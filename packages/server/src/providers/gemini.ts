/**
 * The `gemini` provider (PRD-providers F-42, F-54, N-7, N-10): Gemini CLI driven over the Agent
 * Client Protocol by `providers/acp.ts` — this module is the profile only (markers, preflight,
 * N-7 lines, resume, skills) plus the ACP spec the driver runs with.
 *
 * Tested version: **Gemini CLI 0.60.0** on Windows 11, 2026-09-21 (docs/spikes/gemini-acp-2026-09.md).
 * Observed on that version:
 *
 *   • `gemini --acp` starts ACP mode; `--experimental-acp` (the name F-54 quotes) still works but
 *     prints a deprecation notice, so the profile passes `--acp`.
 *   • `gemini --version` → `0.60.0` (the bare number), exit 0.
 *   • There is no login-status command. Preflight reads what the CLI itself reads: `GEMINI_API_KEY`
 *     / `GOOGLE_API_KEY` in the environment or `~/.gemini/.env` → logged in; `~/.gemini/oauth_creds.json`
 *     → "unknown" (0.60.0 accepts the Google login but may refuse the account's tier at
 *     `session/new`); nothing → not logged in. `GEMINI_CLI_HOME` overrides `~`.
 *   • Auth failures surface as the `session/new` error (-32000): "Gemini API key is missing or not
 *     configured." when logged out; "This client is no longer supported for Gemini Code Assist for
 *     individuals…" when the personal Google login is refused. Both map to N-7 lines.
 *   • `session/new` returns a UUID; `gemini --resume <uuid>` resumes it from the same project
 *     directory (sessions are stored per project under `~/.gemini/tmp/<project>/chats`).
 *   • Commands Gemini runs see `GEMINI_CLI=1` (launchEnv, F-44).
 *   • `initialize` advertises `promptCapabilities.image: true` → screenshots go inline (F-50).
 *   • Skills (F-58): `.gemini/skills` in the project (`.agents/skills` is read too), `~/.gemini/skills` for the user.
 *   • No per-invocation telemetry flag in 0.60.0; Gemini's own `usageStatisticsEnabled` setting applies (N-12).
 *   • npm installs `gemini.cmd` + an sh `gemini` shim over `node_modules/@google/gemini-cli/bundle/gemini.js`;
 *     `exec.ts` runs that entry with our own Node (N-10).
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ProviderCapabilities } from "../session-events.js";
import { startAcpSession } from "./acp.js";
import { compareVersions } from "./codex.js";
import { resolveExecutable, runExecutable } from "./exec.js";
import type { PreflightOptions, PreflightResult, ProviderProfile } from "./types.js";

export const GEMINI_TESTED_VERSION = "0.60.0";
/** Oldest version whose ACP contract matches the tested one; older prints "too old" (N-7). */
export const GEMINI_MIN_VERSION = "0.60.0";
const GEMINI_INSTALL = "npm i -g @google/gemini-cli";
const GEMINI_LOGIN = "gemini";
/** Arguments that put the tested version in ACP mode. */
export const GEMINI_ACP_ARGS: readonly string[] = ["--acp"];

/** F-46 reference values for Gemini over ACP: streamed text, cards, inline images, resumable. */
export const GEMINI_CAPABILITIES: ProviderCapabilities = {
  streaming: true,
  toolEvents: true,
  permissions: "interactive",
  images: "inline",
  resume: true,
  interrupt: true,
  instructions: "first-message",
};

/** N-7 lines; the README's Providers section quotes them verbatim. */
export const GEMINI_NOT_FOUND = `gemini not found on PATH — ${GEMINI_INSTALL}, or set providers.gemini.command in .crt/config.json`;
export const GEMINI_NOT_LOGGED_IN = `not logged in to Gemini — run \`${GEMINI_LOGIN}\` in a terminal and pick an auth method (or set GEMINI_API_KEY), then send again`;
export const GEMINI_TIER_REFUSED = "Gemini refused the Google login for this CLI (\"no longer supported for Gemini Code Assist for individuals\") — use a Gemini API key: put GEMINI_API_KEY=… in ~/.gemini/.env and set security.auth.selectedType to gemini-api-key in ~/.gemini/settings.json";
export const geminiTooOld = (version: string): string => `gemini ${version} is too old — CRT needs ${GEMINI_MIN_VERSION} or newer (${GEMINI_INSTALL}@latest)`;

