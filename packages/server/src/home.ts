/**
 * The CRT home (PRD-zero §5.3, F-130): the one place outside a project the server writes at
 * runtime (N-34) — `~/.crt`, or `CRT_HOME` (tests always set it). It holds the CRT browser's
 * profile per project (`browser/<project-key>/`, F-125) and a project's reviews
 * (`reviews/<project-key>/`, F-133): `project.json`, the guest's `config.local.json`, and one folder
 * per review with its `review.json` manifest, `tasks/` and `captures/`. store.ts decides when the
 * server writes here and announces the first creation (N-34); this module is the layout and the files.
 * Node built-ins only; nothing here is ever served to a page.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

/**
 * `CRT_HOME`, else `<homedir>/.crt`. Under a test runner the fallback is refused: a test that did
 * not set `CRT_HOME` must fail, not write into the developer's real home (PRD-zero N-34).
 */
export function crtHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CRT_HOME?.trim();
  if (override) return resolve(override);
  if (env.VITEST || env.PLAYWRIGHT_TEST || env.TEST_WORKER_INDEX) throw new Error("CRT_HOME is not set — tests must point the CRT home at a temp directory");
  return join(homedir(), ".crt");
}

/**
 * F-130: the project root's folder name (lower-cased, anything outside `[a-z0-9-]` → `-`) plus the
 * first 6 hex of the SHA-256 of the absolute root (case-folded on Windows, where paths compare
 * that way), so two checkouts of one name never share a profile or a review.
 */
export function projectKey(root: string, platform: NodeJS.Platform = process.platform): string {
  const abs = resolve(root);
  const name =
    basename(abs)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/^-+|-+$/g, "") || "project";
  const hash = createHash("sha256")
    .update(platform === "win32" ? abs.toLowerCase() : abs)
    .digest("hex")
    .slice(0, 6);
  return `${name}-${hash}`;
}

/** F-125: the CRT browser's user-data directory for a project. */
export function browserProfileDir(root: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(crtHome(env), "browser", projectKey(root));
}

// ---- reviews (PRD-zero §5.3, F-130, F-133) -----------------------------------------------------------

export const REVIEWS_DIRNAME = "reviews";
export const REVIEW_FILE = "review.json";
export const PROJECT_FILE = "project.json";
/** F-133: a review's name — the local date by default, or what `crt review new <name>` was given. */
export const REVIEW_NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

/** `<home>/reviews/<project-key>`: every review of a project, `project.json` and the guest's `config.local.json`. */
export function projectReviewsDir(root: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(crtHome(env), REVIEWS_DIRNAME, projectKey(root));
}

/** F-130: where a guest's F-72 target and F-57 provider choice are kept, in place of `.crt/config.local.json`. */
export function guestConfigPath(root: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(projectReviewsDir(root, env), "config.local.json");
}

export interface ReviewItem {
  id: string;
  /** False once the reviewer dropped it (M30); a dropped item stays in the review. */
  keep: boolean;
  /** Position in the review, 1-based; the order filed until the reviewer moves an item. */
  order: number;
}

/** `review.json` (F-133). `handovers` is filled by `crt handoff` (M31). */
export interface ReviewManifest {
  name: string;
  status: "open" | "handed";
  /** ISO-8601 with offset, like a task's `created`. */
  created: string;
  project: { root: string; remote: string | null };
  items: ReviewItem[];
  handovers: unknown[];
}

export interface Review {
  name: string;
  /** `<home>/reviews/<project-key>/<name>` */
  dir: string;
  manifest: ReviewManifest;
}

/** A review's task files (and `assets/`, `README.md`) and its captures not yet turned into items. */
export function reviewTasksDir(reviewDir: string): string {
  return join(reviewDir, "tasks");
}
export function reviewCapturesDir(reviewDir: string): string {
  return join(reviewDir, "captures");
}

/** Called with every file or directory this module creates that was not there before (N-34's announcement is the caller's). */
export type OnCreate = (path: string) => void;

/** N-34: `crt: created <path>` for the first thing a run creates under the home, and nothing after it. */
export function announceOnce(log: ((line: string) => void) | undefined): OnCreate {
  let announced = false;
  return (path) => {
    if (announced) return;
    announced = true;
    log?.(`crt: created ${path}`);
  };
}

/** `mkdir -p`, reporting the outermost directory that had to be created. */
export function ensureDir(dir: string, onCreate?: OnCreate): void {
  if (existsSync(dir)) return;
  let top = dir;
  for (let parent = dirname(top); parent !== top && !existsSync(parent); parent = dirname(top)) top = parent;
  mkdirSync(dir, { recursive: true });
  onCreate?.(top);
}

