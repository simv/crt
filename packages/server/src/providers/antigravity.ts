/**
 * The `antigravity` provider (PRD-providers F-42, F-111, N-7, N-10, N-13): an intake session on
 * the developer's own Antigravity CLI (`agy`) in its first-party non-interactive JSON mode — one
 * `agy` process per session, one turn per NDJSON line on stdin, resumed by conversation id after an
 * interrupt.
 *
 * Tested version: **agy 1.2.7** on Windows 11, 2026-09-21 (docs/spikes/antigravity-2026-09.md is
 * the record; test/providers/fixtures/antigravity/*.jsonl are its recordings). Every flag, event
 * name, file and exit code below was observed on that version:
 *
 *   agy --output-format stream-json --input-format stream-json --print ""
 *       --dangerously-skip-permissions --add-dir <sessionDir> [--model <id>] [--conversation <id>]
 *     spawned with cwd = projectRoot and CRT_MCP_TOKEN / CRT_MCP_PORT in its environment; each
 *     developer message is one stdin line {"event":"user","message":{"role":"user","content":"…"}}
 *     (text only — an `image` block ends the process with `only "text"`), a turn ends at `result`.
 *
 *   • `--print` is a string flag: the empty prompt is mandatory in stream-json input mode, and
 *     `--output-format` must come before it or it is taken as the prompt. `--effort` is never
 *     passed (it conflicts with the effort-suffixed model ids `agy models` lists).
 *   • <sessionDir> = .crt/captures/antigravity/<crt session id>/ holds a plugin Antigravity discovers
 *     through --add-dir: .agents/plugins/crt/{plugin.json, mcp_config.json, hooks.json, hook.mjs,
 *     preinvoke.mjs, hook.cmd|hook.sh, preinvoke.cmd|preinvoke.sh}. The MCP server (`crt` →
 *     <node> <cli.js> mcp) is spawned at startup with cwd = the plugin directory and the whole
 *     `agy` environment, so the token travels by environment only (F-49, N-8); plugin servers are
 *     namespaced `<plugin>_<server>`, hence `crt_crt/write_task` via the generic `call_mcp_tool`.
 *   • Headless mode auto-denies every tool that needs a permission — reads of the workspace
 *     included — and allow rules live only in the user's ~/.gemini/antigravity-cli/settings.json,
 *     so the driver passes --dangerously-skip-permissions and enforces its own read-only policy
 *     with a PreToolUse hook (`matcher: "*"`): read-only tools and `call_mcp_tool` on `crt_crt`
 *     pass, everything else is denied with a reason the model sees. A hook that cannot run is a
 *     tool error (fail closed). A PreInvocation hook writes `hooks.loaded` before every model
 *     call; if it is missing when a turn's first real step arrives, the process is killed.
 *     Hook commands run through `cmd /c` (`sh -c`) with cwd = the plugin dir; a bare name is not
 *     found and a quoted "C:\Program Files\…\node.exe" is mangled, so hooks.json names the
 *     absolute path of a .cmd/.sh wrapper that execs our own Node.
 *   • Events (stdout, one JSON object per line):
 *       init {conversation_id, init: {cwd, tools[], permission_mode, model?}}
 *         → init (first process) / resume assertion (a --conversation process must repeat the id:
 *           an unknown id only prints `warning: conversation "…" not found` and starts a new one)
 *       step_update {step_update: {step_index, state: ACTIVE|DONE|ERROR, step_type, …}} with
 *         agent_response {text_delta}           streamed → assistant_start / text / assistant_end
 *         tool {tool_name, tool_info: {name, parameters, output? | error?: {type, message}}}
 *                                                → tool_use on ACTIVE, tool_result on DONE/ERROR
 *         user_input, system_message, others     ignored
 *       result {result: {conversation_id, status: SUCCESS|ERROR, response, error?, num_turns,
 *               usage, denied_actions?}}        → result (costUsd 0, usage in detail)
 *     stderr: `error: …` lines and `AGY_ERROR: {…}` JSON on failures; `warning: …` otherwise.
 *   • Interrupt = kill the process tree; the conversation survives and the next message resumes
 *     it in a new process. Close = kill the tree and remove the session directory.
 *   • `agy --version` → `1.2.7`. No login-status command and no credential file (the token is in
 *     the OS keyring), so preflight reports `loggedIn: "unknown"` (§12 rule 3) and the logged-out
 *     print-mode strings are mapped at turn time.
 *   • Commands Antigravity runs see ANTIGRAVITY_CONVERSATION_ID and ANTIGRAVITY_AGENT=1 (launchEnv).
 *   • No per-invocation telemetry flag (`enableTelemetry` in settings.json applies, N-12).
 *   • Skills: `.agents/skills` in the project, `~/.gemini/config/skills` for the user (F-58).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderCapabilities, SessionDriver, SessionEvent, SessionState, StartSessionOptions, UserInput } from "../session-events.js";
import { CRT_MCP_SERVER, WRITE_TASK_TOOL } from "../write-task.js";
import { compareVersions } from "./codex.js";
import { type Executable, killProcessTree, resolveExecutable, runExecutable } from "./exec.js";
import type { PreflightOptions, PreflightResult, ProviderProfile } from "./types.js";

export const ANTIGRAVITY_TESTED_VERSION = "1.2.7";
/** Oldest version whose stream-json loop, plugin discovery and hook contract match the tested one. */
export const ANTIGRAVITY_MIN_VERSION = "1.2.7";
const ANTIGRAVITY_INSTALL = "install the Antigravity CLI (https://antigravity.google/docs/cli)";
const ANTIGRAVITY_LOGIN = "agy";
const STDERR_TAIL_LINES = 30;
/** The plugin name; Antigravity namespaces its servers `<plugin>_<server>`. */
export const ANTIGRAVITY_PLUGIN = "crt";
export const ANTIGRAVITY_MCP_SERVER = `${ANTIGRAVITY_PLUGIN}_${CRT_MCP_SERVER}`;
/** Written by the PreInvocation hook before every model call; proves the hooks are loaded. */
export const HOOKS_LOADED_MARKER = "hooks.loaded";
/** Antigravity's generic MCP dispatcher tool. */
const CALL_MCP_TOOL = "call_mcp_tool";

