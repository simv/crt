/**
 * The contract between an intake session and the chat panel (PRD F-25, F-26, F-28, F-29;
 * PRD-providers F-42, F-46, F-47). Every provider driver under `providers/` (Claude on the Agent
 * SDK, the scripted stub, Codex from CRT-0012) produces these events; `sessions.ts` numbers them
 * and streams them over SSE; the overlay imports only the types. Nothing here depends on the SDK
 * or on any provider module, so this file is safe for the overlay bundle.
 */

export type SessionState =
  /** Process spawning; nothing streamed yet. */
  | "starting"
  /** Claude is producing a turn (text or tool calls). */
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

export interface UserImage {
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  /** Base64 bytes, no data: prefix. */
  data: string;
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
    }
  /** Echo of a developer message, so a reconnecting panel can rebuild the transcript. */
  | { type: "user"; text: string; images: string[] }
  | { type: "assistant_start"; messageId: string }
  | { type: "text"; messageId: string; text: string }
  | { type: "assistant_end"; messageId: string }
  | { type: "tool_use"; id: string; name: string; label: string }
  | { type: "tool_result"; id: string; isError: boolean; summary: string }
  | {
      type: "permission";
      id: string;
      toolName: string;
      /** One line: what Claude wants to do. */
      title: string;
      /** The tool input rendered for humans (a command, a path, …). */
      detail: string;
      expiresAt: number;
    }
  | { type: "permission_resolved"; id: string; behavior: "allow" | "deny"; by: "user" | "timeout" | "session" }
  | { type: "result"; ok: boolean; durationMs: number; costUsd: number; errors: string[] }
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
  /** F-14: started as a quick note — Claude writes the task without waiting for confirmation. */
  quick: boolean;
  /** One line for the session list: the first note, else the page path. Null until a capture is attached. */
  summary: string | null;
  /** Page URL of the capture. Null until a capture is attached. */
  url: string | null;
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
  /** Intake instructions appended to the Claude Code preset system prompt (F-24). */
  systemPromptAppend: string;
  /**
   * The capture summary + notes + images (F-24). Absent for a warm start: the process boots
   * while the overlay is still rasterising, and the first message arrives via `send()` (N-2).
   */
  first?: UserInput;
  /** Called for every tool call Claude Code would prompt for (F-26). */
  decide: (toolName: string, input: Record<string, unknown>) => PermissionDecision;
  /** Persist a task from the session's `write_task` call; returns id + path shown in the panel. */
  writeTask: (request: WriteTaskRequest) => Promise<{ id: string; path: string }>;
  permissionTimeoutMs?: number;
  log?: (line: string) => void;
}

export type SessionStarter = (opts: StartSessionOptions) => SessionDriver;
