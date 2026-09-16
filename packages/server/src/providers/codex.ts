/**
 * The `codex` provider (PRD-providers F-42, F-53, N-7, N-10, N-13): an intake session on the
 * developer's own Codex CLI, one `codex exec --json` process per turn, resumed by thread id.
 *
 * Tested version: **codex-cli 0.154.0** on Windows 11, 2026-09-15/16 (docs/spikes/codex-2026-09.md
 * is the record; test/providers/fixtures/codex/*.jsonl are its recordings). Every flag, event
 * name, exit code and environment variable below was observed on that version:
 *
 *   Turn 1  codex exec --json --sandbox read-only -C <projectRoot>
 *             -c approval_policy="never" -c mcp_servers.crt.default_tools_approval_mode="approve"
 *             -c mcp_servers.crt.command='<node>' -c mcp_servers.crt.args=['<cli.js>','mcp']
 *             -c mcp_servers.crt.env_vars=['CRT_MCP_TOKEN','CRT_MCP_PORT']
 *             [--image <png>]… [-m <model>] -c analytics.enabled=false -        (message on stdin)
 *   Turn n  codex exec resume <threadId> --json -c sandbox_mode="read-only" <same -c/--image/-m> -
 *             spawned with cwd = projectRoot: `exec resume` rejects `--sandbox` and `-C` (exit 2).
 *
 *   • `--ask-for-approval` is not an `exec` flag; `-c approval_policy="never"` is. Without
 *     `default_tools_approval_mode="approve"` every MCP call fails with "MCP tool call requires
 *     approval, but approval policy is never".
 *   • The per-session token reaches `crt mcp` through Codex's environment: `env_vars` names
 *     parent variables to forward to the stdio MCP server (verified with --strict-config, M9),
 *     so the token is never on a command line (F-49, N-8). The spike used the `env={…}` map,
 *     which also works but would put the token in argv.
 *   • Events (stdout, one JSON object per line; stderr is `tracing` noise):
 *       thread.started {thread_id}      → init (turn 1) / resume assertion (turn n)
 *       turn.started
 *       item.started / item.completed {item: {id, type, status, …}} with type ∈
 *         agent_message {text}            whole text, never deltas → assistant_start/text/assistant_end
 *         mcp_tool_call {server, tool, arguments, result{content[]}, error{message}}
 *         command_execution {command, aggregated_output, exit_code}
 *         file_change / web_search       not observed in the spike; mapped by shape (F-53)
 *       turn.completed {usage}          → result (costUsd 0, usage in detail)
 *       turn.failed {error{message}} / error {message}
 *     `error` + `turn.failed` saying "…log out and sign in again" is the stale-login case
 *     `login status` cannot see; it ends the session with the N-7 not-logged-in line.
 *   • `thread.started` on resume carries the same thread_id; a non-UUID id silently starts a new
 *     thread, hence the assertion (`CODEX_COULD_NOT_RESUME`).
 *   • Interrupt = kill the process tree (`taskkill /T /F`; POSIX group kill); the thread survives
 *     and the next message resumes it.
 *   • `codex --version` → `codex-cli 0.154.0`; `codex login status` exits 0 / 1 (not validated).
 *   • Commands Codex runs see CODEX_THREAD_ID and CODEX_SESSION_ID (launchEnv, F-44).
 *   • `-c analytics.enabled=false` is the per-invocation telemetry opt-out (N-12).
 *   • Skills: `.agents/skills` in the project, `$CODEX_HOME/skills` (default `~/.codex/skills`) for the user (F-58).
 *   • npm installs `codex.cmd` + an sh `codex` shim; `codex.exe` lives under the platform package.
 *     `exec.ts` finds the `.exe` when it is on PATH and otherwise runs the shim's JS entry with our
 *     own Node (N-10).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderCapabilities, SessionDriver, SessionEvent, SessionState, StartSessionOptions, UserInput } from "../session-events.js";
import { CRT_MCP_SERVER, WRITE_TASK_TOOL } from "../write-task.js";
import { type Executable, killProcessTree, resolveExecutable, runExecutable } from "./exec.js";
import type { PreflightOptions, PreflightResult, ProviderProfile } from "./types.js";

export const CODEX_TESTED_VERSION = "0.154.0";
/** Oldest version whose `exec --json` contract matches the tested one; older prints "too old" (N-7). */
export const CODEX_MIN_VERSION = "0.154.0";
const CODEX_INSTALL = "npm i -g @openai/codex";
const CODEX_LOGIN = "codex login";
const STDERR_TAIL_LINES = 30;