/** F-46 reference values for Antigravity (spike verdicts: deltas, the CRT hook sandbox, images by path). */
export const ANTIGRAVITY_CAPABILITIES: ProviderCapabilities = {
  streaming: true,
  toolEvents: true,
  permissions: "sandboxed",
  images: "path",
  resume: true,
  interrupt: true,
  instructions: "first-message",
};

/** F-111: shipped experimental until the M19 Manual row (a real intake on the trial app) has passed. */
export const ANTIGRAVITY_EXPERIMENTAL = "experimental: the M19 real-intake check on the trial app has not been recorded yet; report what you see";

/** F-58: where agy 1.2.7 reads Agent Skills from (the built-in agy-customizations docs, spike §4). */
export function antigravitySkillsDirs(env: NodeJS.ProcessEnv = process.env): { project: string; user: string } {
  const home = env.HOME?.trim() || env.USERPROFILE?.trim() || homedir();
  return { project: join(".agents", "skills"), user: join(home, ".gemini", "config", "skills") };
}

export const antigravityProfile: ProviderProfile = {
  id: "antigravity",
  displayName: "Antigravity",
  agentName: "Antigravity CLI",
  markers: { private: [".agents/"], shared: ["AGENTS.md", "GEMINI.md"] },
  launchEnv: ["ANTIGRAVITY_CONVERSATION_ID", "ANTIGRAVITY_AGENT"],
  hints: { install: ANTIGRAVITY_INSTALL, login: ANTIGRAVITY_LOGIN },
  capabilities: ANTIGRAVITY_CAPABILITIES,
  experimental: ANTIGRAVITY_EXPERIMENTAL,
  telemetryOptOut: [],
  skillsDirs: antigravitySkillsDirs,
  preflight: antigravityPreflight,
  resumeCommand: (conversationId) => `agy --conversation ${conversationId}`,
  start: (opts) => startAntigravitySession(opts),
};

/** N-7 lines; the README's Providers section quotes them verbatim. */
export const ANTIGRAVITY_NOT_FOUND = `agy not found on PATH — ${ANTIGRAVITY_INSTALL}, or set providers.antigravity.command in .crt/config.json`;
export const ANTIGRAVITY_NOT_LOGGED_IN = `not logged in to Antigravity — run \`${ANTIGRAVITY_LOGIN}\` in a terminal and sign in, then send again`;
export const antigravityTooOld = (version: string): string => `agy ${version} is too old — CRT needs ${ANTIGRAVITY_MIN_VERSION} or newer (run \`agy update\`)`;
export const antigravityCouldNotResume = (conversationId: string): string => `Antigravity could not resume conversation ${conversationId} — start a new session`;
export const antigravityHooksNotLoaded = (sessionDir: string): string => `Antigravity did not load the CRT hooks from ${sessionDir} — the turn was stopped before any tool ran; update agy (tested ${ANTIGRAVITY_TESTED_VERSION}) or start a new session`;
export const ANTIGRAVITY_MCP_NEVER_CALLED = "Antigravity finished the turn without replying or calling write_task — check that agy lists the crt_crt MCP server from the session plugin (node <cli.js> mcp) and that nothing on stderr says it failed to start";
const antigravityExited = (code: number | null, tail: string) => `Antigravity exited${code === null ? "" : ` with code ${code}`} before the turn completed${tail ? ` (${tail})` : ""}`;

