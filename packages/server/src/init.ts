/**
 * `crt init` (PRD F-35 as amended by PRD-embedded F-99…F-102, N-19): make a project CRT-ready,
 * explicitly and idempotently. `planInit` lists what is not in place — `.crt/README.md`,
 * `.crt/tasks/`, `.crt/config.json`, the two `.gitignore` lines and the CRT section for agents
 * (F-101) — `renderPlan` prints it as the F-100 plan, `applyInit` writes each item with one
 * `crt init:` line as it happens, and `runInit` is the whole command (plan, the terminal
 * question, the writes, the F-102 snippet). Nothing here runs at server start any more (F-99):
 * `serve` only calls the same plan/apply pair through start.ts `ensureInitialised`, and only
 * after asking or under `--yes`. The `.gitignore` lines and the CRT section are `crt init`'s
 * documented writes outside `.crt/` (N-19). Re-exported from beside it: config.ts (the config
 * files, the mode), instructions.ts (`.crt/README.md`, the CRT section), integration.ts (the snippet).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILE, DEFAULT_CONFIG_FILE, readText } from "./config.js";
import { CrtError } from "./errors.js";
import { type InstructionFile, instructionsStatus, planInstructions, README_FILE, readmeTemplate, writeInstructionsBlock } from "./instructions.js";
import { detectIntegration, renderSnippet } from "./integration.js";
import type { Prompter } from "./prompt.js";
import { isYes } from "./start.js";

export * from "./config.js";
export * from "./instructions.js";
export * from "./integration.js";

export const CAPTURES_IGNORE = ".crt/captures/";
export const LOCAL_CONFIG_IGNORE = ".crt/config.local.json";

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
      if (!isYes(await opts.prompt.ask("Go ahead? [Y/n]"))) throw new CrtError("cancelled", 130);
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
  for (const line of missingIgnoreLines(root)) {
    const sep = ignore === "" || ignore.endsWith("\n") ? "" : "\n";
    ignore = `${ignore}${sep}${line}\n`;
    ignoreAdded.push(line);
  }
  if (ignoreAdded.length) {
    writeFileSync(gitignorePath, ignore, "utf8");
    created.push(gitignorePath);
    log(`crt init: added ${ignoreAdded.join(" and ")} to .gitignore`);
  }
  return { crtDir, tasksDir, configPath, created, ignoreAdded };
}

/**
 * The `.gitignore` lines `crt init` would add, in order: empty when both are present, or the whole
 * `.crt/` is ignored (`crt doctor`'s "`.gitignore` entries", PRD-setup F-76).
 */
export function missingIgnoreLines(root: string): string[] {
  const lines = (readText(join(root, ".gitignore")) ?? "").split(/\r?\n/);
  const wanted: Array<[string, (line: string) => boolean]> = [
    [CAPTURES_IGNORE, isCapturesIgnore],
    [LOCAL_CONFIG_IGNORE, isLocalConfigIgnore],
  ];
  return wanted.filter(([, present]) => !lines.some(present)).map(([line]) => line);
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
