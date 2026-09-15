/**
 * The `claude` provider: an intake session on the Claude Agent SDK (PRD §5.3, F-24…F-29, N-6;
 * PRD-providers F-52). The v0.1 driver, unchanged in behaviour, plus its profile (F-42).
 *
 * This is the only module that imports `@anthropic-ai/claude-agent-sdk` (CLAUDE.md, PRD §12).
 * It exposes `claudeProfile` and `startSession`, which returns a `SessionDriver`
 * (session-events.ts); everything above it — the registry, SSE, the panel — talks to that
 * interface only, so the SDK surface used here stays small and swappable:
 *
 *   query({ prompt: <async iterable of user messages>, options })   streaming input (F-25)
 *   options: cwd, sessionId, settingSources, systemPrompt preset+append, includePartialMessages,
 *            permissionMode 'default', canUseTool, mcpServers (one in-process tool: write_task)
 *   q.interrupt(), q.close()
 *
 * Messages consumed: system/init, stream_event (text deltas), assistant (tool_use blocks),
 * user (tool_result blocks), result, auth_status.
 *
 * Preflight (F-52): the SDK's bundled `claude` binary resolves → installed; login is only known
 * once a session starts (`loginProblem`), so `loggedIn` is "unknown"; the version is the SDK's.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import {
  type CanUseTool,
  createSdkMcpServer,
  type Options,
  type PermissionResult,
  query,
  type Query,
  type SDKAssistantMessage,
  type SDKMessage,
  type SDKPartialAssistantMessage,
  type SDKUserMessage,
  tool,
} from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod/v4";
import { PERMISSION_TIMEOUT_MS } from "../permissions.js";
import type {
  ProviderCapabilities,
  SessionDriver,
  SessionEvent,
  SessionState,
  StartSessionOptions,
  UserInput,
  WriteTaskRequest,
} from "../session-events.js";
import type { PreflightResult, ProviderProfile } from "./types.js";

export const CRT_MCP_SERVER = "crt";
export const WRITE_TASK_TOOL = "write_task";
/** How the tool is named in canUseTool / permission rules. */
export const WRITE_TASK_TOOL_FULL = `mcp__${CRT_MCP_SERVER}__${WRITE_TASK_TOOL}`;

const STDERR_TAIL_LINES = 30;
const SDK_PACKAGE = "@anthropic-ai/claude-agent-sdk";

/** F-46 reference values for Claude Code. */
export const CLAUDE_CAPABILITIES: ProviderCapabilities = {
  streaming: true,
  toolEvents: true,
  permissions: "interactive",
  images: "inline",
  resume: true,
  interrupt: true,
  instructions: "system",
};

/** F-42/F-52: the `claude` profile. Markers per F-44; `CLAUDECODE` is what Claude Code sets in its shells. */
export const claudeProfile: ProviderProfile = {
  id: "claude",
  displayName: "Claude",
  agentName: "Claude Code (Agent SDK)",
  markers: { private: [".claude/", "CLAUDE.md"], shared: ["AGENTS.md"] },
  launchEnv: ["CLAUDECODE"],
  hints: { install: "reinstall claude-review-tool (npm install)", login: "run `claude` in a terminal and complete /login" },
  capabilities: CLAUDE_CAPABILITIES,
  telemetryOptOut: [],
  preflight: async () => claudePreflight(),
  resumeCommand: (id) => `claude --resume ${id}`,
  start: startSession,
};

/**
 * F-52: the SDK ships the CLI as `@anthropic-ai/claude-agent-sdk-<platform>-<arch>/claude[.exe]`;
 * if that package is missing the install is broken (the N-6 line `describeSessionError` prints).
 */
export function claudePreflight(platform: NodeJS.Platform = process.platform, arch: string = process.arch): PreflightResult {
  const require = createRequire(import.meta.url);
  let version: string | null = null;
  try {
    const sdkMain = require.resolve(SDK_PACKAGE);
    version = (JSON.parse(readFileSync(join(dirname(sdkMain), "package.json"), "utf8")) as { version?: string }).version ?? null;
  } catch {
    // resolution below reports the problem
  }
  try {
    require.resolve(`${SDK_PACKAGE}-${platform}-${arch}/claude${platform === "win32" ? ".exe" : ""}`);
  } catch {
    return {
      installed: false,
      loggedIn: "unknown",
      version,
      problem: `Claude Code binary not found — reinstall claude-review-tool (\`npm install\`) so ${SDK_PACKAGE}-${platform}-${arch} is present`,
    };
  }
  return { installed: true, loggedIn: "unknown", version, problem: null };
}