/**
 * F-111 preflight: find the executable (config → PATH), read `--version` against the minimum.
 * Login cannot be told offline (no status command, keyring token): "unknown" passes (§12 rule 3).
 */
export async function antigravityPreflight(opts: PreflightOptions = {}): Promise<PreflightResult> {
  const exe = resolveExecutable("agy", { command: opts.command ?? null, ...(opts.env ? { env: opts.env } : {}) });
  if (!exe) return { installed: false, loggedIn: "unknown", version: null, problem: ANTIGRAVITY_NOT_FOUND };
  const v = await runExecutable(exe, ["--version"], opts.env ? { env: opts.env } : {});
  const version = parseAntigravityVersion(v.stdout);
  if (v.status !== 0 || !version) {
    const why = v.error ?? v.stderr.trim().split(/\r?\n/)[0] ?? `exit ${v.status}`;
    return { installed: true, loggedIn: "unknown", version, problem: `agy --version failed (${why || "no output"}) — ${ANTIGRAVITY_INSTALL}` };
  }
  if (compareVersions(version, ANTIGRAVITY_MIN_VERSION) < 0) return { installed: true, loggedIn: "unknown", version, problem: antigravityTooOld(version) };
  return { installed: true, loggedIn: "unknown", version, problem: null };
}

/** `1.2.7` (or `agy 1.2.7`) → `1.2.7`; null when the output is not a version. */
export function parseAntigravityVersion(stdout: string): string | null {
  const m = /(?:^|\s)v?(\d+\.\d+\.\d+(?:[-+][\w.]+)?)\s*$/m.exec(stdout.trim());
  return m ? m[1]! : null;
}

/** N-7: the logged-out strings print mode emits (spike §4, binary strings). */
export function antigravityLoginProblem(message: string): string | null {
  return /not logged in(?:to)? Antigravity|Print mode: not logged in|Print mode: auth (?:error|timed out)|not logged in and no controlling terminal/i.test(message) ? ANTIGRAVITY_NOT_LOGGED_IN : null;
}

// ---- the session plugin (--add-dir) ------------------------------------------------------------------

/** Tools the PreToolUse hook lets through besides `call_mcp_tool` on the crt server (read-only on 1.2.7). */
export const ANTIGRAVITY_ALLOWED_TOOLS: readonly string[] = ["view_file", "list_dir", "grep_search", "find_by_name", "read_resource", "list_resources", "finish"];

/** What the hook gets on stdin (camelCase, protojson), reduced to what the decision reads. */
export interface HookPayload {
  toolCall?: { name?: string; args?: Record<string, unknown> };
}

/** The F-111 policy: the pure decision the hook script and the unit tests share. */
export function antigravityHookDecision(payload: HookPayload): { decision: "allow" } | { decision: "deny"; reason: string } {
  const name = String(payload.toolCall?.name ?? "");
  const args = payload.toolCall?.args ?? {};
  if (ANTIGRAVITY_ALLOWED_TOOLS.includes(name)) return { decision: "allow" };
  if (name === CALL_MCP_TOOL && String(args.ServerName ?? "") === ANTIGRAVITY_MCP_SERVER) return { decision: "allow" };
  return { decision: "deny", reason: `CRT intake session: ${name || "this tool"} is not allowed here; only reading files and the crt MCP server are.` };
}

