/**
 * Session registry and its HTTP routes (PRD F-14, F-24, F-25, F-28, F-29, F-30).
 *
 *   POST   /__crt/sessions                  { captureId?, quick? } → 201 { id } start intake
 *   POST   /__crt/sessions/<id>/capture     { captureId }        → 200          first message (warm start)
 *   GET    /__crt/sessions                                        → { sessions: SessionInfo[] }
 *   GET    /__crt/sessions/<id>/events      SSE; `Last-Event-ID` or `?after=<seq>` replays
 *   POST   /__crt/sessions/<id>/messages    { text }             → 202
 *   POST   /__crt/sessions/<id>/interrupt                        → 202
 *   POST   /__crt/sessions/<id>/permission  { id, behavior }     → 200 | 404 | 409
 *   DELETE /__crt/sessions/<id>                                  → 200   close ("New session")
 *
 * Every event a driver emits is numbered and kept in memory for the life of the server, so a
 * panel that reloads the page (or the developer opening the session list) can rebuild the
 * transcript by replaying from 0. The driver behind each session is whatever `SessionStarter`
 * the server was created with: the SDK one (session.ts) or the stub (session-stub.ts).
 *
 * Warm start (N-2): the overlay may POST /__crt/sessions with no capture as soon as Send is
 * clicked, so the Claude Code process boots while the page is still being rasterised; the
 * capture is attached with POST …/capture once it is saved, which sends the first message.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { capturesDir } from "./captures.js";
import { json, readJson } from "./http.js";
import { buildIntakeMessage, readCaptureBundle, summarizeCapture } from "./intake-message.js";
import { decidePermission } from "./permissions.js";
import type { SessionDriver, SessionEvent, SessionInfo, SessionStarter, SessionState, UserInput, WriteTaskRequest } from "./session-events.js";
import { createTask, displayPath } from "./tasks.js";

export const SESSIONS_PATH = "/__crt/sessions";
const MAX_BODY = 1024 * 1024;
const KEEPALIVE_MS = 15_000;

export interface RegistryOptions {
  projectRoot: string;
  tasksDir: string;
  /** Body of plugin/skills/intake/SKILL.md; `$ARGUMENTS` is replaced with a pointer to the first message. */
  intakePrompt: string;
  start: SessionStarter;
  permissionTimeoutMs?: number;
  log?: (line: string) => void;
}

interface Entry {
  info: SessionInfo;
  driver: SessionDriver;
  events: SessionEvent[];
  subscribers: Set<(seq: number, event: SessionEvent) => void>;
}

export class SessionRegistry {
  private readonly entries = new Map<string, Entry>();
  constructor(private readonly opts: RegistryOptions) {}

  /**
   * F-24: start an intake session. With a capture id the first message is sent immediately;
   * without one the process boots and waits for `attachCapture` (warm start, N-2). `quick`
   * (F-14) makes the first message tell Claude to write the task without waiting for confirmation.
   * Throws when the capture is missing (nothing is started in that case).
   */
  create(captureId: string | null, opts: { quick?: boolean } = {}): SessionInfo {
    const quick = opts.quick === true;
    const id = randomUUID();
    const entry: Entry = {
      info: { id, captureId, startedAt: new Date().toISOString(), state: "starting", taskId: null, quick, summary: null, url: null },
      driver: undefined as unknown as SessionDriver,
      events: [],
      subscribers: new Set(),
    };
    const first = captureId ? this.firstMessage(entry, captureId) : undefined;
    this.entries.set(id, entry);
    const driverOpts = {
      id,
      cwd: this.opts.projectRoot,
      systemPromptAppend: this.opts.intakePrompt.split("$ARGUMENTS").join("the capture directory named in the first message"),
      ...(first ? { first } : {}),
      decide: (toolName: string, input: Record<string, unknown>) => decidePermission(toolName, input, this.opts.projectRoot),
      writeTask: async (request: WriteTaskRequest) => {
        const created = createTask(this.opts.projectRoot, this.opts.tasksDir, { ...request, session: id, captureId: entry.info.captureId });
        entry.info.taskId = created.id;
        return { id: created.id, path: displayPath(this.opts.projectRoot, created.path) };
      },
      log: this.opts.log,
      ...(this.opts.permissionTimeoutMs !== undefined ? { permissionTimeoutMs: this.opts.permissionTimeoutMs } : {}),
    };
    entry.driver = this.opts.start(driverOpts);
    entry.driver.onEvent((event) => this.record(entry, event));
    this.opts.log?.(`crt: ${quick ? "quick-note" : "intake"} session ${id} started${captureId ? ` for capture ${captureId}` : ""} (claude --resume ${id})`);
    return { ...entry.info };
  }

