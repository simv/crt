/**
 * `crt init` (PRD F-35, amended by PRD-providers F-43): make a project CRT-ready, idempotently.
 * Creates `.crt/tasks/`, writes `.crt/config.json` if absent, and adds `.crt/captures/` and
 * `.crt/config.local.json` to `.gitignore` (creating it if needed). `crt serve` runs this first.
 * The `.gitignore` lines are the only write outside `.crt/` the server ever makes (N-5).
 *
 * Config is two files, read by `readConfig`: `.crt/config.json` (committed, per project) with
 * `.crt/config.local.json` (gitignored, per machine — what "Remember for this project on this
 * machine" writes, F-56/F-57, and where the guided start remembers the target, PRD-setup F-72)
 * layered over it key by key: `target` and `port` local-over-project too (PRD-setup §5.3).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { CrtError } from "./errors.js";

export const DEFAULT_PORT = 4400;

/** PRD-embedded F-91/F-92: what the CRT server does with requests outside `/__crt/`. */
export type CrtMode = "embedded" | "proxy";
export const MODES: readonly CrtMode[] = ["embedded", "proxy"];

export function isMode(v: unknown): v is CrtMode {
  return typeof v === "string" && (MODES as readonly string[]).includes(v);
}

/**
 * PRD-embedded F-91/F-92: the mode a start runs in. `crt proxy` is `--mode proxy`; an explicit
 * `--mode` outranks the config files; otherwise `readConfig`'s `mode` (local over project,
 * default embedded).
 */
export function resolveMode(input: { command: "serve" | "proxy"; flag?: string | boolean | undefined; config: Pick<CrtConfig, "mode"> }): CrtMode {
  const flag = input.flag;
  if (flag !== undefined) {
    if (!isMode(flag)) throw new CrtError(`--mode must be embedded or proxy (got "${String(flag)}")`);
    if (input.command === "proxy" && flag !== "proxy") throw new CrtError("`crt proxy` already means --mode proxy — drop --mode " + flag);
    return flag;
  }
  return input.command === "proxy" ? "proxy" : input.config.mode;
}
export const CAPTURES_IGNORE = ".crt/captures/";
export const LOCAL_CONFIG_IGNORE = ".crt/config.local.json";
export const CONFIG_FILE = "config.json";
export const LOCAL_CONFIG_FILE = "config.local.json";

/** F-54 ad-hoc ACP agent, accepted from the config files only (N-8); the driver arrives with M10. */
export interface AcpProviderConfig {
  kind: "acp";
  command: string;
  args: string[];
  name: string;
}

/** What `.crt/config.json` may contain; every key is optional on disk. */
export interface CrtConfigFile {
  /** `embedded` (the default, F-91) or `proxy` (F-92); the local file wins, `--mode` outranks both. */
  mode?: CrtMode;
  tasksDir?: string;
  target?: string | null;
  port?: number;
  /** A built-in provider id, or the ACP object (F-43 steps 3–4, F-54). */
  provider?: string | AcpProviderConfig | null;
  /** Per-provider model override, e.g. `{ "claude": "claude-sonnet-5" }` (F-57). */
  models?: Record<string, string>;
  /** `providers.<id>.command`: the executable (plus leading args) to run for that agent (F-53). */
  providers?: Record<string, { command?: string[] }>;
}

/** The merged, validated configuration the server runs with. */
export interface CrtConfig {
  mode: CrtMode;
  /** Which file `mode` came from (the local file wins); null when neither sets it (embedded). */
  modeSource: "local" | "project" | null;
  tasksDir: string;
  target: string | null;
  /** Which file `target` came from (the local file wins); null when neither sets it. */
  targetSource: "local" | "project" | null;
  port: number;
  provider: string | AcpProviderConfig | null;
  /** Which file `provider` came from (the local file wins); null when neither sets it. */
  providerSource: "local" | "project" | null;
  models: Record<string, string>;
  providers: Record<string, { command: string[] }>;
}

/** What `crt init` writes; provider keys are added by the developer or by "Remember" (local file). */
export const DEFAULT_CONFIG_FILE: CrtConfigFile = { mode: "embedded", tasksDir: ".crt/tasks", target: null, port: DEFAULT_PORT };

