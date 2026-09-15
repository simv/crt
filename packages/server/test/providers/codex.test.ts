import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CODEX_MIN_VERSION,
  CODEX_NOT_FOUND,
  CODEX_NOT_LOGGED_IN,
  codexPreflight,
  codexProfile,
  codexTooOld,
  compareVersions,
  parseCodexVersion,
} from "../../src/providers/codex.js";

// The codex profile (PRD-providers F-42, F-53, M6 verdicts). The driver itself is CRT-0012; here
// the preflight runs against a fake `codex` installed npm-style into a scratch bin directory, so
// the shim parser and the spawn path are exercised for real on whichever platform runs the tests.

let tmp: string;
let bin: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "crt-codex-"));
  bin = join(tmp, "npm");
  mkdirSync(bin);
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/**
 * A fake Codex CLI installed the way npm does it: `codex.cmd` + sh `codex` shims pointing at a
 * JS entry. It answers `--version` and `login status` from FAKE_CODEX_VERSION / FAKE_CODEX_LOGIN.
 */
function installFakeCodex(): void {
  const rel = "node_modules/@openai/codex/bin/codex.js";
  const entry = join(bin, ...rel.split("/"));
  mkdirSync(join(entry, ".."), { recursive: true });
  writeFileSync(
    entry,
    [
      "const a = process.argv.slice(2);",
      'if (a[0] === "--version") { console.log(`codex-cli ${process.env.FAKE_CODEX_VERSION ?? "0.154.0"}`); process.exit(0); }',
      'if (a[0] === "login" && a[1] === "status") { const s = Number(process.env.FAKE_CODEX_LOGIN ?? 0); console.log(s === 0 ? "Logged in using ChatGPT" : "Not logged in"); process.exit(s); }',
      "process.exit(2);",
      "",
    ].join("\n"),
  );
  writeFileSync(join(bin, "codex.cmd"), `@ECHO off\r\nendLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${rel.split("/").join("\\")}" %*\r\n`);
  writeFileSync(join(bin, "codex"), `#!/bin/sh\nbasedir=$(dirname "$0")\nexec node  "$basedir/${rel}" "$@"\n`);
  chmodSync(join(bin, "codex"), 0o755);
}

const env = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => ({ PATH: bin, PATHEXT: ".COM;.EXE;.BAT;.CMD", ...extra });

describe("codex profile (F-42, F-53)", () => {
  it("declares the M6-verified markers, launch signal, capabilities, telemetry opt-out and resume command (F-42, F-46, F-53)", () => {
    expect(codexProfile.id).toBe("codex");
    expect(codexProfile.markers).toEqual({ private: [".codex/"], shared: ["AGENTS.md"] });
    expect(codexProfile.launchEnv).toEqual(["CODEX_THREAD_ID", "CODEX_SESSION_ID"]);
    expect(codexProfile.capabilities).toEqual({ streaming: false, toolEvents: true, permissions: "sandboxed", images: "path", resume: true, interrupt: true, instructions: "first-message" });
    expect(codexProfile.telemetryOptOut).toEqual(["-c", "analytics.enabled=false"]);
    expect(codexProfile.resumeCommand("01a0a4ca-1dff-7f52-b571-4aad430f5d30")).toBe("codex resume 01a0a4ca-1dff-7f52-b571-4aad430f5d30");
    expect(() => codexProfile.start({} as never)).toThrow(/not implemented until CRT-0012/);
  });

  it("parses `codex-cli 0.154.0` and compares dotted versions (F-53)", () => {
    expect(parseCodexVersion("codex-cli 0.154.0\n")).toBe("0.154.0");
    expect(parseCodexVersion("codex 1.2.3-beta.1")).toBe("1.2.3-beta.1");
    expect(parseCodexVersion("something else")).toBeNull();
    expect(compareVersions("0.154.0", CODEX_MIN_VERSION)).toBe(0);
    expect(compareVersions("0.153.9", "0.154.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "0.999.0")).toBeGreaterThan(0);
    expect(compareVersions("0.154", "0.154.0")).toBe(0);
  });

  it("preflight: not on PATH → the N-7 install line (F-53, N-7)", async () => {
    expect(await codexPreflight({ env: env() })).toEqual({ installed: false, loggedIn: "unknown", version: null, problem: CODEX_NOT_FOUND });
    expect(CODEX_NOT_FOUND).toBe("codex not found on PATH — npm i -g @openai/codex, or set providers.codex.command in .crt/config.json");
  });

  it("preflight: an npm-installed codex is found through its shim, versioned and logged in (F-53, N-10)", async () => {
    installFakeCodex();
    expect(await codexPreflight({ env: env() })).toEqual({ installed: true, loggedIn: true, version: "0.154.0", problem: null });
    expect(await codexProfile.preflight({ env: env({ FAKE_CODEX_LOGIN: "1" }) })).toEqual({ installed: true, loggedIn: false, version: "0.154.0", problem: CODEX_NOT_LOGGED_IN });
    // An odd `login status` exit code is never a blocker (§12 rule 3).
    expect(await codexPreflight({ env: env({ FAKE_CODEX_LOGIN: "7" }) })).toMatchObject({ installed: true, loggedIn: "unknown", problem: null });
  });

  it("preflight: too old, and a configured command that fails --version (F-53, N-7)", async () => {
    installFakeCodex();
    expect(await codexPreflight({ env: env({ FAKE_CODEX_VERSION: "0.100.0" }) })).toEqual({ installed: true, loggedIn: "unknown", version: "0.100.0", problem: codexTooOld("0.100.0") });
    expect(codexTooOld("0.100.0")).toMatch(/too old/);
    // providers.codex.command pointing at something that is not Codex.
    const notCodex = join(tmp, "not-codex.js");
    writeFileSync(notCodex, 'console.log("hello"); process.exit(0);\n');
    const r = await codexPreflight({ command: [process.execPath, notCodex], env: env() });
    expect(r).toMatchObject({ installed: true, loggedIn: "unknown", version: null });
    expect(r.problem).toMatch(/codex --version failed/);
  });
});