/** The PreToolUse hook script: the same decision as `antigravityHookDecision`, self-contained. */
export const HOOK_SCRIPT = `// CRT (PRD-providers F-111): the intake session's PreToolUse allowlist — reads and the crt MCP server pass, everything else is denied.
const ALLOWED = new Set(${JSON.stringify(ANTIGRAVITY_ALLOWED_TOOLS)});
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  let payload = {};
  try { payload = JSON.parse(input); } catch {}
  const call = (payload && payload.toolCall) || {};
  const args = call.args || {};
  const name = String(call.name || "");
  const allow = ALLOWED.has(name) || (name === ${JSON.stringify(CALL_MCP_TOOL)} && String(args.ServerName || "") === ${JSON.stringify(ANTIGRAVITY_MCP_SERVER)});
  process.stdout.write(JSON.stringify(allow ? { decision: "allow" } : { decision: "deny", reason: "CRT intake session: " + (name || "this tool") + " is not allowed here; only reading files and the crt MCP server are." }));
});
`;

/** The PreInvocation hook script: writes the marker next to the plugin's session directory. */
export const PREINVOKE_SCRIPT = `// CRT (PRD-providers F-111): runs before every model call; the marker proves the hooks are loaded.
import { writeFileSync } from "node:fs";
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  writeFileSync(new URL(${JSON.stringify(`../../../${HOOKS_LOADED_MARKER}`)}, import.meta.url), new Date().toISOString());
  process.stdout.write("{}");
});
`;

export interface SessionPlugin {
  /** The directory passed to `--add-dir`. */
  sessionDir: string;
  /** `<sessionDir>/.agents/plugins/crt`. */
  pluginDir: string;
  /** `<sessionDir>/hooks.loaded`. */
  marker: string;
  /** Every file written, absolute. */
  files: string[];
}

/** `.crt/captures/antigravity/<session id>` under the project root. */
export function antigravitySessionDir(root: string, sessionId: string): string {
  return join(root, ".crt", "captures", "antigravity", sessionId);
}

/**
 * F-111: write the per-session plugin Antigravity discovers through `--add-dir <sessionDir>`. The
 * MCP `env` map stays empty: `agy` hands its whole environment to the server, and the token is
 * set on `agy` itself (F-49/N-8). Windows facts from the spike: hooks run under `cmd /c` with cwd
 * = the plugin dir, a bare name is not found and a quoted node path is mangled, so `hooks.json`
 * names the absolute `.cmd` (POSIX: `.sh`) wrapper, which execs our own Node.
 */
export function writeSessionPlugin(
  sessionDir: string,
  mcp: Pick<StartSessionOptions["mcp"], "command" | "args">,
  platform: NodeJS.Platform = process.platform,
): SessionPlugin {
  const pluginDir = join(sessionDir, ".agents", "plugins", ANTIGRAVITY_PLUGIN);
  mkdirSync(pluginDir, { recursive: true });
  const files: string[] = [];
  const write = (name: string, body: string, executable = false) => {
    const file = join(pluginDir, name);
    writeFileSync(file, body, "utf8");
    if (executable && platform !== "win32") chmodSync(file, 0o755);
    files.push(file);
    return file;
  };
  write("plugin.json", `${JSON.stringify({ name: ANTIGRAVITY_PLUGIN })}\n`);
  write("mcp_config.json", `${JSON.stringify({ mcpServers: { [CRT_MCP_SERVER]: { command: mcp.command, args: mcp.args, env: {} } } }, null, 2)}\n`);
  write("hook.mjs", HOOK_SCRIPT);
  write("preinvoke.mjs", PREINVOKE_SCRIPT);
  const wrapper = (name: string, script: string): string =>
    platform === "win32"
      ? write(`${name}.cmd`, `@"${process.execPath}" "%~dp0${script}"\r\n`)
      : write(`${name}.sh`, `#!/bin/sh\nexec '${process.execPath.replace(/'/g, "'\\''")}' "$(dirname "$0")/${script}"\n`, true);
  const hook = wrapper("hook", "hook.mjs");
  const preinvoke = wrapper("preinvoke", "preinvoke.mjs");
  write(
    "hooks.json",
    `${JSON.stringify(
      {
        "crt-intake": {
          PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: hook, timeout: 10 }] }],
          PreInvocation: [{ type: "command", command: preinvoke, timeout: 10 }],
        },
      },
      null,
      2,
    )}\n`,
  );
  return { sessionDir, pluginDir, marker: join(sessionDir, HOOKS_LOADED_MARKER), files };
}

// ---- command line and events ---------------------------------------------------------------------------

/** F-111: the argv for one process; `conversationId` null = a new conversation, else `--conversation <id>`. */
export function antigravityArgs(sessionDir: string, model: string | null, conversationId: string | null): string[] {
  const args = ["--output-format", "stream-json", "--input-format", "stream-json", "--print", "", "--dangerously-skip-permissions", "--add-dir", sessionDir];
  if (model) args.push("--model", model);
  if (conversationId) args.push("--conversation", conversationId);
  return args;
}

