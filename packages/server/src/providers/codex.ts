/**
 * The `codex` provider profile (PRD-providers F-42, F-53). M7 ships the profile only — markers,
 * launch signal, preflight, capabilities — so detection and `crt providers` know about Codex;
 * the driver (`codex exec --json`) lands with CRT-0012 and replaces `start()` below.
 *
 * Tested version: codex-cli 0.154.0 on Windows 11, 2026-09-15 (docs/spikes/codex-2026-09.md).
 * Everything here that names a flag, an exit code or an environment variable was observed on
 * that version:
 *   • `codex --version` prints `codex-cli 0.154.0` (exit 0).
 *   • `codex login status` exits 0 when logged in (`Logged in using ChatGPT`), 1 when not
 *     (`Not logged in`). It does not validate the token: a stale login surfaces only at turn
 *     time as `error` + `turn.failed` ("…log out and sign in again"), which the driver maps to
 *     the same N-7 line (CRT-0012).
 *   • Commands Codex runs see `CODEX_THREAD_ID` and `CODEX_SESSION_ID` (`launchEnv`).
 *   • `-c analytics.enabled=false` is the per-invocation telemetry opt-out (N-12).
 *   • Agent text arrives whole (one `item.completed` per message): `streaming: false`.
 *   • npm installs `codex.cmd` + an sh `codex` shim; `codex.exe` lives under the platform
 *     package. `exec.ts` finds the `.exe` when it is on PATH and otherwise runs the shim's JS
 *     entry with our own Node (N-10).
 */
import type { ProviderCapabilities } from "../session-events.js";
import { resolveExecutable, runExecutable } from "./exec.js";
import type { PreflightOptions, PreflightResult, ProviderProfile } from "./types.js";

export const CODEX_TESTED_VERSION = "0.154.0";
/** Oldest version whose `exec --json` contract matches the tested one; older prints "too old" (N-7). */
export const CODEX_MIN_VERSION = "0.154.0";
const CODEX_INSTALL = "npm i -g @openai/codex";
const CODEX_LOGIN = "codex login";

/** F-46 reference values for Codex (M6 verdicts: no deltas, read-only sandbox, images by path). */
export const CODEX_CAPABILITIES: ProviderCapabilities = {
  streaming: false,
  toolEvents: true,
  permissions: "sandboxed",
  images: "path",
  resume: true,
  interrupt: true,
  instructions: "first-message",
};

export const codexProfile: ProviderProfile = {
  id: "codex",
  displayName: "Codex",
  agentName: "Codex CLI",
  markers: { private: [".codex/"], shared: ["AGENTS.md"] },
  launchEnv: ["CODEX_THREAD_ID", "CODEX_SESSION_ID"],
  hints: { install: CODEX_INSTALL, login: CODEX_LOGIN },
  capabilities: CODEX_CAPABILITIES,
  telemetryOptOut: ["-c", "analytics.enabled=false"],
  preflight: codexPreflight,
  resumeCommand: (threadId) => `codex resume ${threadId}`,
  start: () => {
    throw new Error("codex driver is not implemented until CRT-0012");
  },
};

/** N-7 lines; the README's Providers section quotes them verbatim (M11). */
export const CODEX_NOT_FOUND = `codex not found on PATH — ${CODEX_INSTALL}, or set providers.codex.command in .crt/config.json`;
export const CODEX_NOT_LOGGED_IN = `not logged in to Codex — run \`${CODEX_LOGIN}\` in a terminal, then send again`;
export const codexTooOld = (version: string): string => `codex ${version} is too old — CRT needs ${CODEX_MIN_VERSION} or newer (${CODEX_INSTALL}@latest)`;

/**
 * F-53 preflight: find the executable (config → PATH → npm shim), read `--version`, then ask
 * `login status`. Neither command is allowed to hang the server: 15 s each, then "unknown".
 */
export async function codexPreflight(opts: PreflightOptions = {}): Promise<PreflightResult> {
  const exe = resolveExecutable("codex", { command: opts.command ?? null, ...(opts.env ? { env: opts.env } : {}) });
  if (!exe) return { installed: false, loggedIn: "unknown", version: null, problem: CODEX_NOT_FOUND };

  const v = await runExecutable(exe, ["--version"], opts.env ? { env: opts.env } : {});
  const version = parseCodexVersion(v.stdout);
  if (v.status !== 0 || !version) {
    const why = v.error ?? v.stderr.trim().split(/\r?\n/)[0] ?? `exit ${v.status}`;
    return { installed: true, loggedIn: "unknown", version, problem: `codex --version failed (${why || "no output"}) — reinstall with ${CODEX_INSTALL}` };
  }
  if (compareVersions(version, CODEX_MIN_VERSION) < 0) return { installed: true, loggedIn: "unknown", version, problem: codexTooOld(version) };

  const login = await runExecutable(exe, ["login", "status"], opts.env ? { env: opts.env } : {});
  if (login.status === 0) return { installed: true, loggedIn: true, version, problem: null };
  if (login.status === 1) return { installed: true, loggedIn: false, version, problem: CODEX_NOT_LOGGED_IN };
  return { installed: true, loggedIn: "unknown", version, problem: null };
}

/** `codex-cli 0.154.0` → `0.154.0`; null when the line is not in that shape. */
export function parseCodexVersion(stdout: string): string | null {
  const m = /codex(?:-cli)?\s+v?(\d+\.\d+\.\d+(?:[-+][\w.]+)?)/i.exec(stdout);
  return m ? m[1]! : null;
}

/** Numeric dotted compare; a pre-release suffix is ignored. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[-+]/)[0]!.split(".").map(Number);
  const pb = b.split(/[-+]/)[0]!.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
