/**
 * The generic Agent Client Protocol driver (PRD-providers F-54, N-7, N-11): one intake session on
 * any agent that speaks ACP over stdio — Gemini CLI through `providers/gemini.ts`, or whatever
 * `.crt/config.json` names as `provider: { kind: "acp", command, args, name }` (the ad-hoc `acp`
 * profile at the bottom of this file). One process per session, newline-delimited JSON-RPC 2.0
 * both ways, hand-rolled (N-11: no SDK; the client is `JsonRpcStdio`, ~80 lines).
 *
 * Verified against Gemini CLI 0.60.0 on Windows, 2026-09-21 (docs/spikes/gemini-acp-2026-09.md;
 * test/providers/fixtures/acp/*.jsonl are its recordings):
 *
 *   → initialize { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false,
 *       writeTextFile: false }, terminal: false } }
 *   ← { protocolVersion: 1, agentInfo { name, title, version }, agentCapabilities
 *       { loadSession, promptCapabilities { image, audio, embeddedContext }, mcpCapabilities },
 *       authMethods [] }            — the agent answers 1 whatever the client asked for, so the
 *                                     reply is what is checked against ACP_PROTOCOL_VERSIONS (N-7).
 *   → session/new { cwd, mcpServers: [{ name: "crt", command: <node>, args: [<cli.js>, "mcp"],
 *       env: [{ name, value }…] }] }   — the stdio form; the token travels in `env` over the
 *                                     agent's stdin, never on a command line (F-49, N-8).
 *   ← { sessionId (a UUID), modes?, models? { currentModelId } }   → `init` (nativeSessionId,
 *                                     model from `currentModelId` when the developer set none)
 *   ← error -32000 "<auth message>"  — a logged-out or ineligible agent fails here, not at
 *                                     initialize: the profile's `loginProblem` maps it to N-7.
 *   → session/prompt { sessionId, prompt: [{ type: "text", text }, { type: "image", mimeType,
 *       data }…] }                     — images only when `promptCapabilities.image` (F-50).
 *   ← session/update notifications { sessionId, update: { sessionUpdate, … } }:
 *       agent_message_chunk { content { type: "text", text } }  → assistant_start / text / assistant_end
 *       agent_thought_chunk                                       ignored
 *       tool_call { toolCallId, title, kind, status, content, locations, rawInput }  → tool_use
 *       tool_call_update { toolCallId, status, content, … }      → tool_result on completed / failed
 *       plan, user_message_chunk, available_commands_update, current_mode_update   ignored
 *   ← session/request_permission { sessionId, toolCall, options [{ optionId, name, kind }] }
 *       kind ∈ allow_once | allow_always | reject_once | reject_always (Gemini offers
 *       proceed_once / cancel, plus proceed_always) → the F-54 policy over tool kinds, a card when
 *       it says ask; answered { outcome: { outcome: "selected", optionId } } or { outcome: "cancelled" }.
 *   ← { stopReason: end_turn | max_tokens | max_turn_requests | refusal | cancelled }  → result
 *   → session/cancel { sessionId } (notification)              — interrupt (F-29); the prompt
 *                                     then resolves with `cancelled`.
 *   close = end stdin, wait 2 s, kill the process tree. `session/load` is never used (§12).
 *
 * Any agent→client request other than `session/request_permission` (fs/*, terminal/*) is answered
 * -32601: the client advertised none of those capabilities.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { relative } from "node:path";
import { isReadOnlyGit, isUnderCrtDir, PERMISSION_TIMEOUT_MS } from "../permissions.js";
import type { PermissionDecision, ProviderCapabilities, SessionDriver, SessionEvent, SessionState, StartSessionOptions, UserInput } from "../session-events.js";
import { packageVersion } from "../version.js";
import { CRT_MCP_SERVER, WRITE_TASK_TOOL } from "../write-task.js";
import { type Executable, killProcessTree, resolveExecutable } from "./exec.js";
import type { PreflightOptions, PreflightResult, ProviderProfile } from "./types.js";

/** ACP protocol versions this client speaks (the agent's `initialize` reply is checked against it). */
export const ACP_PROTOCOL_VERSIONS: readonly number[] = [1];
/** How long `close()` waits for the agent to leave on its own after stdin ends. */
export const ACP_CLOSE_GRACE_MS = 2000;
const STDERR_TAIL_LINES = 30;
/** How long `initialize` + `session/new` may take before the session fails (Gemini needs ~6 s cold). */
const ACP_START_TIMEOUT_MS = 60_000;

