/**
 * What the built-in destinations share (PRD-destinations F-140; the text is PRD-zero §5.5's, moved
 * from handoff.ts unchanged — N-37): what the machine has, the plan's item lines, the collated
 * summary, and the "reviewed at" lines.
 */
import { basename, join } from "node:path";
import { CrtError } from "../errors.js";
import { gitDirs } from "../git-state.js";
import { groupByRoute, totalsLine } from "../review.js";
import { ASSETS_DIRNAME, localIso, taskSummaryText } from "../tasks.js";
import type { DestinationContext, FeedbackItem, PublishInput, ToolResult } from "./types.js";

/** A fetch or a push may take a while on a slow link; nothing else here does. */
export const NETWORK_TIMEOUT_MS = 120_000;
export const LOCAL_TIMEOUT_MS = 30_000;

export const count = (n: number): string => `${n} item${n === 1 ? "" : "s"}`;

/** `git` in the project root (or `cwd`), through the context's runner. */
export type Git = (args: string[], cwd?: string, timeoutMs?: number) => Promise<ToolResult>;
export function gitOf(root: string, ctx: DestinationContext): Git {
  return (args, cwd = root, timeoutMs = LOCAL_TIMEOUT_MS) => ctx.run("git", args, { cwd, timeoutMs });
}

/** What a failed tool said, in one line. */
export function reason(r: ToolResult): string {
  const first = (text: string): string | null => text.split(/\r?\n/).map((l) => l.trim()).find(Boolean) ?? null;
  return r.error ?? first(r.stderr) ?? first(r.stdout) ?? `exit ${r.status}`;
}

export interface ProjectFacts {
  /** The project root is a git repository. */
  repo: boolean;
  git: boolean;
  gh: boolean;
  /** `origin`, else the first remote; null without one. */
  remote: string | null;
}

const factsOf = new WeakMap<DestinationContext, Promise<ProjectFacts>>();

/** What the machine has for this project — asked once per run. */
export function projectFacts(root: string, ctx: DestinationContext): Promise<ProjectFacts> {
  let facts = factsOf.get(ctx);
  if (!facts) {
    facts = (async () => {
      const git = ctx.has("git");
      const repo = gitDirs(root) !== null;
      return { repo, git, gh: ctx.has("gh"), remote: repo && git ? pickRemote((await gitOf(root, ctx)(["remote"])).stdout) : null };
    })();
    factsOf.set(ctx, facts);
  }
  return facts;
}

function pickRemote(stdout: string): string | null {
  const names = stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return names.includes("origin") ? "origin" : (names[0] ?? null);
}

/** An item with the id and file name it gets in the destination (its own in a bundle). */
export interface PlannedItem {
  item: FeedbackItem;
  id: string;
  file: string;
}

/** `  R-01 → CRT-0006  normal  /cart  Cart total excludes applied discount` */
export function planLines(items: PlannedItem[]): string[] {
  const w = Math.max(...items.map((p) => p.item.id.length));
  return items.map((p) => `  ${p.item.id.padEnd(w)}${p.id === p.item.id ? "" : ` → ${p.id}`}  ${p.item.priority.padEnd(6)}  ${p.item.route ?? "-"}  ${p.item.title}`);
}

/** `2 of 3 items` */
export function ofLine(input: PublishInput): string {
  return `${input.items.length} of ${count(input.review.totals.items)}`;
}

/** `crt-review-<project>-<review>`: the name of what an export or a bundle writes. */
export function exportName(input: PublishInput): string {
  return `crt-review-${basename(input.project.root).toLowerCase().replace(/[^a-z0-9-]+/g, "-")}-${input.review.name}`;
}

/** The distinct commits the items were reviewed at, in review order. */
function reviewedCommits(items: FeedbackItem[]): { commit: string | null; branch: string | null }[] {
  const seen = new Map<string, { commit: string | null; branch: string | null }>();
  for (const i of items) if (i.commit || i.branch) seen.set(`${i.commit} ${i.branch}`, { commit: i.commit, branch: i.branch });
  return [...seen.values()];
}

