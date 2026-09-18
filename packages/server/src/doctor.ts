/**
 * `crt doctor` (PRD-setup F-76; PRD-embedded F-103): a read-only checklist, one row per check —
 * node, project, .crt, mode, target, integration, instructions, port, one per provider, plugin —
 * with `ok` / `FAIL` / `warn` / `--` as words (N-17), exit 1 on any `FAIL`. `FAIL` is reserved
 * for what stops `crt` from serving: Node too old, no target or target down (proxy mode only —
 * embedded mode's target is soft, F-91), port held, the *resolved* provider unusable. Every other
 * provider's problem, the plugin row and the v0.4 rows (`.crt` without a README, `integration`,
 * `instructions`) are `warn` or `--`, so a Claude-only machine and an un-initialised project pass.
 *
 * Split in two so the rows are unit rows (test/doctor.test.ts): `doctorRows(facts)` is pure over
 * `DoctorFacts`; `collectDoctorFacts` gathers them from the machine with localhost probes only
 * (N-16). The guided start reuses the same rows (minus target and plugin) before its first
 * prompt; the plugin row spawns `claude plugin list --json` and so runs only inside `crt doctor`
 * (PRD-setup §13 decision 5).
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { type CrtMode, detectIntegration, type Framework, ignoreEntriesPresent, type InstructionFile, instructionsStatus, INTEGRATION_CANDIDATES, isInitialised, README_FILE, readConfig } from "./init.js";
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
  /** null when `.crt/tasks/` does not exist (F-99: not initialised); `readme` is `.crt/README.md` (F-100). */
  crt: { readme: boolean; tasks: number; config: boolean; localConfig: boolean; ignore: boolean } | null;
  /** F-103: the mode and which config file set it (null: the embedded default, or a flag). */
  mode: { mode: CrtMode; source: "local" | "project" | null };
  /** Omitted (undefined) when not checked; null when none is set and nothing was found. */
  target?: { origin: string; source: "local" | "project" | "probe"; up: boolean } | null;
  /** F-103: proxy mode has no integration to check; embedded mode names what the F-102 candidate files carry. */
  integration: { kind: "proxy" } | { kind: "embedded"; framework: Framework; file: string | null; found: IntegrationFound | null };
  /** F-103: the existing instruction files (an import-only `CLAUDE.md` skipped) and whether each carries the markers. */
  instructions: Array<{ file: InstructionFile; hasBlock: boolean }>;
  port: { port: number; state: "free" } | { port: number; state: "crt"; health: CrtHealth; thisProject: boolean } | { port: number; state: "busy" };
  providers: ProviderStatus[];
  resolution: Resolution;
  /** This package's version. */
  version: string;
  /** Omitted (undefined) when not checked (the start path). */
  plugin?: { claudeOnPath: false } | { claudeOnPath: true; installed: string | null; error?: string };
}

/** Which CRT string a candidate file carries: an entry import, or the script tag's URL. */
export type IntegrationFound = "react" | "vite" | "loader" | "script";

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
    // F-99/F-103: nothing is created on its own any more.
    rows.push({ status: "--", name: ".crt", detail: "not initialised — run crt init" });
  } else {
    const parts = [
      ...(f.crt.readme ? ["README.md"] : []),
      `tasks/ (${f.crt.tasks} task${f.crt.tasks === 1 ? "" : "s"})`,
      f.crt.config ? "config.json" : "no config.json",
      ...(f.crt.localConfig ? ["config.local.json"] : []),
      f.crt.ignore ? ".gitignore entries" : "no .gitignore entries",
    ];
    // F-103: a folder that predates v0.4 has no README — a warn, never a FAIL.
    rows.push(f.crt.readme ? { status: "ok", name: ".crt", detail: parts.join(", ") } : { status: "warn", name: ".crt", detail: `${parts.join(", ")} — no README.md — run crt init` });
  }
  const embedded = f.mode.mode === "embedded";
  rows.push({ status: "ok", name: "mode", detail: `${f.mode.mode}${f.mode.source ? ` (.crt/${f.mode.source === "local" ? "config.local.json" : "config.json"})` : ""}` });
  if (f.target !== undefined) {
    if (f.target === null) {
      // F-103: in embedded mode the target is only what `crt` opens (F-91) — never a FAIL.
      rows.push(embedded ? { status: "--", name: "target", detail: "none set; crt opens nothing (crt <port> to remember one)" } : { status: "FAIL", name: "target", detail: "none set and nothing on the probed ports — crt <port>" });
    } else {
      const label = f.target.source === "local" ? "(remembered)" : f.target.source === "project" ? "(.crt/config.json)" : "(found)";
      rows.push(
        f.target.up
          ? { status: "ok", name: "target", detail: `${f.target.origin} ${label} — responding` }
          : { status: embedded ? "warn" : "FAIL", name: "target", detail: `${f.target.origin} ${label} — not responding` },
      );
    }
  }
  rows.push(integrationRow(f.integration));
  rows.push(instructionsRow(f.instructions));
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

