/**
 * `crt handoff` (PRD-zero F-136, F-137, N-35; §5.5): deliver the kept items of a review to the
 * project, in review order.
 *
 *   --to pr      a new branch `crt/review-<review>` with the items as task files, pushed, and one
 *                pull request whose body is the collated summary (`gh pr create`)
 *   --to branch  the same branch, committed locally and left for the developer to push
 *   --to here    the same files in the working tree's tasks directory, uncommitted
 *   --to bundle  a folder `crt-review-<project>-<review>/` with `REVIEW.md`, the task files and
 *                their assets, ids left as `R-NN` (F-137) — for a project the reviewer cannot push to
 *
 * The default is `pr` when the project is a git repository with a remote and `gh` on PATH,
 * `branch` when it is a repository without either, `here` otherwise.
 *
 * N-35 — the developer's checkout is never touched by `pr` and `branch`: the branch is made in a
 * temporary `git worktree` under the OS temp dir, from the remote's default branch (after a fetch;
 * from `HEAD` without a remote), and the worktree is removed afterwards, on success and on failure.
 * `HEAD`, the checked-out branch, the index, the stash and the working tree stay as they were, so a
 * running dev server sees nothing. Every destination prints its plan first and asks once
 * (`Go ahead? [Y/n]`; `--yes` skips it; off a terminal without `--yes` nothing is written).
 *
 * Ids are allocated at hand-over (§5.5): each kept item gets the next free `CRT-NNNN` of the
 * destination's tasks directory — the project's own allocator, so its ids are never reused — its
 * file is renamed, `id:` and `updated:` rewritten, `assets/R-NN/` copied to `assets/CRT-NNNN/`, the
 * links to it rewritten and one Log line appended. The index is regenerated. Nothing but the tasks
 * directory is written in the project; the review's own files stay as they are, as the record.
 *
 * `git` and `gh` are resolved and run the way `claude` is for `crt setup` (providers/exec.ts:
 * PATH and PATHEXT, `shell: false`, never a `.cmd` handed to `spawn`), from this module only and
 * only inside this command. It never force-pushes, never merges and never pushes a branch it did
 * not create. A failure is one `crt:` line saying what exists and the next command; one before the
 * commit leaves no branch behind, and the review stays `open` until the destination's last step
 * succeeded.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { readConfig } from "./config.js";
import { CrtError } from "./errors.js";
import { gitDirs } from "./git-state.js";
import { currentReview, type Handover, type HandoverDestination, listReviews, recordHandover, type Review } from "./home.js";
import { type Executable, findOnPath, firstLine, runExecutable, type RunResult } from "./providers/exec.js";
import { noReviewLine, type ReviewItemView, reviewView, type ReviewView, totalsLine } from "./review.js";
import { groupByRoute } from "./review-page.js";
import { isYes, type Prompter } from "./start.js";
import { isSetUp } from "./store.js";
import { allocateTaskId, ASSETS_DIRNAME, localIso, logStamp, TASK_FILE_RE, taskSummaryText, validateTaskText, writeIndex } from "./tasks.js";

export const HANDOFF_DESTINATIONS: readonly HandoverDestination[] = ["pr", "branch", "here", "bundle"];
/** A fetch or a push may take a while on a slow link; nothing else here does. */
const NETWORK_TIMEOUT_MS = 120_000;
const LOCAL_TIMEOUT_MS = 30_000;

export interface HandoffOptions {
  /** The project root. */
  root: string;
  to?: HandoverDestination | undefined;
  /** `--review <name>`: that review instead of the current one. */
  review?: string | undefined;
  /** `--branch <name>`: instead of `crt/review-<review>`. */
  branch?: string | undefined;
  /** `--out <dir>`: where a bundle's folder is made (default: the current directory). */
  out?: string | undefined;
  yes?: boolean;
  /** `--again`: hand a `handed` review over once more. */
  again?: boolean;
  interactive?: boolean;
  prompt?: Prompter;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  log?: (line: string) => void;
  now?: Date;
  /** Test seam: every `git` / `gh` run goes through this (the default spawns the resolved executable). */
  run?: ToolRunner;
}