/** One stdin line for a developer message (text only: images are paths in the text, F-50). */
export function antigravityUserLine(text: string): string {
  return `${JSON.stringify({ event: "user", message: { role: "user", content: text } })}\n`;
}

/** One stdout line of `--output-format stream-json`, loosely typed: unknown shapes are ignored, never fatal. */
export interface AgyEvent {
  event: string;
  conversation_id?: string;
  init?: { cwd?: string; tools?: string[]; permission_mode?: string; model?: string };
  step_update?: AgyStep;
  result?: AgyResult;
}
export interface AgyStep {
  conversation_id?: string;
  step_index: number;
  state?: string;
  step_type?: string;
  text_delta?: string;
  tool_name?: string;
  tool_info?: { name?: string; parameters?: Record<string, unknown>; output?: string; error?: { type?: string; message?: string } };
  duration_seconds?: number;
  usage?: Record<string, number>;
}
export interface AgyResult {
  conversation_id?: string;
  status?: string;
  response?: string;
  error?: string;
  num_turns?: number;
  usage?: Record<string, number>;
  denied_actions?: Array<{ action?: string; display_name?: string }>;
}

export function parseAgyLine(line: string): AgyEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return null;
  try {
    const v = JSON.parse(trimmed) as unknown;
    return v && typeof v === "object" && typeof (v as AgyEvent).event === "string" ? (v as AgyEvent) : null;
  } catch {
    return null;
  }
}

/** Parameter keys worth a label, in the order Antigravity's tools use them (spike recordings). */
const LABEL_KEYS = ["AbsolutePath", "TargetFile", "DirectoryPath", "SearchDirectory", "CommandLine", "Query", "Pattern", "Url"];

function isCrtMcpCall(step: AgyStep): boolean {
  const p = step.tool_info?.parameters ?? {};
  return (step.tool_name ?? step.tool_info?.name) === CALL_MCP_TOOL && String(p.ServerName ?? "") === ANTIGRAVITY_MCP_SERVER;
}

/** F-25-style one-liner for a tool step. */
export function antigravityToolLabel(step: AgyStep): string {
  const name = step.tool_name ?? step.tool_info?.name ?? "tool";
  const p = step.tool_info?.parameters ?? {};
  if (name === CALL_MCP_TOOL) {
    const args = (p.Arguments ?? {}) as Record<string, unknown>;
    if (isCrtMcpCall(step) && p.ToolName === WRITE_TASK_TOOL) return `Write task: ${String(args.title ?? "")}`;
    return `${String(p.ServerName ?? "mcp")}/${String(p.ToolName ?? "?")}`;
  }
  const verb: Record<string, string> = { view_file: "Read", list_dir: "List", grep_search: "Grep", find_by_name: "Find", run_command: "Run", write_to_file: "Edit", replace_file_content: "Edit", multi_replace_file_content: "Edit", sed_file: "Edit" };
  const key = LABEL_KEYS.find((k) => typeof p[k] === "string");
  const detail = key ? summarize(String(p[key])) : "";
  return `${verb[name] ?? name}${detail ? ` ${detail}` : ""}`;
}

/** The tool name the panel and the F-26 vocabulary use: `mcp__crt__<tool>` for our server, else the agy name. */
export function antigravityToolName(step: AgyStep): string {
  const p = step.tool_info?.parameters ?? {};
  if (isCrtMcpCall(step)) return `mcp__${CRT_MCP_SERVER}__${String(p.ToolName ?? "tool")}`;
  if ((step.tool_name ?? step.tool_info?.name) === CALL_MCP_TOOL) return `mcp__${String(p.ServerName ?? "mcp")}__${String(p.ToolName ?? "tool")}`;
  return step.tool_name ?? step.tool_info?.name ?? "tool";
}

/** The collapsed result line of a finished tool step. */
export function antigravityToolSummary(step: AgyStep): string {
  const error = step.tool_info?.error?.message;
  if (error) return summarize(error);
  const out = summarize(step.tool_info?.output ?? "");
  return out || (step.state === "ERROR" ? "failed" : "done");
}

function summarize(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 160 ? `${t.slice(0, 157)}…` : t;
}