/** F-46 reference values for Codex (M6 verdicts: no deltas, read-only sandbox, images by path). */
export const CODEX_CAPABILITIES: ProviderCapabilities = {
  streaming: false,
  toolEvents: true,
  permissions: "sandboxed",
  images: "path",
  resume: true,
  interrupt: true,
  instructions: "first-message",
};

/** F-58: where Codex 0.154.0 reads Agent Skills from (spike §5). */
export function codexSkillsDirs(env: NodeJS.ProcessEnv = process.env): { project: string; user: string } {
  const home = env.CODEX_HOME?.trim() ? env.CODEX_HOME.trim() : join(homedir(), ".codex");
  return { project: join(".agents", "skills"), user: join(home, "skills") };
}

export const codexProfile: ProviderProfile = {
  id: "codex",
  displayName: "Codex",
  agentName: "Codex CLI",
  markers: { private: [".codex/"], shared: ["AGENTS.md"] },
  launchEnv: ["CODEX_THREAD_ID", "CODEX_SESSION_ID"],
  hints: { install: CODEX_INSTALL, login: CODEX_LOGIN },
  capabilities: CODEX_CAPABILITIES,
  telemetryOptOut: ["-c", "analytics.enabled=false"],
  skillsDirs: codexSkillsDirs,
  preflight: codexPreflight,
  resumeCommand: (threadId) => `codex resume ${threadId}`,
  start: (opts) => startCodexSession(opts),
};

/** N-7 lines; the README's Providers section quotes them verbatim. */
export const CODEX_NOT_FOUND = `codex not found on PATH — ${CODEX_INSTALL}, or set providers.codex.command in .crt/config.json`;
export const CODEX_NOT_LOGGED_IN = `not logged in to Codex — run \`${CODEX_LOGIN}\` in a terminal, then send again`;
export const codexTooOld = (version: string): string => `codex ${version} is too old — CRT needs ${CODEX_MIN_VERSION} or newer (${CODEX_INSTALL}@latest)`;
export const codexCouldNotResume = (threadId: string): string => `Codex could not resume thread ${threadId} — start a new session`;
export const CODEX_MCP_NEVER_CALLED = "Codex finished the turn without replying or calling write_task — check that Codex lists the crt MCP server (node <cli.js> mcp) and that nothing on stderr says it failed to start";
const codexExited = (code: number | null, tail: string) => `Codex exited${code === null ? "" : ` with code ${code}`} before the turn completed${tail ? ` (${tail})` : ""}`;

/**
 * F-53 preflight: find the executable (config → PATH → npm shim), read `--version`, then ask
 * `login status`. Neither command is allowed to hang the server: 15 s each, then "unknown".
 */
export async function codexPreflight(opts: PreflightOptions = {}): Promise<PreflightResult> {
  const exe = resolveExecutable("codex", { command: opts.command ?? null, ...(opts.env ? { env: opts.env } : {}) });
  if (!exe) return { installed: false, loggedIn: "unknown", version: null, problem: CODEX_NOT_FOUND };

  const v = await runExecutable(exe, ["--version"], opts.env ? { env: opts.env } : {});
  const version = parseCodexVersion(v.stdout);
  if (v.status !== 0 || !version) {
    const why = v.error ?? v.stderr.trim().split(/\r?\n/)[0] ?? `exit ${v.status}`;
    return { installed: true, loggedIn: "unknown", version, problem: `codex --version failed (${why || "no output"}) — reinstall with ${CODEX_INSTALL}` };
  }
  if (compareVersions(version, CODEX_MIN_VERSION) < 0) return { installed: true, loggedIn: "unknown", version, problem: codexTooOld(version) };

  const login = await runExecutable(exe, ["login", "status"], opts.env ? { env: opts.env } : {});
  if (login.status === 0) return { installed: true, loggedIn: true, version, problem: null };
  if (login.status === 1) return { installed: true, loggedIn: false, version, problem: CODEX_NOT_LOGGED_IN };
  return { installed: true, loggedIn: "unknown", version, problem: null };
}

