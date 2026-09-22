import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { build } from "esbuild";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { installFakeAgy } from "../../e2e/fixture/fake-codex-install.mjs";
import { writeCapture } from "../../src/captures.js";
import { FIRST_MESSAGE_HEADING } from "../../src/intake-message.js";
import {
  AgyMapper,
  ANTIGRAVITY_ALLOWED_TOOLS,
  ANTIGRAVITY_CAPABILITIES,
  ANTIGRAVITY_MCP_NEVER_CALLED,
  ANTIGRAVITY_MCP_SERVER,
  ANTIGRAVITY_MIN_VERSION,
  ANTIGRAVITY_NOT_FOUND,
  ANTIGRAVITY_NOT_LOGGED_IN,
  antigravityArgs,
  antigravityCouldNotResume,
  antigravityHookDecision,
  antigravityHooksNotLoaded,
  antigravityLoginProblem,
  antigravityPreflight,
  antigravityProfile,
  antigravitySessionDir,
  antigravitySkillsDirs,
  antigravityToolLabel,
  antigravityToolName,
  antigravityTooOld,
  antigravityUserLine,
  HOOKS_LOADED_MARKER,
  parseAgyLine,
  parseAntigravityVersion,
  startAntigravitySession,
  writeSessionPlugin,
} from "../../src/providers/antigravity.js";
import type { SessionEvent } from "../../src/session-events.js";
import { samplePost } from "../helpers/sample-capture.js";
import { runConformance } from "./conformance.js";

// The antigravity provider (PRD-providers F-42, F-111, F-59, N-7, N-10; spike verdicts in
// docs/spikes/antigravity-2026-09.md). Four layers:
//   1. the profile and the pure pieces (version parsing, the argv, the stdin line, the session
//      plugin files, the hook decision, event mapping) — the recorded fixtures are replayed
//      through `AgyMapper` without a process;
//   2. the recordings themselves (headers, shapes: the F-59 "fixtures parse" item);
//   3. preflight and the F-59 conformance scenario against the fake `agy` from
//      e2e/fixture/fake-agy.mjs, installed npm-style into a scratch bin on PATH, so `exec.ts`,
//      the plugin discovery, the hooks through `cmd /c` / `sh -c`, process-tree kill and the real
//      `crt mcp` shim plus internal route all run;
//   4. the failure lines: a resume whose conversation id differs, hooks that did not load, a
//      logged-out CLI, agy not on PATH.

const FIXTURES = join(import.meta.dirname, "fixtures", "antigravity");
let tmp: string;
let bin: string;
let shim: string;
const savedPath = process.env.PATH;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "crt-agy-"));
  bin = installFakeAgy(join(tmp, "npm"));
  // The `crt mcp` shim as the agent runs it: one file bundled from src (like test/mcp-stdio.test.ts).
  const entry = join(tmp, "entry.mjs");
  writeFileSync(entry, `import { runMcpStdio } from ${JSON.stringify(join(import.meta.dirname, "..", "..", "src", "mcp-stdio.ts"))};\nprocess.exitCode = await runMcpStdio({ input: process.stdin, output: process.stdout, env: process.env });\n`);
  shim = join(tmp, "crt-mcp.mjs");
  await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", target: "node20", outfile: shim, logLevel: "silent" });
}, 60_000);

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/**
 * Put the fake on a PATH of its own (the driver resolves through `process.env`) and set fake knobs.
 * Not "first on PATH": exec.ts prefers a bare `.exe` anywhere on PATH over an npm shim, so a real
 * `agy.exe` on the developer's machine would win over the fake's `agy.cmd` (N-9). The shell tools the
 * fake and the driver need (node, cmd/sh, taskkill) come from the node and system directories.
 */
const SYSTEM_DIRS = process.platform === "win32" ? [join(process.env.SystemRoot ?? "C:\\Windows", "System32")] : ["/usr/bin", "/bin"];
function useFake(extra: Record<string, string> = {}): void {
  process.env.PATH = [bin, dirname(process.execPath), ...SYSTEM_DIRS].join(delimiter);
  for (const [k, v] of Object.entries(extra)) {
    savedEnv[k] = process.env[k];
    process.env[k] = v;
  }
}
afterEach(() => {
  process.env.PATH = savedPath;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  for (const k of Object.keys(savedEnv)) delete savedEnv[k];
});

// A synthetic PATH: the fake's bin first; on POSIX the executable script's `#!/usr/bin/env node` needs node on it too.
const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({ PATH: `${bin}${delimiter}${dirname(process.execPath)}`, PATHEXT: ".COM;.EXE;.BAT;.CMD", ...extra });

type AgyFixtureEvent = { event: string; conversation_id?: string; step_update?: { step_index: number; state: string; step_type: string; tool_name?: string; text_delta?: string }; result?: { status: string; conversation_id?: string; error?: string; denied_actions?: unknown[] } };

