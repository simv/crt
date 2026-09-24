/**
 * Task store (PRD §6.5: F-31 ids, F-32 file format, F-33 listing, F-34 index; F-23 asset move).
 *
 * A task is `<tasksDir>/<ID>-<slug>.md`: YAML frontmatter (a fixed set of scalar/list keys — the
 * tiny parser below handles exactly the subset the format uses; unknown keys are ignored since
 * v0.2, PRD-providers F-48) followed by seven `##` sections in a fixed order. IDs are allocated
 * by scanning the directory (task files and `assets/` folders) for the highest existing one, so
 * there is no counter file to conflict on. `README.md` in the same directory is a generated table
 * and is rewritten whenever a task is created or `crt tasks` notices it is stale.
 * Everything is written with `\n` line endings.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { type CaptureBundle, validateCaptureBundle } from "./capture-schema.js";
import { capturesDir } from "./captures.js";

export const TASK_STATUSES = ["backlog", "in_progress", "review", "done", "blocked"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_PRIORITIES = ["low", "normal", "high"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const SECTION_NAMES = ["Summary", "Context", "Evidence", "Ask", "Definition of Done", "Notes", "Log"] as const;
export type SectionName = (typeof SECTION_NAMES)[number];
export const FRONTMATTER_KEYS = [
  "id",
  "title",
  "status",
  "priority",
  "created",
  "updated",
  "url",
  "route",
  "session",
  "provider",
  "tags",
  "files",
] as const;

export const TASK_ID_RE = /^CRT-\d{4}$/;
export const TASK_FILE_RE = /^(CRT-\d{4})-([a-z0-9-]+)\.md$/;
export const MAX_SLUG_LENGTH = 40;
export const ASSETS_DIRNAME = "assets";
export const INDEX_FILENAME = "README.md";

export interface TaskFrontmatter {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  created: string;
  updated: string;
  url: string | null;
  route: string | null;
  /** The provider's own session id (PRD-providers §5.4), or null. */
  session: string | null;
  /** Provider that wrote the task (F-48); null in v0.1 files. */
  provider: string | null;
  tags: string[];
  files: string[];
}

export interface Task {
  frontmatter: TaskFrontmatter;
  /** Section bodies without their `## ` heading, trimmed of surrounding blank lines. */
  sections: Record<SectionName, string>;
}

export interface TaskSummary {
  id: string;
  status: TaskStatus;
  priority: TaskPriority;
  title: string;
  updated: string;
  /** F-48: `provider:` when present (v0.1 files have none). */
  provider: string | null;
  /** File name inside the tasks directory. */
  file: string;
}

export class TaskFormatError extends Error {
  readonly errors: string[];
  constructor(errors: string[], what = "task") {
    super(`invalid ${what}: ${errors.slice(0, 5).join("; ")}${errors.length > 5 ? ` (+${errors.length - 5} more)` : ""}`);
    this.name = "TaskFormatError";
    this.errors = errors;
  }
}

// ---------------------------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------------------------