// ---- JSON-RPC 2.0 over stdio (N-11) -------------------------------------------------------------

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}
type Json = Record<string, unknown>;
type RpcMessage = { jsonrpc?: string; id?: number | string; method?: string; params?: unknown; result?: unknown; error?: JsonRpcError };

/**
 * Newline-delimited JSON-RPC over a child's stdio: client requests with numeric ids, notifications,
 * and the agent's own requests/notifications routed to handlers. Lines that are not JSON objects
 * are ignored (never fatal); a request the agent answers with `error` rejects with that error.
 */
export class JsonRpcStdio {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: JsonRpcError) => void }>();
  private buffer = "";
  /** Handlers for the agent's requests (must return a result or throw a JsonRpcError) and notifications. */
  onRequest: (method: string, params: unknown) => Promise<unknown> = async (method) => {
    throw { code: -32601, message: `client does not implement ${method}` } satisfies JsonRpcError;
  };
  onNotification: (method: string, params: unknown) => void = () => undefined;

  constructor(private readonly write: (line: string) => void) {}

  request(method: string, params: unknown): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  notify(method: string, params: unknown): void {
    this.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  /** Feed a chunk of the agent's stdout. */
  feed(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) !== -1) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      this.handle(line);
    }
  }

  /** Reject every outstanding request (the agent went away). */
  fail(error: JsonRpcError): void {
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
  }

  handle(line: string): void {
    const msg = parseRpcLine(line);
    if (!msg) return;
    if (msg.method !== undefined) {
      if (msg.id === undefined) return this.onNotification(msg.method, msg.params);
      const id = msg.id;
      this.onRequest(msg.method, msg.params).then(
        (result) => this.write(`${JSON.stringify({ jsonrpc: "2.0", id, result: result ?? null })}\n`),
        (err: unknown) => {
          const error: JsonRpcError = isRpcError(err) ? err : { code: -32603, message: (err as Error)?.message ?? String(err) };
          this.write(`${JSON.stringify({ jsonrpc: "2.0", id, error })}\n`);
        },
      );
      return;
    }
    const p = typeof msg.id === "number" ? this.pending.get(msg.id) : undefined;
    if (!p) return;
    this.pending.delete(msg.id as number);
    if (msg.error) p.reject(msg.error);
    else p.resolve(msg.result);
  }
}

export function parseRpcLine(line: string): RpcMessage | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const v = JSON.parse(trimmed) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as RpcMessage) : null;
  } catch {
    return null;
  }
}

function isRpcError(v: unknown): v is JsonRpcError {
  return Boolean(v) && typeof v === "object" && typeof (v as JsonRpcError).code === "number" && typeof (v as JsonRpcError).message === "string";
}

// ---- protocol shapes (loosely typed: unknown fields are ignored, never fatal) ---------------------

export interface AcpInitializeResult {
  protocolVersion?: number;
  agentInfo?: { name?: string; title?: string; version?: string };
  agentCapabilities?: { loadSession?: boolean; promptCapabilities?: { image?: boolean; audio?: boolean; embeddedContext?: boolean } };
  authMethods?: Array<{ id?: string; name?: string }>;
}
export interface AcpNewSessionResult {
  sessionId?: string;
  models?: { currentModelId?: string };
}
export interface AcpContentBlock {
  type?: string;
  text?: string;
  mimeType?: string;
  data?: string;
}
export interface AcpToolCallContent {
  type?: string;
  content?: AcpContentBlock;
  path?: string;
  terminalId?: string;
}
export interface AcpToolCall {
  toolCallId: string;
  title?: string;
  kind?: string;
  status?: string;
  content?: AcpToolCallContent[];
  locations?: Array<{ path?: string; line?: number }>;
  rawInput?: unknown;
  rawOutput?: unknown;
}
export type AcpUpdate = { sessionUpdate?: string; content?: AcpContentBlock } & Partial<AcpToolCall>;
export interface AcpPermissionOption {
  optionId: string;
  name?: string;
  kind?: string;
}
export interface AcpPermissionRequest {
  sessionId?: string;
  toolCall?: AcpToolCall;
  options?: AcpPermissionOption[];
}
export type AcpPermissionOutcome = { outcome: { outcome: "selected"; optionId: string } } | { outcome: { outcome: "cancelled" } };

