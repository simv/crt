/**
 * `crt init` (PRD F-35 as amended by PRD-embedded F-99…F-102, N-19): make a project CRT-ready,
 * explicitly and idempotently. `planInit` lists what is not in place — `.crt/README.md`,
 * `.crt/tasks/`, `.crt/config.json`, the two `.gitignore` lines and the CRT section for agents
 * (F-101) — `renderPlan` prints it as the F-100 plan, `applyInit` writes each item with one
 * `crt init:` line as it happens, and `runInit` is the whole command (plan, the terminal
 * question, the writes, the F-102 snippet). Nothing here runs at server start any more (F-99):
 * `serve` only calls the same plan/apply pair through start.ts `ensureInitialised`, and only
 * after asking or under `--yes`. The `.gitignore` lines and the CRT section are `crt init`'s
 * documented writes outside `.crt/` (N-19).
 *
 * Config is two files, read by `readConfig`: `.crt/config.json` (committed, per project) with
 * `.crt/config.local.json` (gitignored, per machine — what "Remember for this project on this
 * machine" writes, F-56/F-57, and where the guided start remembers the target, PRD-setup F-72)
 * layered over it key by key: `mode`, `target` and `port` local-over-project too (PRD-setup §5.3).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CrtError } from "./errors.js";
import type { Prompter } from "./start.js";

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
export const README_FILE = "README.md";
export const REPO_URL = "https://github.com/simv/crt";

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

// ---- .crt/README.md (F-100) -----------------------------------------------------------------------

/**
 * F-100: the folder README for humans reading `.crt/` on GitHub. Written once, hand-editable
 * afterwards (never rewritten by a later `crt init`).
 */
export function readmeTemplate(version: string): string {
  return [
    "# .crt/ — Claude Review Tool",
    "",
    "CRT (Claude Review Tool) puts a review overlay on this project's local dev site: you annotate the page in the browser, talk to a coding agent in-page, and it writes a self-contained task file into this folder. Any later agent session completes a task from its file alone.",
    "",
    "## What is in this folder",
    "",
    "- `tasks/` — the work items, one Markdown file each (`CRT-NNNN-<slug>.md`): YAML frontmatter (`id`, `title`, `status`, `priority`, dates, `url`, `route`, `tags`, `files`), then Summary, Context, Evidence, Ask, Definition of Done, Notes and Log. Statuses run `backlog → in_progress → review → done` (or `blocked`).",
    "- `tasks/README.md` — the generated index; `crt tasks` rewrites it, never hand-edit it.",
    "- `tasks/assets/<ID>/` — the screenshots a task's Evidence refers to.",
    "- `captures/` — transient page captures waiting for intake; gitignored, pruned after 7 days.",
    "- `config.json` — committed, per project: `mode` (`embedded` or `proxy`), `target` (the app URL), `port` (the CRT server port), `provider` (the agent).",
    '- `config.local.json` — the same keys per machine (what "Remember" and the guided start write); gitignored.',
    "",
    "## Working a task",
    "",
    "- `/crt:next [ID]` in Claude Code takes the next backlog task (or the named one) to an open pull request.",
    "- `crt tasks` lists the tasks; `crt task <ID>` prints one (`--validate` checks its format).",
    "- A task file is self-contained: any agent can read it and do the work.",
    "",
    `Written by crt init ${version}; ${REPO_URL}`,
    "",
  ].join("\n");
}

// ---- the CRT section for agents (F-101) --------------------------------------------------------------

/** The agent instruction files `crt init` maintains a section in, in the order they are checked. */
export const INSTRUCTION_FILES = ["CLAUDE.md", "AGENTS.md"] as const;
export type InstructionFile = (typeof INSTRUCTION_FILES)[number];
export const BLOCK_END = "<!-- END:crt -->";
/**
 * Matches one existing block, capturing its major.minor stamp (absent in a hand-made block). Both
 * markers must stand on their own lines: a sentence that merely mentions `<!-- BEGIN:crt -->` (this
 * repository's CLAUDE.md does) is not a block.
 */
const BLOCK_RE = /^<!-- BEGIN:crt(?: v(\d+\.\d+)(?:\.\d+)?)? -->[ \t]*\r?\n[\s\S]*?^<!-- END:crt -->[ \t]*$/m;

/** `0.4.0` → `0.4`; the stamp the markers carry and the comparison that decides regeneration. */
export function majorMinor(version: string): string {
  const m = /^(\d+)\.(\d+)/.exec(version);
  return m ? `${m[1]}.${m[2]}` : version;
}

export function blockBegin(version: string): string {
  return `<!-- BEGIN:crt v${majorMinor(version)} -->`;
}

