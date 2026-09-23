/**
 * The contract between an intake session and the chat panel (PRD F-25, F-26, F-28, F-29;
 * PRD-providers F-42, F-46, F-47). Every provider driver under `providers/` (Claude on the Agent
 * SDK, the scripted stub, Codex over `codex exec --json`) produces these events; `sessions.ts` numbers them
 * and streams them over SSE; the overlay imports only the types. Nothing here depends on the SDK
 * or on any provider module, so this file is safe for the overlay bundle.
 */

export type SessionState =
  /** Process spawning; nothing streamed yet. */
  | "starting"
  /** The agent is producing a turn (text or tool calls). */
  | "running"
  /** A permission card is waiting for the developer. */
  | "waiting"
  /** Turn finished; the input box is live. */
  | "idle"
  /** The session ended normally (closed by the developer, or the input stream was finished). */
  | "ended"
  /** The session died; `detail` is the one-line reason (N-6). */
  | "error";

/** Outcome of the F-26 policy for one tool call (see permissions.ts). */
export type PermissionDecision = { kind: "allow" } | { kind: "deny"; reason: string } | { kind: "ask" };

/**
 * One screenshot for the agent (F-24). F-50: `path` is always set (absolute, under
 * `.crt/captures/`); `data` only for providers with `images: inline`, so the base64 work is
 * skipped for those that take a file path.
 */
export interface UserImage {
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  /** Absolute path of the PNG in the capture directory. */
  path: string;
  /** Base64 bytes, no data: prefix; absent unless the provider wants images inline. */
  data?: string;
  /** Shown to the developer in place of the bytes (e.g. the file name). */
  label: string;
}

export interface UserInput {
  text: string;
  images?: UserImage[];
}

/**
 * F-46: what a provider can do; the overlay adapts its chrome to it (M8). Reference values are
 * in PRD-providers F-46; each profile declares its own in `providers/<id>.ts`.
 */
export interface ProviderCapabilities {
  /** Partial text (deltas) rather than whole messages. */
  streaming: boolean;
  /** Emits tool_use / tool_result events. */
  toolEvents: boolean;
  /** `interactive`: Allow/Deny cards (F-26); `sandboxed`: the agent's own read-only sandbox; `none`. */
  permissions: "interactive" | "sandboxed" | "none";
  /** How images reach the agent: base64 in the message, a file path, or not at all. */
  images: "inline" | "path" | "none";
  /** The session can be continued in a terminal (`resumeCommand` on init). */
  resume: boolean;
  /** `interrupt()` does something (F-29). */
  interrupt: boolean;
  /** Where the intake instructions go: the system prompt, or prepended to the first message (F-51). */
  instructions: "system" | "first-message";
}

/**
 * F-119 (PRD-chat §5.1): what the developer wrote, as the server saw it when it built the F-24
 * first message — so the panel shows their words and folds the rest, the same after a reload or
 * from the session list. Built by `summarizeIntake` (intake-message.ts); nothing the agent
 * receives changes (N-28).
 */
export interface IntakeSummary {
  captureId: string;
  /** Page-level chat (F-68): the developer's message. Null when annotations were sent. */
  note: string | null;
  /** The annotations in the capture, in order; `label` is the F-8 label the popover header shows (component + selector). */
  annotations: Array<{ n: number; kind: "select" | "box" | "pin"; note: string; label: string }>;
  /** F-14: the message ended with the quick-note paragraph. */
  quick: boolean;
  /** F-51: the intake instructions were prepended to this message. */
  instructions: boolean;
}

export type SessionEvent =
  | { type: "state"; state: SessionState; detail?: string }
  /**
   * F-47: emitted once the provider's own session id is known. `sessionId` is CRT's registry
   * key; `nativeSessionId` is what the developer can resume (equal for Claude and the stub).
   */
  | {
      type: "init";
      sessionId: string;
      nativeSessionId: string;
      provider: string;
      displayName: string;
      model: string | null;
      agentVersion: string | null;
      resumeCommand: string | null;
      capabilities: ProviderCapabilities;
      /** F-54 (M10): set when the profile has not been verified against a real agent; the footer shows an "experimental" badge with this reason. */
      experimental?: string;
    }
  /**
   * Echo of a developer message, so a reconnecting panel can rebuild the transcript. F-119
   * (PRD-chat §5.1): the first echo of a session — the F-24 intake message — carries `intake`, set
   * by the registry (`sessions.ts` `record()`) and never by a driver, so the rebuilt transcript is
   * the folded bubble: the developer's words visible, the full text behind the Capture pill.
   */
  | { type: "user"; text: string; images: string[]; intake?: IntakeSummary }
  | { type: "assistant_start"; messageId: string }
  | { type: "text"; messageId: string; text: string }
  | { type: "assistant_end"; messageId: string }
  | { type: "tool_use"; id: string; name: string; label: string }
  | { type: "tool_result"; id: string; isError: boolean; summary: string }
  | {
      type: "permission";
      id: string;
      toolName: string;
      /** One line: what the agent wants to do. */
      title: string;
      /** The tool input rendered for humans (a command, a path, …). */
      detail: string;
      expiresAt: number;
    }
  | { type: "permission_resolved"; id: string; behavior: "allow" | "deny"; by: "user" | "timeout" | "session" }
  /** `detail` is the provider's own accounting when it has no cost (Codex token usage, F-53). */
  | { type: "result"; ok: boolean; durationMs: number; costUsd: number; errors: string[]; detail?: string }
  | { type: "task_written"; id: string; path: string }
  | { type: "error"; message: string };

