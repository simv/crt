/**
 * Where a running CRT keeps what it writes (PRD-zero §5.2, §5.3; F-129, F-130, F-133, F-134; N-33, N-34).
 *
 *   • `project` — a set-up project (`<root>/.crt/tasks/` exists, the F-99 test) without `--review`:
 *     captures in `.crt/captures/`, tasks in the configured tasks directory with `CRT-NNNN` ids, the
 *     machine-local config in `.crt/config.local.json`. Exactly what CRT did before 0.8.
 *   • `review` — a guest (a project that is not set up), or a set-up project started with `--review`
 *     or `"store": "review"`: everything goes to the project's folder under the CRT home
 *     (`<home>/reviews/<project-key>/`, home.ts). Captures and tasks live in the **current review**
 *     — the newest open one, created by the first capture when there is none — with `R-NN` ids, and
 *     the machine-local config sits beside the reviews. Nothing under the project root is created,
 *     modified or deleted (N-33).
 *
 * The session registry, the capture route, the config route and the permission policy all go
 * through one `Store`, so none of them knows which of the two it is. A review can change under a
 * running server (`crt review new`, a hand-over), so the review is resolved per capture, and a
 * capture stays with the review it was written into: its task lands there too.
 *
 * N-34: the first thing a run creates under the home is announced once (`crt: created <path>`).
 */
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { capturesDir, pruneCapturesIn, writeCaptureIn, type WrittenCapture } from "./captures.js";
import { type CrtConfig, readConfig, writeLocalConfig } from "./config.js";
import { type GitState, readGitRemote, readGitState } from "./git-state.js";
import {
  addReviewItem,
  announceOnce,
  createReview,
  currentReview,
  ensureProjectHome,
  freeReviewName,
  guestConfigPath,
  listReviews,
  type OnCreate,
  projectKey,
  projectReviewsDir,
  type Review,
  reviewCapturesDir,
  reviewTasksDir,
} from "./home.js";
import { countTaskFiles, type CreatedTask, createTask, displayPath, localIso, type NewTaskInput } from "./tasks.js";

/** `<root>/.crt/tasks` exists — the F-99 test for "set up" (init.ts `isInitialised` is the same test). */
export function isSetUp(root: string): boolean {
  return existsSync(join(root, ".crt", "tasks"));
}

/**
 * F-129: which store a start uses. A project that is not set up is always a guest; a set-up one
 * collects into a review under `--review` or `"store": "review"`.
 */
export function storeKind(root: string, opts: { review?: boolean; config?: Pick<CrtConfig, "store"> } = {}): { kind: "project" | "review"; guest: boolean } {
  const guest = !isSetUp(root);
  return { kind: guest || opts.review === true || opts.config?.store === "review" ? "review" : "project", guest };
}

/** F-130: the configuration of a project as a start in that store reads it (the home's file over the project's two for a review). */
export function readStoreConfig(root: string, kind: "project" | "review", env: NodeJS.ProcessEnv = process.env): CrtConfig {
  return readConfig(root, kind === "review" ? guestConfigPath(root, env) : null);
}

export interface WrittenTask {
  id: string;
  /** How messages and the panel name the file: relative to the project in a project store, absolute in a review. */
  path: string;
}

