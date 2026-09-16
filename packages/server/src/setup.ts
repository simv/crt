/**
 * `crt setup` (PRD-setup F-86): idempotent registration of the plugin bundled in this package
 * (`dist/plugin-marketplace/`, built per F-85) with Claude Code, so a machine with only the npm
 * package gets /crt:serve, /crt:next, /crt:tasks, /crt:task, /crt:done and /crt:intake without
 * reaching GitHub. Everything here is a spawn of the developer's `claude` CLI with `shell: false`
 * (N-10): `plugin list --json`, then `plugin marketplace add <dir>` and `plugin install crt@crt`
 * (or `plugin update crt@crt` when an older version is present). CRT writes nothing itself; the
 * writes are Claude Code's own to its plugin store (PRD §9 N-5, third documented exception).
 *
 * `claude` is resolved from PATH the way `codex` is (PATH/PATHEXT, npm shim parsing — exec.ts) or
 * from `--claude <path>`; never from `providers.claude.command`, whose F-53 meaning ("the agent to
 * run sessions on") does not apply to Claude (§13 decision 5). Observed on claude 2.1.270
 * (2026-09-16): `plugin list --json` prints `[{ id: "crt@crt", version, scope, … }]`;
 * `marketplace add <path>` accepts a local directory holding `.claude-plugin/marketplace.json` and
 * re-adding the same name answers "already on disk" (exit 0); `install` / `update` take
 * `<plugin>@<marketplace>` and are idempotent ("already installed" / "already at the latest
 * version", exit 0). §12 rules 2–3 apply if a later CLI differs.
 */
import { CrtError } from "./errors.js";
import { installedPluginVersion } from "./doctor.js";
import { type Executable, findOnPath, resolveExecutable, runExecutable } from "./providers/exec.js";

/** The marketplace and plugin ids, as `claude plugin install crt@crt` names them (F-85). */
export const PLUGIN_ID = "crt@crt";
/** The GitHub form of the same two commands, for the "claude not found" line. */
export const MANUAL_INSTALL = "claude plugin marketplace add simv/crt && claude plugin install crt@crt";
/** The six skills the plugin loads, in the F-86 line's order. */
export const SKILL_NAMES = ["/crt:serve", "/crt:next", "/crt:tasks", "/crt:task", "/crt:done", "/crt:intake"] as const;

export const CLAUDE_NOT_FOUND = `claude not found on PATH — install Claude Code (npm i -g @anthropic-ai/claude-code), or run: ${MANUAL_INSTALL}`;

/** A generous ceiling: `marketplace add` copies the plugin and `install` may write a lockfile; neither touches the network for a local path. */
const CLAUDE_TIMEOUT_MS = 60_000;

export interface SetupOptions {
  /** This package's version — what the bundled plugin carries (F-87). */
  version: string;
  /** `dist/plugin-marketplace` (F-85), as `marketplace add` receives it. */
  marketplaceDir: string;
  /** `--claude <path>`: the executable (or npm shim) to run instead of the one on PATH. */
  claude?: string | null;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

export interface SetupResult {
  /** `already` when nothing had to change; `installed` / `updated` after the two commands ran. */
  action: "already" | "installed" | "updated";
  /** The lines `crt setup` prints on stdout, in order. */
  lines: string[];
}

/** Run the F-86 sequence. Throws `CrtError` (exit 1) with the one-line reason when `claude` is missing or a subcommand fails. */
export async function runSetup(opts: SetupOptions): Promise<SetupResult> {
  const env = opts.env ?? process.env;
  const claude = resolveClaude(opts.claude, env);
  if (!claude) throw new CrtError(opts.claude ? `claude not found at ${opts.claude} — ${CLAUDE_NOT_FOUND.slice("claude not found on PATH — ".length)}` : CLAUDE_NOT_FOUND);
  const run = (args: string[]) => runExecutable(claude, args, { env, cwd: opts.cwd, timeoutMs: CLAUDE_TIMEOUT_MS });

  // `plugin list --json` is read defensively (§12 rule 2): a failure or an unexpected shape means
  // "not installed as far as we can tell" and the registration proceeds; only the writes are fatal.
  const listed = await run(["plugin", "list", "--json"]);
  const installed = listed.status === 0 ? installedPluginVersion(listed.stdout) : null;
  if (installed === opts.version) return { action: "already", lines: [`crt setup: ${PLUGIN_ID} ${opts.version} is already installed`] };

  const lines: string[] = [];
  await must(run(["plugin", "marketplace", "add", opts.marketplaceDir]), `claude plugin marketplace add ${opts.marketplaceDir}`);
  lines.push(`crt setup: registered marketplace crt from ${opts.marketplaceDir}`);
  const verb = installed === null ? "install" : "update";
  await must(run(["plugin", verb, PLUGIN_ID]), `claude plugin ${verb} ${PLUGIN_ID}`);
  lines.push(`crt setup: ${verb === "install" ? "installed" : "updated"} ${PLUGIN_ID} ${opts.version} — restart Claude Code to load ${SKILL_NAMES.join(", ")}`);
  return { action: verb === "install" ? "installed" : "updated", lines };
}

/** F-86: a failing `claude` command becomes one `crt:` line quoting its first stderr line. */
async function must(result: ReturnType<typeof runExecutable>, command: string): Promise<void> {
  const r = await result;
  if (r.status === 0) return;
  const reason = r.error ?? firstLine(r.stderr) ?? firstLine(r.stdout) ?? `exit ${r.status}`;
  throw new CrtError(`\`${command}\` failed: ${reason} — fix that, or run: ${MANUAL_INSTALL}`);
}

function firstLine(text: string): string | null {
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(Boolean);
  return line ?? null;
}

/** Which `claude` `crt setup` runs: `--claude <path>` (a binary or an npm shim) or the one on PATH; null when neither exists. */
export function resolveClaude(claude: string | null | undefined, env: NodeJS.ProcessEnv = process.env): Executable | null {
  return claude ? resolveExecutable("claude", { command: [claude], env }) : findOnPath("claude", process.platform, env);
}
