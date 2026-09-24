/**
 * F-59 driver conformance scenario (PRD-providers §6.6). Not a test file itself — Vitest collects
 * `test/**\/*.test.ts` — but a helper every `test/providers/<id>.test.ts` runs against its driver:
 *
 *   init (nativeSessionId, resumeCommand, capabilities) → streamed text → a tool event →
 *   if `permissions: interactive`: a permission card answered Allow, then another answered Deny →
 *   `write_task` through the driver's real tool path into a temp `.crt/` → task_written → result →
 *   interrupt mid-turn → close.
 *
 * It asserts the `SessionEvent` sequence shape and that the file passes `validateTaskText` with
 * the right `provider:` and `session:`. The driver under test is started through its profile's
 * `start()` with the same `StartSessionOptions` the registry would build (F-50/F-51 per its
 * capabilities), and `writeTask` is the registry's own `createTask` call.
 *
 * `writePath: "stdio"` (Codex and every ACP agent) adds what the registry provides on that path:
 * a per-session bearer token, `POST /__crt/internal/write-task` on 127.0.0.1 behind the real
 * `handleInternalRoute`, and the `task_written` event the registry records when the route has
 * written the file (`sessions.ts` `writeTaskFor`). The caller passes the `crt mcp` shim to spawn.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { expect } from "vitest";
import { buildIntakeMessage, prependInstructions } from "../../src/intake-message.js";
import { MCP_PORT_ENV, MCP_TOKEN_ENV, STALE_TOKEN_LINE } from "../../src/mcp-stdio.js";
import { decidePermission } from "../../src/permissions.js";
import type { ProviderProfile } from "../../src/providers/types.js";
import type { SessionEvent, StartSessionOptions, UserInput, WriteTaskRequest } from "../../src/session-events.js";
import { handleInternalRoute, INTERNAL_PREFIX, type SessionRegistry } from "../../src/sessions.js";
import { createTask, displayPath, parseTask, validateTaskText } from "../../src/tasks.js";
import { waitForEvent } from "../helpers/fake-cli.js";

export interface ConformanceInput {
  profile: ProviderProfile;
  /** Project root with `.crt/tasks/` and a saved capture. */
  root: string;
  captureDir: string;
  /** CRT session id (the registry key). */
  id: string;
  /** Intake instructions text (`$ARGUMENTS` already substituted). */
  intake: string;
  /** Messages that make the driver (a) run a tool that needs permission again, (b) write the task, (c) start a turn to interrupt. */
  prompts: { permissionAgain: string; write: string; longTurn: string };
  /** `stdio`: `write_task` arrives through `crt mcp` and the internal route (F-49); default in-process. */
  writePath?: "in-process" | "stdio";
  /** The `crt mcp` shim to hand the agent when `writePath` is `stdio` (`node <file>`). */
  shim?: { command: string; args: string[] };
  timeoutMs?: number;
}

export interface ConformanceResult {
  events: SessionEvent[];
  init: Extract<SessionEvent, { type: "init" }>;
  taskFile: string;
  options: StartSessionOptions;
}

