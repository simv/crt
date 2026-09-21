import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { build } from "esbuild";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { installFakeGemini } from "../../e2e/fixture/fake-codex-install.mjs";
import { writeCapture } from "../../src/captures.js";
import { FIRST_MESSAGE_HEADING } from "../../src/intake-message.js";
import {
  ACP_CAPABILITIES,
  ACP_PROTOCOL_VERSIONS,
  acpLoginProblem,
  acpNotFound,
  acpToolLabel,
  acpToolName,
  acpToolSummary,
  AcpTurnMapper,
  adHocAcpProfile,
  decideAcpPermission,
  describeToolCall,
  JsonRpcStdio,
  negotiateCapabilities,
  pickPermissionOption,
  promptBlocks,
  startAcpSession,
  unsupportedProtocol,
} from "../../src/providers/acp.js";
import {
  GEMINI_CAPABILITIES,
  GEMINI_MIN_VERSION,
  GEMINI_NOT_FOUND,
  GEMINI_NOT_LOGGED_IN,
  GEMINI_TIER_REFUSED,
  geminiLoginProblem,
  geminiLoginState,
  geminiPreflight,
  geminiProfile,
  geminiSkillsDirs,
  geminiTooOld,
  parseGeminiVersion,
} from "../../src/providers/gemini.js";
import type { SessionEvent } from "../../src/session-events.js";
import { samplePost } from "../helpers/sample-capture.js";
import { runConformance } from "./conformance.js";

// The ACP driver, the gemini profile and the ad-hoc `acp` profile (PRD-providers F-42, F-54,
// F-59, N-7, N-10, N-11; spike verdicts in docs/spikes/gemini-acp-2026-09.md). Three layers:
//   1. the profiles and the pure pieces (JSON-RPC framing, version parsing, the F-54 policy over
//      tool kinds and the option mapping, capability negotiation, update → event mapping);
//   2. preflight and the F-59 conformance scenario against the fake ACP agent from
//      e2e/fixture/fake-acp.mjs — installed npm-style as `gemini` (the `.cmd` shim on Windows)
//      for the gemini profile, and run by command for the ad-hoc profile — so `exec.ts`, the
//      permission round-trip, the real `crt mcp` shim plus internal route all run;
//   3. the failure lines: protocol-version mismatch, logged out, tier refused, not on PATH.

