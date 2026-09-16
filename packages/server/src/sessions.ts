/**
 * Session registry and its HTTP routes (PRD F-14, F-24, F-25, F-28, F-29, F-30; PRD-providers
 * F-43, F-47, F-49, F-50, F-51, F-57).
 *
 *   POST   /__crt/sessions                  { captureId?, quick?, provider? } → 201 { id } start intake
 *   POST   /__crt/sessions/<id>/capture     { captureId }        → 200          first message (warm start)
 *   GET    /__crt/sessions                                        → { sessions: SessionInfo[] }
 *   GET    /__crt/sessions/<id>/events      SSE; `Last-Event-ID` or `?after=<seq>` replays
 *   POST   /__crt/sessions/<id>/messages    { text }             → 202
 *   POST   /__crt/sessions/<id>/interrupt                        → 202
 *   POST   /__crt/sessions/<id>/permission  { id, behavior }     → 200 | 404 | 409
 *   DELETE /__crt/sessions/<id>                                  → 200   close ("New session")
 *   POST   /__crt/internal/write-task       Authorization: Bearer <session token> → 201 { id, path }
 *
 * Every event a driver emits is numbered and kept in memory for the life of the server, so a
 * panel that reloads the page (or the developer opening the session list) can rebuild the
 * transcript by replaying from 0. The driver behind each session comes from the provider the
 * `ProviderRegistry` resolves for it (session.ts, F-43): Claude on the Agent SDK by default,
 * the scripted stub under `CRT_SESSION_STUB=1`, Codex from CRT-0012.
 *
 * The provider's capabilities (F-46) shape the first message: images by path or inline (F-50)
 * and the intake instructions in the system prompt or prepended to the message (F-51).
 *
 * `write_task` (§5.3, F-49): every session gets a random bearer token. The Claude driver calls
 * `writeTask` in-process; every other agent spawns `crt mcp`, which POSTs to the internal route
 * above with that token. Both call the same function, so the file is the same either way. The
 * token lives only in this process's memory and the shim's environment: it is never in a
 * `SessionInfo`, an event, a log line or a URL (N-8). A wrong or expired token answers 404 with an
 * empty body (one local log line explains it), and any request carrying `Origin` — a browser,
 * never the shim — is refused with 403 before it is read.
 *
 * Warm start (N-2): the overlay may POST /__crt/sessions with no capture as soon as Send is
 * clicked, so the agent process boots while the page is still being rasterised; the capture is
 * attached with POST …/capture once it is saved, which sends the first message.
 */
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { capturesDir } from "./captures.js";
import { json, readJson } from "./http.js";
import { buildIntakeMessage, prependInstructions, readCaptureBundle, summarizeCapture } from "./intake-message.js";
import { INTERNAL_WRITE_TASK_PATH, mcpLaunch, STALE_TOKEN_LINE } from "./mcp-stdio.js";
import { decidePermission } from "./permissions.js";
import { describeResolution, type ProviderRegistry } from "./session.js";
import type { ProviderCapabilities, SessionDriver, SessionEvent, SessionInfo, SessionState, UserInput, WriteTaskRequest } from "./session-events.js";
import { createTask, displayPath, TaskFormatError } from "./tasks.js";
import { parseWriteTaskRequest } from "./write-task.js";

export const SESSIONS_PATH = "/__crt/sessions";
export const INTERNAL_PREFIX = "/__crt/internal";
const MAX_BODY = 1024 * 1024;
const KEEPALIVE_MS = 15_000;

export interface RegistryOptions {
  projectRoot: string;
  tasksDir: string;
  /** Body of plugin/skills/intake/SKILL.md; `$ARGUMENTS` is replaced with a pointer to the first message. */
  intakePrompt: string;
  /** Resolves the provider (and so the driver) for every new session (F-43). */
  providers: ProviderRegistry;
  /** The port CRT listens on, for `crt mcp` to call back (F-49). May be set later via `mcpPort`. */
  port?: number;
  permissionTimeoutMs?: number;
  log?: (line: string) => void;
}