  /** Warm start, step 2: send the capture as the first message. Throws when the capture is missing. */
  attachCapture(id: string, captureId: string): "ok" | "no_session" | "already_started" {
    const e = this.entries.get(id);
    if (!e || isOver(e.info.state)) return "no_session";
    if (e.info.captureId !== null) return "already_started";
    const first = this.firstMessage(e, captureId);
    e.info.captureId = captureId;
    e.driver.send(first);
    this.opts.log?.(`crt: intake session ${id} received capture ${captureId}`);
    return "ok";
  }

  /** Build the F-24 first message and fill the F-30 list fields from the same bundle. */
  private firstMessage(entry: Entry, captureId: string): UserInput {
    const dir = join(capturesDir(this.opts.projectRoot), captureId);
    const bundle = readCaptureBundle(dir);
    entry.info.summary = summarizeCapture(bundle);
    entry.info.url = bundle.page.url;
    return buildIntakeMessage(dir, bundle, { quick: entry.info.quick });
  }

  private record(entry: Entry, event: SessionEvent): void {
    if (event.type === "state") entry.info.state = event.state;
    if (event.type === "task_written") entry.info.taskId = event.id;
    entry.events.push(event);
    const seq = entry.events.length;
    for (const fn of entry.subscribers) fn(seq, event);
  }

  get(id: string): SessionInfo | null {
    const e = this.entries.get(id);
    return e ? { ...e.info } : null;
  }

  /** F-30: newest first. */
  list(): SessionInfo[] {
    return [...this.entries.values()].map((e) => ({ ...e.info })).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /** Replay events with seq > `after`, then stream live ones. Returns an unsubscribe function. */
  subscribe(id: string, after: number, fn: (seq: number, event: SessionEvent) => void): (() => void) | null {
    const e = this.entries.get(id);
    if (!e) return null;
    for (let i = Math.max(0, after); i < e.events.length; i++) fn(i + 1, e.events[i]!);
    e.subscribers.add(fn);
    return () => e.subscribers.delete(fn);
  }

  send(id: string, text: string): boolean {
    const e = this.entries.get(id);
    if (!e || isOver(e.info.state)) return false;
    e.driver.send({ text });
    return true;
  }

  async interrupt(id: string): Promise<boolean> {
    const e = this.entries.get(id);
    if (!e || isOver(e.info.state)) return false;
    await e.driver.interrupt();
    return true;
  }

  respondPermission(id: string, permissionId: string, behavior: "allow" | "deny"): "ok" | "no_session" | "no_permission" {
    const e = this.entries.get(id);
    if (!e) return "no_session";
    return e.driver.respondPermission(permissionId, behavior) ? "ok" : "no_permission";
  }

  close(id: string): boolean {
    const e = this.entries.get(id);
    if (!e) return false;
    e.driver.close();
    return true;
  }

  closeAll(): void {
    for (const e of this.entries.values()) e.driver.close();
  }
}

function isOver(state: SessionState): boolean {
  return state === "ended" || state === "error";
}

function isCaptureId(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9_-]+$/.test(v);
}

