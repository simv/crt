/**
 * Finding and running provider CLIs on the developer's machine (PRD-providers F-53 executable
 * resolution, N-10 Windows first). Rules every driver shares:
 *
 *   • `shell: false` everywhere; a command is always an executable path plus an argv array.
 *   • Windows PATH/PATHEXT resolution prefers `<name>.exe`; a `.cmd`/`.bat` is never handed to
 *     `spawn`. npm's shims (`codex.cmd`, the sh `codex` next to it) are parsed instead and the JS
 *     entry they point at is run with this process's own Node (`process.execPath`).
 *   • Interrupting a provider means killing its whole process tree (`taskkill /T /F` on Windows,
 *     a negative-pid group kill on POSIX), because agents spawn MCP servers and shells of their own.
 *
 * Only `providers/<id>.ts` and this file may spawn a provider (CLAUDE.md, F-63).
 */
import { execFile, spawnSync } from "node:child_process";
import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { posix, win32 } from "node:path";

export interface Executable {
  /** What to pass to `spawn()`: a binary, or `process.execPath` when `via` is `shim`. */
  command: string;
  /** Leading argv (the shim's JS entry) that goes before the caller's own arguments. */
  args: string[];
  /** Where it came from: `providers.<id>.command`, a binary on PATH, or a parsed npm shim. */
  via: "config" | "path" | "shim";
  /** The file that was found (the shim itself when `via` is `shim`). */
  found: string;
}

export interface ResolveOptions {
  /** `providers.<id>.command` from `.crt/config.json`: command plus leading args. Wins when set. */
  command?: string[] | null;
  env?: NodeJS.ProcessEnv;
  /** Defaults to `process.platform`; tests pass `win32`/`linux` with a fake PATH. */
  platform?: NodeJS.Platform;
}

/** Extensions Windows can start without a shell; `.exe` first (F-53 "prefer .exe"). */
const WIN_BINARY_EXTS = [".exe", ".com"];
/** npm writes these next to every global bin on Windows; they need cmd.exe, so we read them instead. */
const WIN_SHIM_EXTS = [".cmd", ".bat"];
const DEFAULT_PATHEXT = ".COM;.EXE;.BAT;.CMD";

/**
 * F-53 order: the configured command, then `<name>.exe`/`<name>` on PATH, then an npm shim on PATH
 * whose JS entry we can run ourselves. Null means "not installed" as far as CRT can tell.
 */
export function resolveExecutable(name: string, opts: ResolveOptions = {}): Executable | null {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  if (opts.command && opts.command.length) return fromConfig(opts.command, platform, env);
  return findOnPath(name, platform, env);
}

function fromConfig(command: string[], platform: NodeJS.Platform, env: NodeJS.ProcessEnv): Executable | null {
  const [head, ...rest] = command as [string, ...string[]];
  const p = platform === "win32" ? win32 : posix;
  const bare = !p.isAbsolute(head) && p.basename(head) === head;
  const found = bare ? findOnPath(head, platform, env) : fromFile(head, platform);
  if (!found) return null;
  return { ...found, args: [...found.args, ...rest], via: "config" };
}

/** A path the developer gave us: use it if it exists, parsing it when it is a shim. */
function fromFile(file: string, platform: NodeJS.Platform): Executable | null {
  if (!isFile(file)) return null;
  const p = platform === "win32" ? win32 : posix;
  const ext = p.extname(file).toLowerCase();
  if (platform === "win32" && WIN_SHIM_EXTS.includes(ext)) return shimEntry(file, platform);
  if (platform !== "win32" && looksLikeShShim(file)) return shimEntry(file, platform) ?? { command: file, args: [], via: "path", found: file };
  return { command: file, args: [], via: "path", found: file };
}

/** Scan PATH for `name`: binaries first across every directory, then npm shims. */
export function findOnPath(name: string, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): Executable | null {
  const p = platform === "win32" ? win32 : posix;
  const dirs = (envValue(env, "PATH") ?? "").split(platform === "win32" ? ";" : ":").filter(Boolean);
  if (platform === "win32") {
    const pathext = (envValue(env, "PATHEXT") ?? DEFAULT_PATHEXT).toLowerCase().split(";").filter(Boolean);
    const binaryExts = WIN_BINARY_EXTS.filter((e) => pathext.includes(e));
    const shimExts = WIN_SHIM_EXTS.filter((e) => pathext.includes(e));
    for (const dir of dirs) {
      for (const ext of binaryExts) {
        const file = p.join(dir, name + ext);
        if (isFile(file)) return { command: file, args: [], via: "path", found: file };
      }
    }
    for (const dir of dirs) {
      for (const ext of shimExts) {
        const file = p.join(dir, name + ext);
        if (!isFile(file)) continue;
        const shim = shimEntry(file, platform);
        if (shim) return shim;
      }
      // npm also writes an extension-less sh shim; Git Bash users may have only that on PATH.
      const sh = p.join(dir, name);
      if (isFile(sh) && looksLikeShShim(sh)) {
        const shim = shimEntry(sh, platform);
        if (shim) return shim;
      }
    }
    return null;
  }
  for (const dir of dirs) {
    const file = p.join(dir, name);
    if (!isFile(file) || !isExecutable(file)) continue;
    if (looksLikeShShim(file)) {
      const shim = shimEntry(file, platform);
      if (shim) return shim;
    }
    return { command: file, args: [], via: "path", found: file };
  }
  return null;
}