/** Splits a fixture into its `#` header lines and parsed events; throws on a bad line. */
function parseFixture(name: string): { header: string[]; events: AgyFixtureEvent[] } {
  const lines = readFileSync(join(FIXTURES, name), "utf8").split("\n");
  const header: string[] = [];
  const events: AgyFixtureEvent[] = [];
  lines.forEach((line, i) => {
    if (line === "") return;
    if (line.startsWith("#")) {
      header.push(line.slice(1).trim());
      return;
    }
    try {
      events.push(JSON.parse(line) as AgyFixtureEvent);
    } catch (err) {
      throw new Error(`${name}:${i + 1}: not JSON — ${(err as Error).message}`);
    }
  });
  return { header, events };
}
const steps = (events: AgyFixtureEvent[]) => events.filter((e) => e.event === "step_update").map((e) => e.step_update!);
const conversation = (events: AgyFixtureEvent[]) => events.find((e) => e.event === "init")?.conversation_id;

describe("antigravity profile (F-42, F-111)", () => {
  it("declares the spike-verified markers, launch signal, capabilities, no experimental badge, skills dirs and resume command (F-42, F-46, F-58, F-111)", () => {
    expect(antigravityProfile.id).toBe("antigravity");
    expect(antigravityProfile.displayName).toBe("Antigravity");
    expect(antigravityProfile.agentName).toBe("Antigravity CLI");
    expect(antigravityProfile.markers).toEqual({ private: [".agents/"], shared: ["AGENTS.md", "GEMINI.md"] });
    expect(antigravityProfile.launchEnv).toEqual(["ANTIGRAVITY_CONVERSATION_ID", "ANTIGRAVITY_AGENT"]);
    expect(antigravityProfile.capabilities).toEqual({ streaming: true, toolEvents: true, permissions: "sandboxed", images: "path", resume: true, interrupt: true, instructions: "first-message" });
    expect(antigravityProfile.experimental).toBeUndefined(); // the M19 Manual row passed on 2026-09-21
    expect(antigravityProfile.telemetryOptOut).toEqual([]);
    expect(antigravityProfile.resumeCommand("2e4133c8-449b-4de2-982b-a6d6252ed327")).toBe("agy --conversation 2e4133c8-449b-4de2-982b-a6d6252ed327");
    expect(antigravitySkillsDirs({ HOME: join("C:", "h") })).toEqual({ project: join(".agents", "skills"), user: join("C:", "h", ".gemini", "config", "skills") });
    expect(antigravitySkillsDirs({ USERPROFILE: join("C:", "u") })).toEqual({ project: join(".agents", "skills"), user: join("C:", "u", ".gemini", "config", "skills") });
    expect(ANTIGRAVITY_MCP_SERVER).toBe("crt_crt");
  });

  it("parses the bare version, recognises the logged-out strings and builds the recorded argv and stdin line (F-111, N-7)", () => {
    expect(parseAntigravityVersion("1.2.7\n")).toBe("1.2.7");
    expect(parseAntigravityVersion("agy 1.3.0-beta.1")).toBe("1.3.0-beta.1");
    expect(parseAntigravityVersion("Usage of agy.exe:")).toBeNull();
    expect(ANTIGRAVITY_MIN_VERSION).toBe("1.2.7");
    expect(antigravityLoginProblem("Print mode: not logged in and no controlling terminal; cannot complete interactive login")).toBe(ANTIGRAVITY_NOT_LOGGED_IN);
    expect(antigravityLoginProblem("error getting token source: You are not logged into Antigravity.")).toBe(ANTIGRAVITY_NOT_LOGGED_IN);
    expect(antigravityLoginProblem("Print mode: auth error: x")).toBe(ANTIGRAVITY_NOT_LOGGED_IN);
    expect(antigravityLoginProblem('warning: conversation "x" not found')).toBeNull();
    const dir = join("C:", "proj", ".crt", "captures", "antigravity", "s1");
    expect(antigravityArgs(dir, null, null)).toEqual(["--output-format", "stream-json", "--input-format", "stream-json", "--print", "", "--dangerously-skip-permissions", "--add-dir", dir]);
    expect(antigravityArgs(dir, "gemini-3.8-flash-high", "2e4133c8-449b-4de2-982b-a6d6252ed327").slice(-4)).toEqual(["--model", "gemini-3.8-flash-high", "--conversation", "2e4133c8-449b-4de2-982b-a6d6252ed327"]);
    expect(antigravityArgs(dir, null, null)).not.toContain("--effort");
    expect(antigravityUserLine("hi\nthere")).toBe('{"event":"user","message":{"role":"user","content":"hi\\nthere"}}\n');
    expect(antigravitySessionDir(join("C:", "proj"), "abc")).toBe(join("C:", "proj", ".crt", "captures", "antigravity", "abc"));
    expect(parseAgyLine("not json")).toBeNull();
    expect(parseAgyLine('{"event":"init","conversation_id":"x"}')).toEqual({ event: "init", conversation_id: "x" });
  });

  it("writes the session plugin: manifest, mcp_config with an empty env, hooks.json naming absolute wrappers, the scripts (F-49, F-111)", () => {
    const root = mkdtempSync(join(tmpdir(), "crt-agy-plugin-"));
    try {
      const sessionDir = antigravitySessionDir(root, "sess");
      const mcp = { command: process.execPath, args: [join("C:", "crt", "cli.js"), "mcp"], env: { CRT_MCP_TOKEN: "secret-token", CRT_MCP_PORT: "4400" } };
      for (const platform of ["win32", "linux"] as const) {
        rmSync(sessionDir, { recursive: true, force: true });
        const plugin = writeSessionPlugin(sessionDir, mcp, platform);
        expect(plugin.pluginDir).toBe(join(sessionDir, ".agents", "plugins", "crt"));
        expect(plugin.marker).toBe(join(sessionDir, HOOKS_LOADED_MARKER));
        expect(JSON.parse(readFileSync(join(plugin.pluginDir, "plugin.json"), "utf8"))).toEqual({ name: "crt" });
        // F-49/N-8: the server inherits agy's environment; the token is in no file.
        expect(JSON.parse(readFileSync(join(plugin.pluginDir, "mcp_config.json"), "utf8"))).toEqual({ mcpServers: { crt: { command: process.execPath, args: mcp.args, env: {} } } });
        for (const f of plugin.files) expect(readFileSync(f, "utf8")).not.toContain("secret-token");
        const hooks = JSON.parse(readFileSync(join(plugin.pluginDir, "hooks.json"), "utf8")) as { "crt-intake": { PreToolUse: Array<{ matcher: string; hooks: Array<{ command: string }> }>; PreInvocation: Array<{ command: string }> } };
        const ext = platform === "win32" ? "cmd" : "sh";
        expect(hooks["crt-intake"].PreToolUse[0]).toMatchObject({ matcher: "*", hooks: [{ type: "command", command: join(plugin.pluginDir, `hook.${ext}`), timeout: 10 }] });
        expect(hooks["crt-intake"].PreInvocation[0]).toMatchObject({ type: "command", command: join(plugin.pluginDir, `preinvoke.${ext}`) });
        const wrapper = readFileSync(join(plugin.pluginDir, `hook.${ext}`), "utf8");
        expect(wrapper).toContain(process.execPath);
        expect(wrapper).toContain(platform === "win32" ? '"%~dp0hook.mjs"' : '"$(dirname "$0")/hook.mjs"');
        expect(readFileSync(join(plugin.pluginDir, "hook.mjs"), "utf8")).toContain('"crt_crt"');
        expect(readFileSync(join(plugin.pluginDir, "preinvoke.mjs"), "utf8")).toContain("../../../hooks.loaded");
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("the hook decision: read-only tools and call_mcp_tool on crt_crt pass, everything else is denied with the reason the model sees (F-111)", () => {
    for (const name of ANTIGRAVITY_ALLOWED_TOOLS) expect(antigravityHookDecision({ toolCall: { name, args: {} } })).toEqual({ decision: "allow" });
    expect(antigravityHookDecision({ toolCall: { name: "call_mcp_tool", args: { ServerName: "crt_crt", ToolName: "write_task", Arguments: {} } } })).toEqual({ decision: "allow" });
    expect(antigravityHookDecision({ toolCall: { name: "call_mcp_tool", args: { ServerName: "other_server", ToolName: "x" } } })).toEqual({ decision: "deny", reason: "CRT intake session: call_mcp_tool is not allowed here; only reading files and the crt MCP server are." });
    for (const name of ["run_command", "write_to_file", "replace_file_content", "browser_click_element", "read_url_content", "search_web", "invoke_subagent"]) {
      expect(antigravityHookDecision({ toolCall: { name, args: {} } })).toEqual({ decision: "deny", reason: `CRT intake session: ${name} is not allowed here; only reading files and the crt MCP server are.` });
    }
    expect(antigravityHookDecision({})).toMatchObject({ decision: "deny" });
  });

  it("labels steps the F-25 way and names our MCP tool mcp__crt__write_task (F-111)", () => {
    const write = { step_index: 4, tool_name: "call_mcp_tool", tool_info: { name: "call_mcp_tool", parameters: { Arguments: { title: "Fix cart" }, ServerName: "crt_crt", ToolName: "write_task" } } };
    expect(antigravityToolLabel(write)).toBe("Write task: Fix cart");
    expect(antigravityToolName(write)).toBe("mcp__crt__write_task");
    const ping = { step_index: 4, tool_name: "call_mcp_tool", tool_info: { name: "call_mcp_tool", parameters: { Arguments: { message: "turn one" }, ServerName: "crt_crt", ToolName: "crt_ping" } } };
    expect(antigravityToolLabel(ping)).toBe("crt_crt/crt_ping");
    expect(antigravityToolName(ping)).toBe("mcp__crt__crt_ping");
    expect(antigravityToolLabel({ step_index: 2, tool_name: "view_file", tool_info: { name: "view_file", parameters: { AbsolutePath: "C:\\p\\AGENTS.md" } } })).toBe("Read C:\\p\\AGENTS.md");
    expect(antigravityToolLabel({ step_index: 6, tool_name: "run_command", tool_info: { name: "run_command", parameters: { CommandLine: "Get-Date" } } })).toBe("Run Get-Date");
    expect(antigravityToolLabel({ step_index: 8, tool_name: "write_to_file", tool_info: { name: "write_to_file", parameters: { TargetFile: "C:\\p\\x.txt" } } })).toBe("Edit C:\\p\\x.txt");
    expect(antigravityToolName({ step_index: 8, tool_name: "write_to_file" })).toBe("write_to_file");
    expect(antigravityToolLabel({ step_index: 9, tool_name: "something_new", tool_info: { name: "something_new", parameters: { Foo: 1 } } })).toBe("something_new");
  });

  it("the README quotes every Antigravity N-7 line verbatim and states the sandbox, the telemetry setting and the skills command (N-7, N-12, F-58)", () => {
    const readme = readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "docs", "providers.md"), "utf8"); // docs/providers.md since M23 (PRD-polish §9, N-26)
    for (const line of [ANTIGRAVITY_NOT_FOUND, ANTIGRAVITY_NOT_LOGGED_IN, antigravityTooOld("<version>"), antigravityCouldNotResume("<id>"), antigravityHooksNotLoaded("<sessionDir>"), ANTIGRAVITY_MCP_NEVER_CALLED]) {
      expect(readme, line).toContain(`
${line}
`);
    }
    expect(readme).toContain("--dangerously-skip-permissions");
    expect(readme).toContain("enableTelemetry");
    expect(readme).toContain("crt skills install --provider antigravity");
  });
});

describe("antigravity fixtures (F-111, F-59)", () => {
  const all = readdirSync(FIXTURES).filter((f) => f.endsWith(".jsonl"));

  it("every fixture has a header naming the tested version, the command and the exit code, and parses (F-59)", () => {
    expect(all.sort()).toEqual(["first-turn.jsonl", "image-by-path.jsonl", "input-error-image-block.jsonl", "killed.jsonl", "loop.jsonl", "mcp-denied-headless.jsonl", "resume-unknown-id.jsonl", "resume.jsonl"]);
    for (const name of all) {
      const { header, events } = parseFixture(name);
      expect(header[0], name).toMatch(/^agy 1\.2\.7 /);
      expect(header.some((h) => /^command: agy\.exe --output-format stream-json --input-format stream-json --print ""/.test(h)), `${name} names its command`).toBe(true);
      expect(header.some((h) => /^exit: \d/.test(h)), `${name} names its exit code`).toBe(true);
      expect(events.length, name).toBeGreaterThan(0);
      for (const e of events) expect(["init", "step_update", "result"], `${name} event`).toContain(e.event);
      expect(events[0]!.event, `${name} starts with init`).toBe("init");
      expect(conversation(events), name).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });

  it("first-turn.jsonl: the hook lets view_file and the crt MCP call through and refuses run_command and write_to_file; text is deltas (F-111)", () => {
    const s = steps(parseFixture("first-turn.jsonl").events);
    const tools = s.filter((x) => x.step_type === "tool" && x.state !== "ACTIVE").map((x) => `${x.tool_name}:${x.state}`);
    expect(tools).toEqual(["view_file:DONE", "call_mcp_tool:DONE", "run_command:ERROR", "write_to_file:ERROR"]);
    expect(JSON.stringify(s)).toContain("tool call denied by pre-tool hook: CRT intake session: run_command is not allowed here");
    expect(s.filter((x) => x.step_type === "agent_response" && x.state === "ACTIVE" && x.text_delta).length).toBeGreaterThan(1);
    expect(parseFixture("first-turn.jsonl").events.at(-1)?.result).toMatchObject({ status: "SUCCESS" });
  });

  it("loop.jsonl: two turns in one process share the conversation id and count num_turns up (F-111)", () => {
    const { events } = parseFixture("loop.jsonl");
    const results = events.filter((e) => e.event === "result").map((e) => e.result!);
    expect(results.map((r) => (r as { num_turns: number }).num_turns)).toEqual([1, 2]);
    expect(new Set(events.map((e) => e.conversation_id ?? e.step_update?.conversation_id ?? e.result?.conversation_id).filter(Boolean)).size).toBe(1);
  });

  it("resume.jsonl re-emits the killed conversation's id; resume-unknown-id.jsonl starts a new one after a stderr warning (F-111)", () => {
    expect(conversation(parseFixture("resume.jsonl").events)).toBe(conversation(parseFixture("killed.jsonl").events));
    expect(steps(parseFixture("killed.jsonl").events).map((x) => x.step_type)).toEqual(["user_input"]);
    const unknown = parseFixture("resume-unknown-id.jsonl");
    expect(unknown.header.some((h) => /^stderr: warning: conversation "00000000-0000-4000-8000-000000000000" not found/.test(h))).toBe(true);
    expect(conversation(unknown.events)).not.toBe("00000000-0000-4000-8000-000000000000");
  });

  it("mcp-denied-headless.jsonl and input-error-image-block.jsonl record why the driver passes the flag and sends text only (F-111)", () => {
    const denied = parseFixture("mcp-denied-headless.jsonl").events;
    expect(denied.at(-1)?.result).toMatchObject({ status: "SUCCESS", denied_actions: [{ action: "mcp", display_name: "CallMcpTool" }] });
    expect(JSON.stringify(denied)).toContain("user denied permission for mcp(crt_crt/crt_ping)");
    const image = parseFixture("input-error-image-block.jsonl");
    expect(image.events.at(-1)?.result).toMatchObject({ status: "ERROR", error: 'stream input content block type "image" is not supported (only "text")' });
    expect(image.header.some((h) => /^exit: 1/.test(h))).toBe(true);
  });
});

/** Replay one fixture through the mapper; every fixture is one process, so one mapper and one turn per result. */
function replay(name: string, expected: string | null): { events: SessionEvent[]; outcomes: Array<ReturnType<AgyMapper["handle"]>>; mapper: AgyMapper } {
  const events: SessionEvent[] = [];
  const mapper = new AgyMapper(expected, { id: "crt-session", model: null, agentVersion: "1.2.7" }, (e) => events.push(e));
  let turn = false;
  const outcomes = parseFixture(name).events.map((e, i) => {
    if (e.event === "step_update" && !turn) {
      mapper.beginTurn();
      turn = true;
    }
    const o = mapper.handle(e as never, i * 10);
    if (e.event === "result") turn = false;
    return o;
  });
  return { events, outcomes, mapper };
}

describe("antigravity event mapping over the recorded fixtures (F-111, F-59)", () => {
  it("first-turn.jsonl: init from the conversation id, tool lines with hook denials as errors, streamed text, result with usage (F-47, F-111)", () => {
    const { events, outcomes } = replay("first-turn.jsonl", null);
    expect(outcomes[0]).toEqual({ kind: "conversation", conversationId: "85a317c0-5ddc-432a-a1e1-2c9be63cdc37" });
    expect(events[0]).toMatchObject({ type: "init", sessionId: "crt-session", nativeSessionId: "85a317c0-5ddc-432a-a1e1-2c9be63cdc37", provider: "antigravity", displayName: "Antigravity", model: null, agentVersion: "1.2.7", resumeCommand: "agy --conversation 85a317c0-5ddc-432a-a1e1-2c9be63cdc37", capabilities: ANTIGRAVITY_CAPABILITIES });
    expect("experimental" in events[0]!).toBe(false);
    const types = events.map((e) => e.type);
    expect(types.slice(0, 5)).toEqual(["init", "tool_use", "tool_result", "tool_use", "tool_result"]);
    expect(events[1]).toMatchObject({ type: "tool_use", id: "t1-s2", name: "view_file" });
    expect((events[1] as { label: string }).label).toMatch(/^Read C:\\Users/);
    expect(events[2]).toMatchObject({ type: "tool_result", id: "t1-s2", isError: false, summary: "1 lines, 262 bytes" });
    expect(events[3]).toMatchObject({ type: "tool_use", id: "t1-s4", name: "mcp__crt__crt_ping", label: "crt_crt/crt_ping" });
    expect(events[4]).toMatchObject({ type: "tool_result", id: "t1-s4", isError: false, summary: "listener replied 200: pong #9" });
    expect(events[6]).toMatchObject({ type: "tool_result", id: "t1-s6", isError: true });
    expect((events[6] as { summary: string }).summary).toMatch(/^tool call denied by pre-tool hook: CRT intake session: run_command is not allowed/);
    expect(events[8]).toMatchObject({ type: "tool_result", id: "t1-s8", isError: true });
    // Streamed text: one assistant_start, several deltas, one assistant_end, then the result.
    expect(types.filter((t) => t === "assistant_start")).toHaveLength(1);
    expect(types.filter((t) => t === "text").length).toBeGreaterThan(1);
    expect(events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("")).toMatch(/^1\. crt_ping: listener replied 200: pong #9/);
    expect(types.at(-2)).toBe("assistant_end");
    expect(events.at(-1)).toMatchObject({ type: "result", ok: true, costUsd: 0, errors: [], detail: "tokens: input 69182, output 1842, thinking 1486, cache read 0, total 71024" });
    expect(events.filter((e) => e.type === "error")).toEqual([]);
  });

  it("loop.jsonl: two turns in one process — one init, ids numbered per turn, two results (F-111)", () => {
    const { events } = replay("loop.jsonl", null);
    expect(events.filter((e) => e.type === "init")).toHaveLength(1);
    expect(events.filter((e) => e.type === "result")).toHaveLength(2);
    expect(events.filter((e) => e.type === "assistant_start").map((e) => (e as { messageId: string }).messageId)).toEqual(["t1-s1", "t2-s3"]);
    expect(events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("|")).toBe("noted|\n|Teal|\n");
  });

  it("resume.jsonl: the same conversation id passes the assertion and emits no second init; a different one fails with the N-7 line (F-111)", () => {
    const { events, outcomes } = replay("resume.jsonl", "2e4133c8-449b-4de2-982b-a6d6252ed327");
    expect(outcomes[0]).toBeNull();
    expect(events.some((e) => e.type === "init")).toBe(false);
    expect(events.map((e) => e.type)).toEqual(["assistant_start", "text", "text", "assistant_end", "result"]);
    const mismatch = replay("resume-unknown-id.jsonl", "00000000-0000-4000-8000-000000000000");
    expect(mismatch.outcomes[0]).toEqual({ kind: "fail", problem: antigravityCouldNotResume("00000000-0000-4000-8000-000000000000") });
    expect(antigravityCouldNotResume("x")).toBe("Antigravity could not resume conversation x — start a new session");
  });

  it("image-by-path.jsonl: a view_file on the PNG then `Red`; killed.jsonl maps only the init (F-50, F-111)", () => {
    const { events } = replay("image-by-path.jsonl", null);
    expect(events[1]).toMatchObject({ type: "tool_use", name: "view_file" });
    expect((events[1] as { label: string }).label).toMatch(/red\.png$/);
    expect(events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("")).toBe("Red\n");
    const killed = replay("killed.jsonl", null);
    expect(killed.events.map((e) => e.type)).toEqual(["init"]);
    expect((killed.events[0] as { model: string }).model).toBe("gemini-3.8-flash-high");
    expect(killed.mapper.ended).toBe(false);
  });

  it("input-error-image-block.jsonl: the result's error is an error event and a failed result; mcp-denied-headless.jsonl lists the denial in detail (F-111)", () => {
    const bad = replay("input-error-image-block.jsonl", null);
    expect(bad.events.map((e) => e.type)).toEqual(["init", "error", "result"]);
    expect(bad.events[2]).toMatchObject({ type: "result", ok: false, errors: ['stream input content block type "image" is not supported (only "text")'] });
    const denied = replay("mcp-denied-headless.jsonl", null);
    expect(denied.events.at(-1)).toMatchObject({ type: "result", ok: true });
    expect((denied.events.at(-1) as { detail: string }).detail).toMatch(/denied by Antigravity: CallMcpTool$/);
    expect(denied.events.find((e) => e.type === "tool_result" && (e as { id: string }).id === "t1-s4")).toMatchObject({ isError: true });
  });

  it("a turn with neither text nor an MCP call carries the missing-MCP warning; a logged-out result fails the session; unknown events are ignored (F-111, N-7)", () => {
    const events: SessionEvent[] = [];
    const mapper = new AgyMapper(null, { id: "s", model: "m", agentVersion: null }, (e) => events.push(e));
    mapper.handle({ event: "init", conversation_id: "2e4133c8-449b-4de2-982b-a6d6252ed327", init: {} }, 0);
    mapper.beginTurn();
    mapper.handle({ event: "step_update", step_update: { step_index: 0, state: "DONE", step_type: "user_input" } }, 1);
    mapper.handle({ event: "something.new" }, 2);
    mapper.handle({ event: "step_update", step_update: { step_index: 1, state: "DONE", step_type: "system_message" } }, 3);
    expect(mapper.handle({ event: "result", result: { status: "SUCCESS", response: "" } }, 4)).toBeNull();
    expect(events.map((e) => e.type)).toEqual(["init", "error", "result"]);
    expect(events[1]).toEqual({ type: "error", message: ANTIGRAVITY_MCP_NEVER_CALLED });
    expect(events[2]).toEqual({ type: "result", ok: true, durationMs: 4, costUsd: 0, errors: [] });
    expect((events[0] as { model: string }).model).toBe("m");
    mapper.beginTurn();
    expect(mapper.handle({ event: "result", result: { status: "ERROR", error: "Print mode: auth error: token expired" } }, 5)).toEqual({ kind: "fail", problem: ANTIGRAVITY_NOT_LOGGED_IN });
  });
});

describe("antigravity preflight against the fake (F-111, N-7, N-10)", () => {
  it("not on PATH → the N-7 install line (F-111, N-7)", async () => {
    expect(await antigravityPreflight({ env: { PATH: `${tmp}${delimiter}${dirname(process.execPath)}`, PATHEXT: ".COM;.EXE;.BAT;.CMD" } })).toEqual({ installed: false, loggedIn: "unknown", version: null, problem: ANTIGRAVITY_NOT_FOUND });
    expect(ANTIGRAVITY_NOT_FOUND).toBe("agy not found on PATH — install the Antigravity CLI (https://antigravity.google/docs/cli), or set providers.antigravity.command in .crt/config.json");
  });

  it("found, versioned, login unknown (no status command, §12 rule 3); too old; a configured command that is not agy (F-111, N-7)", async () => {
    expect(await antigravityPreflight({ env: env() })).toEqual({ installed: true, loggedIn: "unknown", version: "1.2.7", problem: null });
    expect(await antigravityProfile.preflight({ env: env({ FAKE_AGY_VERSION: "1.1.0" }) })).toEqual({ installed: true, loggedIn: "unknown", version: "1.1.0", problem: antigravityTooOld("1.1.0") });
    const notAgy = join(tmp, "not-agy.js");
    writeFileSync(notAgy, 'console.log("hello"); process.exit(0);\n');
    const r = await antigravityPreflight({ command: [process.execPath, notAgy], env: env() });
    expect(r).toMatchObject({ installed: true, loggedIn: "unknown", version: null });
    expect(r.problem).toMatch(/agy --version failed/);
  });
});

describe("antigravity driver (F-111, F-59, N-7)", () => {
  let root: string;
  let captureDir: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "crt-agy-root-"));
    mkdirSync(join(root, ".crt", "tasks"), { recursive: true });
    captureDir = writeCapture(root, samplePost()).dir;
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("passes the F-59 conformance scenario: the session plugin, hooks through the shell, write_task through crt mcp + the internal route, interrupt by process-tree kill and resume by conversation id (F-49, F-50, F-51, F-59, F-111)", async () => {
    useFake();
    const id = randomUUID();
    const r = await runConformance({
      profile: antigravityProfile,
      root,
      captureDir,
      id,
      intake: "INTAKE INSTRUCTIONS for the capture directory named in the first message",
      prompts: { permissionAgain: "n/a", write: "please write it", longTurn: "this will be slow" },
      writePath: "stdio",
      shim: { command: process.execPath, args: [shim] },
      timeoutMs: 20_000,
    });
    // F-47/§5.4: the native id is the conversation id, and it is what `session:` and the resume hint carry.
    expect(r.init.nativeSessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.init.nativeSessionId).not.toBe(id);
    expect(r.init).toMatchObject({ provider: "antigravity", displayName: "Antigravity", agentVersion: "conformance", resumeCommand: `agy --conversation ${r.init.nativeSessionId}`, capabilities: ANTIGRAVITY_CAPABILITIES });
    // F-51/F-50: instructions in the first message, images by path only (their paths are in the text).
    const first = r.events.find((e) => e.type === "user") as Extract<SessionEvent, { type: "user" }>;
    expect(first.text.startsWith(`${FIRST_MESSAGE_HEADING}\n\nINTAKE INSTRUCTIONS`)).toBe(true);
    expect(r.options.systemPromptAppend).toBe("");
    expect(r.options.first?.images?.length).toBeGreaterThan(0);
    for (const img of r.options.first?.images ?? []) expect(img.data).toBeUndefined();
    // Turn 1 replays image-by-path.jsonl through the real hooks: view_file allowed, run_command denied by the hook.
    const labels = r.events.filter((e) => e.type === "tool_use").map((e) => (e as { label: string }).label);
    expect(labels[0]).toMatch(/^Read .*red\.png$/);
    expect(labels[1]).toMatch(/^Run python/);
    const results = r.events.filter((e) => e.type === "tool_result") as Array<Extract<SessionEvent, { type: "tool_result" }>>;
    expect(results[0]).toMatchObject({ isError: false });
    expect(results[1]).toMatchObject({ isError: true });
    expect(results[1]!.summary).toMatch(/^tool call denied by pre-tool hook: CRT intake session: run_command is not allowed here/);
    expect(r.events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("")).toContain("Red");
    // The write turn: the fake called write_task on crt_crt through the hook and the real shim.
    expect(labels).toContain("Write task: Cart total excludes applied discount");
    const written = r.events.find((e) => e.type === "task_written") as Extract<SessionEvent, { type: "task_written" }>;
    expect(results.find((e) => e.summary.startsWith("Task "))).toMatchObject({ isError: false, summary: `Task ${written.id} written to ${written.path}` });
    expect(readFileSync(r.taskFile, "utf8")).toContain("provider: antigravity");
    // Streaming: several text events per assistant message.
    expect(r.events.filter((e) => e.type === "text").length).toBeGreaterThan(r.events.filter((e) => e.type === "assistant_start").length);
    // The session directory is gone after close; no permission machinery on a sandboxed provider.
    expect(existsSync(antigravitySessionDir(root, id))).toBe(false);
    const { first: _first, ...warm } = r.options;
    const idle = antigravityProfile.start(warm);
    expect(idle.respondPermission("x", "allow")).toBe(false);
    idle.close();
  }, 60_000);

  it("after an interrupt the next message resumes the conversation in a new process; a different id ends the session with the N-7 line (F-111)", async () => {
    useFake({ FAKE_AGY_RESUME_MISMATCH: "1" });
    const { events, driver, waitFor } = start(root, captureDir, shim);
    await waitFor((e) => e.type === "state" && e.state === "idle");
    const init = events.find((e) => e.type === "init") as Extract<SessionEvent, { type: "init" }>;
    const before = events.length;
    driver.send({ text: "be slow" });
    await waitFor((e) => e.type === "state" && e.state === "running", before);
    await new Promise((r) => setTimeout(r, 300));
    await driver.interrupt();
    await waitFor((e) => e.type === "result" && !e.ok && e.errors[0] === "interrupted");
    driver.send({ text: "and now?" });
    await waitFor((e) => e.type === "state" && e.state === "error");
    expect(events.filter((e) => e.type === "error")).toEqual([{ type: "error", message: antigravityCouldNotResume(init.nativeSessionId) }]);
    expect(events.at(-1)).toMatchObject({ type: "state", state: "error", detail: antigravityCouldNotResume(init.nativeSessionId) });
    driver.close();
  }, 40_000);

  it("hooks that did not load stop the process before its first real step and end the session (F-111)", async () => {
    useFake({ FAKE_AGY_NO_HOOKS: "1" });
    const { events, driver, waitFor } = start(root, captureDir, shim);
    await waitFor((e) => e.type === "state" && e.state === "error");
    expect(events.some((e) => e.type === "init")).toBe(true);
    expect(events.some((e) => e.type === "tool_result")).toBe(false);
    expect(events.filter((e) => e.type === "error")).toEqual([{ type: "error", message: antigravityHooksNotLoaded(antigravitySessionDir(root, events.find((e) => e.type === "init") ? (driver.id) : "")) }]);
    driver.close();
  }, 30_000);

  it("a logged-out CLI surfaces as the N-7 not-logged-in line (F-111, N-7)", async () => {
    useFake({ FAKE_AGY_AUTH: "logged-out" });
    const { events, driver, waitFor } = start(root, captureDir, shim);
    await waitFor((e) => e.type === "state" && e.state === "error");
    expect(events.filter((e) => e.type === "error")).toEqual([{ type: "error", message: ANTIGRAVITY_NOT_LOGGED_IN }]);
    driver.close();
  }, 30_000);

  it("agy not on PATH → the session fails at once with the N-7 install line (F-111, N-7)", async () => {
    process.env.PATH = tmp;
    const { events, driver, waitFor } = start(root, captureDir, shim);
    await waitFor((e) => e.type === "state" && e.state === "error");
    expect(events).toEqual([
      { type: "error", message: ANTIGRAVITY_NOT_FOUND },
      { type: "state", state: "error", detail: ANTIGRAVITY_NOT_FOUND },
    ]);
    driver.close();
  });
});

/** Start a driver on the fake with a capture as the first message; returns a waiter over its events. */
function start(root: string, captureDir: string, shimFile: string) {
  const events: SessionEvent[] = [];
  const driver = startAntigravitySession({
    id: randomUUID(),
    cwd: root,
    systemPromptAppend: "",
    first: { text: "hello from the test", images: [{ mediaType: "image/png", path: join(captureDir, "viewport.png"), label: "viewport" }] },
    decide: () => ({ kind: "allow" }),
    writeTask: async () => ({ id: "CRT-0001", path: "x" }),
    mcp: { command: process.execPath, args: [shimFile], env: { CRT_MCP_TOKEN: "t", CRT_MCP_PORT: "1" } },
    model: null,
  });
  driver.onEvent((e) => events.push(e));
  const waitFor = (pred: (e: SessionEvent) => boolean, from = 0, timeoutMs = 20_000): Promise<void> =>
    new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        if (events.some((e, i) => i >= from && pred(e))) return resolve();
        if (Date.now() - started > timeoutMs) return reject(new Error(`timed out; events: ${JSON.stringify(events.slice(-5))}`));
        setTimeout(tick, 20);
      };
      tick();
    });
  return { events, driver, waitFor };
}
