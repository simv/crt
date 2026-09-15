import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findOnPath, killProcessTree, parseNpmShim, resolveExecutable, runExecutable } from "../../src/providers/exec.js";

// Executable resolution and process helpers shared by every provider (PRD-providers F-53, N-10).
// The PATH scans run against scratch directories with a fake PATH, for both platforms' rules.

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "crt-exec-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

/** The body npm writes for `<name>.cmd` on Windows (trimmed to what matters). */
const CMD_SHIM = (rel: string) =>
  ["@ECHO off", "GOTO start", ":find_dp0", "SET dp0=%~dp0", "EXIT /b", ":start", "SETLOCAL", "CALL :find_dp0", "", 'IF EXIST "%dp0%\\node.exe" (', '  SET "_prog=%dp0%\\node.exe"', ") ELSE (", '  SET "_prog=node"', "  SET PATHEXT=%PATHEXT:;.JS;=;%", ")", "", `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${rel}" %*`].join("\r\n");
/** The sh shim npm writes next to it. */
const SH_SHIM = (rel: string) =>
  ["#!/bin/sh", 'basedir=$(dirname "$(echo "$0" | sed -e \'s,\\\\,/,g\')")', "", 'if [ -x "$basedir/node" ]; then', `  exec "$basedir/node"  "$basedir/${rel}" "$@"`, "else", `  exec node  "$basedir/${rel}" "$@"`, "fi"].join("\n");

/** A fake global npm install: `<bin>/codex.cmd`, `<bin>/codex` and the JS entry they point at. */
function fakeNpmInstall(bin: string, name = "codex"): string {
  const rel = `node_modules/@fake/${name}/bin/${name}.js`;
  const entry = join(bin, ...rel.split("/"));
  mkdirSync(join(entry, ".."), { recursive: true });
  writeFileSync(entry, `console.log("fake ${name}", process.argv.slice(2).join(" "));\n`);
  writeFileSync(join(bin, `${name}.cmd`), CMD_SHIM(rel.split("/").join("\\")));
  writeFileSync(join(bin, name), SH_SHIM(rel));
  chmodSync(join(bin, name), 0o755);
  return entry;
}

describe("parseNpmShim (F-53, N-10)", () => {
  it("extracts the JS entry from a .cmd shim and from an sh shim, relative to the shim's directory", () => {
    const cmd = parseNpmShim(CMD_SHIM("node_modules\\@openai\\codex\\bin\\codex.js"), "C:\\Users\\me\\AppData\\Roaming\\npm\\codex.cmd", "win32");
    expect(cmd).toBe("C:\\Users\\me\\AppData\\Roaming\\npm\\node_modules\\@openai\\codex\\bin\\codex.js");
    const sh = parseNpmShim(SH_SHIM("node_modules/@openai/codex/bin/codex.js"), "/usr/local/bin/codex", "linux");
    expect(sh).toBe("/usr/local/bin/node_modules/@openai/codex/bin/codex.js");
  });

  it("returns null for anything that is not npm-shaped", () => {
    expect(parseNpmShim('@echo off\r\n"C:\\real\\codex.exe" %*', "C:\\bin\\codex.cmd", "win32")).toBeNull();
    expect(parseNpmShim("#!/bin/sh\nexec /opt/codex/codex \"$@\"", "/usr/bin/codex", "linux")).toBeNull();
    expect(parseNpmShim("", "/usr/bin/codex", "linux")).toBeNull();
  });
});

const WIN = process.platform === "win32";

