import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { build } from "esbuild";
import { vi } from "vitest";
import type { SessionDriver, SessionEvent, StartSessionOptions } from "../../src/session-events.js";

// The fake-CLI plumbing the provider tests share (PRD-providers F-59, N-9, N-10): the environment a
// fake agent runs under, the `crt mcp` shim the agent spawns, and a waiter over a driver's events.

/**
 * The system directories the fakes and the drivers need besides node: `cmd` and `taskkill` on
 * Windows (the npm `.cmd` shims, process-tree kill), `sh` elsewhere (the hook wrappers).
 */
const SYSTEM_DIRS = process.platform === "win32" ? [join(process.env.SystemRoot ?? "C:\\Windows", "System32")] : ["/usr/bin", "/bin"];

/** PATH and every variable `setEnv` changed, as they were before the first change since the last `restoreEnv`. */
const savedPath = process.env.PATH;
const saved = new Map<string, string | undefined>();

/** Set `process.env` variables for this test; `restoreEnv()` (in `afterEach`) puts them back. */
export function setEnv(vars: Record<string, string>): void {
  for (const [k, v] of Object.entries(vars)) {
    if (!saved.has(k)) saved.set(k, process.env[k]);
    process.env[k] = v;
  }
}

/** Undo every `setEnv`/`useFake` since the last call, and put PATH back as it was when the suite loaded. */
export function restoreEnv(): void {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  saved.clear();
  process.env.PATH = savedPath;
}

/**
 * Put the fake installed in `bin` on a PATH of its own (the drivers resolve through `process.env`)
 * and set the fake's knobs. Not "first on PATH": exec.ts prefers a bare `.exe` anywhere on PATH
 * over an npm shim, so a real `codex.exe` / `agy.exe` on the developer's machine would win over the
 * fake's `.cmd` (N-9). node and the system directories are all the fakes and drivers need.
 */
export function useFake(bin: string, knobs: Record<string, string> = {}): void {
  setEnv({ PATH: [bin, dirname(process.execPath), ...SYSTEM_DIRS].join(delimiter), ...knobs });
}

/**
 * A synthetic environment for `preflight({ env })`: the fake's bin first and node (on POSIX the
 * script's `#!/usr/bin/env node` needs it), Windows' executable extensions, plus `extra`.
 */
export function env(bin: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { PATH: `${bin}${delimiter}${dirname(process.execPath)}`, PATHEXT: ".COM;.EXE;.BAT;.CMD", ...extra };
}

let shim: Promise<string> | null = null;

/**
 * The `crt mcp` shim as an agent runs it (F-49): one file bundled from src/ by esbuild, so the tests
 * do not depend on the build step. Built once per test process and removed when it exits.
 */
export function buildMcpShim(): Promise<string> {
  shim ??= (async () => {
    const dir = mkdtempSync(join(tmpdir(), "crt-mcp-shim-"));
    process.once("exit", () => rmSync(dir, { recursive: true, force: true }));
    const entry = join(dir, "entry.mjs");
    writeFileSync(entry, `import { runMcpStdio } from ${JSON.stringify(join(import.meta.dirname, "..", "..", "src", "mcp-stdio.ts"))};\nprocess.exitCode = await runMcpStdio({ input: process.stdin, output: process.stdout, env: process.env });\n`);
    const outfile = join(dir, "crt-mcp.mjs");
    await build({ entryPoints: [entry], bundle: true, platform: "node", format: "esm", target: "node20", outfile, logLevel: "silent" });
    return outfile;
  })();
  return shim;
}

/**
 * The options a provider test starts a driver with: a capture's viewport as the first message's
 * image, every permission allowed, a `write_task` that answers CRT-0001 and the shim as the MCP server.
 */
export function driverOptions(o: { cwd: string; captureDir: string; shim: string; imageData?: string; model?: string | null }): StartSessionOptions {
  return {
    id: randomUUID(),
    cwd: o.cwd,
    systemPromptAppend: "",
    first: { text: "hello from the test", images: [{ mediaType: "image/png", path: join(o.captureDir, "viewport.png"), ...(o.imageData === undefined ? {} : { data: o.imageData }), label: "viewport" }] },
    decide: () => ({ kind: "allow" }),
    writeTask: async () => ({ id: "CRT-0001", path: "x" }),
    mcp: { command: process.execPath, args: [o.shim], env: { CRT_MCP_TOKEN: "t", CRT_MCP_PORT: "1" } },
    model: o.model ?? null,
  };
}

/**
 * Wait until `events` holds one matching `pred` at index `from` or later; resolves with its index.
 * The timeout message carries the last events, which is usually the whole diagnosis.
 */
export function waitForEvent(events: SessionEvent[], pred: (e: SessionEvent) => boolean, from = 0, timeoutMs = 20_000): Promise<number> {
  return vi.waitFor(
    () => {
      const i = events.findIndex((e, idx) => idx >= from && pred(e));
      if (i === -1) throw new Error(`timed out; events: ${JSON.stringify(events.slice(-5))}`);
      return i;
    },
    { timeout: timeoutMs, interval: 10 },
  );
}

/** Collect a driver's events; `waitFor(pred, from)` is `waitForEvent` over them. */
export function driverHarness(driver: SessionDriver) {
  const events: SessionEvent[] = [];
  driver.onEvent((e) => events.push(e));
  const waitFor = (pred: (e: SessionEvent) => boolean, from = 0, timeoutMs = 20_000) => waitForEvent(events, pred, from, timeoutMs);
  return { events, driver, waitFor };
}