export async function runConformance(input: ConformanceInput): Promise<ConformanceResult> {
  const { profile, root, id } = input;
  const caps = profile.capabilities;
  const tasksDir = join(root, ".crt", "tasks");
  mkdirSync(tasksDir, { recursive: true });
  const timeoutMs = input.timeoutMs ?? 10_000;
  const events: SessionEvent[] = [];

  // The registry's composition (sessions.ts): images per F-50, instructions per F-51.
  const message = buildIntakeMessage(input.captureDir, undefined, { images: caps.images });
  const first: UserInput = caps.instructions === "first-message" ? prependInstructions(message, input.intake) : message;
  let nativeSessionId: string | null = null;
  const writeTask = async (request: WriteTaskRequest) => {
    const created = createTask(root, tasksDir, { ...request, session: nativeSessionId, provider: profile.id, captureId: null });
    return { id: created.id, path: displayPath(root, created.path) };
  };
  const stdio = input.writePath === "stdio" ? await internalRoute(id, writeTask, (e) => events.push(e)) : null;
  const options: StartSessionOptions = {
    id,
    cwd: root,
    systemPromptAppend: caps.instructions === "system" ? input.intake : "",
    first,
    decide: (tool, args) => decidePermission(tool, args, root),
    writeTask,
    mcp: stdio
      ? { command: input.shim?.command ?? process.execPath, args: input.shim?.args ?? [], env: { [MCP_TOKEN_ENV]: stdio.token, [MCP_PORT_ENV]: String(stdio.port) } }
      : { command: process.execPath, args: ["cli.js", "mcp"], env: { CRT_MCP_TOKEN: "conformance-token", CRT_MCP_PORT: "1" } },
    model: null,
    agentVersion: "conformance",
    permissionTimeoutMs: timeoutMs,
  };

  const driver = profile.start(options);
  driver.onEvent((e) => {
    events.push(e);
    if (e.type === "init") nativeSessionId = e.nativeSessionId;
  });
  const waitFor = (pred: (e: SessionEvent) => boolean, from = 0): Promise<number> => waitForEvent(events, pred, from, timeoutMs);
  const idle = (e: SessionEvent) => e.type === "state" && e.state === "idle";
  const errors = () => events.filter((e) => e.type === "error");

  // init → text → tool event
  const initAt = await waitFor((e) => e.type === "init");
  const init = events[initAt] as Extract<SessionEvent, { type: "init" }>;
  expect(init).toMatchObject({ sessionId: id, provider: profile.id, displayName: profile.displayName, capabilities: caps });
  expect(typeof init.nativeSessionId).toBe("string");
  expect(init.resumeCommand).toBe(caps.resume ? profile.resumeCommand(init.nativeSessionId) : null);
  expect(events.slice(0, initAt).every((e) => e.type === "user" || e.type === "state")).toBe(true);
  await waitFor((e) => e.type === "text");
  await waitFor((e) => e.type === "tool_use");
  await waitFor((e) => e.type === "tool_result");

  // interactive: a card answered Allow on this turn, another answered Deny on the next
  if (caps.permissions === "interactive") {
    const at = await waitFor((e) => e.type === "permission");
    const perm = events[at] as Extract<SessionEvent, { type: "permission" }>;
    expect(events.some((e) => e.type === "state" && e.state === "waiting")).toBe(true);
    expect(driver.respondPermission(perm.id, "allow")).toBe(true);
    await waitFor((e) => e.type === "permission_resolved" && e.id === perm.id && e.behavior === "allow" && e.by === "user");
    await waitFor(idle, at);
    driver.send({ text: input.prompts.permissionAgain });
    const again = await waitFor((e) => e.type === "permission", at + 1);
    const perm2 = events[again] as Extract<SessionEvent, { type: "permission" }>;
    expect(driver.respondPermission(perm2.id, "deny")).toBe(true);
    await waitFor((e) => e.type === "permission_resolved" && e.id === perm2.id && e.behavior === "deny");
    await waitFor(idle, again);
    expect(driver.respondPermission(perm2.id, "allow")).toBe(false);
  } else {
    await waitFor(idle);
    expect(events.some((e) => e.type === "permission")).toBe(false);
    expect(events.some((e) => e.type === "state" && e.state === "waiting")).toBe(false);
  }
  expect(events.some((e) => e.type === "result" && e.ok)).toBe(true);

  // write_task through the driver's real tool path → task_written → result
  const before = events.length;
  driver.send({ text: input.prompts.write });
  const writtenAt = await waitFor((e) => e.type === "task_written", before);
  const written = events[writtenAt] as Extract<SessionEvent, { type: "task_written" }>;
  await waitFor((e) => e.type === "result", writtenAt);
  await waitFor(idle, writtenAt);
  const file = join(root, written.path);
  const text = readFileSync(file, "utf8");
  expect(validateTaskText(text, readdirSync(tasksDir).find((f) => f.startsWith(written.id))!)).toEqual([]);
  expect(parseTask(text).frontmatter).toMatchObject({ id: written.id, provider: profile.id, session: init.nativeSessionId });

  // interrupt mid-turn → result(ok: false) → idle
  const turnAt = events.length;
  driver.send({ text: input.prompts.longTurn });
  await waitFor((e) => e.type === "state" && e.state === "running", turnAt);
  if (caps.interrupt) {
    await driver.interrupt();
    const cut = await waitFor((e) => e.type === "result" && !e.ok, turnAt);
    await waitFor(idle, cut);
  } else {
    await waitFor(idle, turnAt);
  }

  // close → ended; nothing after that
  driver.close();
  await waitFor((e) => e.type === "state" && e.state === "ended");
  expect(errors()).toEqual([]);
  await stdio?.close();
  return { events, init, taskFile: file, options };
}

/**
 * The registry's side of F-49 for one session: a bearer token, the internal route on a random
 * 127.0.0.1 port, and `task_written` recorded when the route has written the file — a minimal
 * `SessionRegistry` duck for `handleInternalRoute`, which is the real route handler.
 */
async function internalRoute(
  sessionId: string,
  writeTask: (request: WriteTaskRequest) => Promise<{ id: string; path: string }>,
  record: (e: SessionEvent) => void,
): Promise<{ token: string; port: number; close: () => Promise<void> }> {
  const token = randomBytes(32).toString("base64url");
  let live = true;
  const registry = {
    sessionForToken: (given: string) => (live && given === token ? sessionId : null),
    writeTaskFor: async (_id: string, request: WriteTaskRequest) => {
      if (!live) throw new Error(STALE_TOKEN_LINE);
      const written = await writeTask(request);
      record({ type: "task_written", id: written.id, path: written.path });
      return written;
    },
    rejectToken: () => undefined,
  } as unknown as SessionRegistry;
  const server: Server = createServer((req, res) => {
    const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (req.headers.origin !== undefined) {
      res.writeHead(403);
      res.end();
      return;
    }
    void handleInternalRoute(path.startsWith(INTERNAL_PREFIX) ? path : INTERNAL_PREFIX + "/none", req, res, registry);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  return {
    token,
    port,
    close: async () => {
      live = false;
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
