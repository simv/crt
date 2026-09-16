import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG } from "../../src/init.js";
import { AUTH_STATUS_TIMEOUT_MS, CLAUDE_INSTALL_HINT, CLAUDE_NOT_LOGGED_IN, claudePreflight, parseAuthStatus } from "../../src/providers/claude.js";
import { codexProfile } from "../../src/providers/codex.js";
import type { RunResult } from "../../src/providers/exec.js";
import { claudeProfile } from "../../src/providers/claude.js";
import { ProviderRegistry } from "../../src/session.js";

// PRD-setup F-74 / F-90: `claudePreflight` against recorded `auth status --json` outputs
// (fixtures/claude/*.txt: `#` header lines, then the payload as the binary printed it).
// Only `loggedIn` is read; the rest of the payload — it names the account — never reaches a
// result, a log line or the ready line.

const FIXTURES = fileURLToPath(new URL("./fixtures/claude/", import.meta.url));

function fixture(name: string): { header: string[]; body: string } {
  const lines = readFileSync(join(FIXTURES, name), "utf8").split("\n");
  const header = lines.filter((l) => l.startsWith("#")).map((l) => l.slice(1).trim());
  return { header, body: lines.filter((l) => !l.startsWith("#")).join("\n") };
}

const ok = (stdout: string): RunResult => ({ status: 0, stdout, stderr: "", error: null });
const LOGGED_IN = fixture("auth-status-logged-in.txt").body;
const LOGGED_OUT = fixture("auth-status-logged-out.txt").body;
/** Strings from the fixtures that must never leave the parser. */
const PRIVATE = ["dev@example.com", "00000000-0000-4000-8000-000000000000", "subscriptionType", "projectsDirectory"];

let tmp: string;
let withClaude: string;
let withoutClaude: string;
beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "crt-claude-pf-"));
  withClaude = join(tmp, "bin");
  withoutClaude = join(tmp, "empty");
  for (const d of [withClaude, withoutClaude]) mkdirSync(d, { recursive: true });
  // A `claude` on PATH: an .exe (Windows) or an executable file (elsewhere); never run here.
  const fake = join(withClaude, process.platform === "win32" ? "claude.exe" : "claude");
  writeFileSync(fake, "", { mode: 0o755 });
  if (process.platform !== "win32") chmodSync(fake, 0o755);
  writeFileSync(join(withoutClaude, ".keep"), "");
});
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe("claudePreflight fixtures (PRD-setup F-74)", () => {
  it("every fixture has a header naming the tested binary version and command", () => {
    const all = readdirSync(FIXTURES).filter((f) => f.endsWith(".txt"));
    expect(all.length).toBeGreaterThanOrEqual(2);
    for (const name of all) {
      const { header } = fixture(name);
      expect(header[0], name).toMatch(/^claude \d+\.\d+\.\d+ /);
      expect(header.some((h) => /^command: .*auth status --json/.test(h)), `${name} names its command`).toBe(true);
    }
  });

  it.each([
    ["loggedIn true", ok(LOGGED_IN), true],
    ["loggedIn false", ok(LOGGED_OUT), false],
    ["garbage on stdout", ok("not json at all"), "unknown"],
    ["a JSON object without loggedIn", ok('{"authenticated": true}'), "unknown"],
    ["a JSON array", ok("[]"), "unknown"],
    ["non-zero exit", { status: 1, stdout: "", stderr: "Error: no credentials", error: null }, "unknown"],
    ["timeout", { status: null, stdout: "", stderr: "", error: "timed out" }, "unknown"],
    ["could not start", { status: null, stdout: "", stderr: "", error: "spawn ENOENT" }, "unknown"],
  ])("%s → %s", (_name, run, expected) => {
    expect(parseAuthStatus(run as RunResult)).toBe(expected);
  });

  it("spawns the bundled binary with `auth status --json` and a 5 s timeout, and maps the result (F-74)", async () => {
    const calls: Array<{ binary: string; args: string[]; timeoutMs: number }> = [];
    const run = (result: RunResult) => async (binary: string, args: string[], timeoutMs: number) => {
      calls.push({ binary, args, timeoutMs });
      return result;
    };
    const env = { PATH: withClaude };
    expect(await claudePreflight({ run: run(ok(LOGGED_IN)), env })).toMatchObject({ installed: true, loggedIn: true, problem: null });
    expect(calls[0]!.args).toEqual(["auth", "status", "--json"]);
    expect(calls[0]!.timeoutMs).toBe(AUTH_STATUS_TIMEOUT_MS);
    expect(calls[0]!.binary).toMatch(/claude-agent-sdk-.*[\\/]claude(\.exe)?$/);
    expect(await claudePreflight({ run: run(ok(LOGGED_OUT)), env })).toMatchObject({ installed: true, loggedIn: false, problem: CLAUDE_NOT_LOGGED_IN });
    for (const r of [ok("garbage"), { status: 1, stdout: "", stderr: "x", error: null }, { status: null, stdout: "", stderr: "", error: "timed out" }]) {
      expect(await claudePreflight({ run: run(r), env })).toMatchObject({ installed: true, loggedIn: "unknown", problem: null });
    }
  });

  it("the false case carries the N-6 line, plus the install hint only when `claude` is not on PATH (F-74)", async () => {
    const run = async () => ok(LOGGED_OUT);
    expect((await claudePreflight({ run, env: { PATH: withClaude, PATHEXT: ".EXE;.CMD" } })).problem).toBe(CLAUDE_NOT_LOGGED_IN);
    expect((await claudePreflight({ run, env: { PATH: withoutClaude, PATHEXT: ".EXE;.CMD" } })).problem).toBe(`${CLAUDE_NOT_LOGGED_IN} (${CLAUDE_INSTALL_HINT})`);
    expect(CLAUDE_INSTALL_HINT).toBe("install Claude Code first: npm i -g @anthropic-ai/claude-code");
  });

  it("nothing but loggedIn leaves the parser: results, the registry's log and its rows carry none of the payload (F-74)", async () => {
    const logs: string[] = [];
    const profile = { ...claudeProfile, preflight: () => claudePreflight({ run: async () => ok(LOGGED_IN), env: { PATH: withClaude } }) };
    const registry = new ProviderRegistry({ root: tmp, env: {}, config: DEFAULT_CONFIG, profiles: [profile, codexProfile], log: (l) => logs.push(l) });
    await registry.refresh();
    const seen = JSON.stringify([registry.preflight("claude"), registry.status(), registry.payload(), registry.resolve(null), logs]);
    for (const secret of PRIVATE) expect(seen, secret).not.toContain(secret);
    expect(registry.preflight("claude")).toMatchObject({ loggedIn: true });
    expect(registry.status().find((r) => r.id === "claude")).toMatchObject({ loggedIn: true, state: "ready" });
  });
});