/**
 * Parse an npm shim and return the JS entry it runs, or null when the file is not npm-shaped.
 * `.cmd` shims contain `"%dp0%\node_modules\<pkg>\bin\<entry>.js"`; sh shims contain
 * `"$basedir/node_modules/<pkg>/bin/<entry>.js"`. Both are relative to the shim's directory.
 */
export function parseNpmShim(body: string, shimPath: string, platform: NodeJS.Platform = process.platform): string | null {
  const p = platform === "win32" ? win32 : posix;
  const dir = p.dirname(shimPath);
  const cmd = /"%dp0%\\([^"\r\n]+\.[cm]?js)"/i.exec(body);
  if (cmd) return p.join(dir, cmd[1]!.split("\\").join(p.sep));
  const sh = /"\$basedir\/([^"\r\n]+\.[cm]?js)"/.exec(body);
  if (sh && /\bnode\b/.test(body)) return p.join(dir, sh[1]!.split("/").join(p.sep));
  return null;
}

function shimEntry(shimPath: string, platform: NodeJS.Platform): Executable | null {
  let body: string;
  try {
    body = readFileSync(shimPath, "utf8");
  } catch {
    return null;
  }
  const entry = parseNpmShim(body, shimPath, platform);
  if (!entry || !isFile(entry)) return null;
  return { command: process.execPath, args: [entry], via: "shim", found: shimPath };
}

function looksLikeShShim(file: string): boolean {
  try {
    const head = readFileSync(file, { encoding: "utf8", flag: "r" }).slice(0, 512);
    return head.startsWith("#!") && /\$basedir/.test(head);
  } catch {
    return false;
  }
}

function isFile(file: string): boolean {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
}

function isExecutable(file: string): boolean {
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** `env.PATH` on POSIX is `Path` (or any casing) on Windows; plain objects in tests are case-sensitive. */
function envValue(env: NodeJS.ProcessEnv, key: string): string | undefined {
  if (env[key] !== undefined) return env[key];
  const k = Object.keys(env).find((e) => e.toLowerCase() === key.toLowerCase());
  return k === undefined ? undefined : env[k];
}

export interface RunResult {
  /** Exit code; null when the process was killed (timeout) or could not start. */
  status: number | null;
  stdout: string;
  stderr: string;
  /** Set when the process could not be started or was killed by the timeout. */
  error: string | null;
}

/** Run to completion without a shell, capturing both streams. Never throws. */
export function runExecutable(
  exe: Executable,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; input?: string } = {},
): Promise<RunResult> {
  return new Promise((resolve) => {
    const child = execFile(
      exe.command,
      [...exe.args, ...args],
      { cwd: opts.cwd, env: opts.env, timeout: opts.timeoutMs ?? 15_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024, encoding: "utf8", shell: false },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { code?: number | string; killed?: boolean }) | null;
        resolve({
          status: e === null ? 0 : typeof e.code === "number" ? e.code : null,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          error: e === null || typeof e.code === "number" ? null : e.killed ? "timed out" : e.message,
        });
      },
    );
    if (opts.input !== undefined) child.stdin?.end(opts.input);
  });
}

/**
 * Kill a provider and everything it spawned (F-53 interrupt). On POSIX this expects the child
 * to have been spawned with `detached: true` so `-pid` names its process group; it falls back to
 * the single pid. Returns false when nothing could be signalled.
 */
export function killProcessTree(pid: number, platform: NodeJS.Platform = process.platform): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (platform === "win32") {
    const r = spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { shell: false, windowsHide: true, stdio: "ignore" });
    return r.status === 0;
  }
  try {
    process.kill(-pid, "SIGKILL");
    return true;
  } catch {
    try {
      process.kill(pid, "SIGKILL");
      return true;
    } catch {
      return false;
    }
  }
}