/** F-101: the section text (≤ 15 lines, provider-neutral), between its markers, LF only, no trailing newline. */
export function instructionsBlock(version: string): string {
  return [
    blockBegin(version),
    "## CRT (Claude Review Tool)",
    "",
    "- `.crt/` is part of this repository and is documented in `.crt/README.md`.",
    '- `.crt/tasks/*.md` are work items filed from the browser with CRT. They can appear while a CRT intake session runs — that is expected: keep them, commit them with the project, never delete or "clean up" one.',
    "- `.crt/tasks/README.md` is generated by `crt tasks` — never hand-edit it.",
    "- `.crt/captures/` and `.crt/config.local.json` are per-machine and gitignored.",
    "- To work a task: `/crt:next [ID]` in Claude Code, or read the task file — it is self-contained.",
    "- The CRT integration in the app (one dev-only import, printed by `crt init`) is development-only and stays.",
    "- `crt init` maintains this section.",
    BLOCK_END,
  ].join("\n");
}

/** A `CLAUDE.md` made only of `@` import lines (the trial app's `@AGENTS.md`) — skipped in favour of what it imports. */
export function isImportOnly(text: string): boolean {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((l) => l.startsWith("@"));
}

export interface InstructionsTarget {
  file: InstructionFile;
  /** `create` when neither file exists; `add` appends; `update` replaces a block with another major.minor; `unchanged` leaves a matching stamp alone. */
  action: "create" | "add" | "update" | "unchanged";
}

/** What `writeInstructionsBlock` would do, file by file (the plan reads it; the doctor's `instructions` row reads `instructionsStatus`). */
export function planInstructions(root: string, provider: string, version: string): InstructionsTarget[] {
  const out: InstructionsTarget[] = [];
  for (const file of INSTRUCTION_FILES) {
    const text = readText(join(root, file));
    if (text === null) continue;
    if (file === "CLAUDE.md" && isImportOnly(text)) continue;
    const m = BLOCK_RE.exec(text);
    out.push({ file, action: m === null ? "add" : m[1] === majorMinor(version) ? "unchanged" : "update" });
  }
  if (!out.length) out.push({ file: provider === "claude" && !existsSync(join(root, "CLAUDE.md")) ? "CLAUDE.md" : "AGENTS.md", action: "create" });
  return out;
}

/**
 * F-101: write the section into every target — appended after a blank line, replaced in place by
 * its markers when the stamped major.minor differs, left alone when it matches (even if edited),
 * created as `CLAUDE.md` for `claude` and `AGENTS.md` otherwise when neither exists. LF only.
 */
export function writeInstructionsBlock(root: string, provider: string, version: string): InstructionsTarget[] {
  const block = instructionsBlock(version);
  const targets = planInstructions(root, provider, version);
  for (const t of targets) {
    const path = join(root, t.file);
    if (t.action === "unchanged") continue;
    if (t.action === "create") {
      writeFileSync(path, `${block}\n`, "utf8");
      continue;
    }
    const text = readText(path) ?? "";
    if (t.action === "update") {
      writeFileSync(path, text.replace(BLOCK_RE, block), "utf8");
      continue;
    }
    const body = text.replace(/\r\n/g, "\n");
    const gap = body === "" ? "" : body.endsWith("\n\n") ? "" : body.endsWith("\n") ? "\n" : "\n\n";
    writeFileSync(path, `${body}${gap}${block}\n`, "utf8");
  }
  return targets;
}

/** The existing instruction files (an import-only `CLAUDE.md` skipped) and whether each carries the markers — the doctor's `instructions` row and the F-106 hook. */
export function instructionsStatus(root: string): Array<{ file: InstructionFile; hasBlock: boolean }> {
  const out: Array<{ file: InstructionFile; hasBlock: boolean }> = [];
  for (const file of INSTRUCTION_FILES) {
    const text = readText(join(root, file));
    if (text === null) continue;
    if (file === "CLAUDE.md" && isImportOnly(text)) continue;
    out.push({ file, hasBlock: BLOCK_RE.test(text) });
  }
  return out;
}

// ---- the framework snippet (F-102) -------------------------------------------------------------------

export type Framework = "next" | "vite" | "react" | "bundled" | "static";

export interface Integration {
  framework: Framework;
  /** The file the snippet goes in, relative with `/`; null when no candidate exists (or the page has no bundler). */
  file: string | null;
  /** The §4 snippet text, verbatim. */
  snippet: string;
  import: string;
  usage: string;
}