/** `2026-09-14T10:32:00+08:00`: local wall-clock time with the machine's UTC offset (F-32). */
export function localIso(d: Date = new Date(), seconds = true): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  const tz = `${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`;
  const hm = `${p(d.getHours())}:${p(d.getMinutes())}`;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${hm}${seconds ? `:${p(d.getSeconds())}` : ""}${tz}`;
}

/** Log-entry stamp: minute precision, per the F-32 example. */
export function logStamp(d: Date = new Date()): string {
  return localIso(d, false);
}

// ---------------------------------------------------------------------------------------------
// Frontmatter (YAML subset: scalars, `null`, quoted strings, flow lists)
// ---------------------------------------------------------------------------------------------

type Scalar = string | null;
type YamlValue = Scalar | Scalar[];

export function parseFrontmatter(text: string): { data: Record<string, YamlValue>; body: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return null;
  const data: Record<string, YamlValue> = {};
  for (const rawLine of m[1]!.split(/\r?\n/)) {
    const line = stripComment(rawLine);
    if (!line.trim()) continue;
    const kv = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(line);
    if (!kv) continue;
    const key = kv[1]!;
    const value = (kv[2] ?? "").trim();
    data[key] = value.startsWith("[") ? parseFlowList(value) : parseScalar(value);
  }
  return { data, body: text.slice(m[0].length) };
}

/** Drop a trailing ` # comment` that is not inside quotes. */
function stripComment(line: string): string {
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]!))) {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseScalar(value: string): Scalar {
  if (value === "" || value === "null" || value === "~") return null;
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    try {
      return JSON.parse(value) as string;
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) return value.slice(1, -1).replace(/''/g, "'");
  return value;
}

function parseFlowList(value: string): Scalar[] {
  const inner = value.replace(/^\[/, "").replace(/\]\s*$/, "");
  const items: Scalar[] = [];
  let cur = "";
  let quote: string | null = null;
  const push = () => {
    const v = cur.trim();
    if (v !== "") items.push(parseScalar(v));
    cur = "";
  };
  for (const c of inner) {
    if (quote) {
      cur += c;
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
      cur += c;
    } else if (c === ",") {
      push();
    } else {
      cur += c;
    }
  }
  push();
  return items;
}

/** Quote a scalar only when YAML would otherwise misread it. */
export function yamlScalar(value: string | null): string {
  if (value === null) return "null";
  if (value === "" || /^[\s"'#&*!|>%@`[{\]}-]|: |#|\s$|^(null|~|true|false|yes|no|on|off)$|^[\d.+-]+$/i.test(value) || /[\r\n\t]/.test(value)) {
    return JSON.stringify(value);
  }
  return value;
}

function yamlList(items: string[]): string {
  return `[${items.map(yamlScalar).join(", ")}]`;
}

// ---------------------------------------------------------------------------------------------
// Parse / validate / serialise
// ---------------------------------------------------------------------------------------------

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Validate a task file's text against F-32. `fileName` (optional) lets the id/slug be checked
 * against the file name. Returns an empty list for a well-formed task.
 */
export function validateTaskText(text: string, fileName?: string): string[] {
  const errors: string[] = [];
  const fm = parseFrontmatter(text);
  if (!fm) return ["missing YAML frontmatter (--- … ---) at the top of the file"];
  const d = fm.data;

  const str = (key: string, nullable = false): string | null => {
    const v = d[key];
    if (v === undefined) {
      errors.push(`frontmatter: missing "${key}"`);
      return null;
    }
    if (Array.isArray(v)) {
      errors.push(`frontmatter: "${key}" must be a scalar`);
      return null;
    }
    if (v === null && !nullable) errors.push(`frontmatter: "${key}" must not be empty`);
    return v;
  };
  const list = (key: string): void => {
    const v = d[key];
    if (v === undefined) errors.push(`frontmatter: missing "${key}"`);
    else if (!Array.isArray(v)) errors.push(`frontmatter: "${key}" must be a list like [a, b]`);
    else if (v.some((x) => x === null)) errors.push(`frontmatter: "${key}" has an empty item`);
  };

  const id = str("id");
  if (id !== null && !TASK_ID_RE.test(id)) errors.push(`frontmatter: id "${id}" is not CRT-NNNN`);
  const title = str("title");
  if (title !== null && title.trim() === "") errors.push("frontmatter: title is empty");
  const status = str("status");
  if (status !== null && !(TASK_STATUSES as readonly string[]).includes(status)) {
    errors.push(`frontmatter: status "${status}" is not one of ${TASK_STATUSES.join("|")}`);
  }
  const priority = str("priority");
  if (priority !== null && !(TASK_PRIORITIES as readonly string[]).includes(priority)) {
    errors.push(`frontmatter: priority "${priority}" is not one of ${TASK_PRIORITIES.join("|")}`);
  }
  for (const key of ["created", "updated"]) {
    const v = str(key);
    if (v !== null && !ISO_RE.test(v)) errors.push(`frontmatter: ${key} "${v}" is not an ISO-8601 timestamp with offset`);
  }
  str("url", true);
  str("route", true);
  str("session", true);
  // F-48: `provider:` is optional (v0.1 files) and, like any key this version does not know,
  // never a reason to reject the file.
  if (d.provider !== undefined && Array.isArray(d.provider)) errors.push('frontmatter: "provider" must be a scalar');
  list("tags");
  list("files");
  if (fileName !== undefined) {
    const fm2 = TASK_FILE_RE.exec(fileName);
    if (!fm2) errors.push(`file name "${fileName}" is not CRT-NNNN-<slug>.md`);
    else if (id !== null && fm2[1] !== id) errors.push(`file name id ${fm2[1]} does not match frontmatter id ${id}`);
  }

  const headings = [...fm.body.matchAll(/^## (.*)$/gm)].map((m) => m[1]!.trim());
  const expected = SECTION_NAMES as readonly string[];
  if (headings.length !== expected.length || headings.some((h, i) => h !== expected[i])) {
    errors.push(`sections must be exactly, in order: ${expected.map((s) => `## ${s}`).join(", ")} (found: ${headings.map((h) => `## ${h}`).join(", ") || "none"})`);
  } else {
    const sections = splitSections(fm.body);
    if (!sections.Summary.trim()) errors.push("## Summary is empty");
    if (!sections.Ask.trim()) errors.push("## Ask is empty");
    if (!/^- \[[ xX]\] \S/m.test(sections["Definition of Done"])) errors.push("## Definition of Done needs at least one `- [ ] item`");
    if (!/^- \S/m.test(sections.Log)) errors.push("## Log needs at least one `- <timestamp> — …` entry");
  }
  if (/\r\n/.test(text)) errors.push("file uses CRLF line endings; tasks are written with \\n");
  return errors;
}

function splitSections(body: string): Record<SectionName, string> {
  const out = {} as Record<SectionName, string>;
  for (const name of SECTION_NAMES) out[name] = "";
  const parts = body.split(/^## (?=.)/m);
  for (const part of parts.slice(1)) {
    const nl = part.indexOf("\n");
    const name = (nl === -1 ? part : part.slice(0, nl)).trim() as SectionName;
    if ((SECTION_NAMES as readonly string[]).includes(name)) out[name] = (nl === -1 ? "" : part.slice(nl + 1)).replace(/^\n+|\s+$/g, "");
  }
  return out;
}

/** Parse a task file's text; throws TaskFormatError when it does not validate. */
export function parseTask(text: string, fileName?: string): Task {
  const errors = validateTaskText(text, fileName);
  if (errors.length) throw new TaskFormatError(errors, fileName ?? "task");
  const { data, body } = parseFrontmatter(text)!;
  const s = (k: string) => data[k] as string;
  const n = (k: string) => (data[k] as Scalar) ?? null;
  return {
    frontmatter: {
      id: s("id"),
      title: s("title"),
      status: s("status") as TaskStatus,
      priority: s("priority") as TaskPriority,
      created: s("created"),
      updated: s("updated"),
      url: n("url"),
      route: n("route"),
      session: n("session"),
      provider: n("provider"),
      tags: data.tags as string[],
      files: data.files as string[],
    },
    sections: splitSections(body),
  };
}

/** Render a task back to text in the F-32 layout. `parseTask(serializeTask(t))` round-trips. */
export function serializeTask(task: Task): string {
  const f = task.frontmatter;
  const lines = [
    "---",
    `id: ${f.id}`,
    `title: ${yamlScalar(f.title)}`,
    `status: ${f.status}`,
    `priority: ${f.priority}`,
    `created: ${f.created}`,
    `updated: ${f.updated}`,
    `url: ${yamlScalar(f.url)}`,
    `route: ${yamlScalar(f.route)}`,
    `session: ${yamlScalar(f.session)}`,
    `provider: ${yamlScalar(f.provider)}`,
    `tags: ${yamlList(f.tags)}`,
    `files: ${yamlList(f.files)}`,
    "---",
  ];
  for (const name of SECTION_NAMES) {
    lines.push("", `## ${name}`, task.sections[name].replace(/^\n+|\s+$/g, ""));
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------------------------
// Directory operations
// ---------------------------------------------------------------------------------------------

/**
 * F-31: `CRT-` + zero-padded 4 digits, one above the highest id present in the directory. An
 * `assets/<ID>/` folder holds its id too, so a task deleted after its screenshots moved, or one
 * another CRT server is writing, never has its id (and its assets folder) handed out again.
 */
export function allocateTaskId(tasksDir: string, after?: string): string {
  // `after`: an id just found taken, so the result is above it even if the scan cannot see it.
  let max = after === undefined ? 0 : Number(after.slice("CRT-".length));
  for (const name of [...safeReaddir(tasksDir), ...safeReaddir(join(tasksDir, ASSETS_DIRNAME))]) {
    const m = /^CRT-(\d{4})\b/.exec(name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `CRT-${String(max + 1).padStart(4, "0")}`;
}

/** F-31: ≤ 40 chars, lowercase, hyphenated, never empty. */
export function slugify(title: string): string {
  let slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length > MAX_SLUG_LENGTH) {
    const cut = slug.slice(0, MAX_SLUG_LENGTH);
    // Cut on a word boundary: drop a partial trailing word unless the cut already lands on one.
    slug = slug[MAX_SLUG_LENGTH] === "-" ? cut : cut.replace(/-[^-]*$/, "") || cut;
  }
  return slug.replace(/^-+|-+$/g, "") || "task";
}

export function taskFileName(id: string, title: string): string {
  return `${id}-${slugify(title)}.md`;
}

/** Find the file for an id (exact match on the `CRT-NNNN-` prefix). */
export function findTaskFile(tasksDir: string, id: string): string | null {
  const upper = id.toUpperCase();
  for (const name of safeReaddir(tasksDir)) {
    const m = TASK_FILE_RE.exec(name);
    if (m && m[1] === upper) return join(tasksDir, name);
  }
  return null;
}

/** How many task files the directory holds (the ready line's "N tasks", F-5; health's `tasks`, F-78). */
export function countTaskFiles(tasksDir: string): number {
  return safeReaddir(tasksDir).filter((name) => TASK_FILE_RE.test(name)).length;
}

/** F-33: every well-formed task in the directory, sorted by id. Malformed files are skipped. */
export function listTasks(tasksDir: string): TaskSummary[] {
  const out: TaskSummary[] = [];
  for (const name of safeReaddir(tasksDir)) {
    if (!TASK_FILE_RE.test(name)) continue;
    let text: string;
    try {
      text = readFileSync(join(tasksDir, name), "utf8");
    } catch {
      continue;
    }
    const fm = parseFrontmatter(text);
    if (!fm) continue;
    const d = fm.data;
    const status = typeof d.status === "string" && (TASK_STATUSES as readonly string[]).includes(d.status) ? (d.status as TaskStatus) : null;
    if (!status || typeof d.id !== "string" || typeof d.title !== "string") continue;
    out.push({
      id: d.id,
      status,
      priority: typeof d.priority === "string" && (TASK_PRIORITIES as readonly string[]).includes(d.priority) ? (d.priority as TaskPriority) : "normal",
      title: d.title,
      updated: typeof d.updated === "string" ? d.updated : "",
      provider: typeof d.provider === "string" ? d.provider : null,
      file: name,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** F-34: the generated README table. Never hand-edited. */
export function renderIndex(tasks: TaskSummary[]): string {
  const rows = tasks.map(
    (t) => `| [${t.id}](${t.file}) | ${t.status} | ${t.priority} | ${t.title.replace(/\|/g, "\\|")} | ${t.updated.slice(0, 10)} |`,
  );
  return [
    "# CRT tasks",
    "",
    "Generated index — do not edit by hand (PRD F-34). Regenerated by the CRT server whenever a task is written and by `crt tasks`.",
    "",
    "| ID | Status | Priority | Title | Updated |",
    "|---|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
}

/** Rewrite `README.md` when its content is stale. Returns whether it was written. */
export function writeIndex(tasksDir: string): boolean {
  if (!existsSync(tasksDir)) return false;
  const path = join(tasksDir, INDEX_FILENAME);
  const next = renderIndex(listTasks(tasksDir));
  let current: string | null = null;
  try {
    current = readFileSync(path, "utf8");
  } catch {
    // absent
  }
  if (current === next) return false;
  writeFileSync(path, next, "utf8");
  return true;
}

// ---------------------------------------------------------------------------------------------
// Creating a task from intake
// ---------------------------------------------------------------------------------------------

export interface NewTaskInput {
  title: string;
  summary: string;
  context: string;
  /** Extra evidence text appended below the screenshot/annotation lines generated from the capture. */
  evidence?: string;
  ask: string;
  definitionOfDone: string[];
  notes?: string;
  priority?: TaskPriority;
  tags?: string[];
  files?: string[];
  /** The provider's own session id (frontmatter `session`, and named in the first Log entry; §5.4). */
  session: string | null;
  /** Provider id (frontmatter `provider`, and the suffix of the first Log entry; F-48). Omit for v0.1 wording. */
  provider?: string | null;
  /** Capture whose assets move to `.crt/tasks/assets/<ID>/` and whose page info fills url/route/Evidence. */
  captureId?: string | null;
}

export interface CreatedTask {
  id: string;
  path: string;
  file: string;
  assetsDir: string | null;
}

/** How many ids `createTask` tries when another writer takes the one it allocated (F-31). */
const MAX_ID_ATTEMPTS = 10;

/**
 * Allocate an id and render the F-32 file; only once it validates, write it, move the capture's
 * assets (F-23) and regenerate the index (F-34). Input that does not validate changes nothing on
 * disk, so the capture is still there when the agent retries. The file is created exclusively:
 * when another CRT server on the project wrote the same file first, the next id is used instead
 * of overwriting that task. (Two servers writing different titles under one id in the same
 * instant still both succeed; only the file name is exclusive.) All inside `<root>/.crt/` (N-5).
 */
export function createTask(root: string, tasksDir: string, input: NewTaskInput, now: Date = new Date()): CreatedTask {
  const errors: string[] = [];
  if (!input.title?.trim()) errors.push("title is required");
  if (!input.summary?.trim()) errors.push("summary is required");
  if (!input.ask?.trim()) errors.push("ask is required");
  if (!Array.isArray(input.definitionOfDone) || !input.definitionOfDone.some((d) => d.trim())) errors.push("definitionOfDone needs at least one item");
  if (input.priority !== undefined && !(TASK_PRIORITIES as readonly string[]).includes(input.priority)) errors.push(`priority must be one of ${TASK_PRIORITIES.join("|")}`);
  if (errors.length) throw new TaskFormatError(errors, "task input");

  let capture: CaptureBundle | null = null;
  let captureDir: string | null = null;
  let captureFiles: string[] = [];
  if (input.captureId) {
    captureDir = join(capturesDir(root), input.captureId);
    capture = readCapture(captureDir);
    captureFiles = safeReaddir(captureDir);
  }

  const title = input.title.trim();
  const stamp = localIso(now);
  const dod = input.definitionOfDone
    .map((d) => demoteHeadings(d.trim()))
    .filter(Boolean)
    .map((d) => (/^- \[[ x]\]/i.test(d) ? d : `- [ ] ${d.replace(/^-\s*/, "")}`));
  const who = `${input.session ? `intake session ${input.session}` : "intake"}${input.provider ? ` (${input.provider})` : ""}`;
  const render = (id: string): string =>
    serializeTask({
      frontmatter: {
        id,
        title,
        status: "backlog",
        priority: input.priority ?? "normal",
        created: stamp,
        updated: stamp,
        url: capture?.page.url ?? null,
        route: capture?.framework.route ?? capture?.page.pathname ?? null,
        session: input.session,
        provider: input.provider ?? null,
        tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean),
        files: (input.files ?? []).map((f) => f.trim()).filter(Boolean),
      },
      sections: {
        Summary: demoteHeadings(input.summary.trim()),
        Context: demoteHeadings(input.context?.trim() || "See Evidence."),
        // The whole section: the developer's annotation notes are free text too.
        Evidence: demoteHeadings(renderEvidence(id, capture, captureFiles, input.evidence)),
        Ask: demoteHeadings(input.ask.trim()),
        "Definition of Done": dod.join("\n"),
        Notes: demoteHeadings(input.notes?.trim() || "None."),
        Log: `- ${logStamp(now)} — created by ${who}${input.captureId ? ` from capture ${input.captureId}` : ""}.`,
      },
    });

  let id = allocateTaskId(tasksDir);
  for (let attempt = 1; ; attempt++) {
    const file = taskFileName(id, title);
    const text = render(id);
    const problems = validateTaskText(text, file);
    if (problems.length) throw new TaskFormatError(problems, file);
    const path = join(tasksDir, file);
    mkdirSync(tasksDir, { recursive: true });
    try {
      writeFileSync(path, text, { encoding: "utf8", flag: "wx" });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST" || attempt >= MAX_ID_ATTEMPTS) throw err;
      id = allocateTaskId(tasksDir, id);
      continue;
    }
    const assetsDir = captureDir ? join(tasksDir, ASSETS_DIRNAME, id) : null;
    if (captureDir && assetsDir) moveAssets(captureDir, assetsDir);
    writeIndex(tasksDir);
    return { id, path, file, assetsDir };
  }
}

/**
 * The agent's free text sits under the file's own `## ` sections, which `validateTaskText` finds
 * by their heading lines, so a `# ` or `## ` line in it is written as `### `: still a heading to
 * the reader, never a section. A `# ` line inside a fenced code block is a comment and stays; a
 * `## ` one is demoted all the same, because the section check does not see fences. Lines are
 * split on the same terminators the check's `^` does.
 */
function demoteHeadings(text: string): string {
  const parts = text.split(/(\r\n|[\n\r\u2028\u2029])/);
  let fenced = false;
  for (let i = 0; i < parts.length; i += 2) {
    const line = parts[i]!;
    if (/^ {0,3}(```|~~~)/.test(line)) fenced = !fenced;
    else if (line.startsWith("## ") || (!fenced && line.startsWith("# "))) parts[i] = `### ${line.slice(line.indexOf(" ") + 1)}`;
  }
  return parts.join("");
}

function readCapture(dir: string): CaptureBundle {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(join(dir, "capture.json"), "utf8"));
  } catch (err) {
    throw new TaskFormatError([`capture ${basename(dir)} not found or unreadable (${(err as Error).message})`], "capture");
  }
  const errors = validateCaptureBundle(raw);
  if (errors.length) throw new TaskFormatError(errors, "capture");
  return raw as CaptureBundle;
}

/** F-23: move every file of the capture into the task's asset dir, then remove the capture dir. */
function moveAssets(captureDir: string, assetsDir: string): void {
  mkdirSync(assetsDir, { recursive: true });
  for (const name of safeReaddir(captureDir)) {
    const from = join(captureDir, name);
    const to = join(assetsDir, name);
    try {
      renameSync(from, to);
    } catch {
      // Cross-device or locked: copy then delete.
      writeFileSync(to, readFileSync(from));
      rmSync(from, { force: true });
    }
  }
  rmSync(captureDir, { recursive: true, force: true });
}

function renderEvidence(id: string, capture: CaptureBundle | null, assetFiles: string[], extra?: string): string {
  const lines: string[] = [];
  if (capture) {
    const rel = (name: string) => `${ASSETS_DIRNAME}/${id}/${name}`;
    const has = (name: string | null) => name !== null && assetFiles.includes(name);
    if (has(capture.screenshots.annotated)) lines.push(`![viewport (annotated)](${rel(capture.screenshots.annotated!)})`);
    else if (has(capture.screenshots.viewport)) lines.push(`![viewport](${rel(capture.screenshots.viewport!)})`);
    for (const a of capture.annotations) {
      if (has(a.image)) lines.push(`![annotation ${a.n}](${rel(a.image!)})`);
    }
    if (lines.length) lines.push("");
    for (const a of capture.annotations) lines.push(describeAnnotation(a));
    lines.push("", `Capture bundle: \`${rel("capture.json")}\` (page ${capture.page.url}, ${capture.page.viewport.width}×${capture.page.viewport.height} @ ${capture.page.devicePixelRatio}x, ${capture.page.timestamp}).`);
    if (capture.console.length) {
      const errs = capture.console.filter((c) => c.level !== "warn").length;
      lines.push(`Console at send time: ${capture.console.length} entries (${errs} errors) — see capture.json.`);
    }
    if (capture.network.length) {
      const first = capture.network[0]!;
      lines.push(`Failed requests at send time: ${capture.network.length} (first: ${first.method} ${first.url} → ${first.status ?? first.error ?? "failed"}) — see capture.json.`);
    }
  }
  if (extra?.trim()) lines.push("", extra.trim());
  return lines.join("\n").trim() || "None.";
}

function describeAnnotation(a: CaptureBundle["annotations"][number]): string {
  const note = a.note ? `"${a.note}"` : "(no note)";
  if (a.kind === "select" && a.element) {
    const el = a.element;
    const tag = `<${el.tag}${el.id ? ` id="${el.id}"` : ""}${el.classes.length ? ` class="${el.classes.join(" ")}"` : ""}>`;
    const comp = el.components[0]?.name;
    const src = el.source ? `${el.source.file}${el.source.line ? `:${el.source.line}` : ""}` : null;
    const where = comp ? ` in \`${comp}\`${src ? ` (${src})` : ""}` : src ? ` (${src})` : "";
    return `Annotation ${a.n} — \`${tag}\`${where}, selector \`${el.selector}\`: ${note}`;
  }
  if (a.kind === "box") {
    const inside = a.elements.slice(0, 3).map((e) => `\`${e.selector}\``).join(", ");
    return `Annotation ${a.n} — box ${Math.round(a.rect.width)}×${Math.round(a.rect.height)} at (${Math.round(a.rect.x)}, ${Math.round(a.rect.y)})${inside ? ` containing ${inside}` : ""}: ${note}`;
  }
  return `Annotation ${a.n} — pin at (${Math.round(a.rect.x)}, ${Math.round(a.rect.y)}): ${note}`;
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Path of a task file relative to the project root, forward slashes, for messages and logs. */
export function displayPath(root: string, path: string): string {
  return relative(resolve(root), resolve(path)).split("\\").join("/");
}
