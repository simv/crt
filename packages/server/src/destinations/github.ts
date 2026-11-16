/**
 * `--to github` (PRD-destinations F-147, F-148, N-40, §5.6): one GitHub issue per kept item, in
 * review order, each a self-contained brief — the item's sections, its screenshots, and a footer
 * saying which review and commit it came from.
 *
 * Through `gh` only: `gh issue create --repo <owner/name> --title … --body-file …` (never `--web`,
 * never an editor). CRT handles no token and opens no connection of its own; the host is whatever
 * host the project's remote is on, GitHub Enterprise included.
 *
 * Screenshots (F-148): GitHub has no API for attaching an image to an issue, so the images are
 * pushed to a branch of the project made for them — `crt/review-<review>-assets`, created in a
 * temporary worktree like `--to pr`'s branch (PRD-zero N-35: the checkout is never touched),
 * holding `.crt/tasks/assets/review-<review>/<R-NN>/<image>` and nothing else, never merged — and
 * each issue links them at that commit. `--no-screenshots` (or `"screenshots": "none"`) publishes
 * text only. `capture.json` is never pushed: only what `FeedbackItem.images` lists.
 *
 * Each issue is yielded as it is created, so a run that stops is continued by the next (F-142);
 * the assets branch is recorded when it is pushed and reused then.
 */
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CrtError } from "../errors.js";
import { renderItemMarkdown, reviewedAt } from "./item.js";
import { defaultBranch, freeBranchName, inWorktree } from "./project.js";
import { count, gitOf, NETWORK_TIMEOUT_MS, noScreenshots, ofLine, planLines, projectFacts, reason, renderSummary, reviewedLines } from "./shared.js";
import type { Destination, DestinationContext, FeedbackItem, PublishedItem } from "./types.js";

export interface GithubRepo {
  host: string;
  /** `owner/name` */
  slug: string;
}