/** The directory Gemini CLI keeps its state in (`GEMINI_CLI_HOME` overrides the home, as in 0.60.0). */
export function geminiHome(env: NodeJS.ProcessEnv = process.env): string {
  const home = env.GEMINI_CLI_HOME?.trim() ? env.GEMINI_CLI_HOME.trim() : env.HOME?.trim() || env.USERPROFILE?.trim() || homedir();
  return join(home, ".gemini");
}

/** F-58: where Gemini 0.60.0 reads Agent Skills from. */
export function geminiSkillsDirs(env: NodeJS.ProcessEnv = process.env): { project: string; user: string } {
  return { project: join(".gemini", "skills"), user: join(geminiHome(env), "skills") };
}

/**
 * The login state as far as the files Gemini reads can tell (there is no status command): an
 * API key in the environment or `~/.gemini/.env` → true; cached Google credentials → "unknown";
 * nothing → false.
 */
export function geminiLoginState(env: NodeJS.ProcessEnv = process.env): true | false | "unknown" {
  if (env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim()) return true;
  const dir = geminiHome(env);
  try {
    const dotenv = readFileSync(join(dir, ".env"), "utf8");
    if (/^\s*(?:export\s+)?(?:GEMINI_API_KEY|GOOGLE_API_KEY)\s*=\s*\S/m.test(dotenv)) return true;
  } catch {
    // no .env
  }
  return existsSync(join(dir, "oauth_creds.json")) ? "unknown" : false;
}

/** N-7: map what Gemini says at `session/new` (or on stderr) to the one line, or null. */
export function geminiLoginProblem(message: string): string | null {
  if (/no longer supported for Gemini Code Assist|IneligibleTierError|migrate to the Antigravity/i.test(message)) return GEMINI_TIER_REFUSED;
  if (/API key is missing|Authentication required|not logged in|please (?:log|sign) in|unauthori[sz]ed|401\b|invalid api key|API_KEY_INVALID/i.test(message)) return GEMINI_NOT_LOGGED_IN;
  return null;
}

/** `0.60.0` (or `gemini 0.60.0`) → `0.60.0`; null when the output is not a version. */
export function parseGeminiVersion(stdout: string): string | null {
  const m = /(?:^|\s)v?(\d+\.\d+\.\d+(?:[-+][\w.]+)?)\s*$/m.exec(stdout.trim());
  return m ? m[1]! : null;
}

/** F-42 preflight: find the executable (config → PATH → npm shim), read `--version`, then the login files. */
export async function geminiPreflight(opts: PreflightOptions = {}): Promise<PreflightResult> {
  const env = opts.env ?? process.env;
  const exe = resolveExecutable("gemini", { command: opts.command ?? null, env });
  if (!exe) return { installed: false, loggedIn: "unknown", version: null, problem: GEMINI_NOT_FOUND };
  const v = await runExecutable(exe, ["--version"], { env });
  const version = parseGeminiVersion(v.stdout);
  if (v.status !== 0 || !version) {
    const why = v.error ?? v.stderr.trim().split(/\r?\n/)[0] ?? `exit ${v.status}`;
    return { installed: true, loggedIn: "unknown", version, problem: `gemini --version failed (${why || "no output"}) — reinstall with ${GEMINI_INSTALL}` };
  }
  if (compareVersions(version, GEMINI_MIN_VERSION) < 0) return { installed: true, loggedIn: "unknown", version, problem: geminiTooOld(version) };
  const loggedIn = geminiLoginState(env);
  return { installed: true, loggedIn, version, problem: loggedIn === false ? GEMINI_NOT_LOGGED_IN : null };
}

export const geminiProfile: ProviderProfile = {
  id: "gemini",
  displayName: "Gemini",
  agentName: "Gemini CLI",
  markers: { private: [".gemini/", "GEMINI.md"], shared: ["AGENTS.md"] },
  launchEnv: ["GEMINI_CLI"],
  hints: { install: GEMINI_INSTALL, login: GEMINI_LOGIN },
  capabilities: GEMINI_CAPABILITIES,
  telemetryOptOut: [],
  skillsDirs: geminiSkillsDirs,
  preflight: geminiPreflight,
  resumeCommand: (sessionId) => `gemini --resume ${sessionId}`,
  start: (opts) =>
    startAcpSession(opts, {
      id: "gemini",
      displayName: "Gemini",
      capabilities: GEMINI_CAPABILITIES,
      resumeCommand: geminiProfile.resumeCommand,
      resolve: (o) => resolveExecutable("gemini", { command: o.command ?? null }),
      acpArgs: [...GEMINI_ACP_ARGS],
      notFound: GEMINI_NOT_FOUND,
      loginProblem: geminiLoginProblem,
    }),
};