// ---- pure pieces ----------------------------------------------------------------------------------

/** N-7: the agent's `initialize` reply names a protocol version this client does not speak. */
export const unsupportedProtocol = (name: string, version: unknown): string => `${name} speaks ACP ${String(version)}; CRT supports ${ACP_PROTOCOL_VERSIONS.join(", ")} — update CRT or the agent`;
const agentExited = (name: string, code: number | null, tail: string) => `${name} exited${code === null ? "" : ` with code ${code}`} during the session${tail ? ` (${tail})` : ""}`;

/**
 * F-54: what the `init` event carries after `initialize` — the profile's declared capabilities,
 * with `images` lowered to `none` when the agent does not advertise image prompts (F-50).
 */
export function negotiateCapabilities(declared: ProviderCapabilities, init: AcpInitializeResult): ProviderCapabilities {
  const image = init.agentCapabilities?.promptCapabilities?.image === true;
  return { ...declared, images: image && declared.images !== "none" ? declared.images : "none" };
}

/**
 * F-54 policy over ACP tool kinds (F-26 as amended): read / search / think / other-with-no-
 * locations → allow; edit / delete / move → allow when every location is under `.crt/`, else ask;
 * execute → allow for a read-only git command, else ask; fetch → deny (N-4); anything else → ask.
 */
export function decideAcpPermission(toolCall: AcpToolCall, projectRoot: string): PermissionDecision {
  const kind = toolCall.kind ?? "other";
  const locations = (toolCall.locations ?? []).map((l) => l.path).filter((p): p is string => typeof p === "string");
  switch (kind) {
    case "read":
    case "search":
    case "think":
      return { kind: "allow" };
    case "other":
      return locations.length === 0 ? { kind: "allow" } : { kind: "ask" };
    case "edit":
    case "delete":
    case "move":
      return locations.length > 0 && locations.every((p) => isUnderCrtDir(p, projectRoot)) ? { kind: "allow" } : { kind: "ask" };
    case "execute":
      return isReadOnlyGit(commandOf(toolCall)) ? { kind: "allow" } : { kind: "ask" };
    case "fetch":
      return { kind: "deny", reason: "fetching from the network is disabled during CRT intake (nothing leaves the machine)" };
    default:
      return { kind: "ask" };
  }
}

/** The command an `execute` tool call would run: `rawInput.command` when present, else the title. */
export function commandOf(toolCall: AcpToolCall): string {
  const raw = toolCall.rawInput;
  if (raw && typeof raw === "object" && typeof (raw as Json).command === "string") return (raw as Json).command as string;
  return toolCall.title ?? "";
}

/**
 * F-54 option mapping: allow → the `allow_once` option (never `allow_always`); deny → `reject_once`;
 * without a matching kind the first option whose kind starts with `allow` / `reject`; none → cancelled.
 */
export function pickPermissionOption(options: AcpPermissionOption[], behavior: "allow" | "deny"): AcpPermissionOutcome {
  const want = behavior === "allow" ? "allow_once" : "reject_once";
  const prefix = behavior === "allow" ? "allow" : "reject";
  const exact = options.find((o) => o.kind === want) ?? options.find((o) => typeof o.kind === "string" && o.kind.startsWith(prefix));
  return exact ? { outcome: { outcome: "selected", optionId: exact.optionId } } : { outcome: { outcome: "cancelled" } };
}

/** F-25-style label for a tool call: the agent's title, or `Write task: <title>` for CRT's own tool. */
export function acpToolLabel(toolCall: AcpToolCall): string {
  const raw = toolCall.rawInput;
  const title = toolCall.title ?? toolCall.kind ?? "tool";
  if (/write[_ ]task/i.test(title) && raw && typeof raw === "object" && typeof (raw as Json).title === "string") return `Write task: ${(raw as Json).title as string}`;
  return summarize(title) || toolCall.kind || "tool";
}

/** The tool name the panel shows: `mcp__crt__write_task` for CRT's tool, else the ACP kind. */
export function acpToolName(toolCall: AcpToolCall): string {
  if (/write[_ ]task/i.test(toolCall.title ?? "")) return `mcp__${CRT_MCP_SERVER}__${WRITE_TASK_TOOL}`;
  return toolCall.kind ?? "other";
}

