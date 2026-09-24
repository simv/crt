import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page } from "@playwright/test";
import type { CrtTestHooks } from "../../overlay/src/index.js";
import type { CrtLoader } from "../../overlay/src/loader.js";

// What the e2e specs share: the ports, the overlay's `window.__crt` type, the shadow-root locator,
// and the scratch projects plus `dist/cli.js` processes the specs that need a server of their own
// spawn (arrival, embedded, start).

/**
 * Every port the e2e suite binds, in one place. The Playwright web servers take theirs from here
 * (playwright.config.ts, playwright.screenshots.config.ts); a spec that spawns servers of its own
 * owns a range and passes ports from it to `scratch()`, which refuses one outside that range.
 * start.spec.ts also names 3998 as a target nothing answers on: the screenshots fixture's port,
 * never up during `npm run e2e`.
 */
export const PORTS = {
  /** The fixture app: the app under test on its own origin (baseURL, PRD-embedded F-110). */
  fixture: 3999,
  /** The primary embedded CRT server the fixture's loader tag points at. */
  crt: 4499,
  /** PRD-providers F-61 axes: the `sandboxed` stub, the fake Codex, ACP and Antigravity CLIs. */
  sandboxed: 4498,
  codex: 4497,
  acp: 4495,
  antigravity: 4494,
  /** `crt proxy` for proxy.spec.ts (PRD-embedded F-92). */
  proxy: 4496,
  /** `npm run screenshots` (PRD-polish F-116): its own fixture and CRT, never run with the e2e. */
  screenshotsFixture: 3998,
  screenshotsCrt: 4490,
  /** The servers a spec spawns itself, one range per spec. */
  embedded: { from: 4460, to: 4469 },
  arrival: { from: 4470, to: 4479 },
  start: { from: 4480, to: 4489 },
} as const;

/** The app origin: what every browser spec navigates to (F-110). */
export const FIXTURE_ORIGIN = `http://localhost:${PORTS.fixture}`;

/** The overlay's debug and test surface (packages/overlay/src/index.ts) plus the loader's handle (loader.ts). */
export type CrtHooks = CrtTestHooks & { loader?: CrtLoader };
declare global {
  interface Window {
    __crt: CrtHooks;
  }
}

/** An element inside the overlay's shadow root (Playwright pierces open shadow roots). */
export const shadow = (page: Page, sel: string) => page.locator("#crt-host").locator(sel);

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, "..", "dist", "cli.js");

/**
 * A scratch project `e2e/.project/<spec>-<name>` with a `.git` marker (so findProjectRoot stops
 * there) and `port` in .crt/config.json (no `mode`: embedded is the default, F-91). The port must
 * be in the spec's `PORTS` range.
 */
export function scratch(spec: "arrival" | "embedded" | "start", name: string, port: number): string {
  const range = PORTS[spec];
  if (port < range.from || port > range.to) throw new Error(`${spec}.spec.ts owns ports ${range.from}–${range.to} (e2e/helpers.ts PORTS); got ${port}`);
  const root = join(here, ".project", `${spec}-${name}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, ".git"), { recursive: true });
  mkdirSync(join(root, ".crt"), { recursive: true });
  writeFileSync(join(root, ".crt", "config.json"), JSON.stringify({ tasksDir: ".crt/tasks", target: null, port }, null, 2) + "\n");
  return root;
}

export interface Crt {
  child: ChildProcess;
  lines: string[];
  exited: Promise<number | null>;
  /** Resolves with the first stdout/stderr line matching `re`, or rejects after `timeoutMs`. */
  waitFor(re: RegExp, timeoutMs?: number): Promise<string>;
}

const running: ChildProcess[] = [];

/** `node dist/cli.js <args>` in `cwd` with `CRT_SESSION_STUB=1` (and `env`), every output line captured. */
export function startCrt(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): Crt {
  const child = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, CRT_SESSION_STUB: "1", ...env }, stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true });
  running.push(child);
  const lines: string[] = [];
  const waiters: Array<{ re: RegExp; resolve: (line: string) => void }> = [];
  const push = (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (!line) continue;
      lines.push(line);
      for (const w of [...waiters]) {
        if (w.re.test(line)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(line);
        }
      }
    }
  };
  child.stdout!.on("data", push);
  child.stderr!.on("data", push);
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  return {
    child,
    lines,
    exited,
    waitFor: (re, timeoutMs = 20_000) =>
      new Promise<string>((resolve, reject) => {
        const hit = lines.find((l) => re.test(l));
        if (hit) return resolve(hit);
        const timer = setTimeout(() => reject(new Error(`no line matching ${re} within ${timeoutMs} ms; got:\n${lines.join("\n")}`)), timeoutMs);
        waiters.push({
          re,
          resolve: (line) => {
            clearTimeout(timer);
            resolve(line);
          },
        });
      }),
  };
}

/** `test.afterEach`: kill every CRT `startCrt` spawned in this test and wait until each has exited, so its port is free for the next. */
export async function stopCrts(): Promise<void> {
  const children = running.splice(0);
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill();
  await expect.poll(() => children.every((c) => c.exitCode !== null || c.signalCode !== null), { timeout: 10_000 }).toBe(true);
}

/** `GET /__crt/health` on localhost:`port`, or null when nothing (or no CRT) answers. */
export async function health(port: number): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`http://localhost:${port}/__crt/health`);
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
