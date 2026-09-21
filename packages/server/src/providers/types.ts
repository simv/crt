/**
 * Provider profile (PRD-providers F-42). One object per coding agent CRT can open an intake
 * session on. `session.ts` is the registry of these: it resolves which profile a session uses
 * (F-43), auto-detects one from the machine and the project (F-44), and renders `crt providers`
 * (F-45). Everything provider-specific — markers, preflight, one-line problems (N-7), the driver —
 * lives in the profile's own module under `providers/`; nothing else in the server knows an agent
 * by name.
 */
import type { ProviderCapabilities, SessionDriver, StartSessionOptions } from "../session-events.js";

export type { ProviderCapabilities };

/** `true`/`false` when the agent reports it; `"unknown"` counts as passing (F-43, F-44, §12 rule 3). */
export type LoggedIn = true | false | "unknown";

/** Result of `ProviderProfile.preflight()`: is this agent usable on this machine right now? */
export interface PreflightResult {
  /** The agent's executable (or, for Claude, the SDK's bundled binary) was found. */
  installed: boolean;
  loggedIn: LoggedIn;
  /** Version string as the agent reports it, or null when unknown. */
  version: string | null;
  /** The one actionable N-7 line when the agent cannot be used; null when preflight passes. */
  problem: string | null;
}

/** What a preflight run may consult; tests stub these instead of the machine. */
export interface PreflightOptions {
  /** `providers.<id>.command` from `.crt/config.json`: an explicit executable plus leading args. */
  command?: string[] | null;
  env?: NodeJS.ProcessEnv;
}

/**
 * F-44 project markers. Each name is looked up in the project root only: a trailing `/` means a
 * directory, otherwise a file. `private` markers belong to this agent (worth 2 each); `shared`
 * ones are read by several agents (`AGENTS.md`; see F-44 step 3 for its weighting).
 */
export interface ProviderMarkers {
  private: string[];
  shared: string[];
}

export interface ProviderProfile {
  /** Built-in id: `claude`, `codex`, `gemini`, `stub`; `acp` is the ad-hoc ACP agent from the config files (F-54). */
  id: string;
  /** The noun the overlay uses for the agent ("Send to Codex", "Claude has a question"; F-56). */
  displayName: string;
  /** The product line `crt providers` prints ("Claude Code (Agent SDK)", "Codex CLI"; F-45). */
  agentName: string;
  markers: ProviderMarkers;
  /** Environment variables that mean "CRT was started from inside this agent" (F-44 step 1). */
  launchEnv: string[];
  /** One-line hints for the F-45 table and the N-7 problems. */
  hints: {
    /** How to install the agent, e.g. `npm i -g @openai/codex`. */
    install: string;
    /** How to log in, e.g. `codex login`. */
    login: string;
  };
  capabilities: ProviderCapabilities;
  /** Per-invocation flags that switch the agent's own telemetry off (N-12); may be empty. */
  telemetryOptOut: string[];
  /**
   * F-58: where `crt skills install` puts Agent Skills for this agent, as recorded for the tested
   * version: `project` is relative to the project root, `user` absolute (it may depend on the
   * environment, e.g. `$CODEX_HOME`). Null means "no known directory — `--dir` is required"
   * (§12 rule 4); Claude has none because the plugin is its distribution.
   */
  skillsDirs(env?: NodeJS.ProcessEnv): { project: string | null; user: string | null };
  preflight(opts?: PreflightOptions): Promise<PreflightResult>;
  /** Terminal command that continues the session, or null when the agent has none (F-46). */
  resumeCommand(nativeSessionId: string): string | null;
  start(opts: StartSessionOptions): SessionDriver;
}

/** F-43/F-44: preflight passes when the agent is installed, not known to be logged out, and has no other problem. */
export function preflightPasses(p: PreflightResult): boolean {
  return p.installed && p.loggedIn !== false && p.problem === null;
}

/** The F-45 state column. */
export type ProviderState = "ready" | "not on PATH" | "not logged in" | "too old" | "unknown";

export function preflightState(p: PreflightResult): ProviderState {
  if (!p.installed) return "not on PATH";
  if (p.loggedIn === false) return "not logged in";
  if (p.problem === null) return "ready";
  return /too old/i.test(p.problem) ? "too old" : "unknown";
}