/** F-102: the files checked per framework, in order; the first that exists is `file`. The doctor's `integration` row reads only these. */
export const INTEGRATION_CANDIDATES: Record<Framework, readonly string[]> = {
  next: ["app/layout.tsx", "src/app/layout.tsx", "app/layout.jsx", "src/app/layout.jsx", "app/layout.js", "src/app/layout.js"],
  vite: ["vite.config.ts", "vite.config.mts", "vite.config.js", "vite.config.mjs"],
  react: ["src/main.tsx", "src/index.tsx", "src/main.jsx", "src/index.jsx", "src/main.ts", "src/index.ts"],
  bundled: ["src/main.tsx", "src/index.tsx", "src/main.jsx", "src/index.jsx", "src/main.ts", "src/index.ts"],
  static: [],
};

/** What to call the file when none of the candidates exists (the §4 comment headers). */
export const INTEGRATION_PLACEHOLDER: Record<Framework, string> = {
  next: "your root layout",
  vite: "vite.config.ts",
  react: "your client entry",
  bundled: "your client entry",
  static: "the development page only (no bundler)",
};

export const SCRIPT_TAG = '<script src="http://localhost:4400/__crt/loader.js"></script>';

/** PRD-embedded §4: the four snippets, verbatim (`next` keeps its `…` line; `react` and `bundled` share the loader form). */
const SNIPPETS: Record<Framework, { import: string; usage: string; snippet: string }> = {
  next: {
    import: 'import { CrtDevTools } from "claude-review-tool/react";',
    usage: "<body>{children}<CrtDevTools /></body>",
    snippet: 'import { CrtDevTools } from "claude-review-tool/react";\n…\n<body>{children}<CrtDevTools /></body>',
  },
  vite: {
    import: 'import { crt } from "claude-review-tool/vite";',
    usage: "export default defineConfig({ plugins: [react(), crt()] });",
    snippet: 'import { crt } from "claude-review-tool/vite";\nexport default defineConfig({ plugins: [react(), crt()] });',
  },
  react: {
    import: 'import { mountCrt } from "claude-review-tool/loader";',
    usage: 'if (process.env.NODE_ENV !== "production") mountCrt();',
    snippet: 'import { mountCrt } from "claude-review-tool/loader";\nif (process.env.NODE_ENV !== "production") mountCrt();   // the guard is optional (F-98); it lets the bundler drop the import',
  },
  bundled: {
    import: 'import { mountCrt } from "claude-review-tool/loader";',
    usage: 'if (process.env.NODE_ENV !== "production") mountCrt();',
    snippet: 'import { mountCrt } from "claude-review-tool/loader";\nif (process.env.NODE_ENV !== "production") mountCrt();   // the guard is optional (F-98); it lets the bundler drop the import',
  },
  static: { import: SCRIPT_TAG, usage: SCRIPT_TAG, snippet: SCRIPT_TAG },
};

/**
 * F-102: detect the framework from the root `package.json` (dependency names only, no recursion)
 * and the first existing candidate file. Never opens an app file.
 */
export function detectIntegration(root: string): Integration {
  const pkg = readJson(join(root, "package.json"));
  const framework = frameworkOf(pkg);
  const file = INTEGRATION_CANDIDATES[framework].find((f) => existsSync(join(root, ...f.split("/")))) ?? null;
  return { framework, file, ...SNIPPETS[framework] };
}

function frameworkOf(pkg: Record<string, unknown> | null): Framework {
  if (!pkg) return "static";
  const names = new Set<string>();
  for (const key of ["dependencies", "devDependencies"]) {
    const deps = pkg[key];
    if (deps && typeof deps === "object") for (const name of Object.keys(deps as object)) names.add(name);
  }
  if (names.has("next")) return "next";
  if (names.has("vite")) return "vite";
  if (names.has("react") || names.has("react-dom")) return "react";
  const scripts = pkg.scripts;
  if (scripts && typeof scripts === "object" && (typeof (scripts as Record<string, unknown>).dev === "string" || typeof (scripts as Record<string, unknown>).start === "string")) return "bundled";
  // A package.json with neither a framework nor a dev/start script gives no bundler to hook: the script tag.
  return "static";
}

/** The human form `crt init` ends with (F-102). */
export function renderSnippet(i: Integration): string[] {
  return [
    "Add CRT to your app (development only):",
    `  ${i.file ?? INTEGRATION_PLACEHOLDER[i.framework]}`,
    ...i.snippet.split("\n").map((l) => `    ${l}`),
    "Production builds contain nothing from CRT (README › Production). /crt:init in Claude Code applies this for you.",
  ];
}

// ---- the plan (F-100) ---------------------------------------------------------------------------------

