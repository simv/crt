import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { build } from "esbuild";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { installFakeCodex } from "../../e2e/fixture/fake-codex-install.mjs";
import { writeCapture } from "../../src/captures.js";
import { FIRST_MESSAGE_HEADING } from "../../src/intake-message.js";
import {
  CODEX_CAPABILITIES,
  CODEX_MCP_NEVER_CALLED,
  CODEX_MIN_VERSION,
  CODEX_NOT_FOUND,
  CODEX_NOT_LOGGED_IN,
  codexCouldNotResume,
  codexLoginProblem,
  codexPreflight,
  codexProfile,
  codexSkillsDirs,
  codexToolLabel,
  codexTooOld,
  codexTurnCommand,
  compareVersions,
  parseCodexLine,
  parseCodexVersion,
  startCodexSession,
  tomlString,
  TurnMapper,
} from "../../src/providers/codex.js";
import type { SessionEvent } from "../../src/session-events.js";
import { samplePost } from "../helpers/sample-capture.js";
import { parseFixture } from "./codex-fixtures.test.js";
import { runConformance } from "./conformance.js";

// The codex provider (PRD-providers F-42, F-53, F-59, N-7, N-10; M6 verdicts in
// docs/spikes/codex-2026-09.md). Three layers:
//   1. the profile and the pure pieces (version parsing, command lines, event mapping) — the
//      recorded fixtures are replayed through `TurnMapper` without a process;
//   2. preflight and the F-59 conformance scenario against the fake `codex` from
//      e2e/fixture/fake-codex.mjs, installed npm-style into a scratch bin on PATH (the `.cmd`
//      shim on Windows) so `exec.ts`, stdin, process-tree kill and the real `crt mcp` shim plus
//      internal route all run;
//   3. the failure lines: a resume whose thread id differs, a stale login, codex not on PATH.

