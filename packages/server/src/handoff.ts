/**
 * `crt handoff` (PRD-zero F-136, N-35, §5.5; PRD-destinations F-140, F-142, N-38): deliver the
 * kept items of a review to a destination, in review order.
 *
 * This module is what every destination has in common: which review, which items, the plan
 * printed first, the one question (`Go ahead? [Y/n]`; `--yes` skips it; off a terminal without
 * `--yes` nothing is written), and the record in `review.json`. Where the items go is a
 * destination's business — a module behind the contract in destinations/types.ts, found by name
 * in destinations/index.ts: `pr`, `branch`, `here`, `bundle`, `markdown`, `json`, `github`, or a
 * module the config names.
 *
 * N-38 — for every destination, CRT's own or not: `plan` is called first and its lines are
 * printed as given; `publish` is called only after the yes; each item it yields is recorded
 * before the next is asked for, so a publish that stops is continued by running the command
 * again (F-142). A complete hand-over to a `final` destination makes the review `handed`; an
 * export leaves it open. A review goes to a second destination freely; `--again` repeats the same.
 *
 * `git` and `gh` are resolved and run the way `claude` is for `crt setup` (providers/exec.ts:
 * PATH and PATHEXT, `shell: false`, never a `.cmd` handed to `spawn`), through the context's
 * `run` only, and only inside this command.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { listDestinations, readDestinationsConfig, resolveDestination } from "./destinations/index.js";
import { readFeedbackItem } from "./destinations/item.js";
import { defaultDestination } from "./destinations/project.js";
import { projectFacts } from "./destinations/shared.js";
import type { DestinationContext, PublishedItem, PublishInput } from "./destinations/types.js";
import { CrtError } from "./errors.js";
import { completeHandover, currentReview, type Handover, handoversOf, listReviews, noteHandover, recordPublished, type Review } from "./home.js";
import { type Executable, findOnPath, runExecutable, type RunResult } from "./providers/exec.js";
import { noReviewLine, reviewView } from "./review.js";
import { isYes, type Prompter } from "./start.js";
import { isSetUp } from "./store.js";
import { displayPath, localIso } from "./tasks.js";

export { defaultDestination, nextTaskIds, rewriteTaskText } from "./destinations/project.js";

const LOCAL_TIMEOUT_MS = 30_000;

export interface HandoffOptions {
  /** The project root. */
  root: string;
  /** `--to <name>`: a destination's name; default `handoff.to` in the config, else PRD-zero §5.5's rule. */
  to?: string | undefined;
  /** `--review <name>`: that review instead of the current one. */
  review?: string | undefined;
  /** `--branch <name>`: instead of `crt/review-<review>`. */
  branch?: string | undefined;
  /** `--out <dir>`: where a bundle's folder or an export's file is made (default: the current directory). */
  out?: string | undefined;
  /** Every other flag of the run, for the destination (`--no-screenshots`, a module's own). */
  flags?: Record<string, string | boolean>;
  yes?: boolean;
  /** `--again`: hand a review over to the same destination once more. */
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