export type PlanItem =
  | { kind: "readme" }
  | { kind: "tasks" }
  | { kind: "config" }
  | { kind: "ignore"; lines: string[] }
  | { kind: "instructions"; file: InstructionFile; action: "create" | "add" | "update" };

export interface InitPlan {
  root: string;
  /** What is not in place, in write order; empty when the project is set up. */
  items: PlanItem[];
  /** What is already in place, for the "is set up" line. */
  inPlace: string[];
  /** The provider resolved for a file to be created (F-101); null when none had to be. */
  provider: string | null;
}

export interface PlanOptions {
  /** Include the F-101 section (false under `--no-instructions`). */
  instructions: boolean;
  /** This package's version (the README footer, the block stamp). */
  version: string;
  /** The resolved provider — asked for only when neither `CLAUDE.md` nor `AGENTS.md` exists (F-101). */
  provider(): Promise<string>;
}

export async function planInit(root: string, opts: PlanOptions): Promise<InitPlan> {
  const crtDir = join(root, ".crt");
  const items: PlanItem[] = [];
  const inPlace: string[] = [];
  if (existsSync(join(crtDir, README_FILE))) inPlace.push(".crt/README.md");
  else items.push({ kind: "readme" });
  if (existsSync(join(crtDir, "tasks"))) inPlace.push("tasks/");
  else items.push({ kind: "tasks" });
  if (existsSync(join(crtDir, CONFIG_FILE))) inPlace.push("config.json");
  else items.push({ kind: "config" });
  const missing = missingIgnoreLines(root);
  if (missing.length) items.push({ kind: "ignore", lines: missing });
  else inPlace.push(".gitignore entries");
  let provider: string | null = null;
  if (opts.instructions) {
    if (!instructionsStatus(root).length) provider = await opts.provider();
    const carrying: string[] = [];
    for (const t of planInstructions(root, provider ?? "", opts.version)) {
      if (t.action === "unchanged") carrying.push(t.file);
      else items.push({ kind: "instructions", file: t.file, action: t.action });
    }
    if (carrying.length) inPlace.push(`CRT section in ${carrying.join(" and ")}`);
  }
  return { root, items, inPlace, provider };
}

/** The F-100 plan: `crt init will, in <root>:` and one indented line per item. */
export function renderPlan(plan: InitPlan): string[] {
  return [`crt init will, in ${plan.root}:`, ...plan.items.map((item) => `  ${planLine(item)}`)];
}

function planLine(item: PlanItem): string {
  switch (item.kind) {
    case "readme":
      return "create .crt/README.md";
    case "tasks":
      return "create .crt/tasks/";
    case "config":
      return "create .crt/config.json";
    case "ignore":
      return `add ${item.lines.join(" and ")} to .gitignore`;
    case "instructions":
      return item.action === "create" ? `create ${item.file} with a CRT section` : item.action === "update" ? `update the CRT section in ${item.file}` : `add a CRT section to ${item.file}`;
  }
}

/** The "nothing to do" line: `crt init: C:\my-app is set up (.crt/README.md, tasks/, config.json, .gitignore entries, CRT section in CLAUDE.md)`. */
export function describeSetUp(plan: InitPlan): string {
  return `crt init: ${plan.root} is set up (${plan.inPlace.join(", ")})`;
}

/**
 * F-100: apply the plan, one `crt init:` line per write as it happens. The section is written by
 * `writeInstructionsBlock` for the planned file; the rest by `initProject`.
 */
export function applyInit(plan: InitPlan, opts: { version: string; log(line: string): void }): void {
  initProject(plan.root, { version: opts.version, log: opts.log });
  if (!plan.items.some((i) => i.kind === "instructions")) return;
  for (const t of writeInstructionsBlock(plan.root, plan.provider ?? "", opts.version)) {
    if (t.action === "create") opts.log(`crt init: created ${t.file} with the CRT section`);
    else if (t.action === "add") opts.log(`crt init: added the CRT section to ${t.file}`);
    else if (t.action === "update") opts.log(`crt init: updated the CRT section in ${t.file}`);
  }
}

export interface RunInitOptions {
  /** `--yes`: skip the terminal question. */
  yes: boolean;
  /** `--no-instructions`: leave `CLAUDE.md` / `AGENTS.md` alone. */
  instructions: boolean;
  /** `--snippet`: print only the F-102 snippet, write nothing. */
  snippet: boolean;
  /** `--snippet --json`: the F-102 JSON instead of the human form. */
  json: boolean;
  /** A terminal (cli.ts `isInteractive`); the question is asked only then and without `--yes`. */
  interactive: boolean;
  prompt?: Prompter;
  version: string;
  /** The resolved provider, asked for only when a file must be created (F-101). */
  provider(): Promise<string>;
  log(line: string): void;
}