// The PATH scans use the platform's own path rules and real files, so each platform's branch runs
// on its own CI runner (windows-latest / ubuntu-latest, N-10); parseNpmShim above covers both anywhere.
describe("findOnPath / resolveExecutable (F-53, N-10)", () => {
  it.skipIf(!WIN)("on Windows prefers <name>.exe over a shim, across the whole PATH, honouring PATHEXT", () => {
    const shimDir = join(tmp, "npm");
    const exeDir = join(tmp, "bin");
    mkdirSync(shimDir);
    mkdirSync(exeDir);
    fakeNpmInstall(shimDir);
    writeFileSync(join(exeDir, "codex.exe"), "MZ");
    const env = { Path: `${shimDir};${exeDir}`, PATHEXT: ".COM;.EXE;.BAT;.CMD" };
    // The shim dir comes first on PATH, the .exe still wins (F-53 "prefer .exe").
    expect(findOnPath("codex", "win32", env)).toEqual({ command: join(exeDir, "codex.exe"), args: [], via: "path", found: join(exeDir, "codex.exe") });
    // Without .EXE in PATHEXT the binary is not considered at all.
    expect(findOnPath("codex", "win32", { ...env, PATHEXT: ".CMD" })?.via).toBe("shim");
    expect(findOnPath("nothing", "win32", env)).toBeNull();
  });

  it.skipIf(!WIN)("on Windows runs an npm .cmd shim's JS entry with our own Node and never returns the .cmd itself", () => {
    const shimDir = join(tmp, "npm");
    mkdirSync(shimDir);
    const entry = fakeNpmInstall(shimDir);
    const found = findOnPath("codex", "win32", { PATH: shimDir, PATHEXT: ".COM;.EXE;.BAT;.CMD" });
    expect(found).toEqual({ command: process.execPath, args: [entry], via: "shim", found: join(shimDir, "codex.cmd") });
    // A .cmd that is not an npm shim cannot be spawned without a shell: treated as not installed.
    writeFileSync(join(shimDir, "other.cmd"), '@echo off\r\n"C:\\somewhere\\other.exe" %*\r\n');
    expect(findOnPath("other", "win32", { PATH: shimDir, PATHEXT: ".EXE;.CMD" })).toBeNull();
  });

  it.skipIf(WIN)("on POSIX runs an npm sh shim's JS entry with our own Node and a plain executable directly", () => {
    const bin = join(tmp, "bin");
    mkdirSync(bin);
    const entry = fakeNpmInstall(bin);
    const found = findOnPath("codex", "linux", { PATH: `${join(tmp, "missing")}:${bin}` });
    expect(found).toEqual({ command: process.execPath, args: [entry], via: "shim", found: join(bin, "codex") });
    writeFileSync(join(bin, "gemini"), "#!/bin/sh\nexec /opt/gemini \"$@\"\n");
    chmodSync(join(bin, "gemini"), 0o755);
    const plain = findOnPath("gemini", "linux", { PATH: bin });
    expect(plain).toEqual({ command: join(bin, "gemini"), args: [], via: "path", found: join(bin, "gemini") });
  });

  it("providers.<id>.command wins: an absolute file, a shim path, or a bare name looked up on PATH (F-53)", () => {
    const bin = join(tmp, "bin");
    mkdirSync(bin);
    const entry = fakeNpmInstall(bin);
    const exe = join(tmp, WIN ? "codex.exe" : "codex-real");
    writeFileSync(exe, WIN ? "MZ" : "#!/bin/sh\nexit 0\n");
    chmodSync(exe, 0o755);
    const shim = join(bin, WIN ? "codex.cmd" : "codex");
    expect(resolveExecutable("codex", { command: [exe, "--flag"], env: { PATH: "" } })).toEqual({ command: exe, args: ["--flag"], via: "config", found: exe });
    expect(resolveExecutable("codex", { command: [shim], env: { PATH: "" } })).toEqual({ command: process.execPath, args: [entry], via: "config", found: shim });
    expect(resolveExecutable("codex", { command: ["codex"], env: { PATH: bin, PATHEXT: ".EXE;.CMD" } })).toMatchObject({ command: process.execPath, args: [entry], via: "config" });
    expect(resolveExecutable("codex", { command: [join(tmp, "nope.exe")], env: { PATH: bin } })).toBeNull();
    // An empty command falls through to PATH.
    expect(resolveExecutable("codex", { command: [], env: { PATH: bin, PATHEXT: ".EXE;.CMD" } })?.via).toBe("shim");
  });
});

describe("runExecutable / killProcessTree (F-53, N-10)", () => {
  it("runs a resolved executable without a shell and reports exit code and output", async () => {
    const exe = { command: process.execPath, args: ["-e", "console.log('v ' + process.argv[1]); console.error('warn'); process.exit(Number(process.argv[2] ?? 0))"], via: "shim" as const, found: "x" };
    expect(await runExecutable(exe, ["1.2.3"])).toEqual({ status: 0, stdout: "v 1.2.3\n", stderr: "warn\n", error: null });
    expect(await runExecutable(exe, ["1.2.3", "3"])).toMatchObject({ status: 3, error: null });
    expect(await runExecutable({ command: join(tmp, "missing.exe"), args: [], via: "path", found: "" }, [])).toMatchObject({ status: null, stdout: "", error: expect.stringMatching(/ENOENT/) });
    const slow = { ...exe, args: ["-e", "setInterval(() => {}, 1000)"] };
    expect(await runExecutable(slow, [], { timeoutMs: 200 })).toMatchObject({ status: null, error: "timed out" });
  });

  it("kills a process and its children (taskkill /T on Windows, the process group on POSIX)", async () => {
    // A parent that spawns a child; both idle until killed.
    const script = "const { spawn } = require('node:child_process'); const c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' }); process.stdout.write(String(c.pid)); setInterval(() => {}, 1000);";
    const parent = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "ignore"], detached: process.platform !== "win32", windowsHide: true });
    const childPid = await new Promise<number>((resolve) => parent.stdout!.once("data", (d: Buffer) => resolve(Number(String(d)))));
    expect(childPid).toBeGreaterThan(0);
    const exited = new Promise<void>((resolve) => parent.once("exit", () => resolve()));
    expect(killProcessTree(parent.pid!)).toBe(true);
    await exited;
    // The grandchild is gone too: signalling it now fails.
    await new Promise((r) => setTimeout(r, 300));
    expect(() => process.kill(childPid, 0)).toThrow();
    expect(killProcessTree(0)).toBe(false);
  });
});