export const DEFAULT_CONFIG: CrtConfig = {
  mode: "embedded",
  modeSource: null,
  tasksDir: ".crt/tasks",
  target: null,
  targetSource: null,
  port: DEFAULT_PORT,
  provider: null,
  providerSource: null,
  models: {},
  providers: {},
};

export interface InitResult {
  crtDir: string;
  tasksDir: string;
  configPath: string;
  /** Paths this run created or modified; empty when everything was already in place. */
  created: string[];
  /** The `.gitignore` lines this run added (PRD-setup F-75 names them). */
  ignoreAdded: string[];
}

export function initProject(root: string): InitResult {
  const crtDir = join(root, ".crt");
  const tasksDir = join(crtDir, "tasks");
  const configPath = join(crtDir, CONFIG_FILE);
  const gitignorePath = join(root, ".gitignore");
  const created: string[] = [];
  const ignoreAdded: string[] = [];

  if (!existsSync(tasksDir)) {
    mkdirSync(tasksDir, { recursive: true });
    created.push(tasksDir);
  }
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG_FILE, null, 2) + "\n", "utf8");
    created.push(configPath);
  }
  let ignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  const lines = ignore.split(/\r?\n/);
  const wanted: Array<[string, (line: string) => boolean]> = [
    [CAPTURES_IGNORE, isCapturesIgnore],
    [LOCAL_CONFIG_IGNORE, isLocalConfigIgnore],
  ];
  let changed = false;
  for (const [line, present] of wanted) {
    if (lines.some(present)) continue;
    const sep = ignore === "" || ignore.endsWith("\n") ? "" : "\n";
    ignore = `${ignore}${sep}${line}\n`;
    ignoreAdded.push(line);
    changed = true;
  }
  if (changed) {
    writeFileSync(gitignorePath, ignore, "utf8");
    created.push(gitignorePath);
  }
  return { crtDir, tasksDir, configPath, created, ignoreAdded };
}

/**
 * PRD-setup F-75: the first-init line, or null when nothing was created:
 * `crt init: created .crt/tasks, .crt/config.json; added .crt/captures/ and .crt/config.local.json to .gitignore — commit .crt/`
 */
export function describeInit(root: string, r: InitResult): string | null {
  if (!r.created.length) return null;
  const made = r.created.filter((p) => p !== join(root, ".gitignore")).map((p) => relative(root, p).split(sep).join("/"));
  const parts: string[] = [];
  if (made.length) parts.push(`created ${made.join(", ")}`);
  if (r.ignoreAdded.length) parts.push(`added ${r.ignoreAdded.join(" and ")} to .gitignore`);
  return `crt init: ${parts.join("; ")} — commit .crt/`;
}

/** `crt doctor` (PRD-setup F-76): are both `.gitignore` entries (or a whole-`.crt/` ignore) present? */
export function ignoreEntriesPresent(root: string): boolean {
  let lines: string[];
  try {
    lines = readFileSync(join(root, ".gitignore"), "utf8").split(/\r?\n/);
  } catch {
    return false;
  }
  return lines.some(isCapturesIgnore) && lines.some(isLocalConfigIgnore);
}

function ignoresWholeCrt(t: string): boolean {
  return t === ".crt/" || t === ".crt";
}

