/**
 * The project's own repository as a destination (PRD-zero §5.5, F-136, N-35; moved behind the
 * destination contract by PRD-destinations F-140 with no change in behaviour, N-37):
 *
 *   pr      a new branch `crt/review-<review>` with the items as task files, pushed, and one pull
 *           request whose body is the collated summary (`gh pr create`)
 *   branch  the same branch, committed locally and left for the developer to push
 *   here    the same files in the working tree's tasks directory, uncommitted
 *
 * N-35 — the developer's checkout is never touched by `pr` and `branch`: the branch is made in a
 * temporary `git worktree` under the OS temp dir, from the remote's default branch (after a fetch;
 * from `HEAD` without a remote), and the worktree is removed afterwards, on success and on failure.
 * `inWorktree` is that mechanism, shared with the `github` destination's assets branch (F-148).
 *
 * Ids are allocated at hand-over: each item gets the next free `CRT-NNNN` of the destination's
 * tasks directory, its file is renamed, `id:` and `updated:` rewritten, `assets/R-NN/` copied to
 * `assets/CRT-NNNN/`, the links to it rewritten and one Log line appended. Nothing but the tasks
 * directory is written in the project. `git` and `gh` run through the context only; nothing is
 * ever forced, merged, or pushed to a branch this run did not create.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { readConfig } from "../config.js";
import { CrtError } from "../errors.js";
import { allocateTaskId, ASSETS_DIRNAME, localIso, logStamp, TASK_FILE_RE, validateTaskText, writeIndex } from "../tasks.js";
import { assetsDirOf, count, type Git, gitOf, NETWORK_TIMEOUT_MS, ofLine, type PlannedItem, planLines, projectFacts, reason, renderSummary, reviewedAgainst, reviewedLines } from "./shared.js";
import type { Destination, DestinationContext, DestinationPlan, FeedbackItem, PublishedItem, PublishInput } from "./types.js";

// ---------------------------------------------------------------------------------------------
// Pure pieces
// ---------------------------------------------------------------------------------------------

/** PRD-zero §5.5: `pr` with a repository, a remote and `gh`; `branch` in a repository without either; `here` otherwise. */
export function defaultDestination(facts: { repo: boolean; git: boolean; remote: boolean; gh: boolean }): "pr" | "branch" | "here" {
  if (facts.repo && facts.git) return facts.remote && facts.gh ? "pr" : "branch";
  return "here";
}