let tmp: string;
let bin: string;
let shim: string;
const savedPath = process.env.PATH;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "crt-codex-"));
  bin = installFakeCodex(join(tmp, "npm"));
  // The `crt mcp` shim as the agent runs it: one file bundled from src (like test/mcp-stdio.test.ts).
  const entry = join(tmp, "entry.mjs");
  writeFileSync(entry, `import { runMcpStdio } from ${JSON.stringify(join(import.meta.dirname, "..", "..", "src", "mcp-stdio.ts"))};\nprocess.exitCode = await runMcpStdio({ input: process.stdin, output: process.stdout, env: process.env });\n`);
  shim = join(tmp, "crt-mcp.mjs");
  await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", target: "node20", outfile: shim, logLevel: "silent" });
}, 60_000);

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** Put the fake first on PATH (the driver resolves through `process.env`) and set fake knobs. */
function useFake(extra: Record<string, string> = {}): void {
  process.env.PATH = `${bin}${delimiter}${savedPath ?? ""}`;
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

describe("codex profile (F-42, F-53)", () => {
  it("declares the M6-verified markers, launch signal, capabilities, telemetry opt-out, skills dirs and resume command (F-42, F-46, F-53, F-58)", () => {
    expect(codexProfile.id).toBe("codex");
    expect(codexProfile.markers).toEqual({ private: [".codex/"], shared: ["AGENTS.md"] });
    expect(codexProfile.launchEnv).toEqual(["CODEX_THREAD_ID", "CODEX_SESSION_ID"]);
    expect(codexProfile.capabilities).toEqual({ streaming: false, toolEvents: true, permissions: "sandboxed", images: "path", resume: true, interrupt: true, instructions: "first-message" });
    expect(codexProfile.telemetryOptOut).toEqual(["-c", "analytics.enabled=false"]);
    expect(codexProfile.resumeCommand("01a0a4ca-1dff-7f52-b571-4aad430f5d30")).toBe("codex resume 01a0a4ca-1dff-7f52-b571-4aad430f5d30");
    expect(codexSkillsDirs({})).toEqual({ project: join(".agents", "skills"), user: join(process.env.HOME ?? process.env.USERPROFILE ?? "", ".codex", "skills") });
    expect(codexSkillsDirs({ CODEX_HOME: join("C:", "cx") })).toEqual({ project: join(".agents", "skills"), user: join("C:", "cx", "skills") });
  });

  it("parses `codex-cli 0.154.0`, compares dotted versions and recognises the stale-login message (F-53, N-7)", () => {
    expect(parseCodexVersion("codex-cli 0.154.0\n")).toBe("0.154.0");
    expect(parseCodexVersion("codex 1.2.3-beta.1")).toBe("1.2.3-beta.1");
    expect(parseCodexVersion("something else")).toBeNull();
    expect(compareVersions("0.154.0", CODEX_MIN_VERSION)).toBe(0);
    expect(compareVersions("0.153.9", "0.154.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "0.999.0")).toBeGreaterThan(0);
    expect(compareVersions("0.154", "0.154.0")).toBe(0);
    expect(codexLoginProblem("Your access token could not be refreshed. Please log out and sign in again.")).toBe(CODEX_NOT_LOGGED_IN);
    expect(codexLoginProblem("Not logged in")).toBe(CODEX_NOT_LOGGED_IN);
    expect(codexLoginProblem("rate limited")).toBeNull();
  });

  it("builds the M6-amended command lines: exec with --sandbox/-C, resume with -c sandbox_mode and no -C; token only via env_vars (F-49, F-53)", () => {
    const opts = { cwd: join("C:", "proj"), mcp: { command: join("C:", "Program Files", "nodejs", "node.exe"), args: [join("C:", "crt", "cli.js"), "mcp"], env: { CRT_MCP_TOKEN: "secret-token", CRT_MCP_PORT: "4400" } }, model: null };
    const first = codexTurnCommand(opts, null, [join("C:", "a.png"), join("C:", "b.png")], { PATH: "p" });
    expect(first.args).toEqual([
      "exec", "--json", "--sandbox", "read-only", "-C", opts.cwd,
      "-c", 'approval_policy="never"',
      "-c", 'mcp_servers.crt.default_tools_approval_mode="approve"',
      "-c", `mcp_servers.crt.command='${opts.mcp.command}'`,
      "-c", `mcp_servers.crt.args=['${opts.mcp.args[0]}','mcp']`,
      "-c", "mcp_servers.crt.env_vars=['CRT_MCP_TOKEN','CRT_MCP_PORT']",
      "--image", join("C:", "a.png"), "--image", join("C:", "b.png"),
      "-c", "analytics.enabled=false", "-",
    ]);
    expect(first.args.join(" ")).not.toContain("secret-token");
    expect(first.env).toMatchObject({ PATH: "p", CRT_MCP_TOKEN: "secret-token", CRT_MCP_PORT: "4400" });
    expect(first.cwd).toBe(opts.cwd);
    const resume = codexTurnCommand({ ...opts, model: "gpt-5.5" }, "01a0a4ca-1dff-7f52-b571-4aad430f5d30", []);
    expect(resume.args.slice(0, 5)).toEqual(["exec", "resume", "01a0a4ca-1dff-7f52-b571-4aad430f5d30", "--json", "-c"]);
    expect(resume.args).toContain('sandbox_mode="read-only"');
    expect(resume.args).not.toContain("--sandbox");
    expect(resume.args).not.toContain("-C");
    expect(resume.args.slice(-5)).toEqual(["-m", "gpt-5.5", "-c", "analytics.enabled=false", "-"]);
    expect(tomlString(join("C:", "x y", "z.js"))).toBe(`'${join("C:", "x y", "z.js")}'`);
    expect(tomlString("it's")).toBe('"it\'s"');
    expect(tomlString('a\\b"c')).toBe(`'a\\b"c'`); // a literal string takes backslashes and double quotes as they are
    expect(tomlString("a\\b'c")).toBe('"a\\\\b\'c"'); // only a single quote forces the escaped basic form
  });

  it("the README quotes every Codex N-7 line verbatim and states the resume cost and telemetry opt-out (N-7, N-12, N-13)", () => {
    const readme = readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "docs", "providers.md"), "utf8"); // docs/providers.md since M23 (PRD-polish §9, N-26)
    for (const line of [CODEX_NOT_FOUND, CODEX_NOT_LOGGED_IN, codexTooOld("<version>"), codexCouldNotResume("<id>"), CODEX_MCP_NEVER_CALLED]) {
      expect(readme, line).toContain(`
${line}
`);
    }
    expect(readme).toContain("Every later message is a new `codex exec resume` process.");
    expect(readme).toContain("-c analytics.enabled=false");
    expect(readme).toContain("crt skills install --provider codex");
  });

  it("labels items the F-25 way (F-53)", () => {
    expect(codexToolLabel({ id: "i", type: "mcp_tool_call", server: "crt", tool: "write_task", arguments: { title: "Fix cart" } })).toBe("Write task: Fix cart");
    expect(codexToolLabel({ id: "i", type: "mcp_tool_call", server: "crt", tool: "crt_ping", arguments: {} })).toBe("crt/crt_ping");
    expect(codexToolLabel({ id: "i", type: "command_execution", command: "pwsh -Command 'Get-ChildItem'" })).toBe("Run pwsh -Command 'Get-ChildItem'");
    expect(codexToolLabel({ id: "i", type: "file_change", changes: [{ path: "a.ts" }, { path: "b.ts" }] })).toBe("Edit a.ts, b.ts");
    expect(codexToolLabel({ id: "i", type: "web_search", query: "x" })).toBe('Search "x"');
    expect(parseCodexLine("not json")).toBeNull();
    expect(parseCodexLine('{"type":"turn.started"}')).toEqual({ type: "turn.started" });
  });
});

/** Replay one fixture through the mapper; returns the events and the last outcome. */
function replay(name: string, expected: string | null): { events: SessionEvent[]; outcomes: Array<ReturnType<TurnMapper["handle"]>>; mapper: TurnMapper } {
  const events: SessionEvent[] = [];
  const mapper = new TurnMapper(expected, { id: "crt-session", model: null, agentVersion: "0.154.0" }, (e) => events.push(e));
  const outcomes = parseFixture(name).events.map((e, i) => mapper.handle(e as never, i * 10));
  return { events, outcomes, mapper };
}

describe("codex event mapping over the recorded fixtures (F-53, F-59)", () => {
  it("first-turn.jsonl: init from thread.started, tool lines for mcp_tool_call and command_execution, whole text, result with usage (F-47, F-53)", () => {
    const { events, outcomes } = replay("first-turn.jsonl", null);
    expect(outcomes[0]).toEqual({ kind: "thread", threadId: "01a0a4ca-1dff-7f52-b571-4aad430f5d30" });
    expect(events.map((e) => e.type)).toEqual(["init", "tool_use", "tool_result", "tool_use", "tool_result", "assistant_start", "text", "assistant_end", "result"]);
    expect(events[0]).toMatchObject({ type: "init", sessionId: "crt-session", nativeSessionId: "01a0a4ca-1dff-7f52-b571-4aad430f5d30", provider: "codex", displayName: "Codex", model: null, agentVersion: "0.154.0", resumeCommand: "codex resume 01a0a4ca-1dff-7f52-b571-4aad430f5d30", capabilities: CODEX_CAPABILITIES });
    expect(events[1]).toMatchObject({ type: "tool_use", id: "t1-item_0", name: "mcp__crt__crt_ping", label: "crt/crt_ping" });
    expect(events[2]).toMatchObject({ type: "tool_result", id: "t1-item_0", isError: false, summary: "listener replied 200: pong #5" });
    expect(events[3]).toMatchObject({ type: "tool_use", id: "t1-item_1", name: "command_execution" });
    expect((events[3] as { label: string }).label).toMatch(/^Run "C:\\\\Users/);
    expect(events[4]).toMatchObject({ type: "tool_result", id: "t1-item_1", isError: false });
    expect((events[6] as { text: string }).text).toMatch(/^listener replied 200: pong #5/);
    expect(events[8]).toMatchObject({ type: "result", ok: true, costUsd: 0, errors: [], detail: "tokens: input 39688, cached input 34944, cache write input 0, output 297, reasoning output 15" });
  });

  it("first-turn-mcp-approval-denied.jsonl: a failed MCP call is an error tool line, the turn still completes (F-53)", () => {
    const { events } = replay("first-turn-mcp-approval-denied.jsonl", null);
    expect(events[2]).toMatchObject({ type: "tool_result", id: "t1-item_0", isError: true, summary: "MCP tool call requires approval, but approval policy is never" });
    expect(events[4]).toMatchObject({ type: "tool_result", id: "t1-item_1", isError: true });
    expect((events[4] as { summary: string }).summary).toMatch(/^exit 1: Access to the path/);
    expect(events.at(-1)).toMatchObject({ type: "result", ok: true });
  });

  it("resume.jsonl: the same thread id passes the assertion and emits no second init (F-53)", () => {
    const { events, outcomes } = replay("resume.jsonl", "01a0a4ca-1dff-7f52-b571-4aad430f5d30");
    expect(outcomes.every((o) => o === null)).toBe(true);
    expect(events.some((e) => e.type === "init")).toBe(false);
    expect(events.map((e) => e.type)).toEqual(["tool_use", "tool_result", "assistant_start", "text", "assistant_end", "result"]);
  });

  it("resume with a different thread.started id fails with the N-7 could-not-resume line (F-53)", () => {
    const { outcomes } = replay("resume-after-kill.jsonl", "01a0a4ca-1dff-7f52-b571-4aad430f5d30");
    expect(outcomes[0]).toEqual({ kind: "fail", problem: codexCouldNotResume("01a0a4ca-1dff-7f52-b571-4aad430f5d30") });
    expect(codexCouldNotResume("x")).toBe("Codex could not resume thread x — start a new session");
  });

  it("*-auth-failed.jsonl: error + turn.failed → one error event, result(ok:false) and the not-logged-in line (N-7)", () => {
    for (const name of ["first-turn-auth-failed.jsonl", "resume-auth-failed.jsonl", "resume-after-kill-auth-failed.jsonl"]) {
      const expected = name.startsWith("first") ? null : parseFixture(name).events[0]!.thread_id!;
      const { events, outcomes, mapper } = replay(name, expected);
      expect(events.filter((e) => e.type === "error"), name).toEqual([{ type: "error", message: "Your access token could not be refreshed. Please log out and sign in again." }]);
      expect(events.at(-1), name).toMatchObject({ type: "result", ok: false, errors: ["Your access token could not be refreshed. Please log out and sign in again."] });
      expect(outcomes.at(-1), name).toEqual({ kind: "fail", problem: CODEX_NOT_LOGGED_IN });
      expect(mapper.ended).toBe(true);
    }
  });

  it("a killed turn maps nothing after turn.started and never ends; the process exit decides (F-53)", () => {
    for (const name of ["first-turn-killed.jsonl", "first-turn-killed-live.jsonl"]) {
      const { events, mapper } = replay(name, null);
      expect(events.map((e) => e.type), name).toEqual(["init"]);
      expect(mapper.ended).toBe(false);
    }
  });

  it("a completed turn with neither text nor an MCP call carries the missing-MCP warning; unknown events are ignored (F-53)", () => {
    const events: SessionEvent[] = [];
    const mapper = new TurnMapper(null, { id: "s", model: "m", agentVersion: null }, (e) => events.push(e));
    mapper.handle({ type: "thread.started", thread_id: "01a0a4ca-1dff-7f52-b571-4aad430f5d30" }, 0);
    mapper.handle({ type: "turn.started" }, 1);
    mapper.handle({ type: "item.started", item: { id: "r", type: "reasoning" } }, 2);
    mapper.handle({ type: "item.completed", item: { id: "r", type: "reasoning", text: "thinking" } }, 3);
    mapper.handle({ type: "something.new" }, 4);
    mapper.handle({ type: "turn.completed" }, 5);
    expect(events.map((e) => e.type)).toEqual(["init", "error", "result"]);
    expect(events[1]).toEqual({ type: "error", message: CODEX_MCP_NEVER_CALLED });
    expect(events[2]).toEqual({ type: "result", ok: true, durationMs: 5, costUsd: 0, errors: [] });
    expect((events[0] as { model: string }).model).toBe("m");
  });
});

describe("codex preflight against the npm-style fake (F-53, N-7, N-10)", () => {
  it("not on PATH → the N-7 install line (F-53, N-7)", async () => {
    expect(await codexPreflight({ env: { PATH: `${tmp}${delimiter}${dirname(process.execPath)}`, PATHEXT: ".COM;.EXE;.BAT;.CMD" } })).toEqual({ installed: false, loggedIn: "unknown", version: null, problem: CODEX_NOT_FOUND });
    expect(CODEX_NOT_FOUND).toBe("codex not found on PATH — npm i -g @openai/codex, or set providers.codex.command in .crt/config.json");
  });

  it("found through the shim, versioned, logged in / not / unknown per §12 rule 3 (F-53, N-10)", async () => {
    expect(await codexPreflight({ env: env() })).toEqual({ installed: true, loggedIn: true, version: "0.154.0", problem: null });
    expect(await codexProfile.preflight({ env: env({ FAKE_CODEX_LOGIN: "1" }) })).toEqual({ installed: true, loggedIn: false, version: "0.154.0", problem: CODEX_NOT_LOGGED_IN });
    expect(await codexPreflight({ env: env({ FAKE_CODEX_LOGIN: "7" }) })).toMatchObject({ installed: true, loggedIn: "unknown", problem: null });
  });

  it("too old, and a configured command that is not codex (F-53, N-7)", async () => {
    expect(await codexPreflight({ env: env({ FAKE_CODEX_VERSION: "0.100.0" }) })).toEqual({ installed: true, loggedIn: "unknown", version: "0.100.0", problem: codexTooOld("0.100.0") });
    const notCodex = join(tmp, "not-codex.js");
    writeFileSync(notCodex, 'console.log("hello"); process.exit(0);\n');
    const r = await codexPreflight({ command: [process.execPath, notCodex], env: env() });
    expect(r).toMatchObject({ installed: true, loggedIn: "unknown", version: null });
    expect(r.problem).toMatch(/codex --version failed/);
  });
});

describe("codex driver (F-53, F-59, N-7)", () => {
  let root: string;
  let captureDir: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "crt-codex-root-"));
    mkdirSync(join(root, ".crt", "tasks"), { recursive: true });
    captureDir = writeCapture(root, samplePost()).dir;
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  it("passes the F-59 conformance scenario: fixtures replayed, write_task through crt mcp + the internal route, interrupt by process-tree kill (F-49, F-50, F-51, F-53, F-59)", async () => {
    useFake();
    const id = randomUUID();
    const r = await runConformance({
      profile: codexProfile,
      root,
      captureDir,
      id,
      intake: "INTAKE INSTRUCTIONS for the capture directory named in the first message",
      prompts: { permissionAgain: "n/a", write: "please write it", longTurn: "this will be slow" },
      writePath: "stdio",
      shim: { command: process.execPath, args: [shim] },
      timeoutMs: 20_000,
    });
    // F-47/§5.4: the native id is Codex's thread id, and it is what `session:` and the resume hint carry.
    expect(r.init.nativeSessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.init.nativeSessionId).not.toBe(id);
    expect(r.init).toMatchObject({ provider: "codex", displayName: "Codex", agentVersion: "conformance", resumeCommand: `codex resume ${r.init.nativeSessionId}`, capabilities: CODEX_CAPABILITIES });
    // F-51/F-50: instructions in the first message, images by path only.
    const first = r.events.find((e) => e.type === "user") as Extract<SessionEvent, { type: "user" }>;
    expect(first.text.startsWith(`${FIRST_MESSAGE_HEADING}\n\nINTAKE INSTRUCTIONS`)).toBe(true);
    expect(r.options.systemPromptAppend).toBe("");
    expect(r.options.first?.images?.length).toBeGreaterThan(0);
    for (const img of r.options.first?.images ?? []) expect(img.data).toBeUndefined();
    // Turn 1 is first-turn.jsonl: two tool lines and the recorded text; the write turn shows the real shim answer.
    const labels = r.events.filter((e) => e.type === "tool_use").map((e) => (e as { label: string }).label);
    expect(labels[0]).toBe("crt/crt_ping");
    expect(labels[1]).toMatch(/^Run /);
    expect(labels).toContain("Write task: Cart total excludes applied discount");
    const written = r.events.find((e) => e.type === "task_written") as Extract<SessionEvent, { type: "task_written" }>;
    const results = r.events.filter((e) => e.type === "tool_result") as Array<Extract<SessionEvent, { type: "tool_result" }>>;
    expect(results.find((e) => e.summary.startsWith("Task "))).toMatchObject({ isError: false, summary: `Task ${written.id} written to ${written.path}` });
    expect(readFileSync(r.taskFile, "utf8")).toContain(`provider: codex`);
    // F-53: Codex text is whole, never streamed — one text event per message.
    const texts = r.events.filter((e) => e.type === "text");
    const starts = r.events.filter((e) => e.type === "assistant_start");
    expect(texts.length).toBe(starts.length);
    // No permission machinery on a sandboxed provider (a warm-start driver spawns nothing until send()).
    const { first: _first, ...warm } = r.options;
    const idle = codexProfile.start(warm);
    expect(idle.respondPermission("x", "allow")).toBe(false);
    idle.close();
  }, 60_000);

  it("a resume whose thread.started id differs ends the session with the N-7 could-not-resume line (F-53)", async () => {
    useFake({ FAKE_CODEX_RESUME_MISMATCH: "1" });
    const { events, driver, waitFor } = start(root, captureDir, shim);
    await waitFor((e) => e.type === "state" && e.state === "idle");
    const init = events.find((e) => e.type === "init") as Extract<SessionEvent, { type: "init" }>;
    driver.send({ text: "and now?" });
    await waitFor((e) => e.type === "state" && e.state === "error");
    expect(events.filter((e) => e.type === "error")).toEqual([{ type: "error", message: codexCouldNotResume(init.nativeSessionId) }]);
    expect(events.at(-1)).toMatchObject({ type: "state", state: "error", detail: codexCouldNotResume(init.nativeSessionId) });
    driver.close();
  }, 30_000);

  it("a stale login surfaces at turn time as the N-7 not-logged-in line (F-53, N-7)", async () => {
    useFake({ FAKE_CODEX_AUTH: "stale" });
    const { events, driver, waitFor } = start(root, captureDir, shim);
    await waitFor((e) => e.type === "state" && e.state === "error");
    expect(events.some((e) => e.type === "init")).toBe(true);
    expect(events.filter((e) => e.type === "error").map((e) => (e as { message: string }).message)).toEqual([
      "Your access token could not be refreshed. Please log out and sign in again.",
      CODEX_NOT_LOGGED_IN,
    ]);
    expect(events.at(-1)).toMatchObject({ type: "state", state: "error", detail: CODEX_NOT_LOGGED_IN });
    driver.close();
  }, 30_000);

  it("codex not on PATH → the session fails at once with the N-7 install line (F-53, N-7)", async () => {
    process.env.PATH = tmp;
    const { events, driver, waitFor } = start(root, captureDir, shim);
    await waitFor((e) => e.type === "state" && e.state === "error");
    expect(events).toEqual([
      { type: "error", message: CODEX_NOT_FOUND },
      { type: "state", state: "error", detail: CODEX_NOT_FOUND },
    ]);
    driver.close();
  });
});

/** Start a driver on the fake with a capture as the first message; returns a waiter over its events. */
function start(root: string, captureDir: string, shimFile: string) {
  const events: SessionEvent[] = [];
  const driver = startCodexSession({
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
  const waitFor = (pred: (e: SessionEvent) => boolean, timeoutMs = 20_000): Promise<void> =>
    new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        if (events.some(pred)) return resolve();
        if (Date.now() - started > timeoutMs) return reject(new Error(`timed out; events: ${JSON.stringify(events.slice(-5))}`));
        setTimeout(tick, 20);
      };
      tick();
    });
  return { events, driver, waitFor };
}