export interface Store {
  readonly kind: "project" | "review";
  /** The project is not set up (F-129). A guest's store is always a review. */
  readonly guest: boolean;
  readonly projectRoot: string;
  /** The review tasks go to: the current one, else the name the first capture will create. Null in a project store. */
  review(): string | null;
  /** Where tasks are written right now (a review that does not exist yet has no directory: null). */
  tasksDir(): string | null;
  /** Task files there (the ready line, health). */
  taskCount(): number;
  /** The tasks directory as the ready line and the welcome card name it. */
  tasksLabel(): string;
  /** F-13: validate and write a capture; in a review this creates the review when there is no open one. */
  writeCapture(body: unknown, now?: Date): WrittenCapture;
  /** The directory of a capture written here (or found on disk after a restart). */
  captureDir(id: string): string;
  /** F-23: remove captures older than 7 days; returns their ids. */
  pruneCaptures(now?: Date): string[];
  /** §5.3 of PRD-providers: the one write path behind `write_task`. */
  createTask(input: NewTaskInput, now?: Date): WrittenTask & { created: CreatedTask };
  /** The configuration as this store layers it (F-130). */
  readConfig(): CrtConfig;
  /** F-57, F-72, F-124: merge into the machine-local config file; returns the path written. */
  writeLocalConfig(patch: Parameters<typeof writeLocalConfig>[1]): string;
  /** How messages name that file (`.crt/config.local.json`, or its path under the home). */
  localConfigLabel(): string;
  /** F-129: directories besides the project root an intake session reads (a review: the project's folder under the home). */
  readDirs(): string[];
  /** F-26: where an intake session's file writes are allowed without a card. */
  writeRoots(): string[];
  /** A place for a driver's per-session files (the Antigravity plugin): never inside a guest's project. */
  scratchDir(): string;
}

export interface StoreOptions {
  root: string;
  /** `--review [name]`: collect into a review; a name starts (or continues) the review of that name. */
  review?: boolean | string | undefined;
  env?: NodeJS.ProcessEnv;
  log?: (line: string) => void;
  /** N-34: the run's one announcer, when the caller shares it with the CRT browser's profile; defaults to one over `log`. */
  onCreate?: OnCreate;
}

/** F-129: the store for a start in `root` — the project's own `.crt/`, or the current review under the CRT home. */
export function openStore(opts: StoreOptions): Store {
  const root = resolve(opts.root);
  const env = opts.env ?? process.env;
  const base = readConfig(root);
  const { kind, guest } = storeKind(root, { review: opts.review !== undefined && opts.review !== false, config: base });
  return kind === "project" ? projectStore(root, base.tasksDir, opts.log) : reviewStore(root, guest, typeof opts.review === "string" ? opts.review : null, env, opts.log, opts.onCreate ?? announceOnce(opts.log));
}

/** The pre-0.8 store: `<root>/.crt/` and the tasks directory (absolute, or relative to the root). */
export function projectStore(root: string, tasksDirSetting: string, log?: (line: string) => void): Store {
  const tasksDir = resolve(root, tasksDirSetting);
  /** F-134: the git state at capture time, by capture id (a restart forgets; `createTask` then reads it afresh). */
  const git = new Map<string, GitState>();
  const gitState = unreadOnce(root, log);
  return {
    kind: "project",
    guest: false,
    projectRoot: root,
    review: () => null,
    tasksDir: () => tasksDir,
    taskCount: () => countTaskFiles(tasksDir),
    tasksLabel: () => displayPath(root, tasksDir) || ".",
    writeCapture: (body, now) => {
      const written = writeCaptureIn(capturesDir(root), body, now);
      git.set(written.id, gitState());
      return written;
    },
    captureDir: (id) => join(capturesDir(root), id),
    pruneCaptures: (now) => (existsSync(capturesDir(root)) ? pruneCapturesIn(capturesDir(root), now) : []),
    createTask: (input, now) => {
      const state = input.captureId ? git.get(input.captureId) : undefined;
      const created = createTask(root, tasksDir, input, now, { git: state ?? gitState() });
      return { id: created.id, path: displayPath(root, created.path), created };
    },
    readConfig: () => readConfig(root),
    writeLocalConfig: (patch) => writeLocalConfig(root, patch),
    localConfigLabel: () => ".crt/config.local.json",
    readDirs: () => [],
    writeRoots: () => [join(root, ".crt")],
    scratchDir: () => capturesDir(root),
  };
}

/** F-134: the project's git state now; PRD-zero §12 rule 6: a `.git` shape that was not read is said once per run, and the items carry nulls. */
function unreadOnce(root: string, log: ((line: string) => void) | undefined): () => GitState {
  let warned = false;
  return () =>
    readGitState(root, (why) => {
      if (!warned) log?.(`crt: could not read the current commit from .git (${why})`);
      warned = true;
    });
}