/** The collapsed result line of a completed or failed tool call: its text content, else the status. */
export function acpToolSummary(update: AcpToolCall): string {
  const texts = (update.content ?? []).map((c) => (c.type === "content" ? (c.content?.text ?? "") : c.type === "diff" ? `diff ${c.path ?? ""}` : c.type ?? "")).filter(Boolean);
  const text = summarize(texts.join(" "));
  if (text) return text;
  const raw = update.rawOutput;
  if (typeof raw === "string") return summarize(raw) || "done";
  return update.status === "failed" ? "failed" : "done";
}

/** The human-readable body of a permission card. */
export function describeToolCall(toolCall: AcpToolCall, cwd: string): string {
  const command = commandOf(toolCall);
  if (toolCall.kind === "execute" && command) return command;
  const paths = (toolCall.locations ?? []).map((l) => l.path).filter((p): p is string => typeof p === "string");
  if (paths.length) return paths.map((p) => shortPath(p, cwd)).join(", ");
  const raw = toolCall.rawInput;
  if (raw !== undefined) {
    const text = typeof raw === "string" ? raw : JSON.stringify(raw);
    return text.length > 500 ? `${text.slice(0, 497)}…` : text;
  }
  return toolCall.title ?? toolCall.kind ?? "";
}

function shortPath(p: string, cwd: string): string {
  const r = relative(cwd, p);
  return r && !r.startsWith("..") ? r.split("\\").join("/") : p;
}

function summarize(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 160 ? `${t.slice(0, 157)}…` : t;
}

/** F-50: what the first message says when the agent turned out not to take images (the intake-message.ts wording). */
export const IMAGES_DROPPED_LINE = "Images not attached: this agent does not accept images; the screenshots are the PNG files next to capture.json.";

/**
 * F-50: the `session/prompt` content blocks for one developer message. When `initialize` negotiated
 * `images: none` after the registry had already attached them, the blocks are dropped and the text
 * says so up front (the F-14 quick-note paragraph must stay last).
 */
export function promptBlocks(input: UserInput, images: boolean): AcpContentBlock[] {
  const attached = (input.images ?? []).filter((img) => img.data);
  const text = !images && attached.length ? `${IMAGES_DROPPED_LINE}\n\n${input.text}` : input.text;
  const blocks: AcpContentBlock[] = [{ type: "text", text }];
  if (images) for (const img of attached) blocks.push({ type: "image", mimeType: img.mediaType, data: img.data });
  return blocks;
}

/**
 * Maps one turn's `session/update` notifications to `SessionEvent`s (the F-54 table). Pure apart
 * from `emit`, so the recorded fixtures replay through it without a process. Text chunks open
 * one assistant message that a tool call or the end of the turn closes.
 */
export class AcpTurnMapper {
  private message: string | null = null;
  private messages = 0;
  private readonly seen = new Set<string>();
  /** A `write_task` tool call was seen this turn (F-53's missing-MCP warning applies to ACP too). */
  sawWriteTask = false;

  constructor(
    private readonly emit: (e: SessionEvent) => void,
    /** Turn number: tool-call ids and message ids are namespaced per turn so the panel can tell turns apart. */
    private readonly turn = 1,
  ) {}

  private id(toolCallId: string): string {
    return `t${this.turn}-${toolCallId}`;
  }

  handle(update: AcpUpdate): void {
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const text = update.content?.type === "text" ? (update.content.text ?? "") : "";
        if (!text) return;
        if (this.message === null) {
          this.message = `t${this.turn}-msg-${++this.messages}`;
          this.emit({ type: "assistant_start", messageId: this.message });
        }
        this.emit({ type: "text", messageId: this.message, text });
        return;
      }
      case "tool_call": {
        if (typeof update.toolCallId !== "string") return;
        this.endMessage();
        const call = update as AcpToolCall;
        this.seen.add(call.toolCallId);
        if (acpToolName(call).endsWith(WRITE_TASK_TOOL)) this.sawWriteTask = true;
        this.emit({ type: "tool_use", id: this.id(call.toolCallId), name: acpToolName(call), label: acpToolLabel(call) });
        if (call.status === "completed" || call.status === "failed") this.emit({ type: "tool_result", id: this.id(call.toolCallId), isError: call.status === "failed", summary: acpToolSummary(call) });
        return;
      }
      case "tool_call_update": {
        if (typeof update.toolCallId !== "string") return;
        const call = update as AcpToolCall;
        if (call.status !== "completed" && call.status !== "failed") return;
        if (!this.seen.has(call.toolCallId)) {
          this.seen.add(call.toolCallId);
          this.emit({ type: "tool_use", id: this.id(call.toolCallId), name: acpToolName(call), label: acpToolLabel(call) });
        }
        if (acpToolName(call).endsWith(WRITE_TASK_TOOL)) this.sawWriteTask = true;
        this.emit({ type: "tool_result", id: this.id(call.toolCallId), isError: call.status === "failed", summary: acpToolSummary(call) });
        return;
      }
      default:
        return; // agent_thought_chunk, plan, user_message_chunk, available_commands_update, current_mode_update, …
    }
  }

  /** Close the open assistant message, if any (a tool call or the end of the turn). */
  endMessage(): void {
    if (this.message === null) return;
    this.emit({ type: "assistant_end", messageId: this.message });
    this.message = null;
  }
}