/** The ids `n` new tasks get in a directory holding `names` (files, and `assets/<ID>` folders): consecutive, above the highest `CRT-NNNN` there. */
export function nextTaskIds(names: readonly string[], n: number): string[] {
  let max = 0;
  for (const name of names) {
    const m = /^CRT-(\d{4})(?![\w])/.exec(name);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return Array.from({ length: n }, (_, i) => `CRT-${String(max + i + 1).padStart(4, "0")}`);
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

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** The project's tasks directory relative to its root, with `/` — `.crt/tasks` unless the config names another inside the project. */
export function tasksDirOf(root: string): string {
  const rel = relative(root, resolve(root, readConfig(root).tasksDir));
  return !rel || rel.startsWith("..") || isAbsolute(rel) ? ".crt/tasks" : rel.split("\\").join("/");
}

/** The highest id a directory on disk holds, as a name for `nextTaskIds` — by the project's own allocator (tasks.ts), so the two never disagree. */
function highestIn(tasksDir: string): string[] {
  return [`CRT-${String(Number(allocateTaskId(tasksDir).slice(4)) - 1).padStart(4, "0")}`];
}

function planned(items: FeedbackItem[], ids: string[]): PlannedItem[] {
  return items.map((item, i) => ({ item, id: ids[i]!, file: item.file.replace(TASK_FILE_RE, (_m, _id: string, slug: string) => `${ids[i]}-${slug}.md`) }));
}

/**
 * Write the items into `dest` with the destination's own next ids, then the index. Every file is
 * checked against the F-32 format before anything is written.
 */
function writeItems(items: FeedbackItem[], dest: string, review: string, now: Date): PlannedItem[] {
  mkdirSync(dest, { recursive: true });
  const out = planned(items, nextTaskIds(highestIn(dest), items.length));
  const texts = out.map((p) => {
    const text = rewriteTaskText(readFileSync(p.item.path, "utf8"), p.item.id, p.id, review, now);
    const errors = validateTaskText(text, p.file);
    if (errors.length) throw new CrtError(`${p.item.id} would not be a valid task file as ${p.id} (${errors[0]}) — nothing was written; fix ${p.item.path}`);
    return text;
  });
  out.forEach((p, i) => {
    const assets = assetsDirOf(p.item);
    if (existsSync(assets)) cpSync(assets, join(dest, ASSETS_DIRNAME, p.id), { recursive: true });
    writeFileSync(join(dest, p.file), texts[i]!, "utf8");
  });
  writeIndex(dest);
  return out;
}

/** The remote's default branch: what its `HEAD` names, else `main` or `master` when it has one; null for an empty remote. */
export async function defaultBranch(g: Git, remote: string): Promise<string | null> {
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

/** `wanted`, or `wanted-2`, `-3` … when a branch of that name exists locally or on the remote. Refuses a name git does not accept. */
export async function freeBranchName(g: Git, wanted: string, remote: string | null): Promise<string> {
  if ((await g(["check-ref-format", "--branch", wanted])).status !== 0) throw new CrtError(`"${wanted}" is not a branch name git accepts`, 2);
  let branch = wanted;
  for (let n = 2; await branchExists(g, branch, remote); n++) branch = `${wanted}-${n}`;
  return branch;
}

/**
 * N-35: make `branch` from `baseRef` in a temporary worktree, let `write` fill it and name what to
 * stage, commit, and remove the worktree — whatever happens in between. A failure before the commit
 * leaves no branch behind. Hooks are skipped: the worktree has none of the project's installed hook
 * dependencies, and the commit holds only what CRT wrote.
 */
export async function inWorktree<T>(g: Git, o: { branch: string; baseRef: string; message: string; pathspec: string; what: string; hint: string }, write: (worktree: string) => T): Promise<T> {
  const worktree = mkdtempSync(join(tmpdir(), "crt-handoff-"));
  let committed = false;
  try {
    const added = await g(["worktree", "add", "--no-track", "-b", o.branch, worktree, o.baseRef]);
    if (added.status !== 0) throw new CrtError(`could not create the branch ${o.branch} in a temporary worktree (${reason(added)}) — nothing was created; fix that, or ${o.hint}`);
    try {
      const result = write(worktree);
      const staged = await g(["add", "--", o.pathspec], worktree);
      const commit = staged.status === 0 ? await g(["commit", "--no-verify", "-m", o.message, "--", o.pathspec], worktree) : staged;
      if (commit.status !== 0) throw new CrtError(`could not commit ${o.what} on ${o.branch} (${reason(commit)}) — nothing was created`);
      committed = true;
      return result;
    } finally {
      await g(["worktree", "remove", "--force", worktree]);
      if (!committed) await g(["branch", "-D", o.branch]); // a failure before the commit leaves no branch behind
    }
  } finally {
    rmSync(worktree, { recursive: true, force: true });
    await g(["worktree", "prune"]);
  }
}

const published = (items: PlannedItem[]): PublishedItem[] => items.map((p) => ({ item: p.item.id, id: p.id }));

// ---------------------------------------------------------------------------------------------
// here
// ---------------------------------------------------------------------------------------------

export const here: Destination = {
  apiVersion: 1,
  id: "here",
  title: "This working tree",
  final: true,
  plan(input) {
    const { root } = input.project;
    const tasksRel = tasksDirOf(root);
    const items = planned(input.items, nextTaskIds(highestIn(join(root, tasksRel)), input.items.length));
    return {
      lines: [`Hand over review ${input.review.name} into this working tree: ${ofLine(input)}.`, ...planLines(items), `Writes ${tasksRel}/ in ${root}, uncommitted. Nothing else is written.`],
      sends: [],
      state: tasksRel,
    };
  },
  async *publish(input, plan, ctx) {
    const tasksRel = plan.state as string;
    const written = writeItems(input.items, join(input.project.root, tasksRel), input.review.name, ctx.now);
    ctx.log("");
    for (const line of renderSummary({ input, items: written, reviewed: reviewedLines(input.items), tasksDir: tasksRel, now: ctx.now }).trimEnd().split("\n")) ctx.log(line);
    ctx.log("");
    ctx.log(`Handed over review ${input.review.name}: ${written.length} task file${written.length === 1 ? "" : "s"} written to ${tasksRel}/ (uncommitted).`);
    yield* published(written);
  },
};

// ---------------------------------------------------------------------------------------------
// pr and branch
// ---------------------------------------------------------------------------------------------

interface BranchState {
  remote: string | null;
  base: string | null;
  baseRef: string;
  branch: string;
  tasksRel: string;
  reviewed: string[];
  title: string;
}

async function planBranch(to: "pr" | "branch", input: PublishInput, ctx: DestinationContext): Promise<DestinationPlan> {
  const { root } = input.project;
  const facts = await projectFacts(root, ctx);
  if (!facts.repo) throw new CrtError(`${root} is not a git repository — use \`crt handoff --to here\` or \`--to bundle\``);
  if (!facts.git) throw new CrtError("git not found on PATH — install git, or use `crt handoff --to here`");
  if (to === "pr" && !facts.remote) throw new CrtError("this repository has no remote to push to — use `crt handoff --to branch`");
  if (to === "pr" && !facts.gh) throw new CrtError("gh (the GitHub CLI) not found on PATH — install it (https://cli.github.com), or use `crt handoff --to branch` and open the pull request yourself");
  const g = gitOf(root, ctx);
  const { remote } = facts;
  const tasksRel = tasksDirOf(root);
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
  const branch = await freeBranchName(g, typeof ctx.flags.branch === "string" ? ctx.flags.branch : `crt/review-${input.review.name}`, remote);
  // The ids as the plan shows them: from the base's own tree (files, and `assets/<ID>` folders).
  const listed = await g(["ls-tree", "-r", "--name-only", baseRef, "--", `${tasksRel}/`]);
  const inBase = listed.stdout.split("\n").map((p) => {
    const rest = p.slice(tasksRel.length + 1);
    return (rest.startsWith(`${ASSETS_DIRNAME}/`) ? rest.slice(ASSETS_DIRNAME.length + 1) : rest).split("/")[0]!;
  });
  const items = planned(input.items, nextTaskIds(inBase, input.items.length));
  const title = `CRT review ${input.review.name}: ${count(input.items.length)}`;
  const state: BranchState = { remote, base, baseRef, branch, tasksRel, reviewed: await reviewedAgainst(g, input.items, baseRef, base ?? "HEAD"), title };
  return {
    lines: [
      `Hand over review ${input.review.name} as a ${to === "pr" ? "pull request" : "branch"}: ${ofLine(input)}.`,
      ...planLines(items),
      `Writes ${tasksRel}/ on a new branch ${branch}, made from ${baseRef} in a temporary worktree — your checkout is not touched.`,
      to === "pr" ? `Then pushes ${branch} to ${remote} and opens a pull request into ${base}: "${title}".` : "The branch stays local: nothing is pushed.",
    ],
    sends: [],
    state,
  };
}

async function* publishBranch(to: "pr" | "branch", input: PublishInput, plan: DestinationPlan, ctx: DestinationContext): AsyncGenerator<PublishedItem> {
  const { root } = input.project;
  const { remote, base, baseRef, branch, tasksRel, reviewed, title } = plan.state as BranchState;
  const g = gitOf(root, ctx);
  const name = input.review.name;
  const written = await inWorktree(
    g,
    { branch, baseRef, message: `chore(crt): review ${name} — ${count(input.items.length)}`, pathspec: tasksRel, what: "the task files", hint: "use `crt handoff --to here`" },
    (worktree) => writeItems(input.items, join(worktree, tasksRel), name, ctx.now),
  );
  const body = renderSummary({ input, items: written, reviewed, tasksDir: tasksRel, now: ctx.now });

  if (to === "branch") {
    ctx.log(`Handed over review ${name}: ${count(written.length)} committed on ${branch} (from ${baseRef}).`);
    ctx.log(remote ? `Push it and open a pull request when you are ready: git push ${remote} ${branch}` : `Merge it when you are ready: git merge ${branch}`);
    ctx.record({ branch, base: baseRef });
    yield* published(written);
    return;
  }

  // A half-way failure keeps the body where the printed command names it.
  const bodyFile = join(tmpdir(), `crt-handoff-${name}-${process.pid}.md`);
  writeFileSync(bodyFile, body, "utf8");
  const create = ["pr", "create", "--base", base!, "--head", branch, "--title", title, "--body-file", bodyFile];
  const byHand = `gh ${create.map((a) => (/[\s"]/.test(a) ? JSON.stringify(a) : a)).join(" ")}`;
  // Only the branch made above, by its full name, and never forced.
  const pushed = await g(["push", remote!, `refs/heads/${branch}:refs/heads/${branch}`], root, NETWORK_TIMEOUT_MS);
  if (pushed.status !== 0) {
    throw new CrtError(`committed ${branch} locally but could not push it (${reason(pushed)}) — the review is still open; push it and open the pull request with: git push ${remote} ${branch} && ${byHand}`);
  }
  const opened = await ctx.run("gh", create, { cwd: root, timeoutMs: NETWORK_TIMEOUT_MS });
  const url = /https?:\/\/\S+/.exec(opened.stdout)?.[0] ?? null;
  if (opened.status !== 0 || !url) {
    throw new CrtError(`pushed ${branch} but could not open the pull request (${reason(opened)}) — the review is still open; open it with: ${byHand}`);
  }
  rmSync(bodyFile, { force: true });
  ctx.log(`Handed over review ${name}: ${count(written.length)} on ${branch} — ${url}`);
  ctx.log("Merging that pull request is when the project takes the feedback on; `/crt:next` works the items from there.");
  ctx.record({ branch, base: baseRef, url });
  yield* published(written);
}

export const pr: Destination = {
  apiVersion: 1,
  id: "pr",
  title: "A pull request with the items as task files",
  final: true,
  plan: (input, ctx) => planBranch("pr", input, ctx),
  publish: (input, plan, ctx) => publishBranch("pr", input, plan, ctx),
};

export const branch: Destination = {
  apiVersion: 1,
  id: "branch",
  title: "A local branch with the items as task files",
  final: true,
  plan: (input, ctx) => planBranch("branch", input, ctx),
  publish: (input, plan, ctx) => publishBranch("branch", input, plan, ctx),
};