interface Entry {
  info: SessionInfo;
  driver: SessionDriver;
  /** The provider's F-46 matrix; null when the session failed before a driver existed. */
  capabilities: ProviderCapabilities | null;
  /** F-49 bearer token for `POST /__crt/internal/write-task`; valid while the session is live. */
  token: string;
  /** The one write path (§5.3): what the in-process tool and the internal route both call. */
  writeTask: (request: WriteTaskRequest) => Promise<{ id: string; path: string }>;
  events: SessionEvent[];
  subscribers: Set<(seq: number, event: SessionEvent) => void>;
}

export class SessionRegistry {
  private readonly entries = new Map<string, Entry>();
  /** F-49: the port `crt mcp` posts back to; the server sets it once it listens. */
  mcpPort: number;

  constructor(private readonly opts: RegistryOptions) {
    this.mcpPort = opts.port ?? 0;
  }

  /**
   * F-24: start an intake session. With a capture id the first message is sent immediately;
   * without one the process boots and waits for `attachCapture` (warm start, N-2). `quick`
   * (F-14) makes the first message tell the agent to write the task without waiting for
   * confirmation. `provider` is the F-43 step-1 request value; an explicit provider that cannot
   * be used still gets a session, one that fails at once with the N-7 line so the panel shows it.
   * Throws when the capture is missing (nothing is started in that case).
   */
  create(captureId: string | null, opts: { quick?: boolean; provider?: string | null } = {}): SessionInfo {
    const quick = opts.quick === true;
    const id = randomUUID();
    const resolution = this.opts.providers.resolve(opts.provider ?? null);
    const profile = resolution.problem === null ? this.opts.providers.get(resolution.provider) : null;
    const entry: Entry = {
      info: {
        id,
        provider: resolution.provider,
        nativeSessionId: null,
        captureId,
        startedAt: new Date().toISOString(),
        state: "starting",
        taskId: null,
        quick,
        summary: null,
        url: null,
      },
      driver: undefined as unknown as SessionDriver,
      capabilities: profile?.capabilities ?? null,
      token: randomBytes(32).toString("base64url"),
      writeTask: async (request: WriteTaskRequest) => {
        // F-48: `session:` is the provider's own id (§5.4); null until the driver reported it.
        const created = createTask(this.opts.projectRoot, this.opts.tasksDir, {
          ...request,
          session: entry.info.nativeSessionId,
          provider: entry.info.provider,
          captureId: entry.info.captureId,
        });
        entry.info.taskId = created.id;
        return { id: created.id, path: displayPath(this.opts.projectRoot, created.path) };
      },
      events: [],
      subscribers: new Set(),
    };
    const first = captureId ? this.firstMessage(entry, captureId) : undefined;
    this.entries.set(id, entry);
    if (!profile) {
      const problem = resolution.problem ?? `provider "${resolution.provider}" is not available`;
      entry.driver = failedDriver(id, problem);
      entry.driver.onEvent((event) => this.record(entry, event));
      this.opts.log?.(`crt: ${quick ? "quick-note" : "intake"} session ${id} could not start — ${describeResolution(resolution)}`);
      return { ...entry.info };
    }
    const driverOpts = {
      id,
      cwd: this.opts.projectRoot,
      // F-51: `system` gets the instructions here; `first-message` already has them in `first`.
      systemPromptAppend: profile.capabilities.instructions === "system" ? this.intakeText() : "",
      ...(first ? { first } : {}),
      decide: (toolName: string, input: Record<string, unknown>) => decidePermission(toolName, input, this.opts.projectRoot),
      writeTask: entry.writeTask,
      mcp: mcpLaunch(entry.token, this.mcpPort),
      model: this.opts.providers.modelFor(profile.id),
      log: this.opts.log,
      ...(this.opts.permissionTimeoutMs !== undefined ? { permissionTimeoutMs: this.opts.permissionTimeoutMs } : {}),
    };
    entry.driver = profile.start(driverOpts);
    entry.driver.onEvent((event) => this.record(entry, event));
    this.opts.log?.(`crt: ${quick ? "quick-note" : "intake"} session ${id} started on ${profile.id}${captureId ? ` for capture ${captureId}` : ""} (${describeResolution(resolution)})`);
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

  /** The intake instructions with `$ARGUMENTS` pointed at the first message (F-24). */
  private intakeText(): string {
    return this.opts.intakePrompt.split("$ARGUMENTS").join("the capture directory named in the first message");
  }

  /**
   * Build the F-24 first message for the session's provider — images per F-50, instructions
   * per F-51 — and fill the F-30 list fields from the same bundle.
   */
  private firstMessage(entry: Entry, captureId: string): UserInput {
    const dir = join(capturesDir(this.opts.projectRoot), captureId);
    const bundle = readCaptureBundle(dir);
    entry.info.summary = summarizeCapture(bundle);
    entry.info.url = bundle.page.url;
    const caps = entry.capabilities;
    const message = buildIntakeMessage(dir, bundle, { quick: entry.info.quick, images: caps?.images ?? "inline" });
    return caps?.instructions === "first-message" ? prependInstructions(message, this.intakeText()) : message;
  }

  private record(entry: Entry, event: SessionEvent): void {
    if (event.type === "state") entry.info.state = event.state;
    if (event.type === "task_written") entry.info.taskId = event.id;
    if (event.type === "init") {
      // F-47: the provider's own id is known now; that is what `session:` and the resume hint use.
      entry.info.nativeSessionId = event.nativeSessionId;
      const agent = [event.displayName, event.agentVersion].filter(Boolean).join(" ");
      this.opts.log?.(`crt: session ${entry.info.id} is ${agent}${event.model ? ` (${event.model})` : ""}${event.resumeCommand ? `, continue with \`${event.resumeCommand}\`` : ""}`);
    }
    entry.events.push(event);
    const seq = entry.events.length;
    for (const fn of entry.subscribers) fn(seq, event);
  }

  get(id: string): SessionInfo | null {
    const e = this.entries.get(id);
    return e ? { ...e.info } : null;
  }

  /** Ids `POST /__crt/sessions { provider }` may name (F-42: `stub` only under `CRT_SESSION_STUB`). */
  providerIds(): string[] {
    return this.opts.providers.ids();
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

  // ---- F-49: the stdio write path -----------------------------------------------------------------

  /** The F-49 token of a session (tests and drivers' fixtures only; never a route). */
  tokenOf(id: string): string | null {
    return this.entries.get(id)?.token ?? null;
  }

  /** The live session a bearer token belongs to, compared in constant time; null when none. */
  sessionForToken(token: string): string | null {
    const given = Buffer.from(token);
    for (const e of this.entries.values()) {
      const own = Buffer.from(e.token);
      if (own.length === given.length && timingSafeEqual(own, given) && !isOver(e.info.state)) return e.info.id;
    }
    return null;
  }

  /**
   * §5.3: perform a session's `write_task` on the server (the stdio path), emit `task_written`
   * as the in-process tool does, and return what the agent reads back.
   */
  async writeTaskFor(id: string, request: WriteTaskRequest): Promise<{ id: string; path: string }> {
    const e = this.entries.get(id);
    if (!e || isOver(e.info.state)) throw new Error(STALE_TOKEN_LINE);
    const written = await e.writeTask(request);
    this.record(e, { type: "task_written", id: written.id, path: written.path });
    this.opts.log?.(`crt: task ${written.id} written to ${written.path}`);
    return written;
  }

  /** N-7: one local log line for a rejected token (the token itself is never logged). */
  rejectToken(): void {
    this.opts.log?.(`crt: ${STALE_TOKEN_LINE}`);
  }
}

function isOver(state: SessionState): boolean {
  return state === "ended" || state === "error";
}

/**
 * F-43/N-7: a session whose explicitly chosen provider cannot be used. It emits the one-line
 * problem and dies, so the panel shows the reason and the session list keeps the row.
 */
function failedDriver(id: string, problem: string): SessionDriver {
  const listeners = new Set<(e: SessionEvent) => void>();
  // Deferred so the registry can attach onEvent() first, like every real driver.
  queueMicrotask(() => {
    for (const fn of listeners) fn({ type: "error", message: problem });
    for (const fn of listeners) fn({ type: "state", state: "error", detail: problem });
  });
  return {
    id,
    send: () => undefined,
    interrupt: async () => undefined,
    respondPermission: () => false,
    close: () => undefined,
    onEvent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
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
      json(res, 405, { ok: false, error: "GET lists sessions; POST { captureId?, quick?, provider? } starts one" });
      return true;
    }
    const body = await readJson(req, MAX_BODY);
    if (!body.ok) {
      json(res, body.status, { ok: false, error: body.error });
      return true;
    }
    const { captureId, quick, provider } = body.value as { captureId?: unknown; quick?: unknown; provider?: unknown };
    if (captureId !== undefined && captureId !== null && !isCaptureId(captureId)) {
      json(res, 400, { ok: false, error: "captureId must be a capture id string (or omitted for a warm start)" });
      return true;
    }
    if (quick !== undefined && typeof quick !== "boolean") {
      json(res, 400, { ok: false, error: "quick must be a boolean" });
      return true;
    }
    // F-57/N-8: `provider` is a listed string id or nothing; objects and unknown ids never reach the registry.
    if (provider !== undefined && provider !== null) {
      const named = providerId(provider, registry);
      if (named === null) {
        json(res, 400, { ok: false, error: `provider must be one of ${registry.providerIds().join(", ")}` });
        return true;
      }
    }
    try {
      const info = registry.create(isCaptureId(captureId) ? captureId : null, {
        quick: quick === true,
        ...(typeof provider === "string" ? { provider: provider.trim() } : {}),
      });
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

/** A listed provider id from a request body, or null when the value is not one (F-57). */
function providerId(value: unknown, registry: SessionRegistry): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  return registry.providerIds().includes(id) ? id : null;
}

/**
 * F-49: `POST /__crt/internal/write-task` — the stdio shim's call. Bearer token → session; a
 * wrong or expired token is a 404 with an empty body and one log line; the request body is the
 * `write_task` arguments. Returns false when the path is not an internal route. The caller has
 * already refused anything carrying an `Origin` header (proxy.ts).
 */
export async function handleInternalRoute(path: string, req: IncomingMessage, res: ServerResponse, registry: SessionRegistry): Promise<boolean> {
  if (path !== INTERNAL_WRITE_TASK_PATH && !path.startsWith(INTERNAL_PREFIX + "/")) return false;
  if (path !== INTERNAL_WRITE_TASK_PATH) {
    json(res, 404, { ok: false, error: `no CRT route ${path}` });
    return true;
  }
  if (req.method !== "POST") {
    json(res, 405, { ok: false, error: "POST write_task arguments here with the session's bearer token" });
    return true;
  }
  const auth = req.headers.authorization ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(auth)?.[1] ?? "";
  const id = token ? registry.sessionForToken(token) : null;
  if (!id) {
    registry.rejectToken();
    res.writeHead(404);
    res.end();
    return true;
  }
  const body = await readJson(req, MAX_BODY);
  if (!body.ok) {
    json(res, body.status, { ok: false, error: body.error });
    return true;
  }
  const parsed = parseWriteTaskRequest(body.value);
  if (!parsed.ok) {
    json(res, 400, { ok: false, error: parsed.error });
    return true;
  }
  try {
    const written = await registry.writeTaskFor(id, parsed.value);
    json(res, 201, { ok: true, id: written.id, path: written.path });
  } catch (err) {
    if (err instanceof TaskFormatError) json(res, 400, { ok: false, error: err.message, errors: err.errors });
    else if ((err as Error).message === STALE_TOKEN_LINE) {
      registry.rejectToken();
      res.writeHead(404);
      res.end();
    } else json(res, 500, { ok: false, error: `could not write the task: ${(err as Error).message}` });
  }
  return true;
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
