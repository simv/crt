/**
 * `crt doctor` (PRD-setup F-76): a read-only checklist, one row per check — node, project, .crt,
 * target, port, one per provider, plugin — with `ok` / `FAIL` / `warn` / `--` as words (N-17),
 * exit 1 on any `FAIL`. `FAIL` is reserved for what stops `crt` from serving: Node too old, no
 * target or target down, port held, the *resolved* provider unusable. Every other provider's
 * problem and the plugin row are `warn`, so a Claude-only machine passes.
 *
 * Split in two so the rows are unit rows (test/doctor.test.ts): `doctorRows(facts)` is pure over
 * `DoctorFacts`; `collectDoctorFacts` gathers them from the machine with localhost probes only
 * (N-16). The guided start reuses the same rows (minus target and plugin) before its first
 * prompt; the plugin row spawns `claude plugin list --json` and so runs only inside `crt doctor`
 * (PRD-setup §13 decision 5).
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ignoreEntriesPresent, readConfig } from "./init.js";
import { fetchHealth, isPortFree } from "./probes.js";
import { findProjectRoot } from "./project.js";
import { findOnPath, runExecutable } from "./providers/exec.js";
import { preflightPasses } from "./providers/types.js";
import { describeResolution, loginWord, ProviderRegistry, type ProviderStatus, type Resolution } from "./session.js";
import { type CrtHealth, sameProject } from "./start.js";
import { countTaskFiles } from "./tasks.js";
import { isReachable, normalizeTarget, probeAll } from "./target.js";

export const MIN_NODE_MAJOR = 20;

export type DoctorStatus = "ok" | "FAIL" | "warn" | "--";

export interface DoctorRow {
  status: DoctorStatus;
  name: string;
  detail: string;
}

export interface DoctorFacts {
  /** `process.version`, e.g. `v22.4.0`. */
  node: string;
  project: { root: string; git: boolean };
  /** null when `.crt/` does not exist. */
  crt: { tasks: number | null; config: boolean; localConfig: boolean; ignore: boolean } | null;
  /** Omitted (undefined) when not checked; null when none is set and nothing was found. */
  target?: { origin: string; source: "local" | "project" | "probe"; up: boolean } | null;
  port: { port: number; state: "free" } | { port: number; state: "crt"; health: CrtHealth; thisProject: boolean } | { port: number; state: "busy" };
  providers: ProviderStatus[];
  resolution: Resolution;
  /** This package's version. */
  version: string;
  /** Omitted (undefined) when not checked (the start path). */
  plugin?: { claudeOnPath: false } | { claudeOnPath: true; installed: string | null; error?: string };
}

export interface DoctorReport {
  rows: DoctorRow[];
  /** `→ claude — codex not logged in`, as `crt providers` ends. */
  decision: string;
  exitCode: 0 | 1;
}