// ---- the driver -----------------------------------------------------------------------------------

/** What an ACP profile tells the driver about its agent (Gemini, or the ad-hoc command). */
export interface AcpAgentSpec {
  id: string;
  displayName: string;
  capabilities: ProviderCapabilities;
  resumeCommand: (nativeSessionId: string) => string | null;
  /** The executable to spawn (`providers.<id>.command` already applied), or null with the N-7 line. */
  resolve: (opts: StartSessionOptions) => Executable | null;
  /** Arguments that put the agent in ACP mode (`--acp` for Gemini; none for an ad-hoc command). */
  acpArgs: string[];
  /**
   * F-57 `models.<id>`: how the agent takes a model on its command line (`-m` for Gemini). Absent
   * for an ad-hoc agent — the developer's model is then not passed on, and the `init` event reports
   * only what the agent says it runs (`session/new` `models.currentModelId`).
   */
  modelArgs?: (model: string) => string[];
  /** F-54 (M10): the profile ships untested against a real agent; carried on the `init` event for the footer badge. */
  experimental?: string;
  notFound: string;
  /** N-7: map an auth failure the agent reports (a `session/new` error, stderr) to the not-logged-in line, or null. */
  loginProblem: (message: string) => string | null;
}

/** What the driver needs from the OS; tests replace the spawn to drive a fake in-process. */
export interface AcpProcessDeps {
  spawn: (command: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => ChildProcess;
  killTree: (pid: number) => boolean;
  /** Time source and timers (tests shorten the close grace). */
  closeGraceMs?: number;
}

const realDeps: AcpProcessDeps = {
  spawn: (command, args, opts) =>
    spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    }),
  killTree: (pid) => killProcessTree(pid),
};

interface PendingPermission {
  settle: (behavior: "allow" | "deny", by: "user" | "timeout" | "session") => void;
}