export async function runHandoff(opts: HandoffOptions): Promise<HandoffResult> {
  const root = resolve(opts.root);
  const env = opts.env ?? process.env;
  const log = opts.log ?? ((line: string) => console.log(line));
  const now = opts.now ?? new Date();

  // Which review, and what of it is kept.
  const review = pickReview(root, opts, env);
  if (!review) {
    log(noReviewLine(root));
    return { outcome: "nothing" };
  }
  const view = reviewView(review);
  const kept = view.items.filter((i) => i.keep);
  const handovers = handoversOf(review.manifest);
  if (!kept.length) {
    log(`crt: review ${review.name} has no kept items — nothing to hand over`);
    return { outcome: "nothing" };
  }

  // The context every destination works through.
  const tmps: string[] = [];
  const extras: Record<string, string> = {};
  const exes = new Map<string, Executable | null>();
  const exe = (tool: string): Executable | null => {
    if (!exes.has(tool)) exes.set(tool, findOnPath(tool, process.platform, env));
    return exes.get(tool)!;
  };
  // A credential prompt cannot be answered through a pipe: fail with git's own line instead of hanging.
  const toolEnv = { ...env, GIT_TERMINAL_PROMPT: "0" };
  const runner: ToolRunner = opts.run ?? ((_tool, e, args, o) => runExecutable(e, args, o));
  let key: { to: string; at: string } | null = null;
  const ctx: DestinationContext = {
    options: {},
    flags: { ...opts.flags, ...(opts.branch !== undefined ? { branch: opts.branch } : {}), ...(opts.out !== undefined ? { out: opts.out } : {}) },
    env,
    cwd: opts.cwd ?? process.cwd(),
    now,
    log,
    has: (tool) => exe(tool) !== null,
    run: async (tool, args, o = {}) => {
      const found = exe(tool);
      if (!found) return { status: null, stdout: "", stderr: "", error: `${tool} not found on PATH` };
      return runner(tool as "git" | "gh", found, args, { cwd: o.cwd ?? root, env: toolEnv, timeoutMs: o.timeoutMs ?? LOCAL_TIMEOUT_MS });
    },
    tmp: () => {
      const dir = mkdtempSync(join(tmpdir(), "crt-handoff-tmp-"));
      tmps.push(dir);
      return dir;
    },
    recorded: {},
    record: (fields) => {
      Object.assign(extras, fields);
      // Kept with the unfinished entry at once, so a continued run finds it (the branch an issue's images are on).
      if (key) noteHandover(review.dir, key, fields);
    },
  };
  let landed = 0;

  try {
    // Which destination (F-146): `--to`, else `handoff.to`, else the rule of PRD-zero §5.5.
    const config = readDestinationsConfig(root, env);
    const name = opts.to ?? config.defaultTo ?? (await defaultName(root, ctx));
    const { destination, options } = await resolveDestination(name, config, { root, log });
    ctx.options = options;

    // What this destination already has of the review (F-142).
    const mine = handovers.filter((h) => h.to === name);
    const partial = opts.again ? undefined : mine.filter((h) => h.state === "partial").at(-1);
    const complete = mine.filter((h) => h.state !== "partial").at(-1);
    if (destination.final && complete && !partial && !opts.again) throw new CrtError(alreadyLine(review.name, complete));
    key = { to: name, at: partial?.at ?? localIso(now) };
    const already: PublishedItem[] = partial ? Object.entries(partial.items).map(([item, id]) => ({ item, id, ...(partial.urls?.[item] ? { url: partial.urls[item] } : {}) })) : [];
    const todo = kept.filter((i) => !already.some((a) => a.item === i.id));
    if (partial) for (const [k, v] of Object.entries(partial)) if (typeof v === "string" && !["to", "at", "state"].includes(k)) ctx.recorded[k] = v;

    const input: PublishInput = {
      review: { name: review.name, created: view.created, totals: view.totals },
      project: { root, name: basename(view.project.root || "") || "the project", remote: view.project.remote, setUp: isSetUp(root) },
      items: todo.map((i) => readFeedbackItem(view.tasksDir, i.file)),
      already,
    };
    if (!todo.length) {
      const done = completeHandover(review.dir, key, extras, destination.final);
      log(`crt: every kept item of review ${review.name} is already at ${name} — nothing left to publish`);
      return done ? { outcome: "handed", handover: done } : { outcome: "nothing" };
    }

    // Say first (N-35, N-38): the destination's own lines, as given.
    const plan = await planOf(name, () => destination.plan(input, ctx));
    for (const line of plan.lines) log(line);
    for (const line of plan.sends) log(`Sends ${line}.`);
    if (already.length) log(`${already.length} of ${kept.length} are already there from an earlier run; ${todo.length} to go.`);
    if (!opts.yes) {
      if (!opts.interactive || !opts.prompt) throw new CrtError("crt handoff asks before it writes — run it on a terminal, or pass --yes (nothing was written)");
      if (!isYes(await opts.prompt.ask("Go ahead? [Y/n]"))) throw new CrtError("cancelled — nothing was written", 130);
    }

    // Publish, recording each item as it lands.
    const given = new Set(input.items.map((i) => i.id));
    try {
      for await (const item of destination.publish(input, plan, ctx)) {
        if (!item || typeof item.item !== "string" || typeof item.id !== "string" || !given.has(item.item)) {
          throw new CrtError(`${name} reported an item this run did not give it (${JSON.stringify(item?.item ?? null)}) — stopped; ${landed} of ${todo.length} are recorded`);
        }
        given.delete(item.item);
        recordPublished(review.dir, key, { item: item.item, id: item.id, ...(typeof item.url === "string" && item.url ? { url: item.url } : {}) });
        landed++;
      }
    } catch (err) {
      if (err instanceof CrtError) throw err;
      throw new CrtError(`${name} stopped after ${landed} of ${todo.length} item${todo.length === 1 ? "" : "s"} (${oneLine(err)})${landed ? ` — run \`crt handoff --to ${name}\` again to publish the rest` : " — nothing was recorded"}`);
    }
    if (given.size) {
      throw new CrtError(`${name} finished without ${[...given].join(", ")} — ${landed} of ${todo.length} are recorded; run \`crt handoff --to ${name}\` again to publish the rest`);
    }
    const handover = completeHandover(review.dir, key, extras, destination.final);
    return handover ? { outcome: "handed", handover } : { outcome: "nothing" };
  } finally {
    for (const dir of tmps) rmSync(dir, { recursive: true, force: true });
  }
}