/** `codex-cli 0.154.0` → `0.154.0`; null when the line is not in that shape. */
export function parseCodexVersion(stdout: string): string | null {
  const m = /codex(?:-cli)?\s+v?(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/i.exec(stdout);
  return m ? m[1]! : null;
}

/** Numeric dotted compare; a pre-release suffix is ignored. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[-+]/)[0]!.split(".").map(Number);
  const pb = b.split(/[-+]/)[0]!.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** N-7: the stale-login message Codex prints at turn time (spike §2); `login status` does not see it. */
export function codexLoginProblem(message: string): string | null {
  return /log out and sign in again|not logged in|please (?:log|sign) in/i.test(message) ? CODEX_NOT_LOGGED_IN : null;
}

// ---- command lines ------------------------------------------------------------------------------

/**
 * A TOML string for a `-c key=value` override. Literal strings (`'…'`) take Windows paths as they
 * are; a value containing `'` falls back to a basic string with escapes.
 */
export function tomlString(value: string): string {
  if (!value.includes("'") && !/[\r\n]/.test(value)) return `'${value}'`;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "\\r").replace(/\n/g, "\\n")}"`;
}

export interface CodexTurnCommand {
  args: string[];
  /** Codex's own environment: the parent's plus the MCP variables it forwards via `env_vars`. */
  env: NodeJS.ProcessEnv;
  cwd: string;
}

/**
 * F-53 (as amended by M6/M9): the argv for one turn. `threadId` null = turn 1 (`exec`), else
 * `exec resume <threadId>`. Images travel by path (F-50); the message itself goes on stdin (`-`).
 */
export function codexTurnCommand(
  opts: Pick<StartSessionOptions, "cwd" | "mcp" | "model">,
  threadId: string | null,
  images: string[],
  env: NodeJS.ProcessEnv = process.env,
): CodexTurnCommand {
  const args = threadId === null ? ["exec", "--json", "--sandbox", "read-only", "-C", opts.cwd] : ["exec", "resume", threadId, "--json", "-c", 'sandbox_mode="read-only"'];
  const mcpEnvNames = Object.keys(opts.mcp.env);
  args.push(
    "-c", 'approval_policy="never"',
    "-c", `mcp_servers.${CRT_MCP_SERVER}.default_tools_approval_mode="approve"`,
    "-c", `mcp_servers.${CRT_MCP_SERVER}.command=${tomlString(opts.mcp.command)}`,
    "-c", `mcp_servers.${CRT_MCP_SERVER}.args=[${opts.mcp.args.map(tomlString).join(",")}]`,
    "-c", `mcp_servers.${CRT_MCP_SERVER}.env_vars=[${mcpEnvNames.map(tomlString).join(",")}]`,
  );
  for (const image of images) args.push("--image", image);
  if (opts.model) args.push("-m", opts.model);
  args.push(...codexProfile.telemetryOptOut, "-");
  return { args, env: { ...env, ...opts.mcp.env }, cwd: opts.cwd };
}

// ---- event mapping ------------------------------------------------------------------------------

/** One `codex exec --json` line, loosely typed: unknown shapes are ignored, never fatal (F-53). */
export interface CodexEvent {
  type: string;
  thread_id?: string;
  message?: string;
  error?: { message?: string } | null;
  usage?: Record<string, number>;
  item?: CodexItem;
}
export interface CodexItem {
  id: string;
  type: string;
  status?: string;
  text?: string;
  server?: string;
  tool?: string;
  arguments?: unknown;
  result?: { content?: Array<{ type?: string; text?: string }> } | null;
  error?: { message?: string } | null;
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  changes?: Array<{ path?: string; kind?: string }>;
  query?: string;
}

/** Item types that map to tool lines (F-53). `agent_message` is text; anything else (reasoning…) is ignored. */
const TOOL_ITEMS = new Set(["mcp_tool_call", "command_execution", "file_change", "web_search"]);

export function parseCodexLine(line: string): CodexEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const v = JSON.parse(trimmed) as unknown;
    return v && typeof v === "object" && typeof (v as CodexEvent).type === "string" ? (v as CodexEvent) : null;
  } catch {
    return null;
  }
}