/** `result.usage` (+ denied actions) as one line for `result.detail`. */
export function describeAgyResult(result: AgyResult): string | undefined {
  const parts: string[] = [];
  const usage = Object.entries(result.usage ?? {})
    .filter(([, v]) => typeof v === "number")
    .map(([k, v]) => `${k.replace(/_tokens$/, "").replace(/_/g, " ")} ${v}`);
  if (usage.length) parts.push(`tokens: ${usage.join(", ")}`);
  const denied = (result.denied_actions ?? []).map((d) => d.display_name ?? d.action ?? "?");
  if (denied.length) parts.push(`denied by Antigravity: ${denied.join(", ")}`);
  return parts.length ? parts.join("; ") : undefined;
}

type TurnOutcome = { kind: "conversation"; conversationId: string } | { kind: "fail"; problem: string } | { kind: "first-step" } | null;

/**
 * Maps one process's stdout lines to `SessionEvent`s (the F-111 event table). Pure apart from
 * `emit`, so the fixtures replay through it without a process. One mapper per process; `beginTurn`
 * numbers the turns so step ids stay unique per session.
 */
export class AgyMapper {
  /** `result` seen for the current turn. */
  ended = true;
  private turn = 0;
  private textStep: number | null = null;
  private sawText = false;
  private sawMcp = false;
  private firstStepSeen = false;
  private startedTools = new Set<string>();

  constructor(
    private readonly expectedConversation: string | null,
    private readonly opts: Pick<StartSessionOptions, "id" | "model" | "agentVersion">,
    private readonly emit: (e: SessionEvent) => void,
  ) {}

  beginTurn(): void {
    this.turn++;
    this.ended = false;
    this.textStep = null;
    this.sawText = false;
    this.sawMcp = false;
    this.firstStepSeen = false;
    this.startedTools.clear();
  }

  private id(step: AgyStep): string {
    return `t${this.turn}-s${step.step_index}`;
  }

  private endText(): void {
    if (this.textStep === null) return;
    this.emit({ type: "assistant_end", messageId: `t${this.turn}-s${this.textStep}` });
    this.textStep = null;
  }

  handle(event: AgyEvent, elapsedMs: number): TurnOutcome {
    switch (event.event) {
      case "init": {
        const id = typeof event.conversation_id === "string" ? event.conversation_id : "";
        if (this.expectedConversation !== null) {
          // F-111: an unknown id silently starts a new conversation; that ends the session (N-7).
          return id === this.expectedConversation ? null : { kind: "fail", problem: antigravityCouldNotResume(this.expectedConversation) };
        }
        if (!id) return { kind: "fail", problem: "Antigravity started without a conversation id — cannot resume this session later" };
        this.emit({
          type: "init",
          sessionId: this.opts.id,
          nativeSessionId: id,
          provider: antigravityProfile.id,
          displayName: antigravityProfile.displayName,
          model: event.init?.model ?? this.opts.model ?? null,
          agentVersion: this.opts.agentVersion ?? null,
          resumeCommand: antigravityProfile.resumeCommand(id),
          capabilities: ANTIGRAVITY_CAPABILITIES,
          experimental: ANTIGRAVITY_EXPERIMENTAL,
        });
        return { kind: "conversation", conversationId: id };
      }
      case "step_update": {
        const step = event.step_update;
        if (!step || typeof step.step_index !== "number") return null;
        if (step.step_type === "user_input") return null;
        const first = !this.firstStepSeen;
        this.firstStepSeen = true;
        if (step.step_type === "agent_response") {
          const delta = step.text_delta ?? "";
          if (delta) {
            if (this.textStep !== step.step_index) {
              this.endText();
              this.textStep = step.step_index;
              this.emit({ type: "assistant_start", messageId: this.id(step) });
            }
            this.sawText = true;
            this.emit({ type: "text", messageId: this.id(step), text: delta });
          }
          if (step.state === "DONE" || step.state === "ERROR") this.endText();
        } else if (step.step_type === "tool") {
          this.endText();
          const id = this.id(step);
          if (isCrtMcpCall(step)) this.sawMcp = true;
          if (!this.startedTools.has(id)) {
            this.startedTools.add(id);
            this.emit({ type: "tool_use", id, name: antigravityToolName(step), label: antigravityToolLabel(step) });
          }
          if (step.state === "DONE" || step.state === "ERROR") {
            this.emit({ type: "tool_result", id, isError: step.state === "ERROR" || Boolean(step.tool_info?.error?.message), summary: antigravityToolSummary(step) });
          }
        }
        return first ? { kind: "first-step" } : null;
      }
      case "result": {
        const result = event.result ?? {};
        this.endText();
        this.ended = true;
        const ok = result.status === "SUCCESS";
        const errors: string[] = [];
        if (result.error) {
          errors.push(result.error);
          this.emit({ type: "error", message: result.error });
        } else if (!ok) {
          errors.push(`Antigravity reported ${result.status ?? "an error"}`);
        }
        if (ok && !this.sawText && !this.sawMcp) this.emit({ type: "error", message: ANTIGRAVITY_MCP_NEVER_CALLED });
        const detail = describeAgyResult(result);
        this.emit({ type: "result", ok, durationMs: elapsedMs, costUsd: 0, errors, ...(detail ? { detail } : {}) });
        const login = result.error ? antigravityLoginProblem(result.error) : null;
        return login ? { kind: "fail", problem: login } : null;
      }
      default:
        return null; // anything newer than the tested version
    }
  }
}