function reviewStore(root: string, guest: boolean, named: string | null, env: NodeJS.ProcessEnv, log: ((line: string) => void) | undefined, onCreate: OnCreate): Store {
  const home = projectReviewsDir(root, env);
  const gitState = unreadOnce(root, log);
  /** A capture stays with the review it was written into (and remembers the git state it saw, F-134). */
  const captures = new Map<string, { dir: string; git: GitState }>();
  /** `--review <name>`: that review when it is open, else it is created by the first capture. */
  const wanted = (): Review | null => {
    if (named === null) return currentReview(root, env);
    return listReviews(root, env).find((r) => r.name === named && r.manifest.status === "open") ?? null;
  };
  const ensureReview = (now: Date = new Date()): Review =>
    wanted() ?? createReview(root, named ?? undefined, { env, now, created: localIso(now), remote: readGitRemote(root), onCreate });
  const findCapture = (id: string): string => {
    const known = captures.get(id);
    if (known) return known.dir;
    // After a restart: the capture is in whichever review it was written into (ids are unique across them).
    for (const review of listReviews(root, env).reverse()) {
      const dir = join(reviewCapturesDir(review.dir), id);
      if (existsSync(dir)) return dir;
    }
    return join(reviewCapturesDir(join(home, wanted()?.name ?? freeReviewName(root, named ?? undefined, env))), id);
  };
  return {
    kind: "review",
    guest,
    projectRoot: root,
    review: () => wanted()?.name ?? freeReviewName(root, named ?? undefined, env),
    tasksDir: () => {
      const review = wanted();
      return review ? reviewTasksDir(review.dir) : null;
    },
    taskCount() {
      const dir = this.tasksDir();
      return dir ? countTaskFiles(dir) : 0;
    },
    tasksLabel() {
      return reviewTasksDir(join(home, this.review()!));
    },
    writeCapture: (body, now) => {
      const review = ensureReview(now);
      const written = writeCaptureIn(reviewCapturesDir(review.dir), body, now);
      captures.set(written.id, { dir: written.dir, git: gitState() });
      return written;
    },
    captureDir: findCapture,
    pruneCaptures: (now) => {
      const review = wanted();
      return review ? pruneCapturesIn(reviewCapturesDir(review.dir), now) : [];
    },
    createTask: (input, now) => {
      // The capture's own review (it may have been handed over or superseded since); the current one without a capture.
      const captureDir = input.captureId ? findCapture(input.captureId) : null;
      const reviewDir = captureDir ? dirname(dirname(captureDir)) : ensureReview(now).dir;
      const created = createTask(root, reviewTasksDir(reviewDir), input, now, {
        capturesDir: reviewCapturesDir(reviewDir),
        prefix: "R",
        git: (input.captureId ? captures.get(input.captureId)?.git : undefined) ?? gitState(),
      });
      addReviewItem(reviewDir, created.id);
      return { id: created.id, path: created.path, created };
    },
    readConfig: () => readConfig(root, guestConfigPath(root, env)),
    writeLocalConfig: (patch) => {
      ensureProjectHome(root, { env, remote: readGitRemote(root), onCreate });
      return writeLocalConfig(root, patch, home);
    },
    localConfigLabel: () => guestConfigPath(root, env),
    readDirs: () => {
      // The session starts before the first capture exists (warm start, N-2), so the folder is there from the first session on.
      ensureProjectHome(root, { env, remote: readGitRemote(root), onCreate });
      return [home];
    },
    writeRoots: () => [home],
    // Under the OS temp dir (an allowed write root, N-34): a driver's scratch files are not part of a review.
    scratchDir: () => join(tmpdir(), "crt", projectKey(root)),
  };
}

/** F-129: the line a guest start prints before the ready line. */
export function guestLine(root: string, env: NodeJS.ProcessEnv = process.env): string {
  return `crt: ${root} is not set up for CRT — keeping this review in ${projectReviewsDir(root, env)} (nothing is written to the project; \`crt init\` adopts CRT here).`;
}