/** F-146: `crt handoff --list` — every destination, one line each, the default marked. Imports no module from outside (N-39). */
export async function listHandoff(opts: Pick<HandoffOptions, "root" | "env" | "log">): Promise<void> {
  const root = resolve(opts.root);
  const log = opts.log ?? ((line: string) => console.log(line));
  const config = readDestinationsConfig(root, opts.env ?? process.env);
  const rows = listDestinations(config);
  const w = Math.max(...rows.map((r) => r.name.length), 4);
  const rel = (file: string) => (file.startsWith(root) ? displayPath(root, file) : file);
  for (const r of rows) {
    const where = r.kind === "builtin" ? `built in${r.file ? `, options from ${rel(r.file)}` : ""}` : `${r.use}, from ${rel(r.file!)}`;
    log(`${r.name === config.defaultTo ? "*" : " "} ${r.name.padEnd(w)}  ${r.kind === "builtin" ? r.title : "(a module from outside CRT)"} — ${where}`);
  }
  log("");
  log(config.defaultTo ? `* is what plain \`crt handoff\` uses (handoff.to in ${rel(config.defaultFile!)}).` : "Plain `crt handoff` uses pr, branch or here, whichever the project allows; set handoff.to in .crt/config.json to choose.");
}

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** PRD-zero §5.5's default: `pr` with a remote and `gh`, `branch` in a repository without either, `here` otherwise. */
async function defaultName(root: string, ctx: DestinationContext): Promise<string> {
  const facts = await projectFacts(root, ctx);
  return defaultDestination({ repo: facts.repo, git: facts.git, remote: facts.remote !== null, gh: facts.gh });
}

function alreadyLine(review: string, last: Partial<Handover>): string {
  return `review ${review} was already handed over${last.to ? ` (--to ${last.to}${last.url ? `, ${last.url}` : last.branch ? `, branch ${last.branch}` : ""})` : ""} — pass --again to hand it over once more`;
}

function oneLine(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).split("\n")[0]!.trim() || "no message";
}

/** A destination's refusal is one `crt:` line whoever wrote the destination. */
async function planOf<T>(name: string, plan: () => T | Promise<T>): Promise<T> {
  try {
    return await plan();
  } catch (err) {
    if (err instanceof CrtError) throw err;
    throw new CrtError(`${name} cannot publish this review: ${oneLine(err)} (nothing was written)`);
  }
}

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