/** What the server knows about a session without replaying its events (F-30, F-47). */
export interface SessionInfo {
  id: string;
  /** Provider profile id the session runs on (F-43). */
  provider: string;
  /** The provider's own session id; null until the `init` event (PRD-providers §5.4). */
  nativeSessionId: string | null;
  captureId: string | null;
  startedAt: string;
  state: SessionState;
  taskId: string | null;
  /** F-14: started as a quick note — the agent writes the task without waiting for confirmation. */
  quick: boolean;
  /** One line for the session list: the first note, else the page path. Null until a capture is attached. */
  summary: string | null;
  /** Page URL of the capture. Null until a capture is attached. */
  url: string | null;
}

/** F-57: one row of `GET /__crt/providers` (and `crt providers --json`); what the overlay's menu shows. */
export interface ProviderRow {
  id: string;
  displayName: string;
  installed: boolean;
  loggedIn: true | false | "unknown";
  version: string | null;
  /** The N-7 line when the agent cannot be used right now; null when it can. */
  problem: string | null;
  /** F-44 markers found in the project root. */
  markers: string[];
  capabilities: ProviderCapabilities;
  /** F-54 (M10): the profile is shipped untested against a real agent; the one-line reason (menu badge tooltip). */
  experimental?: string;
}

export interface ProvidersPayload {
  ok: true;
  /** The provider a new session would run on right now (F-43). */
  active: string;
  /** The F-44 auto-detection result and why. */
  decision: { provider: string; reason: string | null };
  providers: ProviderRow[];
}

/** Fields the intake session passes to CRT's `write_task` tool; mirrors tasks.ts NewTaskInput. */
export interface WriteTaskRequest {
  title: string;
  summary: string;
  context: string;
  evidence?: string;
  ask: string;
  definitionOfDone: string[];
  notes?: string;
  priority?: "low" | "normal" | "high";
  tags?: string[];
  files?: string[];
}

/** One intake session as seen by the registry: every provider driver implements this (F-42). */
export interface SessionDriver {
  readonly id: string;
  /** Queue a developer message (starts the next turn). */
  send(input: UserInput): void;
  /** Stop the current turn (F-29). */
  interrupt(): Promise<void>;
  /** Answer a permission card; false when the id is unknown or already resolved. */
  respondPermission(id: string, behavior: "allow" | "deny"): boolean;
  /** End the session and release the process. */
  close(): void;
  onEvent(fn: (event: SessionEvent) => void): () => void;
}

export interface StartSessionOptions {
  /** CRT session UUID (the registry key); Claude uses it as its own session id (F-28, §5.4). */
  id: string;
  /** Project root: the session's cwd (PRD goal 6). */
  cwd: string;
  /**
   * Intake instructions for the agent's system prompt (F-24). Empty when the profile declares
   * `instructions: "first-message"`: the registry has then already prepended them to `first` (F-51).
   */
  systemPromptAppend: string;
  /**
   * The capture summary + notes + images (F-24). Absent for a warm start: the process boots
   * while the overlay is still rasterising, and the first message arrives via `send()` (N-2).
   */
  first?: UserInput;
  /** Called for every tool call the agent would prompt for (F-26; `permissions: interactive` only). */
  decide: (toolName: string, input: Record<string, unknown>) => PermissionDecision;
  /** Persist a task from the session's `write_task` call; returns id + path shown in the panel. */
  writeTask: (request: WriteTaskRequest) => Promise<{ id: string; path: string }>;
  /**
   * F-49: how an agent that is not driven in-process reaches `write_task`: spawn `command args`
   * with `env` added (the per-session token and the server port). Drivers hand this to the agent
   * as its MCP server; the token must never appear on a command line or in a URL (N-8).
   */
  mcp: { command: string; args: string[]; env: Record<string, string> };
  /** F-57 `models.<id>`: the model the developer asked for, or null for the agent's default. */
  model: string | null;
  /**
   * F-53: `providers.<id>.command` from `.crt/config.json` — the executable (plus leading args)
   * a CLI-driven provider runs instead of searching PATH. Ignored by in-process drivers.
   */
  command?: string[] | null;
  /** The version preflight found (F-42), for the `init` event of drivers whose CLI does not report it per turn. */
  agentVersion?: string | null;
  permissionTimeoutMs?: number;
  log?: (line: string) => void;
}

export type SessionStarter = (opts: StartSessionOptions) => SessionDriver;