const FAKE = join(import.meta.dirname, "..", "..", "e2e", "fixture", "fake-acp.mjs");
let tmp: string;
let bin: string;
let shim: string;
const savedPath = process.env.PATH;
const savedEnv: Record<string, string | undefined> = {};

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), "crt-acp-"));
  bin = installFakeGemini(join(tmp, "npm"));
  const entry = join(tmp, "entry.mjs");
  writeFileSync(entry, `import { runMcpStdio } from ${JSON.stringify(join(import.meta.dirname, "..", "..", "src", "mcp-stdio.ts"))};\nprocess.exitCode = await runMcpStdio({ input: process.stdin, output: process.stdout, env: process.env });\n`);
  shim = join(tmp, "crt-mcp.mjs");
  await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", target: "node20", outfile: shim, logLevel: "silent" });
}, 60_000);

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function useFake(extra: Record<string, string> = {}): void {
  process.env.PATH = `${bin}${delimiter}${savedPath ?? ""}`;
  for (const [k, v] of Object.entries(extra)) {
    if (!(k in savedEnv)) savedEnv[k] = process.env[k];
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

const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({ PATH: `${bin}${delimiter}${dirname(process.execPath)}`, PATHEXT: ".COM;.EXE;.BAT;.CMD", GEMINI_CLI_HOME: join(tmp, "nohome"), ...extra });

describe("gemini profile (F-42, F-54)", () => {
  it("declares the spike-verified markers, launch signal, capabilities, skills dirs and resume command (F-42, F-44, F-46, F-58)", () => {
    expect(geminiProfile.id).toBe("gemini");
    expect(geminiProfile.displayName).toBe("Gemini");
    expect(geminiProfile.markers).toEqual({ private: [".gemini/", "GEMINI.md"], shared: ["AGENTS.md"] });
    expect(geminiProfile.launchEnv).toEqual(["GEMINI_CLI"]);
    expect(geminiProfile.capabilities).toEqual({ streaming: true, toolEvents: true, permissions: "interactive", images: "inline", resume: true, interrupt: true, instructions: "first-message" });
    expect(geminiProfile.telemetryOptOut).toEqual([]);
    expect(geminiProfile.resumeCommand("2f1c1e2a-1111-4222-8333-444455556666")).toBe("gemini --resume 2f1c1e2a-1111-4222-8333-444455556666");
    expect(geminiSkillsDirs({ HOME: join("C:", "u") })).toEqual({ project: join(".gemini", "skills"), user: join("C:", "u", ".gemini", "skills") });
    expect(geminiSkillsDirs({ GEMINI_CLI_HOME: join("C:", "gh"), HOME: join("C:", "u") })).toEqual({ project: join(".gemini", "skills"), user: join("C:", "gh", ".gemini", "skills") });
  });

  it("parses `0.60.0`, maps the session/new auth messages to the N-7 lines and reads the login files (F-54, N-7)", () => {
    expect(parseGeminiVersion("0.60.0\n")).toBe("0.60.0");
    expect(parseGeminiVersion("gemini 1.2.3-beta.1")).toBe("1.2.3-beta.1");
    expect(parseGeminiVersion("something else")).toBeNull();
    expect(GEMINI_MIN_VERSION).toBe("0.60.0");
    expect(geminiLoginProblem("Gemini API key is missing or not configured.")).toBe(GEMINI_NOT_LOGGED_IN);
    expect(geminiLoginProblem("Authentication required.")).toBe(GEMINI_NOT_LOGGED_IN);
    expect(geminiLoginProblem("This client is no longer supported for Gemini Code Assist for individuals. To continue using Gemini, please migrate to the Antigravity suite of products: https://antigravity.google")).toBe(GEMINI_TIER_REFUSED);
    expect(geminiLoginProblem("rate limited")).toBeNull();
    const home = join(tmp, "home-a");
    mkdirSync(join(home, ".gemini"), { recursive: true });
    expect(geminiLoginState({ GEMINI_CLI_HOME: home })).toBe(false);
    writeFileSync(join(home, ".gemini", "oauth_creds.json"), "{}");
    expect(geminiLoginState({ GEMINI_CLI_HOME: home })).toBe("unknown");
    writeFileSync(join(home, ".gemini", ".env"), "# key\nGEMINI_API_KEY=abc\n");
    expect(geminiLoginState({ GEMINI_CLI_HOME: home })).toBe(true);
    expect(geminiLoginState({ GEMINI_CLI_HOME: join(tmp, "nope"), GEMINI_API_KEY: "k" })).toBe(true);
  });

  it("the README quotes every Gemini and ACP N-7 line verbatim and states the telemetry and resume facts (N-7, N-12, N-13)", () => {
    const readme = readFileSync(join(import.meta.dirname, "..", "..", "..", "..", "README.md"), "utf8");
    for (const line of [GEMINI_NOT_FOUND, GEMINI_NOT_LOGGED_IN, GEMINI_TIER_REFUSED, geminiTooOld("<version>"), unsupportedProtocol("<agent>", "<v>"), acpNotFound("<command>")]) {
      expect(readme, line).toContain(`
${line}
`);
    }
    expect(readme).toContain("gemini --resume <id>");
    expect(readme).toContain('{ "kind": "acp"');
    expect(readme).toContain("crt skills install --provider gemini");
  });
});

describe("ACP pure pieces (F-54, N-11)", () => {
  it("frames newline-delimited JSON-RPC both ways: requests, notifications, the agent's requests and non-JSON noise (N-11)", async () => {
    const written: string[] = [];
    const rpc = new JsonRpcStdio((line) => written.push(line));
    const seen: Array<[string, unknown]> = [];
    rpc.onNotification = (m, p) => seen.push([m, p]);
    rpc.onRequest = async (m, p) => {
      if (m === "session/request_permission") return { outcome: { outcome: "selected", optionId: (p as { options: Array<{ optionId: string }> }).options[0]!.optionId } };
      throw { code: -32601, message: `client does not implement ${m}` };
    };
    const p = rpc.request("initialize", { protocolVersion: 1 });
    expect(written[0]).toBe('{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}\n');
    rpc.feed('not json\n{"jsonrpc":"2.0","method":"session/update","params":{"x":1}}\n{"jsonrpc":"2.0","id":1,"res');
    rpc.feed('ult":{"protocolVersion":1}}\n');
    expect(await p).toEqual({ protocolVersion: 1 });
    expect(seen).toEqual([["session/update", { x: 1 }]]);
    rpc.feed('{"jsonrpc":"2.0","id":"a1","method":"session/request_permission","params":{"options":[{"optionId":"proceed_once"}]}}\n');
    rpc.feed('{"jsonrpc":"2.0","id":"a2","method":"fs/read_text_file","params":{}}\n');
    await new Promise((r) => setTimeout(r, 10));
    expect(written[1]).toBe('{"jsonrpc":"2.0","id":"a1","result":{"outcome":{"outcome":"selected","optionId":"proceed_once"}}}\n');
    expect(written[2]).toBe('{"jsonrpc":"2.0","id":"a2","error":{"code":-32601,"message":"client does not implement fs/read_text_file"}}\n');
    const failing = rpc.request("session/prompt", {});
    rpc.feed('{"jsonrpc":"2.0","id":2,"error":{"code":-32000,"message":"nope"}}\n');
    await expect(failing).rejects.toEqual({ code: -32000, message: "nope" });
    const orphan = rpc.request("session/prompt", {});
    rpc.fail({ code: -32000, message: "gone" });
    await expect(orphan).rejects.toEqual({ code: -32000, message: "gone" });
    rpc.notify("session/cancel", { sessionId: "s" });
    expect(written.at(-1)).toBe('{"jsonrpc":"2.0","method":"session/cancel","params":{"sessionId":"s"}}\n');
  });

  it("applies the F-54 policy over tool kinds (F-26 as amended)", () => {
    const root = join(tmp, "proj"); // absolute on every platform: a relative root would resolve the locations against itself twice
    const d = (kind: string, extra: Record<string, unknown> = {}) => decidePermission(kind, extra, root);
    expect(d("read").kind).toBe("allow");
    expect(d("search").kind).toBe("allow");
    expect(d("think").kind).toBe("allow");
    expect(d("other").kind).toBe("allow");
    expect(d("other", { locations: [{ path: join(root, "src", "a.ts") }] }).kind).toBe("ask");
    expect(d("edit", { locations: [{ path: join(root, ".crt", "tasks", "x.md") }] }).kind).toBe("allow");
    expect(d("edit", { locations: [{ path: join(root, ".crt", "x.md") }, { path: join(root, "src", "a.ts") }] }).kind).toBe("ask");
    expect(d("edit").kind).toBe("ask");
    expect(d("delete", { locations: [{ path: ".crt/captures/1" }] }).kind).toBe("allow");
    expect(d("move", { locations: [{ path: "src/a.ts" }] }).kind).toBe("ask");
    expect(d("execute", { title: "git status" }).kind).toBe("allow");
    expect(d("execute", { title: "Shell git status", rawInput: { command: "git log --oneline -5" } }).kind).toBe("allow");
    expect(d("execute", { rawInput: { command: "npm test" } }).kind).toBe("ask");
    expect(d("execute", { rawInput: { command: "git status | grep x" } }).kind).toBe("ask");
    expect(d("fetch")).toEqual({ kind: "deny", reason: "fetching from the network is disabled during CRT intake (nothing leaves the machine)" });
    expect(d("switch_mode").kind).toBe("ask");
    expect(decideAcpPermission({ toolCallId: "x" }, root).kind).toBe("allow"); // no kind = other, no locations
  });

  it("maps allow to allow_once and deny to reject_once, never allow_always, and cancels when nothing fits (F-54)", () => {
    const gemini = [
      { optionId: "proceed_always", name: "Allow for this session", kind: "allow_always" },
      { optionId: "proceed_once", name: "Allow", kind: "allow_once" },
      { optionId: "cancel", name: "Reject", kind: "reject_once" },
    ];
    expect(pickPermissionOption(gemini, "allow")).toEqual({ outcome: { outcome: "selected", optionId: "proceed_once" } });
    expect(pickPermissionOption(gemini, "deny")).toEqual({ outcome: { outcome: "selected", optionId: "cancel" } });
    const odd = [{ optionId: "a", kind: "allow_always" }, { optionId: "r", kind: "reject_always" }];
    expect(pickPermissionOption(odd, "allow")).toEqual({ outcome: { outcome: "selected", optionId: "a" } });
    expect(pickPermissionOption(odd, "deny")).toEqual({ outcome: { outcome: "selected", optionId: "r" } });
    expect(pickPermissionOption([{ optionId: "x", kind: "weird" }], "allow")).toEqual({ outcome: { outcome: "cancelled" } });
    expect(pickPermissionOption([], "deny")).toEqual({ outcome: { outcome: "cancelled" } });
  });

  it("negotiates images from promptCapabilities and formats the protocol-mismatch line (F-50, F-54, N-7)", () => {
    expect(negotiateCapabilities(GEMINI_CAPABILITIES, { agentCapabilities: { promptCapabilities: { image: true } } })).toEqual(GEMINI_CAPABILITIES);
    expect(negotiateCapabilities(GEMINI_CAPABILITIES, { agentCapabilities: { promptCapabilities: { image: false } } })).toEqual({ ...GEMINI_CAPABILITIES, images: "none" });
    expect(negotiateCapabilities(GEMINI_CAPABILITIES, {})).toEqual({ ...GEMINI_CAPABILITIES, images: "none" });
    expect(ACP_PROTOCOL_VERSIONS).toEqual([1]);
    expect(unsupportedProtocol("Gemini", 2)).toBe("Gemini speaks ACP 2; CRT supports 1 — update CRT or the agent");
    const input = { text: "hi", images: [{ mediaType: "image/png" as const, path: "p", data: "AAAA", label: "viewport" }, { mediaType: "image/png" as const, path: "q", label: "no data" }] };
    expect(promptBlocks(input, true)).toEqual([{ type: "text", text: "hi" }, { type: "image", mimeType: "image/png", data: "AAAA" }]);
    expect(promptBlocks(input, false)).toEqual([{ type: "text", text: "hi" }]);
  });

  it("labels tool calls the F-25 way and describes cards (F-25, F-54)", () => {
    expect(acpToolLabel({ toolCallId: "1", title: "write_task (crt MCP Server)", kind: "other", rawInput: { title: "Fix cart" } })).toBe("Write task: Fix cart");
    expect(acpToolName({ toolCallId: "1", title: "write_task (crt MCP Server)", kind: "other" })).toBe("mcp__crt__write_task");
    expect(acpToolLabel({ toolCallId: "1", title: "ReadFile AGENTS.md", kind: "read" })).toBe("ReadFile AGENTS.md");
    expect(acpToolName({ toolCallId: "1", kind: "execute" })).toBe("execute");
    expect(acpToolLabel({ toolCallId: "1", kind: "search" })).toBe("search");
    expect(acpToolSummary({ toolCallId: "1", status: "completed", content: [{ type: "content", content: { type: "text", text: "3  passing\n" } }] })).toBe("3 passing");
    expect(acpToolSummary({ toolCallId: "1", status: "completed", content: [{ type: "diff", path: "a.ts" }] })).toBe("diff a.ts");
    expect(acpToolSummary({ toolCallId: "1", status: "completed", rawOutput: "raw" })).toBe("raw");
    expect(acpToolSummary({ toolCallId: "1", status: "failed" })).toBe("failed");
    expect(acpToolSummary({ toolCallId: "1", status: "completed" })).toBe("done");
    const root = join(tmp, "proj");
    expect(describeToolCall({ toolCallId: "1", kind: "execute", title: "Shell", rawInput: { command: "npm test" } }, root)).toBe("npm test");
    expect(describeToolCall({ toolCallId: "1", kind: "edit", locations: [{ path: join(root, "src", "a.ts") }] }, root)).toBe("src/a.ts");
    expect(describeToolCall({ toolCallId: "1", kind: "other", rawInput: { x: 1 } }, root)).toBe('{"x":1}');
    expect(describeToolCall({ toolCallId: "1", kind: "other", title: "T" }, root)).toBe("T");
  });

  it("maps session/update to events: streamed text closed by a tool call, tool_call/tool_call_update pairs, ignored kinds (F-54)", () => {
    const events: SessionEvent[] = [];
    const m = new AcpTurnMapper((e) => events.push(e), 2);
    m.handle({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "hmm" } });
    m.handle({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello " } });
    m.handle({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "world" } });
    m.handle({ sessionUpdate: "plan", content: undefined });
    m.handle({ sessionUpdate: "tool_call", toolCallId: "c1", title: "ReadFile x", kind: "read", status: "in_progress" });
    m.handle({ sessionUpdate: "tool_call_update", toolCallId: "c1", status: "in_progress" });
    m.handle({ sessionUpdate: "tool_call_update", toolCallId: "c1", status: "completed", content: [{ type: "content", content: { type: "text", text: "ok" } }] });
    m.handle({ sessionUpdate: "tool_call", toolCallId: "c2", title: "Shell ls", kind: "execute", status: "completed", content: [] });
    m.handle({ sessionUpdate: "tool_call_update", toolCallId: "c3", status: "failed", title: "write_task (crt MCP Server)", content: [{ type: "content", content: { type: "text", text: "boom" } }] });
    m.handle({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Done." } });
    m.handle({ sessionUpdate: "something_new" });
    m.endMessage();
    m.endMessage();
    expect(events).toEqual([
      { type: "assistant_start", messageId: "t2-msg-1" },
      { type: "text", messageId: "t2-msg-1", text: "Hello " },
      { type: "text", messageId: "t2-msg-1", text: "world" },
      { type: "assistant_end", messageId: "t2-msg-1" },
      { type: "tool_use", id: "t2-c1", name: "read", label: "ReadFile x" },
      { type: "tool_result", id: "t2-c1", isError: false, summary: "ok" },
      { type: "tool_use", id: "t2-c2", name: "execute", label: "Shell ls" },
      { type: "tool_result", id: "t2-c2", isError: false, summary: "done" },
      { type: "tool_use", id: "t2-c3", name: "mcp__crt__write_task", label: "write_task (crt MCP Server)" },
      { type: "tool_result", id: "t2-c3", isError: true, summary: "boom" },
      { type: "assistant_start", messageId: "t2-msg-2" },
      { type: "text", messageId: "t2-msg-2", text: "Done." },
      { type: "assistant_end", messageId: "t2-msg-2" },
    ]);
    expect(m.sawWriteTask).toBe(true);
  });

  it("the ad-hoc profile: id acp, the config name, no markers/resume/skills, preflight = the command resolves (F-54)", async () => {
    const p = adHocAcpProfile({ kind: "acp", command: process.execPath, args: [FAKE, "--acp"], name: "Fake Agent" });
    expect(p.id).toBe("acp");
    expect(p.displayName).toBe("Fake Agent");
    expect(p.agentName).toBe("Fake Agent (ACP)");
    expect(p.markers).toEqual({ private: [], shared: [] });
    expect(p.launchEnv).toEqual([]);
    expect(p.capabilities).toEqual(ACP_CAPABILITIES);
    expect(ACP_CAPABILITIES.resume).toBe(false);
    expect(p.resumeCommand("x")).toBeNull();
    expect(p.skillsDirs()).toEqual({ project: null, user: null });
    expect(await p.preflight({ env: env() })).toEqual({ installed: true, loggedIn: "unknown", version: null, problem: null });
    const missing = adHocAcpProfile({ kind: "acp", command: "no-such-agent-here", args: [], name: "Ghost" });
    expect(await missing.preflight({ env: env() })).toEqual({ installed: false, loggedIn: "unknown", version: null, problem: acpNotFound("no-such-agent-here") });
    expect(acpNotFound("x")).toBe("x not found on PATH — install it, or fix provider.command in .crt/config.json");
    expect(acpLoginProblem("Ghost", "Authentication required.")).toBe("not logged in to Ghost — Authentication required.");
    expect(acpLoginProblem("Ghost", "boom")).toBeNull();
  });
});

function decidePermission(kind: string, extra: Record<string, unknown>, root: string) {
  return decideAcpPermission({ toolCallId: "t", kind, ...extra }, root);
}

describe("gemini preflight against the npm-style fake (F-54, N-7, N-10)", () => {
  it("not on PATH → the N-7 install line", async () => {
    expect(await geminiPreflight({ env: { PATH: `${tmp}${delimiter}${dirname(process.execPath)}`, PATHEXT: ".COM;.EXE;.BAT;.CMD" } })).toEqual({ installed: false, loggedIn: "unknown", version: null, problem: GEMINI_NOT_FOUND });
    expect(GEMINI_NOT_FOUND).toBe("gemini not found on PATH — npm i -g @google/gemini-cli, or set providers.gemini.command in .crt/config.json");
  });

  it("found through the shim, versioned, login from the files / env per §12 rule 3", async () => {
    expect(await geminiPreflight({ env: env() })).toEqual({ installed: true, loggedIn: false, version: "0.60.0", problem: GEMINI_NOT_LOGGED_IN });
    expect(await geminiProfile.preflight({ env: env({ GEMINI_API_KEY: "k" }) })).toEqual({ installed: true, loggedIn: true, version: "0.60.0", problem: null });
    const home = join(tmp, "home-b");
    mkdirSync(join(home, ".gemini"), { recursive: true });
    writeFileSync(join(home, ".gemini", "oauth_creds.json"), "{}");
    expect(await geminiPreflight({ env: env({ GEMINI_CLI_HOME: home }) })).toEqual({ installed: true, loggedIn: "unknown", version: "0.60.0", problem: null });
  });

  it("too old, and a configured command that is not gemini (N-7)", async () => {
    expect(await geminiPreflight({ env: env({ FAKE_GEMINI_VERSION: "0.59.0" }) })).toEqual({ installed: true, loggedIn: "unknown", version: "0.59.0", problem: geminiTooOld("0.59.0") });
    const notGemini = join(tmp, "not-gemini.js");
    writeFileSync(notGemini, 'console.log("hello"); process.exit(0);\n');
    const r = await geminiPreflight({ command: [process.execPath, notGemini], env: env() });
    expect(r).toMatchObject({ installed: true, loggedIn: "unknown", version: null });
    expect(r.problem).toMatch(/gemini --version failed/);
  });
});

describe("ACP driver on the fake agent (F-49, F-50, F-51, F-54, F-59, N-7)", () => {
  let root: string;
  let captureDir: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "crt-acp-root-"));
    mkdirSync(join(root, ".crt", "tasks"), { recursive: true });
    captureDir = writeCapture(root, samplePost()).dir;
  });
  afterEach(async () => {
    // The agent (cwd = root) leaves on stdin end; Windows releases the directory a moment later,
    // and Node 24's rmSync does not retry EPERM on a directory, so retry here.
    for (let attempt = 0; ; attempt++) {
      try {
        rmSync(root, { recursive: true, force: true });
        return;
      } catch (err) {
        if (attempt >= 30) throw err;
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  });

  it("gemini passes the F-59 conformance scenario: permission round-trip, write_task through crt mcp + the internal route, session/cancel, close", async () => {
    useFake({ GEMINI_API_KEY: "fake-key" });
    const id = randomUUID();
    const r = await runConformance({
      profile: geminiProfile,
      root,
      captureDir,
      id,
      intake: "INTAKE INSTRUCTIONS for the capture directory named in the first message",
      prompts: { permissionAgain: "please ask permission again", write: "please write it", longTurn: "this will be slow" },
      writePath: "stdio",
      shim: { command: process.execPath, args: [shim] },
      timeoutMs: 20_000,
    });
    // F-47/§5.4: the native id is the agent's session id (a UUID that is not CRT's); the footer shows `gemini --resume <id>`.
    expect(r.init.nativeSessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(r.init.nativeSessionId).not.toBe(id);
    expect(r.init).toMatchObject({ provider: "gemini", displayName: "Gemini", agentVersion: "conformance", model: "gemini-2.5-pro", resumeCommand: `gemini --resume ${r.init.nativeSessionId}`, capabilities: GEMINI_CAPABILITIES });
    // F-51/F-50: instructions in the first message, images inline (the fake rejects an image block without data).
    const first = r.events.find((e) => e.type === "user") as Extract<SessionEvent, { type: "user" }>;
    expect(first.text.startsWith(`${FIRST_MESSAGE_HEADING}\n\nINTAKE INSTRUCTIONS`)).toBe(true);
    expect(r.options.systemPromptAppend).toBe("");
    expect(r.options.first?.images?.length).toBeGreaterThan(0);
    for (const img of r.options.first?.images ?? []) expect(img.data).toBeTruthy();
    // Streamed text: several text events per assistant message.
    const texts = r.events.filter((e) => e.type === "text");
    const starts = r.events.filter((e) => e.type === "assistant_start");
    expect(texts.length).toBeGreaterThan(starts.length);
    // The permission cards came from the F-54 policy: `execute npm test` asks; the `read` tool never did.
    const cards = r.events.filter((e) => e.type === "permission") as Array<Extract<SessionEvent, { type: "permission" }>>;
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ toolName: "execute", title: "Shell npm test", detail: "npm test" });
    const labels = r.events.filter((e) => e.type === "tool_use").map((e) => (e as { label: string }).label);
    expect(labels[0]).toBe("ReadFile AGENTS.md");
    expect(labels).toContain("Shell npm test");
    expect(labels).toContain("Write task: Cart total excludes applied discount");
    const results = r.events.filter((e) => e.type === "tool_result") as Array<Extract<SessionEvent, { type: "tool_result" }>>;
    expect(results.find((e) => e.summary === "3 passing")).toBeTruthy(); // allowed
    expect(results.find((e) => e.isError && /rejected by the user/.test(e.summary))).toBeTruthy(); // denied
    const written = r.events.find((e) => e.type === "task_written") as Extract<SessionEvent, { type: "task_written" }>;
    expect(results.find((e) => e.summary.startsWith("Task "))).toMatchObject({ isError: false, summary: `Task ${written.id} written to ${written.path}` });
    expect(readFileSync(r.taskFile, "utf8")).toContain("provider: gemini");
  }, 60_000);

  it("an ad-hoc { kind: \"acp\" } command passes the same scenario with no resume hint and provider: acp (F-54)", async () => {
    const profile = adHocAcpProfile({ kind: "acp", command: process.execPath, args: [FAKE, "--acp"], name: "Fake Agent" });
    const r = await runConformance({
      profile,
      root,
      captureDir,
      id: randomUUID(),
      intake: "INTAKE",
      prompts: { permissionAgain: "permission please", write: "write", longTurn: "slow" },
      writePath: "stdio",
      shim: { command: process.execPath, args: [shim] },
      timeoutMs: 20_000,
    });
    expect(r.init).toMatchObject({ provider: "acp", displayName: "Fake Agent", resumeCommand: null, capabilities: ACP_CAPABILITIES });
    expect(readFileSync(r.taskFile, "utf8")).toContain("provider: acp");
  }, 60_000);

  it("an agent that answers initialize with another protocol version fails with the N-7 line (F-54)", async () => {
    useFake({ FAKE_ACP_PROTOCOL: "7", GEMINI_API_KEY: "k" });
    const { events, driver, waitFor } = start(root, captureDir, shim);
    await waitFor((e) => e.type === "state" && e.state === "error");
    expect(events.filter((e) => e.type === "error")).toEqual([{ type: "error", message: unsupportedProtocol("Gemini", 7) }]);
    expect(events.some((e) => e.type === "init")).toBe(false);
    driver.close();
  }, 30_000);

  it("logged out and tier-refused agents fail at session/new with the N-7 lines (F-54, N-7)", async () => {
    useFake({ FAKE_ACP_AUTH: "missing", GEMINI_API_KEY: "k" });
    let s = start(root, captureDir, shim);
    await s.waitFor((e) => e.type === "state" && e.state === "error");
    expect(s.events.at(-1)).toMatchObject({ type: "state", state: "error", detail: GEMINI_NOT_LOGGED_IN });
    s.driver.close();
    useFake({ FAKE_ACP_AUTH: "tier" });
    s = start(root, captureDir, shim);
    await s.waitFor((e) => e.type === "state" && e.state === "error");
    expect(s.events.at(-1)).toMatchObject({ type: "state", state: "error", detail: GEMINI_TIER_REFUSED });
    s.driver.close();
  }, 30_000);

  it("images are dropped when the agent does not advertise them, and the init capabilities say so (F-50)", async () => {
    useFake({ FAKE_ACP_NO_IMAGES: "1", GEMINI_API_KEY: "k" });
    const { events, driver, waitFor } = start(root, captureDir, shim);
    await waitFor((e) => e.type === "permission");
    const card = events.find((e) => e.type === "permission") as Extract<SessionEvent, { type: "permission" }>;
    expect(driver.respondPermission(card.id, "deny")).toBe(true);
    await waitFor((e) => e.type === "state" && e.state === "idle");
    const init = events.find((e) => e.type === "init") as Extract<SessionEvent, { type: "init" }>;
    expect(init.capabilities).toEqual({ ...GEMINI_CAPABILITIES, images: "none" });
    expect(events.filter((e) => e.type === "error")).toEqual([]); // the fake would have rejected an image block
    driver.close();
  }, 30_000);

  it("gemini not on PATH → the session fails at once with the N-7 install line", async () => {
    process.env.PATH = tmp;
    const { events, driver, waitFor } = start(root, captureDir, shim);
    await waitFor((e) => e.type === "state" && e.state === "error");
    expect(events.filter((e) => e.type !== "user")).toEqual([
      { type: "error", message: GEMINI_NOT_FOUND },
      { type: "state", state: "error", detail: GEMINI_NOT_FOUND },
    ]);
    driver.close();
  });
});

/** Start the gemini driver on the fake with a capture as the first message; returns a waiter over its events. */
function start(root: string, captureDir: string, shimFile: string) {
  const events: SessionEvent[] = [];
  const driver = geminiProfile.start({
    id: randomUUID(),
    cwd: root,
    systemPromptAppend: "",
    first: { text: "hello from the test", images: [{ mediaType: "image/png", path: join(captureDir, "viewport.png"), data: "AAAA", label: "viewport" }] },
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

// startAcpSession is exercised through the profiles above; keep the direct import used for the deps type.
void startAcpSession;

/** One recorded line of `fixtures/acp/*.jsonl` (docs/spikes/gemini-acp-2026-09/probe/acp-probe.mjs). */
interface Recorded {
  t: number;
  dir: "in" | "out";
  msg: { id?: number; method?: string; params?: unknown; result?: unknown; error?: { code: number; message: string } };
}

export function parseAcpFixture(name: string): Recorded[] {
  return readFileSync(join(import.meta.dirname, "fixtures", "acp", name), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => JSON.parse(l) as Recorded);
}

describe("the Gemini 0.60.0 recordings (F-54 M10 verdicts, N-7)", () => {
  it("initialize.jsonl: the client's F-54 capabilities go out; protocol 1, image prompts, four auth methods and the version come back", () => {
    const lines = parseAcpFixture("initialize.jsonl");
    expect(lines[0]!.msg).toMatchObject({ method: "initialize", params: { protocolVersion: 1, clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false } } });
    const init = lines[1]!.msg.result as { protocolVersion: number; agentInfo: { name: string; version: string }; authMethods: unknown[] };
    expect(init.protocolVersion).toBe(1);
    expect(ACP_PROTOCOL_VERSIONS).toContain(init.protocolVersion);
    expect(init.agentInfo).toEqual({ name: "gemini-cli", title: "Gemini CLI", version: "0.60.0" });
    expect(init.authMethods.map((m) => (m as { id: string }).id)).toEqual(["oauth-personal", "gemini-api-key", "vertex-ai", "gateway"]);
    expect(negotiateCapabilities(GEMINI_CAPABILITIES, init)).toEqual(GEMINI_CAPABILITIES); // images stay inline
  });

  it("initialize-bad-version.jsonl: asked for 999, the agent still answers 1 — the reply is what is checked", () => {
    const lines = parseAcpFixture("initialize-bad-version.jsonl");
    expect((lines[0]!.msg.params as { protocolVersion: number }).protocolVersion).toBe(999);
    expect((lines[1]!.msg.result as { protocolVersion: number }).protocolVersion).toBe(1);
  });

  it("session-new-*.jsonl: the stdio MCP server travels in session/new; auth failures are -32000 there and map to the N-7 lines", () => {
    for (const [name, line] of [
      ["session-new-logged-out.jsonl", GEMINI_NOT_LOGGED_IN],
      ["session-new-tier-refused.jsonl", GEMINI_TIER_REFUSED],
    ] as const) {
      const lines = parseAcpFixture(name);
      const req = lines.find((l) => l.msg.method === "session/new")!;
      const params = req.msg.params as { cwd: string; mcpServers: Array<{ name: string; command: string; args: string[]; env: Array<{ name: string; value: string }> }> };
      expect(params.mcpServers[0]).toMatchObject({ name: "crt", env: expect.arrayContaining([{ name: "CRT_MCP_TOKEN", value: "<token>" }, { name: "CRT_MCP_PORT", value: "4400" }]) });
      const reply = lines.find((l) => l.dir === "in" && l.msg.id === req.msg.id)!;
      expect(reply.msg.error?.code).toBe(-32000);
      expect(geminiLoginProblem(reply.msg.error!.message), name).toBe(line);
    }
  });
});