export function startAcpSession(opts: StartSessionOptions, spec: AcpAgentSpec, deps: AcpProcessDeps = realDeps): SessionDriver {
  const listeners = new Set<(e: SessionEvent) => void>();
  const pending = new Map<string, PendingPermission>();
  const queue: UserInput[] = [];
  const stderrTail: string[] = [];
  const log = opts.log ?? (() => undefined);
  let state: SessionState = "starting";
  let closed = false;
  let child: ChildProcess | null = null;
  let rpc: JsonRpcStdio | null = null;
  let nativeSessionId: string | null = null;
  let capabilities = spec.capabilities;
  let turns = 0;
  let mapper: AcpTurnMapper | null = null;
  let interrupted = false;
  let busy = false;
  let ready = false;

  const emit = (e: SessionEvent) => {
    for (const fn of listeners) {
      try {
        fn(e);
      } catch {
        // a listener failing must not take the session down
      }
    }
  };
  const setState = (next: SessionState, detail?: string) => {
    if (closed) return;
    state = next;
    emit(detail === undefined ? { type: "state", state: next } : { type: "state", state: next, detail });
  };
  const denyAllPending = (by: "user" | "timeout" | "session") => {
    for (const p of [...pending.values()]) p.settle("deny", by);
  };
  const killNow = () => {
    const pid = child?.pid;
    child = null;
    if (pid) deps.killTree(pid);
  };
  const fail = (problem: string) => {
    if (closed) return;
    emit({ type: "error", message: problem });
    setState("error", problem);
    closed = true;
    queue.length = 0;
    denyAllPending("session");
    rpc?.fail({ code: -32000, message: problem });
    killNow();
  };
  const tail = () => stderrTail.slice(-2).join(" | ");

  // ---- agent → client ----
  const onUpdate = (params: unknown) => {
    const update = (params as { update?: AcpUpdate } | null)?.update;
    if (!update || !mapper) return;
    mapper.handle(update);
  };
  const onPermission = async (params: unknown): Promise<AcpPermissionOutcome> => {
    const req = (params ?? {}) as AcpPermissionRequest;
    const toolCall: AcpToolCall = req.toolCall ?? { toolCallId: randomUUID() };
    const options = req.options ?? [];
    if (closed || interrupted) return { outcome: { outcome: "cancelled" } };
    const decision = decideAcpPermission(toolCall, opts.cwd);
    if (decision.kind === "allow") return pickPermissionOption(options, "allow");
    if (decision.kind === "deny") return pickPermissionOption(options, "deny");
    const behavior = await askCard(toolCall);
    if (closed || interrupted) return { outcome: { outcome: "cancelled" } };
    return pickPermissionOption(options, behavior);
  };
  const askCard = (toolCall: AcpToolCall): Promise<"allow" | "deny"> =>
    new Promise((resolve) => {
      const id = randomUUID();
      const timeoutMs = opts.permissionTimeoutMs ?? PERMISSION_TIMEOUT_MS;
      const timer = setTimeout(() => settle("deny", "timeout"), timeoutMs);
      const settle = (behavior: "allow" | "deny", by: "user" | "timeout" | "session") => {
        if (!pending.delete(id)) return;
        clearTimeout(timer);
        emit({ type: "permission_resolved", id, behavior, by });
        if (pending.size === 0 && state === "waiting") setState("running");
        resolve(behavior);
      };
      pending.set(id, { settle });
      emit({
        type: "permission",
        id,
        toolName: acpToolName(toolCall),
        title: toolCall.title ?? `${spec.displayName} wants to use ${toolCall.kind ?? "a tool"}`,
        detail: describeToolCall(toolCall, opts.cwd),
        expiresAt: Date.now() + timeoutMs,
      });
      setState("waiting");
    });

  // ---- process ----
  const start = async () => {
    const exe = spec.resolve(opts);
    if (!exe) return fail(spec.notFound);
    let proc: ChildProcess;
    try {
      const modelArgs = opts.model && spec.modelArgs ? spec.modelArgs(opts.model) : [];
      proc = deps.spawn(exe.command, [...exe.args, ...spec.acpArgs, ...modelArgs], { cwd: opts.cwd, env: process.env });
    } catch (err) {
      return fail(`could not start ${spec.displayName} (${(err as Error).message})`);
    }
    child = proc;
    const client = new JsonRpcStdio((line) => {
      proc.stdin?.write(line);
    });
    rpc = client;
    client.onNotification = (method, params) => {
      if (method === "session/update") onUpdate(params);
    };
    client.onRequest = async (method, params) => {
      if (method === "session/request_permission") return onPermission(params);
      throw { code: -32601, message: `client does not implement ${method}` } satisfies JsonRpcError;
    };
    proc.stdin?.on("error", () => undefined);
    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", (chunk: string) => client.feed(chunk));
    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (!line.trim()) continue;
        stderrTail.push(line);
        if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
      }
    });
    proc.on("error", (err: NodeJS.ErrnoException) => fail(err.code === "ENOENT" ? spec.notFound : `could not start ${spec.displayName} (${err.message})`));
    proc.on("exit", (code) => {
      if (child !== proc) return; // closed on purpose
      child = null;
      if (closed) return;
      log(`crt: ${spec.id} exited with code ${code}; stderr tail: ${stderrTail.slice(-5).join(" | ")}`);
      fail(spec.loginProblem(stderrTail.join("\n")) ?? agentExited(spec.displayName, code, tail()));
    });

    const timer = setTimeout(() => fail(`${spec.displayName} did not finish initialize + session/new within ${ACP_START_TIMEOUT_MS / 1000} s${tail() ? ` (${tail()})` : ""}`), ACP_START_TIMEOUT_MS);
    try {
      const init = (await client.request("initialize", {
        protocolVersion: ACP_PROTOCOL_VERSIONS[ACP_PROTOCOL_VERSIONS.length - 1],
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: "crt", version: packageVersion() },
      })) as AcpInitializeResult | null;
      if (closed) return;
      const version = init?.protocolVersion;
      if (typeof version !== "number" || !ACP_PROTOCOL_VERSIONS.includes(version)) return fail(unsupportedProtocol(spec.displayName, version));
      capabilities = negotiateCapabilities(spec.capabilities, init ?? {});
      const session = (await client.request("session/new", {
        cwd: opts.cwd,
        mcpServers: [{ name: CRT_MCP_SERVER, command: opts.mcp.command, args: opts.mcp.args, env: Object.entries(opts.mcp.env).map(([name, value]) => ({ name, value })) }],
      })) as AcpNewSessionResult | null;
      if (closed) return;
      const sessionId = session?.sessionId;
      if (typeof sessionId !== "string" || !sessionId) return fail(`${spec.displayName} started without a session id — cannot continue this session`);
      nativeSessionId = sessionId;
      emit({
        type: "init",
        sessionId: opts.id,
        nativeSessionId: sessionId,
        provider: spec.id,
        displayName: spec.displayName,
        model: (spec.modelArgs ? opts.model : null) ?? session?.models?.currentModelId ?? null,
        agentVersion: opts.agentVersion ?? init?.agentInfo?.version ?? null,
        resumeCommand: capabilities.resume ? spec.resumeCommand(sessionId) : null,
        capabilities,
        ...(spec.experimental ? { experimental: spec.experimental } : {}),
      });
      ready = true;
      if (queue.length) void pump();
      else setState("idle");
    } catch (err) {
      if (closed) return;
      const message = isRpcError(err) ? err.message : (err as Error)?.message ?? String(err);
      fail(spec.loginProblem(message) ?? spec.loginProblem(stderrTail.join("\n")) ?? `${spec.displayName} could not start a session: ${message}`);
    } finally {
      clearTimeout(timer);
    }
  };

  // ---- turns ----
  const runTurn = async (input: UserInput) => {
    if (closed || !rpc || !nativeSessionId) return;
    const started = Date.now();
    const turn = new AcpTurnMapper(emit, ++turns);
    mapper = turn;
    interrupted = false;
    setState("running");
    try {
      const r = (await rpc.request("session/prompt", { sessionId: nativeSessionId, prompt: promptBlocks(input, capabilities.images === "inline") })) as { stopReason?: string } | null;
      if (closed) return;
      turn.endMessage();
      const stop = r?.stopReason ?? "end_turn";
      if (stop === "cancelled" || interrupted) {
        emit({ type: "result", ok: false, durationMs: Date.now() - started, costUsd: 0, errors: ["interrupted"] });
      } else {
        emit({ type: "result", ok: true, durationMs: Date.now() - started, costUsd: 0, errors: [], ...(stop !== "end_turn" ? { detail: `stopped: ${stop}` } : {}) });
      }
      setState("idle");
    } catch (err) {
      if (closed) return;
      turn.endMessage();
      const message = isRpcError(err) ? err.message : (err as Error)?.message ?? String(err);
      const login = spec.loginProblem(message);
      emit({ type: "error", message });
      emit({ type: "result", ok: false, durationMs: Date.now() - started, costUsd: 0, errors: [message] });
      if (login) fail(login);
      else setState("idle");
    } finally {
      if (mapper === turn) mapper = null;
    }
  };
  const pump = async () => {
    if (busy || !ready) return;
    busy = true;
    try {
      while (queue.length && !closed) await runTurn(queue.shift()!);
    } finally {
      busy = false;
    }
  };
  const enqueue = (input: UserInput) => {
    if (closed) return;
    emit({ type: "user", text: input.text, images: (input.images ?? []).map((i) => i.label) });
    queue.push(input);
    void pump();
  };

  if (opts.first) {
    const first = opts.first;
    queueMicrotask(() => enqueue(first));
  }
  queueMicrotask(() => void start());

  return {
    id: opts.id,
    send(u) {
      enqueue(u);
    },
    async interrupt() {
      if (closed || !rpc || !nativeSessionId || state !== "running" && state !== "waiting") return;
      interrupted = true;
      denyAllPending("session");
      rpc.notify("session/cancel", { sessionId: nativeSessionId });
    },
    respondPermission(id, behavior) {
      const p = pending.get(id);
      if (!p) return false;
      p.settle(behavior, "user");
      return true;
    },
    close() {
      if (closed) return;
      closed = true;
      queue.length = 0;
      denyAllPending("session");
      rpc?.fail({ code: -32000, message: "session closed" });
      const proc = child;
      child = null;
      state = "ended";
      emit({ type: "state", state: "ended" });
      if (!proc?.pid) return;
      // F-54 close: end stdin, give the agent a moment to leave, then kill the tree.
      const pid = proc.pid;
      let exited = false;
      proc.once("exit", () => {
        exited = true;
      });
      try {
        proc.stdin?.end();
      } catch {
        // already gone
      }
      // Should CRT itself exit during the grace (Ctrl+C runs closeAll then process.exit), kill synchronously
      // so neither the agent nor its `crt mcp` child is orphaned.
      const onExit = () => {
        if (!exited) deps.killTree(pid);
      };
      process.once("exit", onExit);
      proc.once("exit", () => process.off("exit", onExit));
      const grace = setTimeout(() => {
        process.off("exit", onExit);
        if (!exited) deps.killTree(pid);
      }, deps.closeGraceMs ?? ACP_CLOSE_GRACE_MS);
      grace.unref();
    },
    onEvent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

// ---- the ad-hoc `acp` profile (F-54) --------------------------------------------------------------

/** `.crt/config.json` `provider: { kind: "acp", … }` as `init.ts` reads it. */
export interface AcpProviderConfig {
  kind: "acp";
  command: string;
  args: string[];
  name: string;
}

/** F-46 for an agent CRT knows nothing about: everything ACP offers, no resume, images negotiated. */
export const ACP_CAPABILITIES: ProviderCapabilities = {
  streaming: true,
  toolEvents: true,
  permissions: "interactive",
  images: "inline",
  resume: false,
  interrupt: true,
  instructions: "first-message",
};

/** F-54 (M10): an agent CRT has never met is experimental by definition (Simon, 2026-09-21). */
export const ACP_EXPERIMENTAL = "experimental: an agent CRT has never met — capabilities negotiated at start, tested against the fake ACP agent only; report what you see";
export const acpNotFound = (command: string): string => `${command} not found on PATH — install it, or fix provider.command in .crt/config.json`;

/** N-7 for an agent without a known login command: quote what the agent said. */
export function acpLoginProblem(name: string, message: string): string | null {
  const re = /api key|not logged in|log ?in|sign ?in|authenticat|credential|unauthori[sz]ed|401\b|no longer supported/i;
  const line = message.split(/\r?\n/).find((l) => re.test(l));
  return line === undefined ? null : `not logged in to ${name} — ${summarize(line)}`;
}

/**
 * F-54 ad-hoc: a profile with id `acp` for `provider: { kind: "acp", command, args, name }` —
 * no markers, no launch signal, no resume, no skills directory, preflight = "the command resolves".
 */
export function adHocAcpProfile(config: AcpProviderConfig): ProviderProfile {
  const argv = [config.command, ...config.args];
  const resolve = (command?: string[] | null, env?: NodeJS.ProcessEnv) => resolveExecutable(config.command, { command: command?.length ? command : argv, ...(env ? { env } : {}) });
  return {
    id: "acp",
    displayName: config.name,
    agentName: `${config.name} (ACP)`,
    markers: { private: [], shared: [] },
    launchEnv: [],
    hints: { install: `install ${config.command} and put it on PATH`, login: `log in with ${config.name}'s own command` },
    capabilities: ACP_CAPABILITIES,
    experimental: ACP_EXPERIMENTAL,
    telemetryOptOut: [],
    skillsDirs: () => ({ project: null, user: null }),
    preflight: async (opts: PreflightOptions = {}): Promise<PreflightResult> => {
      const exe = resolve(opts.command, opts.env);
      return exe ? { installed: true, loggedIn: "unknown", version: null, problem: null } : { installed: false, loggedIn: "unknown", version: null, problem: acpNotFound(config.command) };
    },
    resumeCommand: () => null,
    start: (opts) =>
      startAcpSession(opts, {
        id: "acp",
        displayName: config.name,
        capabilities: ACP_CAPABILITIES,
        resumeCommand: () => null,
        resolve: (o) => resolve(o.command),
        acpArgs: [],
        experimental: ACP_EXPERIMENTAL,
        notFound: acpNotFound(config.command),
        loginProblem: (message) => acpLoginProblem(config.name, message),
      }),
  };
}