/** F-103 `integration`: what the F-102 candidate files of the detected framework carry; `--` in proxy mode and for a static page. */
function integrationRow(i: DoctorFacts["integration"]): DoctorRow {
  if (i.kind === "proxy") return { status: "--", name: "integration", detail: "proxy mode" };
  if (i.framework === "static") return { status: "--", name: "integration", detail: "static page — add the <script> tag (crt init --snippet)" };
  if (i.found === null || i.file === null) return { status: "warn", name: "integration", detail: `not found (${i.framework}) — run crt init for the snippet, or crt proxy` };
  const label = i.framework === "next" ? "next" : i.framework === "vite" ? "vite" : "loader";
  const what = i.found === "script" ? "loads /__crt/loader.js" : i.found === "vite" ? "uses claude-review-tool/vite" : `imports claude-review-tool/${i.found}`;
  return { status: "ok", name: "integration", detail: `${label} — ${i.file} ${what}` };
}

/** F-103 `instructions`: every existing instruction file carries the markers, or which ones do not. */
function instructionsRow(files: DoctorFacts["instructions"]): DoctorRow {
  if (!files.length) return { status: "--", name: "instructions", detail: "no CLAUDE.md or AGENTS.md — crt init creates one" };
  const lacking = files.filter((f) => !f.hasBlock).map((f) => f.file);
  if (!lacking.length) return { status: "ok", name: "instructions", detail: `${files.map((f) => f.file).join(" and ")} ${files.length === 1 ? "carries" : "carry"} the CRT section` };
  return { status: "warn", name: "instructions", detail: `${lacking.join(" and ")} ${lacking.length === 1 ? "has" : "have"} no CRT section — crt init adds it` };
}

/** `Claude Code (Agent SDK)` + `0.3.270` → `Claude Code (Agent SDK 0.3.270)`; `Codex CLI` + `0.154.0` → `Codex CLI 0.154.0`. */
function withVersion(agentName: string, version: string | null): string {
  if (!version) return agentName;
  return agentName.endsWith(")") ? `${agentName.slice(0, -1)} ${version})` : `${agentName} ${version}`;
}

/** The F-76 layout: `ok    node      v22.4.0 (needs 20 or newer)`. */
export function renderRow(r: DoctorRow): string {
  // The v0.4 names `integration` and `instructions` (F-103) outgrow the 10-column name field: one space, not a wider table.
  const name = r.name.length < 10 ? r.name.padEnd(10) : `${r.name} `;
  return `${r.status.padEnd(6)}${name}${r.detail}`;
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
  /** The resolved mode (the start path's `crt proxy` / `--mode`); `crt doctor` reads the config files. */
  mode?: CrtMode;
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

  const mode = opts.mode ?? config.mode;
  const facts: DoctorFacts = {
    node: process.version,
    project: { root, git: existsSync(join(root, ".git")) },
    crt: isInitialised(root)
      ? {
          readme: existsSync(join(crtDir, README_FILE)),
          tasks: countTaskFiles(tasksDir),
          config: existsSync(join(crtDir, "config.json")),
          localConfig: existsSync(join(crtDir, "config.local.json")),
          ignore: ignoreEntriesPresent(root),
        }
      : null,
    mode: { mode, source: opts.mode !== undefined && opts.mode !== config.mode ? null : config.modeSource },
    integration: mode === "proxy" ? { kind: "proxy" } : integrationFact(root),
    instructions: instructionsStatus(root),
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

/** F-103: read only the F-102 candidate files of the detected framework, looking for an entry import or the loader URL. */
export function integrationFact(root: string): Extract<DoctorFacts["integration"], { kind: "embedded" }> {
  const { framework, file } = detectIntegration(root);
  for (const candidate of INTEGRATION_CANDIDATES[framework]) {
    let text: string;
    try {
      text = readFileSync(join(root, ...candidate.split("/")), "utf8");
    } catch {
      continue;
    }
    const found: IntegrationFound | null = text.includes("claude-review-tool/react")
      ? "react"
      : text.includes("claude-review-tool/vite")
        ? "vite"
        : text.includes("claude-review-tool/loader")
          ? "loader"
          : text.includes("/__crt/loader.js")
            ? "script"
            : null;
    if (found) return { kind: "embedded", framework, file: candidate, found };
  }
  return { kind: "embedded", framework, file, found: null };
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