/** Temp file + rename, so a reader never sees half a file (F-133). Written with `\n`. */
export function writeJsonAtomic(path: string, value: unknown): void {
  const tmp = `${path}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  try {
    renameSync(tmp, path);
  } catch (err) {
    rmSync(tmp, { force: true });
    throw err;
  }
}

function readJsonFile(path: string): Record<string, unknown> | null {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `<dir>/review.json`, tolerating missing or junk keys (a hand edit never takes the review away); null when there is no manifest. */
export function readReview(dir: string): ReviewManifest | null {
  const raw = readJsonFile(join(dir, REVIEW_FILE));
  if (!raw) return null;
  const project = raw.project && typeof raw.project === "object" ? (raw.project as Record<string, unknown>) : {};
  const items: ReviewItem[] = [];
  for (const entry of Array.isArray(raw.items) ? raw.items : []) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (typeof e.id === "string") items.push({ id: e.id, keep: e.keep !== false, order: typeof e.order === "number" ? e.order : items.length + 1 });
  }
  return {
    name: typeof raw.name === "string" && raw.name ? raw.name : basename(dir),
    status: raw.status === "handed" ? "handed" : "open",
    created: typeof raw.created === "string" ? raw.created : "",
    project: { root: typeof project.root === "string" ? project.root : "", remote: typeof project.remote === "string" ? project.remote : null },
    items,
    handovers: Array.isArray(raw.handovers) ? raw.handovers : [],
  };
}

export function writeReview(dir: string, manifest: ReviewManifest): void {
  writeJsonAtomic(join(dir, REVIEW_FILE), manifest);
}

/** Every review of the project, oldest first (by `created`, then name). */
export function listReviews(root: string, env: NodeJS.ProcessEnv = process.env): Review[] {
  const base = projectReviewsDir(root, env);
  let names: string[];
  try {
    names = readdirSync(base);
  } catch {
    return [];
  }
  const out: Review[] = [];
  for (const name of names) {
    if (!REVIEW_NAME_RE.test(name)) continue;
    const dir = join(base, name);
    const manifest = readReview(dir);
    if (manifest) out.push({ name, dir, manifest });
  }
  return out.sort((a, b) => a.manifest.created.localeCompare(b.manifest.created) || a.name.localeCompare(b.name, "en", { numeric: true }));
}

/** §5.3: the project's newest review whose status is `open`; null when there is none. */
export function currentReview(root: string, env: NodeJS.ProcessEnv = process.env): Review | null {
  return listReviews(root, env).filter((r) => r.manifest.status === "open").pop() ?? null;
}

/** `2026-11-16`: the default name, in local time. */
export function reviewDate(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** F-133: the name a new review would get — `wanted` (default the local date), suffixed `-2`, `-3` … on a clash. */
export function freeReviewName(root: string, wanted?: string, env: NodeJS.ProcessEnv = process.env, now: Date = new Date()): string {
  const base = wanted ?? reviewDate(now);
  if (!REVIEW_NAME_RE.test(base)) throw new Error(`a review name is lower-case letters, digits and hyphens, starting with a letter or digit (got "${base}")`);
  const dir = projectReviewsDir(root, env);
  let name = base;
  for (let n = 2; existsSync(join(dir, name)); n++) name = `${base}-${n}`;
  return name;
}

export interface CreateReviewOptions {
  env?: NodeJS.ProcessEnv;
  now?: Date;
  /** `created`, as the caller formats a task's (tasks.ts `localIso`); defaults to the ISO instant. */
  created?: string;
  remote?: string | null;
  onCreate?: OnCreate;
}

/** `<home>/reviews/<key>/` with its `project.json` (written once; the folder name is the key, the file says which checkout). */
export function ensureProjectHome(root: string, opts: Pick<CreateReviewOptions, "env" | "remote" | "onCreate"> = {}): string {
  const dir = projectReviewsDir(root, opts.env);
  ensureDir(dir, opts.onCreate);
  const file = join(dir, PROJECT_FILE);
  if (!existsSync(file)) writeJsonAtomic(file, { root: resolve(root), remote: opts.remote ?? null, name: basename(resolve(root)) });
  return dir;
}

/** F-133: start a new open review (it becomes the current one: the newest open). */
export function createReview(root: string, wanted?: string, opts: CreateReviewOptions = {}): Review {
  const now = opts.now ?? new Date();
  const base = ensureProjectHome(root, opts);
  const name = freeReviewName(root, wanted, opts.env, now);
  const dir = join(base, name);
  mkdirSync(reviewTasksDir(dir), { recursive: true });
  mkdirSync(reviewCapturesDir(dir), { recursive: true });
  const manifest: ReviewManifest = {
    name,
    status: "open",
    created: opts.created ?? now.toISOString(),
    project: { root: resolve(root), remote: opts.remote ?? null },
    items: [],
    handovers: [],
  };
  writeReview(dir, manifest);
  return { name, dir, manifest };
}

/** F-133: a task was written into the review — it joins `items`, kept, at the end. Returns the manifest written. */
export function addReviewItem(dir: string, id: string): ReviewManifest | null {
  const manifest = readReview(dir);
  if (!manifest) return null;
  if (!manifest.items.some((i) => i.id === id)) {
    manifest.items.push({ id, keep: true, order: manifest.items.reduce((max, i) => Math.max(max, i.order), 0) + 1 });
    writeReview(dir, manifest);
  }
  return manifest;
}