function reviewedLine(r: { commit: string | null; branch: string | null }): string {
  return `Reviewed ${r.commit ? `at \`${r.commit.slice(0, 7)}\`` : "with no commit yet"}${r.branch ? ` on \`${r.branch}\`` : ""}`;
}

/** Without git: what was reviewed, and no word on the base. */
export function reviewedLines(items: FeedbackItem[]): string[] {
  return reviewedCommits(items).map((r) => `${reviewedLine(r)}.`);
}

/** PRD-zero §5.5: `Reviewed at 4f2a91c on main; the base (main) is 12 commits ahead.` */
export async function reviewedAgainst(g: Git, items: FeedbackItem[], baseRef: string, baseName: string): Promise<string[]> {
  const out: string[] = [];
  for (const r of reviewedCommits(items)) {
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

export interface SummaryInput {
  input: PublishInput;
  items: PlannedItem[];
  /** One line per distinct reviewed commit. */
  reviewed: string[];
  /** Where the task files are, as the reader will see them (`.crt/tasks`); null when the items are not task files there. */
  tasksDir: string | null;
  now: Date;
  /** A bundle's `REVIEW.md`: relative links to each item's file and screenshot (item id → screenshot file name, or null). */
  links?: Map<string, string | null>;
  /** How each item is named in the list, in place of `**<id>**` (an export's anchor link, an issue reference). */
  name?: (p: PlannedItem) => string;
  /** The closing section, in place of "Working them"; an empty list leaves it out. */
  closing?: string[];
}

/** PRD-zero §5.5: the collated summary — the pull request body, a bundle's `REVIEW.md`, what `here` prints, and the head of an export. */
export function renderSummary(s: SummaryInput): string {
  const n = s.items.length;
  const { review, project } = s.input;
  const lines = [
    `# CRT review ${review.name}: ${n} item${n === 1 ? "" : "s"}`,
    "",
    `Review \`${review.name}\` of \`${project.name}\`, started ${review.created || "(unknown)"} and handed over ${localIso(s.now)}. ${totalsLine(review.totals)}; the ${n === 1 ? "one kept item is" : `${n} kept items are`} here, in review order.`,
    "",
    ...(s.reviewed.length ? [...s.reviewed.map((r) => `- ${r}`), ""] : []),
  ];
  for (const group of groupByRoute(s.items.map((p) => ({ ...p, route: p.item.route })))) {
    lines.push(`## ${group.route ?? "(no route)"}`, "");
    for (const p of group.items) {
      const summary = taskSummaryText(p.item.path, 200);
      const shot = s.links?.get(p.item.id);
      const name = s.name ? s.name(p) : s.links ? `[${p.id}](${p.file})` : `**${p.id}**`;
      lines.push(`- ${name} (${p.item.priority}) ${p.item.title}${summary ? ` — ${summary}` : ""}${shot ? ` ([screenshot](${ASSETS_DIRNAME}/${p.item.id}/${shot}))` : ""}`);
    }
    lines.push("");
  }
  if (s.closing) {
    if (s.closing.length) lines.push(...s.closing);
    else lines.pop();
    return lines.join("\n") + "\n";
  }
  lines.push("## Working them", "");
  if (s.links) lines.push("Each file is a self-contained task and keeps the review's `R-NN` id; the project gives it one of its own when it takes the item on.");
  else lines.push(`Each item is a self-contained task file in \`${s.tasksDir}/\`. Run \`/crt:next\` in Claude Code to take the first one (\`/crt:next ${s.items[0]?.id ?? "CRT-NNNN"}\` for a particular one), or read the files.`);
  if (!project.setUp && !s.links) lines.push("", "This project is not set up for CRT yet. `crt init` adds the `.gitignore` lines and the instructions for agents; the task files work without it.");
  return lines.join("\n") + "\n";
}

/** The folder of an item's assets (images and `capture.json`) in the review. */
export function assetsDirOf(item: FeedbackItem): string {
  return join(item.path, "..", ASSETS_DIRNAME, item.id);
}

/** `--out` as a string, or undefined; a bare `--out` is a usage error. */
export function outFlag(ctx: DestinationContext): string | undefined {
  const out = ctx.flags.out;
  if (out === true) throw new CrtError("--out needs a path", 2);
  return typeof out === "string" ? out : undefined;
}

/** `--no-screenshots`, or `"screenshots": "none"` in the destination's options. */
export function noScreenshots(ctx: DestinationContext): boolean {
  return ctx.flags["no-screenshots"] === true || ctx.options.screenshots === "none" || ctx.options.screenshots === false;
}