/** Route a request under /__crt/sessions. Returns false when the path is not a session route. */
export async function handleSessionRoute(
  path: string,
  query: URLSearchParams,
  req: IncomingMessage,
  res: ServerResponse,
  registry: SessionRegistry,
): Promise<boolean> {
  if (path !== SESSIONS_PATH && !path.startsWith(SESSIONS_PATH + "/")) return false;
  const method = req.method ?? "GET";

  if (path === SESSIONS_PATH) {
    if (method === "GET") {
      json(res, 200, { ok: true, sessions: registry.list() });
      return true;
    }
    if (method !== "POST") {
      json(res, 405, { ok: false, error: "GET lists sessions; POST { captureId?, quick? } starts one" });
      return true;
    }
    const body = await readJson(req, MAX_BODY);
    if (!body.ok) {
      json(res, body.status, { ok: false, error: body.error });
      return true;
    }
    const { captureId, quick } = body.value as { captureId?: unknown; quick?: unknown };
    if (captureId !== undefined && captureId !== null && !isCaptureId(captureId)) {
      json(res, 400, { ok: false, error: "captureId must be a capture id string (or omitted for a warm start)" });
      return true;
    }
    if (quick !== undefined && typeof quick !== "boolean") {
      json(res, 400, { ok: false, error: "quick must be a boolean" });
      return true;
    }
    try {
      const info = registry.create(isCaptureId(captureId) ? captureId : null, { quick: quick === true });
      json(res, 201, { ok: true, id: info.id, session: info });
    } catch (err) {
      const message = (err as Error).message;
      json(res, /not found/.test(message) ? 404 : 500, { ok: false, error: message });
    }
    return true;
  }

  const [id, action] = path.slice(SESSIONS_PATH.length + 1).split("/");
  if (!id || !registry.get(id)) {
    json(res, 404, { ok: false, error: `no session ${id ?? ""}` });
    return true;
  }

  if (action === undefined) {
    if (method === "GET") json(res, 200, { ok: true, session: registry.get(id) });
    else if (method === "DELETE") json(res, 200, { ok: registry.close(id) });
    else json(res, 405, { ok: false, error: "GET or DELETE" });
    return true;
  }
  if (action === "events" && method === "GET") {
    streamEvents(id, query, req, res, registry);
    return true;
  }
  if (method !== "POST") {
    json(res, 405, { ok: false, error: `POST ${path}` });
    return true;
  }
  const body = await readJson(req, MAX_BODY);
  if (!body.ok) {
    json(res, body.status, { ok: false, error: body.error });
    return true;
  }
  const b = body.value as Record<string, unknown>;
  switch (action) {
    case "capture": {
      if (!isCaptureId(b.captureId)) {
        json(res, 400, { ok: false, error: "captureId (string) is required" });
        return true;
      }
      try {
        const r = registry.attachCapture(id, b.captureId);
        json(res, r === "ok" ? 200 : 409, { ok: r === "ok", error: r === "ok" ? undefined : r });
      } catch (err) {
        const message = (err as Error).message;
        json(res, /not found/.test(message) ? 404 : 500, { ok: false, error: message });
      }
      return true;
    }
    case "messages": {
      const text = typeof b.text === "string" ? b.text.trim() : "";
      if (!text) {
        json(res, 400, { ok: false, error: "text (string) is required" });
        return true;
      }
      json(res, registry.send(id, text) ? 202 : 409, { ok: true });
      return true;
    }
    case "interrupt":
      json(res, (await registry.interrupt(id)) ? 202 : 409, { ok: true });
      return true;
    case "permission": {
      const permissionId = typeof b.id === "string" ? b.id : "";
      const behavior = b.behavior === "allow" || b.behavior === "deny" ? b.behavior : null;
      if (!permissionId || !behavior) {
        json(res, 400, { ok: false, error: "id (string) and behavior (allow|deny) are required" });
        return true;
      }
      const r = registry.respondPermission(id, permissionId, behavior);
      json(res, r === "ok" ? 200 : r === "no_session" ? 404 : 409, { ok: r === "ok", error: r === "ok" ? undefined : `${r}: already answered or unknown` });
      return true;
    }
    default:
      json(res, 404, { ok: false, error: `no session action ${action}` });
      return true;
  }
}

/** SSE: `id:` is the event sequence number, so EventSource reconnects resume via Last-Event-ID. */
function streamEvents(id: string, query: URLSearchParams, req: IncomingMessage, res: ServerResponse, registry: SessionRegistry): void {
  const lastHeader = req.headers["last-event-id"];
  const after = Number((Array.isArray(lastHeader) ? lastHeader[0] : lastHeader) ?? query.get("after") ?? 0) || 0;
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write(":ok\n\n");
  const write = (seq: number, event: SessionEvent) => {
    // Unnamed events so a plain EventSource.onmessage receives everything.
    res.write(`id: ${seq}\ndata: ${JSON.stringify(event)}\n\n`);
  };
  const unsubscribe = registry.subscribe(id, after, write);
  const keepalive = setInterval(() => res.write(":ka\n\n"), KEEPALIVE_MS);
  req.on("close", () => {
    clearInterval(keepalive);
    unsubscribe?.();
  });
}