// ---- the driver ---------------------------------------------------------------------------------

/** What `startAntigravitySession` needs from the OS; tests replace the spawn to replay fixtures in-process. */
export interface AntigravityProcessDeps {
  spawn: (command: string, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv }) => ChildProcess;
  killTree: (pid: number) => boolean;
  /** Where the session plugin goes; defaults to `.crt/captures/antigravity/<id>` under the project root. */
  sessionDir?: (opts: StartSessionOptions) => string;
}

const realDeps: AntigravityProcessDeps = {
  spawn: (command, args, opts) =>
    spawn(command, args, {
      cwd: opts.cwd,
      env: opts.env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      // POSIX: a process group of its own so a negative-pid kill takes the MCP child and the sidecar with it.
      detached: process.platform !== "win32",
    }),
  killTree: (pid) => killProcessTree(pid),
};

/**
 * F-111: one `agy` process per session, one turn per stdin line. Turn 1 carries the first message
 * (instructions prepended, F-51) with the screenshot paths in its text (F-50); an interrupt kills
 * the process and the next message resumes the conversation in a new one. The registry's
 * `writeTask` is never called here: Antigravity reaches `write_task` through `crt mcp` and the
 * internal route, and the registry records `task_written` itself (§5.3).
 */
export function startAntigravitySession(opts: StartSessionOptions, deps: AntigravityProcessDeps = realDeps): SessionDriver {
  const listeners = new Set<(e: SessionEvent) => void>();
  const env = process.env;
  const log = opts.log ?? (() => undefined);
  let state: SessionState = "starting";
  let closed = false;
  let conversationId: string | null = null;
  let child: ChildProcess | null = null;
  let mapper: AgyMapper | null = null;
  let turnStarted = 0;
  let resolveTurn: (() => void) | null = null;
  const queue: UserInput[] = [];
  const stderrTail: string[] = [];
  const sessionDir = deps.sessionDir ? deps.sessionDir(opts) : antigravitySessionDir(opts.cwd, opts.id);
  let plugin: SessionPlugin | null = null;
  let hooksVerified = false;

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
  const killCurrent = () => {
    const pid = child?.pid;
    child = null;
    if (pid) deps.killTree(pid);
  };
  const removeSessionDir = () => {
    try {
      rmSync(sessionDir, { recursive: true, force: true });
    } catch {
      // best effort; the directory is gitignored with the captures
    }
  };
  const fail = (problem: string) => {
    if (closed) return;
    emit({ type: "error", message: problem });
    setState("error", problem);
    closed = true;
    queue.length = 0;
    killCurrent();
    removeSessionDir();
    resolveTurn?.();
  };
  const tail = () => stderrTail.filter((l) => !/^warning:/i.test(l)).slice(-2).join(" | ");

  const exe: Executable | null = resolveExecutable("agy", { command: opts.command ?? null, env });
  if (!exe) queueMicrotask(() => fail(ANTIGRAVITY_NOT_FOUND));

  /** Spawn a process for this session (a fresh conversation, or `--conversation` after a kill). */
  const spawnProcess = (): ChildProcess | null => {
    if (!exe) return null;
    if (!plugin) {
      try {
        plugin = writeSessionPlugin(sessionDir, opts.mcp);
      } catch (err) {
        fail(`could not write the Antigravity session plugin under ${sessionDir} (${(err as Error).message})`);
        return null;
      }
    }
    rmSync(plugin.marker, { force: true });
    hooksVerified = false;
    const turn = new AgyMapper(conversationId, opts, emit);
    let proc: ChildProcess;
    try {
      proc = deps.spawn(exe.command, [...exe.args, ...antigravityArgs(sessionDir, opts.model, conversationId)], { cwd: opts.cwd, env: { ...env, ...opts.mcp.env } });
    } catch (err) {
      fail(`could not start agy (${(err as Error).message}) — ${ANTIGRAVITY_INSTALL}`);
      return null;
    }
    child = proc;
    mapper = turn;
    let buffer = "";
    proc.stdin?.on("error", () => undefined);
    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        handle(proc, turn, line);
      }
    });
    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (chunk: string) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (!line.trim()) continue;
        stderrTail.push(line);
        if (stderrTail.length > STDERR_TAIL_LINES) stderrTail.shift();
        if (child !== proc || closed) continue;
        const login = antigravityLoginProblem(line);
        if (login) {
          fail(login);
        } else if (/^(error:|AGY_ERROR:)/.test(line)) {
          emit({ type: "error", message: summarize(line.replace(/^error:\s*/, "")) });
        } else {
          log(`crt: agy: ${line}`);
        }
      }
    });
    proc.on("error", (err: NodeJS.ErrnoException) => {
      if (child !== proc) return;
      fail(err.code === "ENOENT" ? ANTIGRAVITY_NOT_FOUND : `could not start agy (${err.message})`);
    });
    proc.on("exit", (code) => {
      if (buffer.trim()) handle(proc, turn, buffer);
      buffer = "";
      if (child !== proc) return; // killed on purpose (interrupt, close, fail)
      child = null;
      if (closed) return;
      if (turn.ended || state === "idle" || state === "starting") {
        // Died between turns: the next message resumes the conversation in a new process.
        log(`crt: agy exited with code ${code} between turns; stderr tail: ${stderrTail.slice(-3).join(" | ")}`);
        if (conversationId === null) fail(antigravityLoginProblem(stderrTail.join("\n")) ?? antigravityExited(code, tail()));
        return;
      }
      log(`crt: agy exited with code ${code} mid-turn; stderr tail: ${stderrTail.slice(-5).join(" | ")}`);
      if (conversationId === null) {
        fail(antigravityLoginProblem(stderrTail.join("\n")) ?? antigravityExited(code, tail()));
        return;
      }
      emit({ type: "result", ok: false, durationMs: Date.now() - turnStarted, costUsd: 0, errors: [antigravityExited(code, tail())] });
      turn.ended = true;
      setState("idle");
      resolveTurn?.();
    });
    return proc;
  };

  const handle = (proc: ChildProcess, turn: AgyMapper, line: string) => {
    if (closed || child !== proc) return;
    const event = parseAgyLine(line);
    if (!event) return;
    const outcome = turn.handle(event, Date.now() - turnStarted);
    if (outcome?.kind === "conversation") conversationId = outcome.conversationId;
    else if (outcome?.kind === "fail") fail(outcome.problem);
    else if (outcome?.kind === "first-step" && !hooksVerified) {
      // F-111: the PreInvocation hook ran before the model was called, or the hooks are not loaded.
      if (plugin && !existsSync(plugin.marker)) {
        fail(antigravityHooksNotLoaded(sessionDir));
        return;
      }
      hooksVerified = true;
    }
    if (turn.ended && !closed) {
      setState("idle");
      resolveTurn?.();
    }
  };

  /** Write one message and wait for its `result` (or the process to die). */
  const runTurn = (input: UserInput): Promise<void> =>
    new Promise((resolve) => {
      if (closed) return resolve();
      const proc = child ?? spawnProcess();
      if (!proc || !mapper) return resolve();
      turnStarted = Date.now();
      mapper.beginTurn();
      resolveTurn = () => {
        resolveTurn = null;
        resolve();
      };
      setState("running");
      proc.stdin?.write(antigravityUserLine(input.text));
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
      enqueue(u);
    },
    async interrupt() {
      if (closed || !child?.pid || state !== "running") return;
      const proc = child;
      child = null;
      deps.killTree(proc.pid!);
      if (mapper) mapper.ended = true;
      emit({ type: "result", ok: false, durationMs: Date.now() - turnStarted, costUsd: 0, errors: ["interrupted"] });
      setState("idle");
      resolveTurn?.();
    },
    respondPermission: () => false, // F-46 sandboxed: there are no cards
    close() {
      if (closed) return;
      closed = true;
      queue.length = 0;
      killCurrent();
      removeSessionDir();
      state = "ended";
      emit({ type: "state", state: "ended" });
      resolveTurn?.();
    },
    onEvent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
