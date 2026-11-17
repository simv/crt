/**
 * `crt extension` (PRD-extension F-161) and what the server remembers of the extension (F-162).
 *
 * The extension is built into this package (`dist/extension/`, packages/overlay/build.mjs) and
 * Chrome loads an unpacked extension from a folder it keeps reading, so the command copies it to a
 * stable place — `<home>/extension/` (PRD-zero N-34: the CRT home is the one place outside a project
 * CRT writes) — prints that folder and the three steps, and on a later version refreshes the copy
 * and says to reload it. `--path` prints the folder and writes nothing. It writes nowhere else.
 *
 * F-162: the first request the extension's worker makes for a project is remembered beside the
 * project's reviews (`<home>/reviews/<key>/extension.json`), which is what lets plain `crt` open the
 * developer's own browser in an app without the integration (start.ts `openDecision`).
 * Node built-ins only; nothing here is served to a page.
 */
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { CrtError } from "./errors.js";
import { crtHome, ensureDir, type OnCreate, projectReviewsDir, writeJsonAtomic } from "./home.js";

export const EXTENSION_DIRNAME = "extension";
/** F-162: the header the extension's worker puts on every request (packages/overlay/src/extension/wire.ts `VIA_HEADER`). */
export const VIA_HEADER = "x-crt-via";
/** F-162: the origin of the page the request is for (wire.ts `PAGE_HEADER`). */
export const PAGE_HEADER = "x-crt-page";
export const VIA_EXTENSION = "extension";
const SEEN_FILE = "extension.json";

/** F-161: `<home>/extension` — the folder Chrome or Edge is pointed at. */
export function extensionDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(crtHome(env), EXTENSION_DIRNAME);
}

/** The `version` of the manifest in a folder; null when there is none or it does not parse. */
export function manifestVersion(dir: string): string | null {
  try {
    const version = (JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { version?: unknown }).version;
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

export interface ExtensionOptions {
  /** `dist/extension` of this package. */
  sourceDir: string;
  /** `--path`: print the folder only, write nothing. */
  pathOnly?: boolean;
  env?: NodeJS.ProcessEnv;
}

export interface ExtensionResult {
  dir: string;
  /** What the run did to the installed copy. */
  action: "path" | "installed" | "refreshed" | "current";
  lines: string[];
}

/** F-161: the three steps, the same in Chrome and Edge. */
export function installSteps(dir: string): string[] {
  return [
    "  1. Open chrome://extensions (Edge: edge://extensions) and turn on Developer mode.",
    `  2. Click "Load unpacked" and choose ${dir}`,
    "  3. Open your site, click the CRT button in the toolbar (pin it from the puzzle-piece menu) and allow the site.",
  ];
}

/** F-161: copy the built extension to the CRT home, or refresh it, and say what to do in the browser. */
export function runExtension(opts: ExtensionOptions): ExtensionResult {
  const env = opts.env ?? process.env;
  const dir = extensionDir(env);
  if (opts.pathOnly) return { dir, action: "path", lines: [dir] };
  const version = manifestVersion(opts.sourceDir);
  if (version === null) throw new CrtError(`the extension is missing from this package (${opts.sourceDir}) — reinstall claude-review-tool, or run \`npm run build\` in a checkout`);
  const installed = manifestVersion(dir);
  if (installed === version) {
    // Copied again all the same: a checkout's build can change under one version, and the copy is the only write.
    copyExtension(opts.sourceDir, dir);
    return {
      dir,
      action: "current",
      lines: [`crt: the extension ${version} is in ${dir}`, "First time in this browser?", ...installSteps(dir), "Already loaded: click Reload on its card in chrome://extensions after an update."],
    };
  }
  copyExtension(opts.sourceDir, dir);
  if (installed !== null) {
    return {
      dir,
      action: "refreshed",
      lines: [`crt: updated the extension in ${dir} (${installed} → ${version})`, "Open chrome://extensions (Edge: edge://extensions) and click Reload on the CRT card, then reload your page."],
    };
  }
  return {
    dir,
    action: "installed",
    lines: [`crt: copied the extension ${version} to ${dir}`, ...installSteps(dir), "Start the server in your project with `crt` first; the extension talks to it on http://localhost:4400 (its Options page changes the port)."],
  };
}

function copyExtension(from: string, to: string): void {
  // Replaced whole, so a file a later version dropped does not linger; the browser reads the folder on Reload.
  rmSync(to, { recursive: true, force: true });
  ensureDir(to);
  cpSync(from, to, { recursive: true });
}

// ---- F-162: what the server remembers ------------------------------------------------------------------

function seenPath(root: string, env: NodeJS.ProcessEnv): string {
  return join(projectReviewsDir(root, env), SEEN_FILE);
}

/** F-162: the extension has mounted against a server of this project before. */
export function extensionSeen(root: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return existsSync(seenPath(root, env));
}

/** F-162: remember it, once per project; a failure to write is not the request's problem. */
export function rememberExtension(root: string, env: NodeJS.ProcessEnv = process.env, onCreate?: OnCreate, now: Date = new Date()): void {
  try {
    const path = seenPath(root, env);
    if (existsSync(path)) return;
    ensureDir(projectReviewsDir(root, env), onCreate);
    writeJsonAtomic(path, { seen: now.toISOString() });
  } catch {
    // The home is read-only or gone: plain `crt` keeps opening the CRT browser, which is what it did.
  }
}