export function doctorRows(f: DoctorFacts): DoctorReport {
  const rows: DoctorRow[] = [];
  const major = Number(/^v?(\d+)/.exec(f.node)?.[1] ?? 0);
  rows.push(
    major >= MIN_NODE_MAJOR
      ? { status: "ok", name: "node", detail: `${f.node} (needs ${MIN_NODE_MAJOR} or newer)` }
      : { status: "FAIL", name: "node", detail: `${f.node} — CRT needs Node ${MIN_NODE_MAJOR} or newer` },
  );
  rows.push(
    f.project.git
      ? { status: "ok", name: "project", detail: `${f.project.root} (.git)` }
      : { status: "warn", name: "project", detail: `${f.project.root} — no .git above; .crt/ will be created here (run from the repo root, or git init)` },
  );
  if (f.crt === null) {
    rows.push({ status: "--", name: ".crt", detail: "not initialised — crt creates it" });
  } else {
    const parts = [
      f.crt.tasks === null ? "no tasks/" : `tasks/ (${f.crt.tasks} task${f.crt.tasks === 1 ? "" : "s"})`,
      f.crt.config ? "config.json" : "no config.json",
      ...(f.crt.localConfig ? ["config.local.json"] : []),
      f.crt.ignore ? ".gitignore entries" : "no .gitignore entries",
    ];
    rows.push({ status: "ok", name: ".crt", detail: parts.join(", ") });
  }
  if (f.target !== undefined) {
    if (f.target === null) rows.push({ status: "FAIL", name: "target", detail: "none set and nothing on the probed ports — crt <port>" });
    else {
      const label = f.target.source === "local" ? "(remembered)" : f.target.source === "project" ? "(.crt/config.json)" : "(found)";
      rows.push(
        f.target.up
          ? { status: "ok", name: "target", detail: `${f.target.origin} ${label} — responding` }
          : { status: "FAIL", name: "target", detail: `${f.target.origin} ${label} — not responding` },
      );
    }
  }
  const p = f.port;
  if (p.state === "free") rows.push({ status: "ok", name: "port", detail: `${p.port} free` });
  else if (p.state === "crt") {
    const where = p.thisProject ? "this project" : `project ${p.health.projectRoot}`;
    const fix = p.thisProject ? "crt --replace" : `crt starts on ${p.port + 1}, or crt --replace`;
    rows.push({ status: "FAIL", name: "port", detail: `${p.port} held by CRT ${p.health.version ?? "(unknown version)"} → ${p.health.target ?? "no app"} (${where}) — ${fix}` });
  } else rows.push({ status: "FAIL", name: "port", detail: `${p.port} in use by a non-CRT process — crt --port ${p.port + 1}` });

  for (const r of f.providers) {
    const usable = preflightPasses({ installed: r.installed, loggedIn: r.loggedIn, version: r.version, problem: r.problem });
    const name = withVersion(r.agentName, r.version);
    const detail =
      r.state === "ready"
        ? `${name} — ${loginWord(r.loggedIn)}`
        : r.state === "not logged in"
          ? `${name} — not logged in — ${r.hints.login}`
          : `${name} — ${r.problem ?? r.state}`;
    rows.push({ status: usable ? "ok" : r.id === f.resolution.provider ? "FAIL" : "warn", name: r.id, detail });
  }

  if (f.plugin !== undefined) {
    if (!f.plugin.claudeOnPath) rows.push({ status: "--", name: "plugin", detail: "claude not on PATH — skipped" });
    else if (f.plugin.error !== undefined) rows.push({ status: "warn", name: "plugin", detail: `could not read \`claude plugin list --json\` (${f.plugin.error}) — run crt setup` });
    else if (f.plugin.installed === null) rows.push({ status: "warn", name: "plugin", detail: "crt@crt not installed — run crt setup" });
    else if (f.plugin.installed === f.version) rows.push({ status: "ok", name: "plugin", detail: `crt@crt ${f.version} installed (claude on PATH)` });
    else rows.push({ status: "warn", name: "plugin", detail: `crt@crt ${f.plugin.installed} installed, this is ${f.version} — run crt setup` });
  }

  return { rows, decision: `→ ${describeResolution(f.resolution)}`, exitCode: rows.some((r) => r.status === "FAIL") ? 1 : 0 };
}

/** `Claude Code (Agent SDK)` + `0.3.270` → `Claude Code (Agent SDK 0.3.270)`; `Codex CLI` + `0.154.0` → `Codex CLI 0.154.0`. */
function withVersion(agentName: string, version: string | null): string {
  if (!version) return agentName;
  return agentName.endsWith(")") ? `${agentName.slice(0, -1)} ${version})` : `${agentName} ${version}`;
}

/** The F-76 layout: `ok    node      v22.4.0 (needs 20 or newer)`. */
export function renderRow(r: DoctorRow): string {
  return `${r.status.padEnd(6)}${r.name.padEnd(10)}${r.detail}`;
}

export function renderDoctor(report: DoctorReport): string {
  return [...report.rows.map(renderRow), report.decision].join("\n");
}

export interface CollectOptions {
  cwd?: string;
  version: string;
  /** Probe the target (config, then the well-known ports)? The start path skips it. */
  target: boolean;
  /** Spawn `claude plugin list --json`? Only `crt doctor` does. */
  plugin: boolean;
  /** An already-refreshed registry (the start path's); otherwise one is built and refreshed here. */
  providers?: ProviderRegistry;
  env?: NodeJS.ProcessEnv;
}