/** F-25-style one-liner for a Codex item. */
export function codexToolLabel(item: CodexItem): string {
  switch (item.type) {
    case "mcp_tool_call": {
      const args = (item.arguments ?? {}) as Record<string, unknown>;
      if (item.server === CRT_MCP_SERVER && item.tool === WRITE_TASK_TOOL) return `Write task: ${String(args.title ?? "")}`;
      return `${item.server ?? "mcp"}/${item.tool ?? "?"}`;
    }
    case "command_execution":
      return `Run ${summarize(item.command ?? "")}`;
    case "file_change":
      return `Edit ${(item.changes ?? []).map((c) => c.path ?? "?").join(", ") || "files"}`;
    case "web_search":
      return `Search ${JSON.stringify(item.query ?? "")}`;
    default:
      return item.type;
  }
}

/** The tool name the panel and the F-26 vocabulary use for an item. */
export function codexToolName(item: CodexItem): string {
  if (item.type === "mcp_tool_call") return `mcp__${item.server ?? "mcp"}__${item.tool ?? "tool"}`;
  return item.type;
}

/** The collapsed result line of a completed item. */
export function codexToolSummary(item: CodexItem): string {
  if (item.error?.message) return summarize(item.error.message);
  if (item.type === "mcp_tool_call") {
    const text = (item.result?.content ?? []).map((c) => (c.type === "text" ? (c.text ?? "") : `[${c.type ?? "?"}]`)).join(" ");
    return summarize(text) || (item.status === "failed" ? "failed" : "done");
  }
  if (item.type === "command_execution") {
    const out = summarize(item.aggregated_output ?? "");
    const code = item.exit_code;
    return code !== null && code !== undefined && code !== 0 ? `exit ${code}${out ? `: ${out}` : ""}` : out || "done";
  }
  return item.status === "failed" ? "failed" : "done";
}

function summarize(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 160 ? `${t.slice(0, 157)}…` : t;
}

/** `turn.completed.usage` as one line for `result.detail`. */
export function describeUsage(usage: Record<string, number> | undefined): string | undefined {
  if (!usage) return undefined;
  const parts = Object.entries(usage)
    .filter(([, v]) => typeof v === "number")
    .map(([k, v]) => `${k.replace(/_tokens$/, "").replace(/_/g, " ")} ${v}`);
  return parts.length ? `tokens: ${parts.join(", ")}` : undefined;
}

// ---- the driver ---------------------------------------------------------------------------------

/** What `startCodexSession` needs from the OS; tests replace the spawn to replay fixtures in-process. */
export interface CodexProcessDeps {
  spawn: (command: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => ChildProcess;
  killTree: (pid: number) => boolean;
}

const realDeps: CodexProcessDeps = {
  spawn: (command, args, opts) =>
    spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      // POSIX: a process group of its own so a negative-pid kill takes the MCP child and shells with it.
      detached: process.platform !== "win32",
    }),
  killTree: (pid) => killProcessTree(pid),
};

/**
 * F-53: one `codex exec` process per turn. Turn 1 carries the first message (instructions
 * prepended, F-51) and the images by path (F-50); every later message resumes the thread. The
 * registry's `writeTask` is never called here: Codex reaches `write_task` through `crt mcp` and
 * the internal route, and the registry records `task_written` itself (§5.3).
 */
