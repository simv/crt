import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { installFakeClaude } from "../e2e/fixture/fake-codex-install.mjs";
import { CrtError } from "../src/errors.js";
import { CLAUDE_NOT_FOUND, resolveClaude, runSetup } from "../src/setup.js";

// PRD-setup F-86 / F-90: `crt setup` against a fake `claude` installed the way `fake-codex` is (an
// npm `.cmd` shim on Windows — parsed, never handed to a shell — and a script elsewhere), covering
// already-installed, older-installed (→ `update`), missing `claude`, and a failing subcommand.

const VERSION = "0.3.0";
let tmp: string;
let bin: string;
let log: string;
let marketplaceDir: string;
/** A directory holding only `node`, so the POSIX fake's shebang resolves without a real `claude` next to node leaking in. */
let nodeDir: string;

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), "crt-setup-"));
  bin = installFakeClaude(join(tmp, "npm"));
  log = join(tmp, "claude-calls.jsonl");
  marketplaceDir = join(tmp, "plugin-marketplace");
  nodeDir = join(tmp, "node-bin");
  mkdirSync(nodeDir);
  // Windows runs the shim's JS entry with process.execPath directly (exec.ts), so PATH needs no node there.
  if (process.platform !== "win32") symlinkSync(process.execPath, join(nodeDir, "node"));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

beforeEach(() => {
  if (existsSync(log)) rmSync(log);
});

/** An environment with the fake first on PATH (plus `node` for the POSIX script's shebang) and the fake's knobs set; nothing leaks into process.env. */
function env(knobs: Record<string, string> = {}, opts: { withClaude?: boolean } = {}): NodeJS.ProcessEnv {
  const path = [...(opts.withClaude === false ? [] : [bin]), nodeDir].join(delimiter);
  const e: NodeJS.ProcessEnv = { ...process.env, PATH: path, Path: path, FAKE_CLAUDE_LOG: log };
  delete e.FAKE_CLAUDE_INSTALLED;
  delete e.FAKE_CLAUDE_FAIL;
  return { ...e, ...knobs };
}

/** The argv of every `claude` the fake saw, in order. */
function calls(): string[][] {
  return existsSync(log)
    ? readFileSync(log, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l) as string[])
    : [];
}

describe("crt setup (F-86)", () => {
  it("resolves claude through exec.ts: the npm shim on Windows, the script elsewhere (N-10)", () => {
    const exe = resolveClaude(null, env());
    expect(exe).not.toBeNull();
    expect(exe!.via).toBe(process.platform === "win32" ? "shim" : "path");
    expect(exe!.command.endsWith(".cmd")).toBe(false);
    expect(resolveClaude(null, env({}, { withClaude: false }))).toBeNull();
  });

  it("already installed at this version → says so, runs nothing else, exit 0 (F-86)", async () => {
    const r = await runSetup({ version: VERSION, marketplaceDir, env: env({ FAKE_CLAUDE_INSTALLED: VERSION }) });
    expect(r.action).toBe("already");
    expect(r.lines).toEqual([`crt setup: crt@crt ${VERSION} is already installed`]);
    expect(calls()).toEqual([["plugin", "list", "--json"]]);
  });

  it("not installed → marketplace add <dist/plugin-marketplace>, then install crt@crt, with the two lines (F-85, F-86)", async () => {
    const r = await runSetup({ version: VERSION, marketplaceDir, env: env() });
    expect(r.action).toBe("installed");
    expect(r.lines).toEqual([
      `crt setup: registered marketplace crt from ${marketplaceDir}`,
      `crt setup: installed crt@crt ${VERSION} — restart Claude Code to load /crt:serve, /crt:next, /crt:tasks, /crt:task, /crt:done, /crt:intake, /crt:init`,
    ]);
    expect(calls()).toEqual([
      ["plugin", "list", "--json"],
      ["plugin", "marketplace", "add", marketplaceDir],
      ["plugin", "install", "crt@crt"],
    ]);
  });

  it("older version installed → marketplace add, then update crt@crt (F-86)", async () => {
    const r = await runSetup({ version: VERSION, marketplaceDir, env: env({ FAKE_CLAUDE_INSTALLED: "0.2.0" }) });
    expect(r.action).toBe("updated");
    expect(r.lines[1]).toBe(`crt setup: updated crt@crt ${VERSION} — restart Claude Code to load /crt:serve, /crt:next, /crt:tasks, /crt:task, /crt:done, /crt:intake, /crt:init`);
    expect(calls().map((c) => c.slice(0, 2))).toEqual([
      ["plugin", "list"],
      ["plugin", "marketplace"],
      ["plugin", "update"],
    ]);
  });

  it("claude missing → the manual two-command line, exit 1 (F-86, N-7)", async () => {
    const err = await runSetup({ version: VERSION, marketplaceDir, env: env({}, { withClaude: false }) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CrtError);
    expect((err as CrtError).exitCode).toBe(1);
    expect((err as CrtError).message).toBe(CLAUDE_NOT_FOUND);
    expect(CLAUDE_NOT_FOUND).toBe("claude not found on PATH — install Claude Code (npm i -g @anthropic-ai/claude-code), or run: claude plugin marketplace add simv/crt && claude plugin install crt@crt");
    expect(calls()).toEqual([]);
  });

  it("a failing subcommand → its first stderr line in one crt: line, exit 1 (F-86, N-17)", async () => {
    const err = await runSetup({ version: VERSION, marketplaceDir, env: env({ FAKE_CLAUDE_FAIL: "install", FAKE_CLAUDE_FAIL_MESSAGE: "Marketplace 'crt' has no plugin 'crt'" }) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CrtError);
    expect((err as CrtError).exitCode).toBe(1);
    expect((err as CrtError).message).toBe("`claude plugin install crt@crt` failed: Error: Marketplace 'crt' has no plugin 'crt' — fix that, or run: claude plugin marketplace add simv/crt && claude plugin install crt@crt");
    expect((err as CrtError).message).not.toContain("\n");
    expect(calls().at(-1)).toEqual(["plugin", "install", "crt@crt"]);
  });

  it("a failing `plugin list --json` is read as not installed (§12 rule 2), and the registration proceeds (F-86)", async () => {
    const r = await runSetup({ version: VERSION, marketplaceDir, env: env({ FAKE_CLAUDE_FAIL: "list" }) });
    expect(r.action).toBe("installed");
  });

  it("--claude <path> runs that executable (an npm shim is parsed) instead of PATH (F-86, N-10)", async () => {
    const shim = join(bin, process.platform === "win32" ? "claude.cmd" : "claude");
    const r = await runSetup({ version: VERSION, marketplaceDir, claude: shim, env: env({ FAKE_CLAUDE_INSTALLED: VERSION }, { withClaude: false }) });
    expect(r.action).toBe("already");
    const err = await runSetup({ version: VERSION, marketplaceDir, claude: join(tmp, "nope"), env: env() }).catch((e: unknown) => e);
    expect((err as CrtError).message).toMatch(/^claude not found at .*nope — install Claude Code/);
  });

  it("writes nothing itself: the marketplace directory is only ever named, never created (N-5)", async () => {
    writeFileSync(join(tmp, "marker"), "");
    await runSetup({ version: VERSION, marketplaceDir, env: env() });
    expect(existsSync(marketplaceDir)).toBe(false);
  });
});