/** `crt init` (F-100): the plan, the question on a terminal, the writes, the snippet. */
export async function runInit(root: string, opts: RunInitOptions): Promise<void> {
  const integration = detectIntegration(root);
  if (opts.snippet) {
    if (opts.json) opts.log(JSON.stringify(integration, null, 2));
    else for (const line of renderSnippet(integration)) opts.log(line);
    return;
  }
  const plan = await planInit(root, { instructions: opts.instructions, version: opts.version, provider: opts.provider });
  if (!plan.items.length) {
    opts.log(describeSetUp(plan));
  } else {
    for (const line of renderPlan(plan)) opts.log(line);
    if (opts.interactive && !opts.yes && opts.prompt) {
      const answer = await opts.prompt.ask("Go ahead? [Y/n]");
      if (!(answer === "" || /^y(es)?$/i.test(answer.trim()))) throw new CrtError("cancelled", 130);
    }
    applyInit(plan, { version: opts.version, log: opts.log });
  }
  for (const line of renderSnippet(integration)) opts.log(line);
}

// ---- the writes under .crt/ and .gitignore ------------------------------------------------------------

export interface InitResult {
  crtDir: string;
  tasksDir: string;
  configPath: string;
  /** Paths this run created or modified; empty when everything was already in place. */
  created: string[];
  /** The `.gitignore` lines this run added. */
  ignoreAdded: string[];
}

/**
 * The idempotent writes: `.crt/README.md` (only when absent), `.crt/tasks/`, `.crt/config.json`
 * (only when absent) and the two `.gitignore` lines (creating the file if needed). Called by
 * `applyInit` — never by the server at runtime (F-99, N-19).
 */
export function initProject(root: string, opts: { version?: string; log?: (line: string) => void } = {}): InitResult {
  const version = opts.version ?? "0.0.0";
  const log = opts.log ?? (() => undefined);
  const crtDir = join(root, ".crt");
  const tasksDir = join(crtDir, "tasks");
  const configPath = join(crtDir, CONFIG_FILE);
  const readmePath = join(crtDir, README_FILE);
  const gitignorePath = join(root, ".gitignore");
  const created: string[] = [];
  const ignoreAdded: string[] = [];

  if (!existsSync(readmePath)) {
    mkdirSync(crtDir, { recursive: true });
    writeFileSync(readmePath, readmeTemplate(version), "utf8");
    created.push(readmePath);
    log("crt init: created .crt/README.md");
  }
  if (!existsSync(tasksDir)) {
    mkdirSync(tasksDir, { recursive: true });
    created.push(tasksDir);
    log("crt init: created .crt/tasks/");
  }
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG_FILE, null, 2) + "\n", "utf8");
    created.push(configPath);
    log("crt init: created .crt/config.json");
  }
  let ignore = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf8") : "";
  let changed = false;
  for (const line of missingIgnoreLines(root)) {
    const sep = ignore === "" || ignore.endsWith("\n") ? "" : "\n";
    ignore = `${ignore}${sep}${line}\n`;
    ignoreAdded.push(line);
    changed = true;
  }
  if (changed) {
    writeFileSync(gitignorePath, ignore, "utf8");
    created.push(gitignorePath);
    log(`crt init: added ${ignoreAdded.join(" and ")} to .gitignore`);
  }
  return { crtDir, tasksDir, configPath, created, ignoreAdded };
}

/** The `.gitignore` lines `crt init` would add, in order (empty when both are present, or the whole `.crt/` is ignored). */
export function missingIgnoreLines(root: string): string[] {
  const lines = (readText(join(root, ".gitignore")) ?? "").split(/\r?\n/);
  const wanted: Array<[string, (line: string) => boolean]> = [
    [CAPTURES_IGNORE, isCapturesIgnore],
    [LOCAL_CONFIG_IGNORE, isLocalConfigIgnore],
  ];
  return wanted.filter(([, present]) => !lines.some(present)).map(([line]) => line);
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

/** `<root>/.crt/tasks` exists — the F-99 test for "set up". */
export function isInitialised(root: string): boolean {
  return existsSync(join(root, ".crt", "tasks"));
}

// ---- config ----------------------------------------------------------------------------------------------

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
  const raw = readJson(path);
  return raw ?? {};
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** A JSON object from `path`, or null when the file is missing, unparseable or not an object. */
function readJson(path: string): Record<string, unknown> | null {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
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