/** One run of `git` or `gh`: the tool, its arguments and where. */
export type ToolRunner = (tool: "git" | "gh", exe: Executable, args: string[], opts: { cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number }) => Promise<RunResult>;

export interface HandoffResult {
  /** `nothing`: no review, or nothing kept (exit 0). */
  outcome: "handed" | "nothing";
  handover?: Handover;
}

export interface PlannedItem {
  item: ReviewItemView;
  /** The id it gets in the destination (its own `R-NN` in a bundle). */
  id: string;
  /** The file name it gets. */
  file: string;
}

// ---------------------------------------------------------------------------------------------
// Pure pieces
// ---------------------------------------------------------------------------------------------

/** §5.5: `pr` with a repository, a remote and `gh`; `branch` in a repository without either; `here` otherwise. */
export function defaultDestination(facts: { repo: boolean; git: boolean; remote: boolean; gh: boolean }): HandoverDestination {
  if (facts.repo && facts.git) return facts.remote && facts.gh ? "pr" : "branch";
  return "here";
}

/** The ids `count` new tasks get in a directory holding `names` (files, and `assets/<ID>` folders): consecutive, above the highest `CRT-NNNN` there. */
export function nextTaskIds(names: readonly string[], count: number): string[] {
  let max = 0;
  for (const name of names) {
    const m = /^CRT-(\d{4})(?![\w])/.exec(name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return Array.from({ length: count }, (_, i) => `CRT-${String(max + i + 1).padStart(4, "0")}`);
}

/**
 * A review item's text as the project gets it: `id:` and `updated:` rewritten, every
 * `assets/<old>/` link pointed at `assets/<new>/`, and the hand-over Log line appended. Everything
 * else is byte for byte what was reviewed.
 */
export function rewriteTaskText(text: string, from: string, to: string, review: string, now: Date): string {
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(text);
  let head = fm ? fm[1]! : "";
  head = head.replace(/^id:.*$/m, `id: ${to}`).replace(/^updated:.*$/m, `updated: ${localIso(now)}`);
  const body = (fm ? text.slice(fm[0].length) : text).split(`${ASSETS_DIRNAME}/${from}/`).join(`${ASSETS_DIRNAME}/${to}/`).replace(/\s+$/, "");
  const line = `- ${logStamp(now)} — handed over from review ${review} (was ${from}) by crt handoff`;
  return `${fm ? `---\n${head}\n---\n` : ""}${body}${/^## Log[ \t]*$/m.test(body) ? "" : "\n\n## Log"}\n${line}\n`;
}

export interface SummaryInput {
  view: ReviewView;
  items: PlannedItem[];
  /** One line per distinct reviewed commit (`Reviewed at 4f2a91c on main; the base (main) is 12 commits ahead.`). */
  reviewed: string[];
  /** Where the task files are, as the reader will see them (`.crt/tasks`). */
  tasksDir: string;
  setUp: boolean;
  now: Date;
  /** A bundle's `REVIEW.md`: relative links to each item's file and screenshot (item id → screenshot file name, or null). */
  links?: Map<string, string | null>;
}

/** §5.5: the collated summary — the pull request body, a bundle's `REVIEW.md`, and what `here` prints. */
export function renderSummary(s: SummaryInput): string {
  const n = s.items.length;
  const project = basename(s.view.project.root || "") || "the project";
  const lines = [
    `# CRT review ${s.view.name}: ${n} item${n === 1 ? "" : "s"}`,
    "",
    `Review \`${s.view.name}\` of \`${project}\`, started ${s.view.created || "(unknown)"} and handed over ${localIso(s.now)}. ${totalsLine(s.view.totals)}; the ${n === 1 ? "one kept item is" : `${n} kept items are`} here, in review order.`,
    "",
    ...(s.reviewed.length ? [...s.reviewed.map((r) => `- ${r}`), ""] : []),
  ];
  for (const group of groupByRoute(s.items.map((p) => ({ ...p, route: p.item.route })))) {
    lines.push(`## ${group.route ?? "(no route)"}`, "");
    for (const p of group.items) {
      const summary = taskSummaryText(join(s.view.tasksDir, p.item.file), 200);
      const shot = s.links?.get(p.item.id);
      const name = s.links ? `[${p.id}](${p.file})` : `**${p.id}**`;
      lines.push(`- ${name} (${p.item.priority}) ${p.item.title}${summary ? ` — ${summary}` : ""}${shot ? ` ([screenshot](${ASSETS_DIRNAME}/${p.item.id}/${shot}))` : ""}`);
    }
    lines.push("");
  }
  lines.push("## Working them", "");
  if (s.links) lines.push("Each file is a self-contained task and keeps the review's `R-NN` id; the project gives it one of its own when it takes the item on.");
  else lines.push(`Each item is a self-contained task file in \`${s.tasksDir}/\`. Run \`/crt:next\` in Claude Code to take the first one (\`/crt:next ${s.items[0]?.id ?? "CRT-NNNN"}\` for a particular one), or read the files.`);
  if (!s.setUp && !s.links) lines.push("", "This project is not set up for CRT yet. `crt init` adds the `.gitignore` lines and the instructions for agents; the task files work without it.");
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------------------------

export async function runHandoff(opts: HandoffOptions): Promise<HandoffResult> {
  const root = resolve(opts.root);
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((line: string) => console.log(line));
  const now = opts.now ?? new Date();

  // Which review.
  const review = pickReview(root, opts, env);
  if (!review) {
    log(noReviewLine(root));
    return { outcome: "nothing" };
  }
  if (review.manifest.status === "handed" && !opts.again) {
    const last = review.manifest.handovers.at(-1) as Partial<Handover> | undefined;
    throw new CrtError(`review ${review.name} was already handed over${last?.to ? ` (--to ${last.to}${last.url ? `, ${last.url}` : last.branch ? `, branch ${last.branch}` : ""})` : ""} — pass --again to hand it over once more`);
  }
  const view = reviewView(review);
  const kept = view.items.filter((i) => i.keep);
  if (!kept.length) {
    log(`crt: review ${review.name} has no kept items — nothing to hand over`);
    return { outcome: "nothing" };
  }

  // What the machine has.
  const git = findOnPath("git", process.platform, env);
  const gh = findOnPath("gh", process.platform, env);
  const repo = gitDirs(root) !== null;
  const runner: ToolRunner = opts.run ?? ((_tool, exe, args, o) => runExecutable(exe, args, o));
  // A credential prompt cannot be answered through a pipe: fail with git's own line instead of hanging.
  const toolEnv = { ...env, GIT_TERMINAL_PROMPT: "0" };
  const g: Git = (args, cwd = root, timeoutMs = LOCAL_TIMEOUT_MS) => runner("git", git!, args, { cwd, env: toolEnv, timeoutMs });
  const remote = repo && git ? pickRemote((await g(["remote"])).stdout) : null;
  const to = opts.to ?? defaultDestination({ repo, git: git !== null, remote: remote !== null, gh: gh !== null });
  if (to === "pr" || to === "branch") {
    if (!repo) throw new CrtError(`${root} is not a git repository — use \`crt handoff --to here\` or \`--to bundle\``);
    if (!git) throw new CrtError("git not found on PATH — install git, or use `crt handoff --to here`");
    if (to === "pr" && !remote) throw new CrtError("this repository has no remote to push to — use `crt handoff --to branch`");
    if (to === "pr" && !gh) throw new CrtError("gh (the GitHub CLI) not found on PATH — install it (https://cli.github.com), or use `crt handoff --to branch` and open the pull request yourself");
  }

  const ask = async (): Promise<void> => {
    if (opts.yes) return;
    if (!opts.interactive || !opts.prompt) throw new CrtError("crt handoff asks before it writes — run it on a terminal, or pass --yes (nothing was written)");
    if (!isYes(await opts.prompt.ask("Go ahead? [Y/n]"))) throw new CrtError("cancelled — nothing was written", 130);
  };
  const tasksRel = tasksDirOf(root);
  const setUp = isSetUp(root);
  const count = (n: number) => `${n} item${n === 1 ? "" : "s"}`;
  const title = `CRT review ${review.name}: ${count(kept.length)}`;
  const planLines = (items: PlannedItem[]) => {
    const w = Math.max(...items.map((p) => p.item.id.length));
    return items.map((p) => `  ${p.item.id.padEnd(w)}${p.id === p.item.id ? "" : ` → ${p.id}`}  ${p.item.priority.padEnd(6)}  ${p.item.route ?? "-"}  ${p.item.title}`);
  };
  const finish = (handover: Handover): HandoffResult => {
    recordHandover(review.dir, handover);
    return { outcome: "handed", handover };
  };
  const map = (items: PlannedItem[]) => Object.fromEntries(items.map((p) => [p.item.id, p.id]));
  const of = `${kept.length} of ${count(view.items.length)}`;

  // ---- bundle (F-137) ----
  if (to === "bundle") {
    const dir = join(resolve(opts.cwd ?? process.cwd(), opts.out ?? "."), `crt-review-${basename(root).toLowerCase().replace(/[^a-z0-9-]+/g, "-")}-${review.name}`);
    if (existsSync(dir)) throw new CrtError(`${dir} already exists — remove it, or pass --out <dir>`);
    const items = kept.map((item) => ({ item, id: item.id, file: item.file }));
    log(`Hand over review ${review.name} as a bundle: ${of}, ids left as they are.`);
    for (const line of planLines(items)) log(line);
    log(`Writes ${dir} (REVIEW.md, the task files and their assets).`);
    await ask();
    mkdirSync(dir, { recursive: true });
    const links = new Map<string, string | null>();
    for (const p of items) {
      writeFileSync(join(dir, p.file), readFileSync(join(view.tasksDir, p.file), "utf8"), "utf8");
      const assets = join(view.tasksDir, ASSETS_DIRNAME, p.id);
      if (existsSync(assets)) cpSync(assets, join(dir, ASSETS_DIRNAME, p.id), { recursive: true });
      links.set(p.id, ["viewport-annotated.png", "viewport.png"].find((f) => existsSync(join(assets, f))) ?? null);
    }
    writeFileSync(join(dir, "REVIEW.md"), renderSummary({ view, items, reviewed: reviewedLines(kept), tasksDir: ".", setUp, now, links }), "utf8");
    log(`Handed over review ${review.name}: ${count(kept.length)} in ${dir} — send that folder to the project.`);
    return finish({ to, at: localIso(now), items: map(items), dir });
  }

  // ---- here ----
  if (to === "here") {
    const dest = join(root, tasksRel);
    const items = plan(kept, nextTaskIds(highestIn(dest), kept.length));
    log(`Hand over review ${review.name} into this working tree: ${of}.`);
    for (const line of planLines(items)) log(line);
    log(`Writes ${tasksRel}/ in ${root}, uncommitted. Nothing else is written.`);
    await ask();
    const written = writeItems(view, kept, dest, review.name, now);
    log("");
    for (const line of renderSummary({ view, items: written, reviewed: reviewedLines(kept), tasksDir: tasksRel, setUp, now }).trimEnd().split("\n")) log(line);
    log("");
    log(`Handed over review ${review.name}: ${written.length} task file${written.length === 1 ? "" : "s"} written to ${tasksRel}/ (uncommitted).`);
    return finish({ to, at: localIso(now), items: map(written) });
  }

  // ---- pr and branch ----
  if (remote) {
    const fetched = await g(["fetch", remote], root, NETWORK_TIMEOUT_MS);
    if (fetched.status !== 0) throw new CrtError(`could not fetch ${remote} (${reason(fetched)}) — nothing was created; fix that, or use \`crt handoff --to here\``);
  }
  const base = remote ? await defaultBranch(g, remote) : null;
  if (to === "pr" && !base) throw new CrtError(`could not tell ${remote}'s default branch — nothing was created; push a first commit there, or use \`crt handoff --to branch\``);
  const baseRef = base ? `${remote}/${base}` : "HEAD";
  if ((await g(["rev-parse", "--verify", "--quiet", `${baseRef}^{commit}`])).status !== 0) {
    throw new CrtError(`this repository has no commit to branch from (${baseRef}) — nothing was created; use \`crt handoff --to here\``);
  }
  const wanted = opts.branch ?? `crt/review-${review.name}`;
  if ((await g(["check-ref-format", "--branch", wanted])).status !== 0) throw new CrtError(`"${wanted}" is not a branch name git accepts`, 2);
  let branch = wanted;
  for (let n = 2; await branchExists(g, branch, remote); n++) branch = `${wanted}-${n}`;
  // The ids as the plan shows them: from the base's own tree (files, and `assets/<ID>` folders).
  const listed = await g(["ls-tree", "-r", "--name-only", baseRef, "--", `${tasksRel}/`]);
  const inBase = listed.stdout.split("\n").map((p) => {
    const rest = p.slice(tasksRel.length + 1);
    return (rest.startsWith(`${ASSETS_DIRNAME}/`) ? rest.slice(ASSETS_DIRNAME.length + 1) : rest).split("/")[0]!;
  });
  const items = plan(kept, nextTaskIds(inBase, kept.length));
  const reviewed = await reviewedAgainst(g, kept, baseRef, base ?? "HEAD");

  log(`Hand over review ${review.name} as a ${to === "pr" ? "pull request" : "branch"}: ${of}.`);
  for (const line of planLines(items)) log(line);
  log(`Writes ${tasksRel}/ on a new branch ${branch}, made from ${baseRef} in a temporary worktree — your checkout is not touched.`);
  log(to === "pr" ? `Then pushes ${branch} to ${remote} and opens a pull request into ${base}: "${title}".` : "The branch stays local: nothing is pushed.");
  await ask();

  // The worktree: made, written, committed and removed — whatever happens in between.
  const worktree = mkdtempSync(join(tmpdir(), "crt-handoff-"));
  let committed = false;
  let written: PlannedItem[] = [];
  try {
    const added = await g(["worktree", "add", "--no-track", "-b", branch, worktree, baseRef]);
    if (added.status !== 0) throw new CrtError(`could not create the branch ${branch} in a temporary worktree (${reason(added)}) — nothing was created; fix that, or use \`crt handoff --to here\``);
    try {
      written = writeItems(view, kept, join(worktree, tasksRel), review.name, now);
      const staged = await g(["add", "--", tasksRel], worktree);
      // Hooks are skipped: the worktree has no installed dependencies for them, and the commit is task files only.
      const commit = staged.status === 0 ? await g(["commit", "--no-verify", "-m", `chore(crt): review ${review.name} — ${count(written.length)}`, "--", tasksRel], worktree) : staged;
      if (commit.status !== 0) throw new CrtError(`could not commit the task files on ${branch} (${reason(commit)}) — nothing was created`);
      committed = true;
    } finally {
      await g(["worktree", "remove", "--force", worktree]);
      if (!committed) await g(["branch", "-D", branch]); // a failure before the commit leaves no branch behind
    }
  } finally {
    rmSync(worktree, { recursive: true, force: true });
    await g(["worktree", "prune"]);
  }
  const body = renderSummary({ view, items: written, reviewed, tasksDir: tasksRel, setUp, now });

  if (to === "branch") {
    log(`Handed over review ${review.name}: ${count(written.length)} committed on ${branch} (from ${baseRef}).`);
    log(remote ? `Push it and open a pull request when you are ready: git push ${remote} ${branch}` : `Merge it when you are ready: git merge ${branch}`);
    return finish({ to, at: localIso(now), items: map(written), branch, base: baseRef });
  }

  const bodyFile = join(tmpdir(), `crt-handoff-${review.name}-${process.pid}.md`);
  writeFileSync(bodyFile, body, "utf8");
  const create = ["pr", "create", "--base", base!, "--head", branch, "--title", title, "--body-file", bodyFile];
  const byHand = `gh ${create.map((a) => (/[\s"]/.test(a) ? JSON.stringify(a) : a)).join(" ")}`;
  // Only the branch made above, by its full name, and never forced.
  const pushed = await g(["push", remote!, `refs/heads/${branch}:refs/heads/${branch}`], root, NETWORK_TIMEOUT_MS);
  if (pushed.status !== 0) {
    throw new CrtError(`committed ${branch} locally but could not push it (${reason(pushed)}) — the review is still open; push it and open the pull request with: git push ${remote} ${branch} && ${byHand}`);
  }
  const opened = await runner("gh", gh!, create, { cwd: root, env: toolEnv, timeoutMs: NETWORK_TIMEOUT_MS });
  const url = /https?:\/\/\S+/.exec(opened.stdout)?.[0] ?? null;
  if (opened.status !== 0 || !url) {
    throw new CrtError(`pushed ${branch} but could not open the pull request (${reason(opened)}) — the review is still open; open it with: ${byHand}`);
  }
  rmSync(bodyFile, { force: true });
  log(`Handed over review ${review.name}: ${count(written.length)} on ${branch} — ${url}`);
  log("Merging that pull request is when the project takes the feedback on; `/crt:next` works the items from there.");
  return finish({ to, at: localIso(now), items: map(written), branch, base: baseRef, url });
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

type Git = (args: string[], cwd?: string, timeoutMs?: number) => Promise<RunResult>;

/** `--review <name>`, else the current review, else the newest one (to hand it over `--again`, or to say it already was). */
function pickReview(root: string, opts: HandoffOptions, env: NodeJS.ProcessEnv): Review | null {
  const all = listReviews(root, env);
  if (opts.review !== undefined) {
    const named = all.find((r) => r.name === opts.review);
    if (!named) throw new CrtError(`no review ${opts.review} for ${root} — \`crt review list\` shows them`);
    return named;
  }
  return currentReview(root, env) ?? all.at(-1) ?? null;
}

/** The project's tasks directory relative to its root, with `/` — `.crt/tasks` unless the config names another inside the project. */
function tasksDirOf(root: string): string {
  const rel = relative(root, resolve(root, readConfig(root).tasksDir));
  return !rel || rel.startsWith("..") || isAbsolute(rel) ? ".crt/tasks" : rel.split("\\").join("/");
}

/** The highest id a directory on disk holds, as a name for `nextTaskIds` — by the project's own allocator (tasks.ts), so the two never disagree. */
function highestIn(tasksDir: string): string[] {
  return [`CRT-${String(Number(allocateTaskId(tasksDir).slice(4)) - 1).padStart(4, "0")}`];
}

function plan(kept: ReviewItemView[], ids: string[]): PlannedItem[] {
  return kept.map((item, i) => ({ item, id: ids[i]!, file: item.file.replace(TASK_FILE_RE, (_m, _id: string, slug: string) => `${ids[i]}-${slug}.md`) }));
}

/**
 * Write the kept items into `dest` with the destination's own next ids (§5.5), then the index.
 * Every file is checked against the F-32 format before anything is written.
 */
function writeItems(view: ReviewView, kept: ReviewItemView[], dest: string, review: string, now: Date): PlannedItem[] {
  mkdirSync(dest, { recursive: true });
  const items = plan(kept, nextTaskIds(highestIn(dest), kept.length));
  const texts = items.map((p) => {
    const text = rewriteTaskText(readFileSync(join(view.tasksDir, p.item.file), "utf8"), p.item.id, p.id, review, now);
    const errors = validateTaskText(text, p.file);
    if (errors.length) throw new CrtError(`${p.item.id} would not be a valid task file as ${p.id} (${errors[0]}) — nothing was written; fix ${join(view.tasksDir, p.item.file)}`);
    return text;
  });
  items.forEach((p, i) => {
    const assets = join(view.tasksDir, ASSETS_DIRNAME, p.item.id);
    if (existsSync(assets)) cpSync(assets, join(dest, ASSETS_DIRNAME, p.id), { recursive: true });
    writeFileSync(join(dest, p.file), texts[i]!, "utf8");
  });
  writeIndex(dest);
  return items;
}

/** `origin`, else the first remote; null without one. */
function pickRemote(stdout: string): string | null {
  const names = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return names.includes("origin") ? "origin" : (names[0] ?? null);
}

/** The remote's default branch: what its `HEAD` names, else `main` or `master` when it has one; null for an empty remote. */
async function defaultBranch(g: Git, remote: string): Promise<string | null> {
  const asked = await g(["ls-remote", "--symref", remote, "HEAD"], undefined, NETWORK_TIMEOUT_MS);
  const named = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(asked.stdout)?.[1];
  if (named && (await g(["rev-parse", "--verify", "--quiet", `refs/remotes/${remote}/${named}`])).status === 0) return named;
  for (const candidate of ["main", "master"]) {
    if ((await g(["rev-parse", "--verify", "--quiet", `refs/remotes/${remote}/${candidate}`])).status === 0) return candidate;
  }
  return null;
}

async function branchExists(g: Git, branch: string, remote: string | null): Promise<boolean> {
  if ((await g(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`])).status === 0) return true;
  return remote !== null && (await g(["rev-parse", "--verify", "--quiet", `refs/remotes/${remote}/${branch}`])).status === 0;
}

/** The distinct commits the kept items were reviewed at, in review order. */
function reviewedCommits(kept: ReviewItemView[]): { commit: string | null; branch: string | null }[] {
  const seen = new Map<string, { commit: string | null; branch: string | null }>();
  for (const i of kept) if (i.commit || i.branch) seen.set(`${i.commit} ${i.branch}`, { commit: i.commit, branch: i.branch });
  return [...seen.values()];
}

function reviewedLine(r: { commit: string | null; branch: string | null }): string {
  return `Reviewed ${r.commit ? `at \`${r.commit.slice(0, 7)}\`` : "with no commit yet"}${r.branch ? ` on \`${r.branch}\`` : ""}`;
}

/** Without git: what was reviewed, and no word on the base. */
function reviewedLines(kept: ReviewItemView[]): string[] {
  return reviewedCommits(kept).map((r) => `${reviewedLine(r)}.`);
}

/** §5.5: `Reviewed at 4f2a91c on main; the base (main) is 12 commits ahead.` */
async function reviewedAgainst(g: Git, kept: ReviewItemView[], baseRef: string, baseName: string): Promise<string[]> {
  const out: string[] = [];
  for (const r of reviewedCommits(kept)) {
    if (!r.commit) {
      out.push(`${reviewedLine(r)}.`);
      continue;
    }
    const ahead = await g(["rev-list", "--count", `${r.commit}..${baseRef}`]);
    const n = ahead.status === 0 ? Number(ahead.stdout.trim()) : NaN;
    out.push(`${reviewedLine(r)}; ${Number.isNaN(n) ? `that commit is not in the base (\`${baseName}\`)` : n === 0 ? `the base (\`${baseName}\`) has not moved since` : `the base (\`${baseName}\`) is ${n} commit${n === 1 ? "" : "s"} ahead`}.`);
  }
  return out;
}

/** What a failed tool said, in one line. */
function reason(r: RunResult): string {
  return r.error ?? firstLine(r.stderr) ?? firstLine(r.stdout) ?? `exit ${r.status}`;
}