export function startCodexSession(opts: StartSessionOptions, deps: CodexProcessDeps = realDeps): SessionDriver {
  const listeners = new Set<(e: SessionEvent) => void>();
  const env = process.env;
  let state: SessionState = "starting";
  let closed = false;
  let threadId: string | null = null;
  let child: ChildProcess | null = null;
  let interrupted = false;
  let turns = 0;
  const queue: UserInput[] = [];
  const stderrTail: string[] = [];

  const emit = (e: SessionEvent) => {
    for (const fn of listeners) fn(e);
  };
  const setState = (next: SessionState, detail?: string) => {
    if (closed) return;
    state = next;
    emit(detail === undefined ? { type: "state", state: next } : { type: "state", state: next, detail });
  };
  const fail = (problem: string) => {
    if (closed) return;
    emit({ type: "error", message: problem });
    setState("error", problem);
    closed = true;
    killCurrent();
  };
  const killCurrent = () => {
    const pid = child?.pid;
    if (pid) deps.killTree(pid);
    child = null;
  };

  const exe: Executable | null = resolveExecutable("codex", { command: opts.command ?? null, env });
  if (!exe) {
    queueMicrotask(() => fail(CODEX_NOT_FOUND));
  }

  /** Run one turn to completion; resolves when the process has exited and its events are mapped. */
  const runTurn = (input: UserInput): Promise<void> =>
    new Promise((resolve) => {
      if (closed || !exe) return resolve();
      const turn = new TurnMapper(threadId, opts, emit, ++turns);
      const command = codexTurnCommand(opts, threadId, (input.images ?? []).map((i) => i.path), env);
      const started = Date.now();
      interrupted = false;
      let proc: ChildProcess;
      try {
        proc = deps.spawn(exe.command, [...exe.args, ...command.args], { cwd: command.cwd, env: command.env });
      } catch (err) {
        fail(`could not start codex (${(err as Error).message}) — ${CODEX_INSTALL}`);
        return resolve();
      }
      child = proc;
      setState("running");
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (child === proc) child = null;
        resolve();
      };
      proc.on("error", (err: NodeJS.ErrnoException) => {
        fail(err.code === "ENOENT" ? CODEX_NOT_FOUND : `could not start codex (${err.message})`);
        finish();
      });
      let buffer = "";
      proc.stdout?.setEncoding("utf8");
      proc.stdout?.on("data", (chunk: string) => {
        buffer += chunk;
        let idx: number;
        while ((idx = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 1);
          handle(line);
        }
      });
      proc.stderr?.setEncoding("utf8");
      proc.stderr?.on("data", (chunk: string) => {
        for (const line of chunk.split(/\r?\n/)) {
          if (!line.trim()) continue;
          stderrTail.push(line);
          if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
        }
      });
      const handle = (line: string) => {
        if (closed || finished) return;
        const event = parseCodexLine(line);
        if (!event) return;
        const outcome = turn.handle(event, Date.now() - started);
        if (outcome?.kind === "thread") threadId = outcome.threadId;
        else if (outcome?.kind === "fail") fail(outcome.problem);
      };
      proc.on("exit", (code) => {
        if (buffer.trim()) handle(buffer);
        buffer = "";
        if (!closed && !turn.ended) {
          if (interrupted) {
            emit({ type: "result", ok: false, durationMs: Date.now() - started, costUsd: 0, errors: ["interrupted"] });
            setState("idle");
          } else if (threadId === null) {
            // Nothing to resume: the process died before a thread existed (bad flags, broken install, …).
            const tail = stderrTail.filter((l) => !/^\d{4}-\d\d-\d\dT/.test(l)).slice(-2).join(" | ");
            opts.log?.(`crt: codex exited with code ${code} before thread.started; stderr tail: ${stderrTail.slice(-5).join(" | ")}`);
            fail(codexLoginProblem(stderrTail.join("\n")) ?? codexExited(code, tail));
          } else {
            const tail = stderrTail.filter((l) => !/^\d{4}-\d\d-\d\dT/.test(l)).slice(-2).join(" | ");
            emit({ type: "result", ok: false, durationMs: Date.now() - started, costUsd: 0, errors: [codexExited(code, tail)] });
            setState("idle");
          }
        } else if (!closed && turn.ended && state !== "error") {
          setState("idle");
        }
        finish();
      });
      // The prompt: Codex reads it from stdin when the last argument is `-`.
      proc.stdin?.on("error", () => undefined);
      proc.stdin?.end(input.text.endsWith("\n") ? input.text : `${input.text}\n`);
    });

  let busy = false;
  const pump = async () => {
    if (busy) return;
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

  return {
    id: opts.id,
    send(u) {
      if (closed) return;
      enqueue(u);
    },
    async interrupt() {
      if (closed || !child?.pid) return;
      interrupted = true;
      deps.killTree(child.pid);
    },
    respondPermission: () => false, // F-46 sandboxed: there are no cards
    close() {
      if (closed) return;
      closed = true;
      queue.length = 0;
      killCurrent();
      state = "ended";
      emit({ type: "state", state: "ended" });
    },
    onEvent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

type TurnOutcome = { kind: "thread"; threadId: string } | { kind: "fail"; problem: string } | null;

/**
 * Maps one turn's JSONL to `SessionEvent`s (F-53 event table). Pure apart from `emit`, so the
 * fixtures can be replayed through it in unit tests without a process.
 */
export class TurnMapper {
  /** `turn.completed` or `turn.failed` was seen. */
  ended = false;
  private started = new Set<string>();
  private sawMessageOrMcp = false;
  private lastError: string | null = null;

  constructor(
    private readonly expectedThread: string | null,
    private readonly opts: Pick<StartSessionOptions, "id" | "model" | "agentVersion">,
    private readonly emit: (e: SessionEvent) => void,
    /** Codex numbers items from `item_0` in every turn; the panel needs ids unique per session. */
    private readonly turn = 1,
  ) {}

  private id(item: CodexItem): string {
    return `t${this.turn}-${item.id}`;
  }

  handle(event: CodexEvent, elapsedMs: number): TurnOutcome {
    switch (event.type) {
      case "thread.started": {
        const id = typeof event.thread_id === "string" ? event.thread_id : "";
        if (this.expectedThread !== null) {
          // F-53: a resume that silently started a new thread ends the session (N-7).
          if (id !== this.expectedThread) return { kind: "fail", problem: codexCouldNotResume(this.expectedThread) };
          return null;
        }
        if (!id) return { kind: "fail", problem: "Codex started without a thread id — cannot resume this session later" };
        this.emit({
          type: "init",
          sessionId: this.opts.id,
          nativeSessionId: id,
          provider: codexProfile.id,
          displayName: codexProfile.displayName,
          model: this.opts.model ?? null,
          agentVersion: this.opts.agentVersion ?? null,
          resumeCommand: codexProfile.resumeCommand(id),
          capabilities: CODEX_CAPABILITIES,
        });
        return { kind: "thread", threadId: id };
      }
      case "item.started": {
        const item = event.item;
        if (!item || !TOOL_ITEMS.has(item.type)) return null;
        this.started.add(item.id);
        if (item.type === "mcp_tool_call") this.sawMessageOrMcp = true;
        this.emit({ type: "tool_use", id: this.id(item), name: codexToolName(item), label: codexToolLabel(item) });
        return null;
      }
      case "item.completed": {
        const item = event.item;
        if (!item) return null;
        if (item.type === "agent_message") {
          this.sawMessageOrMcp = true;
          this.emit({ type: "assistant_start", messageId: this.id(item) });
          this.emit({ type: "text", messageId: this.id(item), text: item.text ?? "" });
          this.emit({ type: "assistant_end", messageId: this.id(item) });
          return null;
        }
        if (!TOOL_ITEMS.has(item.type)) return null;
        if (item.type === "mcp_tool_call") this.sawMessageOrMcp = true;
        if (!this.started.has(item.id)) this.emit({ type: "tool_use", id: this.id(item), name: codexToolName(item), label: codexToolLabel(item) });
        this.emit({ type: "tool_result", id: this.id(item), isError: item.status === "failed" || Boolean(item.error?.message), summary: codexToolSummary(item) });
        return null;
      }
      case "error": {
        const message = typeof event.message === "string" ? event.message : "Codex reported an error";
        this.lastError = message;
        this.emit({ type: "error", message });
        return null;
      }
      case "turn.failed": {
        this.ended = true;
        const message = event.error?.message ?? this.lastError ?? "the turn failed";
        if (message !== this.lastError) this.emit({ type: "error", message });
        this.emit({ type: "result", ok: false, durationMs: elapsedMs, costUsd: 0, errors: [message] });
        const login = codexLoginProblem(message);
        return login ? { kind: "fail", problem: login } : null;
      }
      case "turn.completed": {
        this.ended = true;
        // F-53: a turn with neither text nor an MCP call usually means the crt server never came up.
        if (!this.sawMessageOrMcp) this.emit({ type: "error", message: CODEX_MCP_NEVER_CALLED });
        const detail = describeUsage(event.usage);
        this.emit({ type: "result", ok: true, durationMs: elapsedMs, costUsd: 0, errors: [], ...(detail ? { detail } : {}) });
        return null;
      }
      default:
        return null; // turn.started and anything newer than the tested version
    }
  }
}

