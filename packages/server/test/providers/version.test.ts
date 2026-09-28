import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type CliPreflightSpec, cliPreflight, compareVersions, parseBareVersion } from "../../src/providers/version.js";

// Version parsing and the preflight skeleton Codex, Gemini and Antigravity share (PRD-providers
// F-42, F-53, F-111, N-7). The fake CLI is a node script named by `command`, so no PATH is needed.

describe("parseBareVersion (F-42)", () => {
  it("reads the version at the end of the output", () => {
    expect(parseBareVersion("0.60.0\n")).toBe("0.60.0");
    expect(parseBareVersion("1.2.7")).toBe("1.2.7");
    expect(parseBareVersion("agy 1.3.0-beta.1\n")).toBe("1.3.0-beta.1");
    expect(parseBareVersion("gemini v2.0.1+build.7")).toBe("2.0.1+build.7");
    expect(parseBareVersion("some banner\n0.61.2\n")).toBe("0.61.2");
  });

  it("returns null when the output is not a version", () => {
    expect(parseBareVersion("")).toBeNull();
    expect(parseBareVersion("Usage of agy.exe:")).toBeNull();
    expect(parseBareVersion("something else")).toBeNull();
    expect(parseBareVersion("1.2")).toBeNull();
    expect(parseBareVersion("version 1.2.3 (build abc)")).toBeNull();
  });
});

describe("compareVersions (F-42)", () => {
  it("compares dotted numbers, missing parts as 0, pre-release suffix ignored", () => {
    expect(compareVersions("0.154.0", "0.154.0")).toBe(0);
    expect(compareVersions("0.153.9", "0.154.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "0.999.0")).toBeGreaterThan(0);
    expect(compareVersions("0.154", "0.154.0")).toBe(0);
    expect(compareVersions("0.60.10", "0.60.9")).toBeGreaterThan(0);
    expect(compareVersions("1.2.7-beta.1", "1.2.7")).toBe(0);
    expect(compareVersions("1.2.6+build", "1.2.7")).toBeLessThan(0);
  });
});

describe("cliPreflight (F-42, N-7)", () => {
  let tmp: string;
  let fake: string;
  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), "crt-version-"));
    fake = join(tmp, "fake.js");
    // `--version` prints FAKE_VERSION (or nothing), FAKE_STDERR on stderr, and exits FAKE_EXIT.
    writeFileSync(fake, 'if (process.env.FAKE_STDERR) console.error(process.env.FAKE_STDERR);\nif (process.env.FAKE_VERSION) console.log(process.env.FAKE_VERSION);\nprocess.exit(Number(process.env.FAKE_EXIT ?? 0));\n');
  });
  afterAll(() => rmSync(tmp, { recursive: true, force: true }));

  const spec = (over: Partial<CliPreflightSpec> = {}): CliPreflightSpec => ({
    name: "fake",
    minVersion: "1.2.0",
    notFound: "fake not found on PATH",
    tooOld: (v) => `fake ${v} is too old`,
    fix: "reinstall with npm i -g fake",
    ...over,
  });
  const run = (s: CliPreflightSpec, env: Record<string, string>) => cliPreflight(s, { command: [process.execPath, fake], env: { ...process.env, ...env } });

  it("not found → the spec's N-7 line, nothing run", async () => {
    const login = vi.fn();
    expect(await cliPreflight(spec({ login }), { command: [join(tmp, "missing.exe")] })).toEqual({ installed: false, loggedIn: "unknown", version: null, problem: "fake not found on PATH" });
    expect(login).not.toHaveBeenCalled();
  });

  it("a version at or over the minimum passes; without a login check, login is unknown", async () => {
    expect(await run(spec(), { FAKE_VERSION: "fake 1.2.0" })).toEqual({ installed: true, loggedIn: "unknown", version: "1.2.0", problem: null });
  });

  it("the login check decides loggedIn and the problem, and gets the executable and env", async () => {
    const login = vi.fn(async () => ({ loggedIn: false as const, problem: "not logged in to Fake" }));
    const env = { ...process.env, FAKE_VERSION: "1.3.0" };
    expect(await cliPreflight(spec({ login }), { command: [process.execPath, fake], env })).toEqual({ installed: true, loggedIn: false, version: "1.3.0", problem: "not logged in to Fake" });
    expect(login).toHaveBeenCalledWith(expect.objectContaining({ command: process.execPath, args: [fake] }), env);
  });

  it("too old → the spec's line with the version, before any login check", async () => {
    const login = vi.fn();
    expect(await run(spec({ login }), { FAKE_VERSION: "1.1.9" })).toEqual({ installed: true, loggedIn: "unknown", version: "1.1.9", problem: "fake 1.1.9 is too old" });
    expect(login).not.toHaveBeenCalled();
  });

  it("a failed or unreadable --version names the first stderr line, else 'no output', then the fix", async () => {
    expect(await run(spec(), { FAKE_EXIT: "3", FAKE_STDERR: "boom\nmore" })).toEqual({ installed: true, loggedIn: "unknown", version: null, problem: "fake --version failed (boom) — reinstall with npm i -g fake" });
    expect((await run(spec(), {})).problem).toBe("fake --version failed (no output) — reinstall with npm i -g fake");
    expect(await run(spec(), { FAKE_VERSION: "hello" })).toMatchObject({ installed: true, version: null, problem: "fake --version failed (no output) — reinstall with npm i -g fake" });
  });

  it("a version the spec's parser finds but that exited non-zero still fails, keeping the version", async () => {
    expect(await run(spec({ parseVersion: (s) => /fake-cli (\S+)/.exec(s)?.[1] ?? null }), { FAKE_VERSION: "fake-cli 2.0.0", FAKE_EXIT: "1" })).toEqual({
      installed: true,
      loggedIn: "unknown",
      version: "2.0.0",
      problem: "fake --version failed (no output) — reinstall with npm i -g fake",
    });
  });
});