/** Streaming-input source for `query()`: a queue the panel pushes user messages into. */
class InputQueue implements AsyncIterable<SDKUserMessage> {
  private items: SDKUserMessage[] = [];
  private waiters: Array<() => void> = [];
  private done = false;

  push(message: SDKUserMessage): void {
    if (this.done) return;
    this.items.push(message);
    this.wake();
  }

  end(): void {
    this.done = true;
    this.wake();
  }

  private wake(): void {
    const w = this.waiters;
    this.waiters = [];
    for (const fn of w) fn();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage, void> {
    for (;;) {
      const next = this.items.shift();
      if (next) {
        yield next;
      } else if (this.done) {
        return;
      } else {
        await new Promise<void>((resolve) => this.waiters.push(resolve));
      }
    }
  }
}

interface PendingPermission {
  settle: (behavior: "allow" | "deny", by: "user" | "timeout" | "session") => void;
}

export function startSession(opts: StartSessionOptions): SessionDriver {
  const listeners = new Set<(e: SessionEvent) => void>();
  const pending = new Map<string, PendingPermission>();
  const input = new InputQueue();
  const stderrTail: string[] = [];
  const streamedMessages = new Set<string>();
  const log = opts.log ?? (() => undefined);
  let state: SessionState = "starting";
  let closed = false;
  let q: Query | null = null;

  const emit = (event: SessionEvent) => {
    for (const fn of listeners) {
      try {
        fn(event);
      } catch {
        // a listener failing must not take the session down
      }
    }
  };
  const setState = (next: SessionState, detail?: string) => {
    if (state === "error" || state === "ended") return;
    state = next;
    emit(detail === undefined ? { type: "state", state: next } : { type: "state", state: next, detail });
  };
  const fail = (message: string) => {
    if (state === "error" || state === "ended") return;
    emit({ type: "error", message });
    state = "error";
    emit({ type: "state", state: "error", detail: message });
    denyAllPending("session");
  };
  const denyAllPending = (by: "user" | "timeout" | "session") => {
    for (const p of [...pending.values()]) p.settle("deny", by);
  };

  const canUseTool: CanUseTool = async (toolName, toolInput, options) => {
    const decision = opts.decide(toolName, toolInput);
    if (decision.kind === "allow") return { behavior: "allow", updatedInput: toolInput };
    if (decision.kind === "deny") return { behavior: "deny", message: decision.reason };
    const id = randomUUID();
    const timeoutMs = opts.permissionTimeoutMs ?? PERMISSION_TIMEOUT_MS;
    const expiresAt = Date.now() + timeoutMs;
    return new Promise<PermissionResult>((resolve) => {
      const timer = setTimeout(() => settle("deny", "timeout"), timeoutMs);
      const settle = (behavior: "allow" | "deny", by: "user" | "timeout" | "session") => {
        if (!pending.delete(id)) return;
        clearTimeout(timer);
        emit({ type: "permission_resolved", id, behavior, by });
        if (pending.size === 0 && state === "waiting") setState("running");
        const why =
          by === "timeout" ? "No answer in the CRT panel within 5 minutes" : by === "session" ? "The CRT session ended before this was answered" : "Denied in the CRT panel";
        resolve(behavior === "allow" ? { behavior: "allow", updatedInput: toolInput } : { behavior: "deny", message: why });
      };
      pending.set(id, { settle });
      options.signal.addEventListener("abort", () => settle("deny", "session"), { once: true });
      emit({
        type: "permission",
        id,
        toolName,
        title: options.title ?? `Claude wants to use ${options.displayName ?? toolName}`,
        detail: describeInput(toolName, toolInput, opts.cwd),
        expiresAt,
      });
      setState("waiting");
    });
  };

  const writeTask = tool(
    WRITE_TASK_TOOL,
    "Write the CRT task file for this intake (PRD F-32). The server allocates the CRT-NNNN id, moves the capture's screenshots to .crt/tasks/assets/<ID>/, renders the Evidence section from the capture, writes the file and regenerates the index. Call it once, after the developer has confirmed the definition of done. Returns the id and path.",
    {
      title: z.string().min(3).describe("Short imperative title, e.g. 'Cart total excludes applied discount'"),
      summary: z.string().min(1).describe("One paragraph: what is wrong / wanted, in plain language"),
      context: z.string().min(1).describe("What the page showed, how to reproduce, which component renders it, where the logic lives (file:line)"),
      evidence: z.string().optional().describe("Extra evidence beyond the screenshots and annotations the server adds automatically (optional)"),
      ask: z.string().min(1).describe("The change requested, precisely"),
      definitionOfDone: z.array(z.string().min(1)).min(1).describe("Checkable items, one per entry; the server renders them as - [ ] checkboxes"),
      notes: z.string().optional().describe("Constraints, hunches, non-goals, alternatives considered"),
      priority: z.enum(["low", "normal", "high"]).optional().describe("Default normal"),
      tags: z.array(z.string()).optional().describe("Short lowercase tags, e.g. ['cart', 'pricing']"),
      files: z.array(z.string()).optional().describe("Project-relative source files identified during intake"),
    },
    async (args) => {
      try {
        const written = await opts.writeTask(args as WriteTaskRequest);
        emit({ type: "task_written", id: written.id, path: written.path });
        log(`crt: task ${written.id} written to ${written.path}`);
        return { content: [{ type: "text", text: `Task ${written.id} written to ${written.path}` }] };
      } catch (err) {
        return { content: [{ type: "text", text: `write_task failed: ${(err as Error).message}` }], isError: true };
      }
    },
  );

  const options: Options = {
    cwd: opts.cwd,
    sessionId: opts.id,
    settingSources: ["user", "project", "local"],
    systemPrompt: { type: "preset", preset: "claude_code", append: opts.systemPromptAppend },
    includePartialMessages: true,
    permissionMode: "default",
    canUseTool,
    mcpServers: { [CRT_MCP_SERVER]: createSdkMcpServer({ name: CRT_MCP_SERVER, version: "1.0.0", tools: [writeTask] }) },
    stderr: (data) => {
      for (const line of data.split(/\r?\n/)) {
        if (!line.trim()) continue;
        stderrTail.push(line);
        if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
      }
    },
  };

  const toSdkMessage = (u: UserInput): SDKUserMessage => {
    const blocks: Array<
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "base64"; media_type: "image/png" | "image/jpeg" | "image/webp" | "image/gif"; data: string } }
    > = [{ type: "text", text: u.text }];
    for (const img of u.images ?? []) {
      blocks.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } });
    }
    return {
      type: "user",
      message: { role: "user", content: blocks },
      parent_tool_use_id: null,
      session_id: opts.id,
    };
  };

  const handle = (msg: SDKMessage): void => {
    switch (msg.type) {
      case "system":
        if (msg.subtype === "init") {
          // F-47: Claude Code adopted CRT's UUID as its own session id, so the native id is `opts.id`.
          emit({
            type: "init",
            sessionId: opts.id,
            nativeSessionId: msg.session_id,
            provider: claudeProfile.id,
            displayName: claudeProfile.displayName,
            model: msg.model,
            agentVersion: msg.claude_code_version,
            resumeCommand: claudeProfile.resumeCommand(msg.session_id),
            capabilities: CLAUDE_CAPABILITIES,
          });
          setState("running");
        }
        return;
      case "stream_event":
        handleStream(msg);
        return;
      case "assistant":
        handleAssistant(msg);
        return;
      case "user":
        handleToolResults(msg);
        return;
      case "result": {
        const errors = msg.subtype === "success" ? (msg.is_error ? [msg.result] : []) : msg.errors.length ? msg.errors : [msg.subtype];
        emit({ type: "result", ok: !msg.is_error, durationMs: msg.duration_ms, costUsd: msg.total_cost_usd, errors });
        const login = errors.map(loginProblem).find(Boolean);
        if (login) fail(login);
        else if (pending.size === 0) setState("idle");
        return;
      }
      case "auth_status":
        if (msg.error) fail(loginProblem(msg.error) ?? `Claude Code authentication failed: ${msg.error}`);
        return;
      default:
        return;
    }
  };

  const handleStream = (msg: SDKPartialAssistantMessage): void => {
    if (msg.parent_tool_use_id !== null) return;
    const ev = msg.event;
    if (ev.type === "message_start") {
      streamedMessages.add(ev.message.id);
      emit({ type: "assistant_start", messageId: ev.message.id });
      setState("running");
    } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
      emit({ type: "text", messageId: current(streamedMessages), text: ev.delta.text });
    } else if (ev.type === "message_stop") {
      emit({ type: "assistant_end", messageId: current(streamedMessages) });
    }
  };

  const handleAssistant = (msg: SDKAssistantMessage): void => {
    if (msg.parent_tool_use_id !== null) return;
    const id = msg.message.id;
    for (const block of msg.message.content) {
      if (block.type === "tool_use") {
        emit({ type: "tool_use", id: block.id, name: block.name, label: toolLabel(block.name, block.input as Record<string, unknown>, opts.cwd) });
      } else if (block.type === "text" && !streamedMessages.has(id) && block.text) {
        // Partial messages were not delivered for this message; show the whole block at once.
        emit({ type: "assistant_start", messageId: id });
        emit({ type: "text", messageId: id, text: block.text });
        emit({ type: "assistant_end", messageId: id });
      }
    }
  };

  const handleToolResults = (msg: Extract<SDKMessage, { type: "user" }>): void => {
    if (msg.parent_tool_use_id !== null) return;
    const content = msg.message.content;
    if (typeof content === "string") return;
    for (const block of content) {
      if (block.type !== "tool_result") continue;
      const text =
        typeof block.content === "string"
          ? block.content
          : (block.content ?? [])
              .map((c) => (c.type === "text" ? c.text : `[${c.type}]`))
              .join(" ");
      emit({ type: "tool_result", id: block.tool_use_id, isError: block.is_error === true, summary: summarize(text) });
    }
  };

  const run = async () => {
    try {
      if (opts.first) {
        input.push(toSdkMessage(opts.first));
        emit({ type: "user", text: opts.first.text, images: (opts.first.images ?? []).map((i) => i.label) });
      }
      q = query({ prompt: input, options });
      for await (const msg of q) handle(msg);
      setState("ended");
    } catch (err) {
      fail(describeSessionError(err, stderrTail));
    } finally {
      denyAllPending("session");
      state = state === "error" ? "error" : "ended";
    }
  };
  // Deferred so the caller can attach onEvent() before the first message is echoed.
  queueMicrotask(() => void run());

  return {
    id: opts.id,
    send(u) {
      if (state === "ended" || state === "error") return;
      emit({ type: "user", text: u.text, images: (u.images ?? []).map((i) => i.label) });
      input.push(toSdkMessage(u));
      if (state !== "starting") setState("running");
    },
    async interrupt() {
      try {
        await q?.interrupt();
      } catch (err) {
        emit({ type: "error", message: `interrupt failed: ${(err as Error).message}` });
      }
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
      input.end();
      denyAllPending("session");
      try {
        q?.close();
      } catch {
        // already gone
      }
      setState("ended");
    },
    onEvent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

function current(ids: Set<string>): string {
  let last = "";
  for (const id of ids) last = id;
  return last;
}

function summarize(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 160 ? `${t.slice(0, 157)}…` : t;
}

/** F-25: the collapsed one-liner for a tool call ("Read src/components/Cart.tsx"). */
export function toolLabel(name: string, input: Record<string, unknown>, cwd: string): string {
  const rel = (p: unknown) => (typeof p === "string" ? shortPath(p, cwd) : "");
  switch (name) {
    case "Read":
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
      return `${name} ${rel(input.file_path ?? input.notebook_path)}`.trim();
    case "Glob":
      return `Glob ${String(input.pattern ?? "")}${input.path ? ` in ${rel(input.path)}` : ""}`;
    case "Grep":
      return `Grep ${JSON.stringify(String(input.pattern ?? ""))}${input.path ? ` in ${rel(input.path)}` : ""}`;
    case "Bash":
      return `Bash ${summarize(String(input.command ?? ""))}`;
    case WRITE_TASK_TOOL_FULL:
      return `Write task: ${String(input.title ?? "")}`;
    default:
      return name;
  }
}

/** The human-readable body of a permission card. */
export function describeInput(name: string, input: Record<string, unknown>, cwd: string): string {
  if (name === "Bash" && typeof input.command === "string") return input.command;
  const path = input.file_path ?? input.notebook_path ?? input.path;
  if (typeof path === "string") return shortPath(path, cwd);
  const text = JSON.stringify(input);
  return text.length > 500 ? `${text.slice(0, 497)}…` : text;
}

function shortPath(p: string, cwd: string): string {
  const r = relative(cwd, p);
  return r && !r.startsWith("..") ? r.split("\\").join("/") : p;
}

/** N-6: the one-line message for "not logged in", or null when the text is something else. */
export function loginProblem(text: string): string | null {
  if (/not logged in|please run \/login|\/login\b|invalid api key|authentication[_ ]error|oauth token|401\b|unauthori[sz]ed/i.test(text)) {
    return "not logged in to Claude Code — run `claude` in a terminal and complete /login (or set CLAUDE_CODE_OAUTH_TOKEN), then send again";
  }
  return null;
}

/** N-6: map an SDK/process failure to one actionable line. */
export function describeSessionError(err: unknown, stderrTail: readonly string[] = []): string {
  const message = err instanceof Error ? err.message : String(err);
  const all = [message, ...stderrTail].join("\n");
  if (/executable not found|native binary.*not found|ENOENT/i.test(all)) {
    return `Claude Code binary not found — reinstall claude-review-tool (\`npm install\`) so @anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch} is present (${message})`;
  }
  const login = loginProblem(all);
  if (login) return login;
  const tail = stderrTail.slice(-3).join(" | ");
  return `Claude Code session failed: ${message}${tail ? ` (${tail})` : ""}`;
}
