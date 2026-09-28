/**
 * Version parsing and the preflight skeleton the CLI providers share (PRD-providers F-42, F-53,
 * F-111, N-7): resolve the executable (config → PATH → npm shim), read `--version`, compare it with
 * the minimum, then the provider's own login check. The N-7 wording stays in each profile and is
 * passed in; nothing here names an agent. Commands run through `exec.ts` only.
 */
import { type Executable, resolveExecutable, runExecutable } from "./exec.js";
import type { PreflightOptions, PreflightResult } from "./types.js";

/** `0.60.0`, `gemini 0.60.0` or `v1.2.7` → the version; null when the output does not end in one. */
export function parseBareVersion(stdout: string): string | null {
  const m = /(?:^|\s)v?(\d+\.\d+\.\d+(?:[-+][\w.]+)?)\s*$/m.exec(stdout.trim());
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

/** What a login check reports once the version passed. */
export type LoginCheck = Pick<PreflightResult, "loggedIn" | "problem">;

/** One provider's preflight: its executable, its minimum version and its N-7 lines. */
export interface CliPreflightSpec {
  /** The executable looked up on PATH (`codex`, `gemini`, `agy`), named in the `--version` failure. */
  name: string;
  minVersion: string;
  /** Reads the version from `--version` stdout; `parseBareVersion` when absent. */
  parseVersion?: (stdout: string) => string | null;
  notFound: string;
  tooOld: (version: string) => string;
  /** The fix after the dash when `--version` fails: `reinstall with npm i -g …`. */
  fix: string;
  /** Absent when login cannot be told offline: `"unknown"`, which passes (§12 rule 3). */
  login?: (exe: Executable, env: NodeJS.ProcessEnv | undefined) => Promise<LoginCheck>;
}

/** The F-42 preflight of a CLI provider; each command it runs times out at 15 s. */
export async function cliPreflight(spec: CliPreflightSpec, opts: PreflightOptions = {}): Promise<PreflightResult> {
  const env = opts.env;
  const exe = resolveExecutable(spec.name, { command: opts.command ?? null, ...(env ? { env } : {}) });
  if (!exe) return { installed: false, loggedIn: "unknown", version: null, problem: spec.notFound };
  const v = await runExecutable(exe, ["--version"], env ? { env } : {});
  const version = (spec.parseVersion ?? parseBareVersion)(v.stdout);
  if (v.status !== 0 || !version) {
    const why = v.error ?? v.stderr.trim().split(/\r?\n/)[0] ?? `exit ${v.status}`;
    return { installed: true, loggedIn: "unknown", version, problem: `${spec.name} --version failed (${why || "no output"}) — ${spec.fix}` };
  }
  if (compareVersions(version, spec.minVersion) < 0) return { installed: true, loggedIn: "unknown", version, problem: spec.tooOld(version) };
  const login: LoginCheck = spec.login ? await spec.login(exe, env) : { loggedIn: "unknown", problem: null };
  return { installed: true, loggedIn: login.loggedIn, version, problem: login.problem };
}