/** `git@github.com:me/app.git`, `https://github.com/me/app`, `ssh://git@host/me/app.git` → host and `owner/name`; null for anything else. */
export function parseGithubRemote(url: string): GithubRepo | null {
  const u = url.trim();
  const m = /^(?:[\w.-]+@)?([\w.-]+):(?!\/)([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(u) ?? /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?([\w.-]+)(?::\d+)?\/([\w.-]+\/[\w.-]+?)(?:\.git)?\/?$/.exec(u);
  return m ? { host: m[1]!.toLowerCase(), slug: m[2]! } : null;
}

/** Where images live on the assets branch: under the tasks assets, in a folder no task id can have. */
export function assetsPath(review: string, item?: string, image?: string): string {
  return [".crt", "tasks", "assets", `review-${review}`, ...(item ? [item] : []), ...(image ? [image] : [])].join("/");
}

/** The issue body: the item's sections (the Definition of Done a task list as written), then where it came from. Pure. */
export function renderIssueBody(item: FeedbackItem, review: string, image: (name: string) => string | null): string {
  const where = [`Filed with CRT from review ${review} (${item.id})`, reviewedAt(item), item.route ?? ""].filter(Boolean).join(" · ");
  return `${renderItemMarkdown(item, { image: (i) => image(i.name), level: 3 })}\n---\n_${where}_\n`;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim()) : [];
}

function labelsFor(item: FeedbackItem, ctx: DestinationContext): string[] {
  const by = ctx.options.priorityLabels;
  const forPriority = by && typeof by === "object" ? (by as Record<string, unknown>)[item.priority] : undefined;
  return [...new Set([...stringList(ctx.options.labels), ...(typeof forPriority === "string" && forPriority.trim() ? [forPriority.trim()] : [])])];
}

interface GithubState {
  repo: GithubRepo;
  /** What `gh --repo` takes: `owner/name`, or `host/owner/name` off github.com. */
  repoArg: string;
  /** Null when no screenshots are published. */
  assets: { branch: string; baseRef: string; remote: string; commit: string | null } | null;
}

export const github: Destination = {
  apiVersion: 1,
  id: "github",
  title: "GitHub Issues",
  final: true,
  async plan(input, ctx) {
    const { root } = input.project;
    const facts = await projectFacts(root, ctx);
    const g = gitOf(root, ctx);
    if (!facts.gh) throw new CrtError("gh (the GitHub CLI) not found on PATH — install it (https://cli.github.com) and run `gh auth login`; nothing was created");
    const configured = typeof ctx.options.repo === "string" && /^[\w.-]+\/[\w.-]+$/.test(ctx.options.repo.trim()) ? ctx.options.repo.trim() : null;
    let repo: GithubRepo | null = configured ? { host: typeof ctx.options.host === "string" && ctx.options.host ? ctx.options.host : "github.com", slug: configured } : null;
    if (!repo) {
      if (!facts.remote) throw new CrtError('this project has no git remote to tell which repository the issues go to — set "destinations": { "github": { "repo": "owner/name" } } in .crt/config.json');
      const url = (await g(["remote", "get-url", facts.remote])).stdout.trim();
      repo = parseGithubRemote(url);
      if (!repo) throw new CrtError(`could not tell a GitHub repository from the remote ${facts.remote} (${url || "no URL"}) — set "destinations": { "github": { "repo": "owner/name" } } in .crt/config.json`);
    }
    const repoArg = repo.host === "github.com" ? repo.slug : `${repo.host}/${repo.slug}`;

    // Labels must exist: `gh issue create` refuses one that does not, and that must not happen on the third issue.
    const wanted = [...new Set(input.items.flatMap((i) => labelsFor(i, ctx)))];
    if (wanted.length) {
      const listed = await ctx.run("gh", ["label", "list", "--repo", repoArg, "--limit", "1000", "--json", "name"], { timeoutMs: NETWORK_TIMEOUT_MS });
      if (listed.status !== 0) throw new CrtError(`could not read the labels of ${repo.slug} (${reason(listed)}) — is \`gh\` logged in? nothing was created`);
      let have: string[] = [];
      try {
        have = (JSON.parse(listed.stdout) as { name?: unknown }[]).map((l) => String(l.name ?? "").toLowerCase());
      } catch {
        /* an empty list */
      }
      const missing = wanted.filter((l) => !have.includes(l.toLowerCase()));
      if (missing.length) throw new CrtError(`${repo.slug} has no label ${missing.map((l) => `"${l}"`).join(", ")} — create ${missing.length === 1 ? "it" : "them"} there, or change destinations.github in the config; nothing was created`);
    }

    // Screenshots: a branch of the project made for them (F-148), or the one an unfinished run already pushed.
    const images = noScreenshots(ctx) ? 0 : input.items.reduce((n, i) => n + i.images.length, 0);
    let assets: GithubState["assets"] = null;
    let shots = "No screenshots are published.";
    if (images && ctx.recorded.assetsBranch && ctx.recorded.assetsCommit) {
      assets = { branch: ctx.recorded.assetsBranch, baseRef: "", remote: facts.remote ?? "", commit: ctx.recorded.assetsCommit };
      shots = `The screenshots are already on the branch ${assets.branch}, pushed by the earlier run.`;
    } else if (images) {
      if (!facts.repo || !facts.git || !facts.remote) throw new CrtError("the screenshots are published on a branch of the project, and this project has no git remote to push one to — pass --no-screenshots for text-only issues");
      const fetched = await g(["fetch", facts.remote], root, NETWORK_TIMEOUT_MS);
      if (fetched.status !== 0) throw new CrtError(`could not fetch ${facts.remote} (${reason(fetched)}) — nothing was created; fix that, or pass --no-screenshots`);
      const base = await defaultBranch(g, facts.remote);
      if (!base) throw new CrtError(`could not tell ${facts.remote}'s default branch — nothing was created; push a first commit there, or pass --no-screenshots`);
      const branch = await freeBranchName(g, `crt/review-${input.review.name}-assets`, facts.remote);
      assets = { branch, baseRef: `${facts.remote}/${base}`, remote: facts.remote, commit: null };
      shots = `Pushes ${images} screenshot${images === 1 ? "" : "s"} to a new branch ${branch} of ${facts.remote}, so the issues can show them — made from ${assets.baseRef} in a temporary worktree, your checkout is not touched. Nothing else is on it, and it is never merged.`;
    }
    const labels = wanted.length ? [`Labels: ${wanted.join(", ")}.`] : [];
    const n = input.items.length;
    const state: GithubState = { repo, repoArg, assets };
    return {
      lines: [`Publish review ${input.review.name} as GitHub issues in ${repo.slug}: ${ofLine(input)}.`, ...planLines(input.items.map((item) => ({ item, id: item.id, file: item.file }))), ...labels, shots],
      sends: [`${n} issue${n === 1 ? "" : "s"}${assets && !assets.commit ? ` and ${images} screenshot${images === 1 ? "" : "s"}` : ""} to ${repo.host}`],
      state,
    };
  },

  async *publish(input, plan, ctx) {
    const { repo, repoArg, assets } = plan.state as GithubState;
    const { root } = input.project;
    const name = input.review.name;
    const g = gitOf(root, ctx);

    // The assets branch first: an issue must never link an image that is not there.
    let commit = assets?.commit ?? null;
    if (assets && !commit) {
      const dir = assetsPath(name);
      await inWorktree(g, { branch: assets.branch, baseRef: assets.baseRef, message: `chore(crt): review ${name} — screenshots for ${count(input.items.length)}`, pathspec: dir, what: "the screenshots", hint: "pass --no-screenshots" }, (worktree) => {
        for (const item of input.items) {
          if (!item.images.length) continue;
          mkdirSync(join(worktree, assetsPath(name, item.id)), { recursive: true });
          for (const image of item.images) cpSync(image.path, join(worktree, assetsPath(name, item.id, image.name)));
        }
      });
      commit = (await g(["rev-parse", "--verify", `refs/heads/${assets.branch}`])).stdout.trim();
      // Only the branch made above, by its full name, and never forced.
      const pushed = await g(["push", assets.remote, `refs/heads/${assets.branch}:refs/heads/${assets.branch}`], root, NETWORK_TIMEOUT_MS);
      if (pushed.status !== 0 || !/^[0-9a-f]{40,64}$/.test(commit)) {
        throw new CrtError(`could not push ${assets.branch} (${reason(pushed)}) — no issue was created; fix that, or pass --no-screenshots`);
      }
      ctx.record({ assetsBranch: assets.branch, assetsCommit: commit });
    }
    const imageUrl = (item: FeedbackItem) => (file: string) => (commit ? `https://${repo.host}/${repo.slug}/blob/${commit}/${assetsPath(name, item.id, encodeURIComponent(file))}?raw=true` : null);

    const tmp = ctx.tmp();
    const created: PublishedItem[] = [];
    const total = input.items.length;
    for (const item of input.items) {
      const bodyFile = join(tmp, `${item.id}.md`);
      writeFileSync(bodyFile, renderIssueBody(item, name, imageUrl(item)), "utf8");
      const args = ["issue", "create", "--repo", repoArg, "--title", item.title, "--body-file", bodyFile, ...labelsFor(item, ctx).flatMap((l) => ["--label", l])];
      const made = await ctx.run("gh", args, { timeoutMs: NETWORK_TIMEOUT_MS });
      const m = /https?:\/\/\S+\/issues\/(\d+)/.exec(made.stdout);
      if (made.status !== 0 || !m) {
        const said = made.status === 0 ? "gh printed no issue URL" : reason(made);
        throw new CrtError(
          created.length
            ? `created ${created.length} of ${total} issues, then gh said: ${said} — run \`crt handoff --to github\` again to create the other ${total - created.length}`
            : `could not create the first issue (${said}) — no issue was created; is \`gh\` logged in to ${repo.host}?`,
        );
      }
      const done: PublishedItem = { item: item.id, id: `#${m[1]}`, url: m[0] };
      created.push(done);
      ctx.log(`  ${item.id} → ${done.id}  ${done.url}`);
      yield done;
    }

    // Should: one more issue that lists them all.
    if (ctx.options.index === true) {
      const all = [...input.already, ...created];
      const bodyFile = join(tmp, "index.md");
      const items = input.items.map((item) => ({ item, id: created.find((c) => c.item === item.id)?.id ?? item.id, file: item.file }));
      const earlier = input.already.length ? [`Published earlier: ${input.already.map((a) => a.id).join(", ")}.`, ""] : [];
      writeFileSync(bodyFile, renderSummary({ input, items, reviewed: reviewedLines(input.items), tasksDir: null, now: ctx.now, name: (p) => `[ ] ${p.id}`, closing: earlier }), "utf8");
      const made = await ctx.run("gh", ["issue", "create", "--repo", repoArg, "--title", `CRT review ${name}: ${count(all.length)}`, "--body-file", bodyFile], { timeoutMs: NETWORK_TIMEOUT_MS });
      const url = /https?:\/\/\S+\/issues\/\d+/.exec(made.stdout)?.[0];
      if (url) {
        ctx.record({ url });
        ctx.log(`  the list of them: ${url}`);
      } else ctx.log(`crt: the ${total} issues exist, but the issue listing them could not be created (${reason(made)})`);
    }
    ctx.log(`Published review ${name}: ${total} issue${total === 1 ? "" : "s"} in ${repo.slug}.`);
  },
};