export async function collectDoctorFacts(opts: CollectOptions): Promise<DoctorFacts> {
  const env = opts.env ?? process.env;
  const root = findProjectRoot(opts.cwd ?? process.cwd());
  const config = readConfig(root);
  const crtDir = join(root, ".crt");
  const tasksDir = resolve(root, config.tasksDir);
  const providers = opts.providers ?? new ProviderRegistry({ root, config, env });
  if (!opts.providers) await providers.refresh();

  const facts: DoctorFacts = {
    node: process.version,
    project: { root, git: existsSync(join(root, ".git")) },
    crt: existsSync(crtDir)
      ? {
          tasks: existsSync(tasksDir) ? countTaskFiles(tasksDir) : null,
          config: existsSync(join(crtDir, "config.json")),
          localConfig: existsSync(join(crtDir, "config.local.json")),
          ignore: ignoreEntriesPresent(root),
        }
      : null,
    port: await portFact(config.port, root),
    providers: providers.status(),
    resolution: providers.resolve(null),
    version: opts.version,
  };
  if (opts.target) {
    if (config.target && config.targetSource) {
      let origin = config.target;
      try {
        origin = normalizeTarget(config.target);
      } catch {
        // an unparseable value: probe it as written, which fails, so the row says "not responding"
      }
      facts.target = { origin, source: config.targetSource, up: await isReachable(origin) };
    } else {
      const hits = await probeAll();
      facts.target = hits.length ? { origin: hits[0]!.origin, source: "probe", up: true } : null;
    }
  }
  if (opts.plugin) facts.plugin = await pluginFact(env);
  return facts;
}

async function portFact(port: number, root: string): Promise<DoctorFacts["port"]> {
  if (await isPortFree(port)) return { port, state: "free" };
  const health = await fetchHealth(port);
  if (!health) return { port, state: "busy" };
  return { port, state: "crt", health, thisProject: sameProject(health.projectRoot, root) };
}

/** F-76 plugin row: `claude plugin list --json` (observed shape: `[{ id: "crt@crt", version, … }]`), parsed defensively (§12 rule 2). */
async function pluginFact(env: NodeJS.ProcessEnv): Promise<NonNullable<DoctorFacts["plugin"]>> {
  const claude = findOnPath("claude", process.platform, env);
  if (!claude) return { claudeOnPath: false };
  const r = await runExecutable(claude, ["plugin", "list", "--json"], { env, timeoutMs: 10_000 });
  if (r.status !== 0) return { claudeOnPath: true, installed: null, error: r.error ?? r.stderr.trim().split(/\r?\n/)[0] ?? `exit ${r.status}` };
  return { claudeOnPath: true, installed: installedPluginVersion(r.stdout) };
}

/** The `crt@crt` entry's version in `claude plugin list --json` output, or null (absent, or not parseable). */
export function installedPluginVersion(stdout: string): string | null {
  try {
    const parsed = JSON.parse(stdout) as unknown;
    const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" && Array.isArray((parsed as { plugins?: unknown }).plugins) ? (parsed as { plugins: unknown[] }).plugins : [];
    for (const item of list) {
      if (item && typeof item === "object" && (item as { id?: unknown }).id === "crt@crt") {
        const v = (item as { version?: unknown }).version;
        return typeof v === "string" ? v : "?";
      }
    }
  } catch {
    // not JSON
  }
  return null;
}

/** Everything `crt doctor` prints, and its exit code. */
export async function runDoctor(opts: { cwd?: string; version: string; env?: NodeJS.ProcessEnv }): Promise<{ text: string; exitCode: 0 | 1 }> {
  const report = doctorRows(await collectDoctorFacts({ ...opts, target: true, plugin: true }));
  return { text: renderDoctor(report), exitCode: report.exitCode };
}

/** Whether a `package.json` in `root` has `scripts.dev` (the F-71 hint). */
export function hasDevScript(root: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { scripts?: Record<string, unknown> };
    return typeof pkg.scripts?.dev === "string";
  } catch {
    return false;
  }
}