function isCapturesIgnore(line: string): boolean {
  const t = line.trim().replace(/^\//, "");
  return t === ".crt/captures/" || t === ".crt/captures" || ignoresWholeCrt(t);
}

function isLocalConfigIgnore(line: string): boolean {
  const t = line.trim().replace(/^\//, "");
  return t === LOCAL_CONFIG_IGNORE || t === ".crt/*.local.json" || ignoresWholeCrt(t);
}

/**
 * Read `.crt/config.json` with `.crt/config.local.json` layered over it (F-43), tolerating absence
 * or malformed content (defaults win, junk values are ignored). `provider` may be the ACP object
 * only here — never from a route (N-8).
 */
export function readConfig(root: string): CrtConfig {
  const project = readConfigFile(join(root, ".crt", CONFIG_FILE));
  const local = readConfigFile(join(root, ".crt", LOCAL_CONFIG_FILE));
  const providerOf = (f: CrtConfigFile): string | AcpProviderConfig | null => {
    if (typeof f.provider === "string" && f.provider.trim()) return f.provider.trim();
    if (isAcpProvider(f.provider)) return { kind: "acp", command: f.provider.command, args: [...(f.provider.args ?? [])], name: f.provider.name };
    return null;
  };
  const localProvider = providerOf(local);
  const projectProvider = providerOf(project);
  const targetOf = (f: CrtConfigFile): string | null => (typeof f.target === "string" && f.target.trim() ? f.target.trim() : null);
  const portOf = (f: CrtConfigFile): number | null => (typeof f.port === "number" && Number.isInteger(f.port) && f.port > 0 && f.port <= 65535 ? f.port : null);
  const localTarget = targetOf(local);
  const projectTarget = targetOf(project);
  const localMode = isMode(local.mode) ? local.mode : null;
  const projectMode = isMode(project.mode) ? project.mode : null;
  return {
    mode: localMode ?? projectMode ?? DEFAULT_CONFIG.mode,
    modeSource: localMode ? "local" : projectMode ? "project" : null,
    tasksDir: typeof project.tasksDir === "string" && project.tasksDir ? project.tasksDir : DEFAULT_CONFIG.tasksDir,
    target: localTarget ?? projectTarget,
    targetSource: localTarget ? "local" : projectTarget ? "project" : null,
    port: portOf(local) ?? portOf(project) ?? DEFAULT_PORT,
    provider: localProvider ?? projectProvider,
    providerSource: localProvider ? "local" : projectProvider ? "project" : null,
    models: { ...modelsOf(project), ...modelsOf(local) },
    providers: { ...providersOf(project), ...providersOf(local) },
  };
}

/**
 * F-57 `PUT /__crt/config`: merge `provider` and/or `models` into `.crt/config.local.json`
 * (creating it), leaving every other key of the file as it was. The route has validated the
 * values; this only writes the machine-local file, never `.crt/config.json` (N-8). The guided
 * start writes `target` the same way (PRD-setup F-72).
 */
export function writeLocalConfig(root: string, patch: { provider?: string; models?: Record<string, string>; target?: string }): string {
  const path = join(root, ".crt", LOCAL_CONFIG_FILE);
  const current = readConfigFile(path);
  const next: CrtConfigFile = { ...current };
  if (patch.provider !== undefined) next.provider = patch.provider;
  if (patch.target !== undefined) next.target = patch.target;
  if (patch.models !== undefined) next.models = { ...(current.models && typeof current.models === "object" ? current.models : {}), ...patch.models };
  mkdirSync(join(root, ".crt"), { recursive: true });
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n", "utf8");
  return path;
}

function readConfigFile(path: string): CrtConfigFile {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as CrtConfigFile) : {};
  } catch {
    return {};
  }
}

function isAcpProvider(v: unknown): v is AcpProviderConfig {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return o.kind === "acp" && typeof o.command === "string" && o.command.trim() !== "" && typeof o.name === "string" && (o.args === undefined || (Array.isArray(o.args) && o.args.every((a) => typeof a === "string")));
}

/** F-57 model strings: `^[A-Za-z0-9._:-]{1,64}$`. */
export const MODEL_RE = /^[A-Za-z0-9._:-]{1,64}$/;

function modelsOf(f: CrtConfigFile): Record<string, string> {
  const out: Record<string, string> = {};
  if (!f.models || typeof f.models !== "object") return out;
  for (const [id, model] of Object.entries(f.models)) {
    if (typeof model === "string" && MODEL_RE.test(model)) out[id] = model;
  }
  return out;
}

function providersOf(f: CrtConfigFile): Record<string, { command: string[] }> {
  const out: Record<string, { command: string[] }> = {};
  if (!f.providers || typeof f.providers !== "object") return out;
  for (const [id, entry] of Object.entries(f.providers)) {
    const command = entry && typeof entry === "object" ? (entry as { command?: unknown }).command : undefined;
    if (Array.isArray(command) && command.length && command.every((c) => typeof c === "string" && c !== "")) out[id] = { command: [...command] };
  }
  return out;
}
