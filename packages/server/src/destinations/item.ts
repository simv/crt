/**
 * A review's task file as a `FeedbackItem` (PRD-destinations F-141), and the one Markdown rendering
 * of an item the `markdown` and `github` destinations share. A destination never parses a task
 * file itself: the F-32 format can gain a key without any destination changing.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { ASSETS_DIRNAME, parseFrontmatter, SECTION_NAMES, TASK_PRIORITIES, type TaskPriority } from "../tasks.js";
import type { FeedbackImage, FeedbackItem } from "./types.js";

/** What counts as an image of an item. `capture.json` (console and network at send time) never does (N-40). */
const IMAGE_RE = /\.(png|jpe?g|webp)$/i;
/** The sections a destination gets: every F-32 section but the Log, which is the task's own history. */
export const ITEM_SECTIONS = SECTION_NAMES.filter((s) => s !== "Log");

function splitSections(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of ITEM_SECTIONS) out[name] = "";
  for (const part of body.split(/^## (?=.)/m).slice(1)) {
    const nl = part.indexOf("\n");
    const name = (nl === -1 ? part : part.slice(0, nl)).trim();
    if (name in out) out[name] = (nl === -1 ? "" : part.slice(nl + 1)).replace(/^\n+|\s+$/g, "");
  }
  return out;
}

/** The annotated viewport, then the plain one, then the rest by name. */
function imageRank(name: string): number {
  return /^viewport-annotated\./i.test(name) ? 0 : /^viewport\./i.test(name) ? 1 : 2;
}

function imagesOf(tasksDir: string, id: string): FeedbackImage[] {
  const dir = join(tasksDir, ASSETS_DIRNAME, id);
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const out: FeedbackImage[] = [];
  for (const name of names.filter((n) => IMAGE_RE.test(n)).sort((a, b) => imageRank(a) - imageRank(b) || a.localeCompare(b, "en", { numeric: true }))) {
    try {
      const st = statSync(join(dir, name));
      if (st.isFile()) out.push({ name, path: join(dir, name), bytes: st.size });
    } catch {
      /* gone since the listing */
    }
  }
  return out;
}

/** F-141: read `<tasksDir>/<file>` — tolerant like `crt review` is: a key that is missing or junk becomes null or empty. */
export function readFeedbackItem(tasksDir: string, file: string): FeedbackItem {
  const path = join(tasksDir, file);
  const markdown = readFileSync(path, "utf8");
  const fm = parseFrontmatter(markdown);
  const data = fm?.data ?? {};
  const text = (key: string): string | null => (typeof data[key] === "string" && data[key] ? (data[key] as string) : null);
  const list = (key: string): string[] => (Array.isArray(data[key]) ? (data[key] as unknown[]).filter((v): v is string => typeof v === "string") : []);
  const id = text("id") ?? file.replace(/-[a-z0-9-]+\.md$/, "");
  const priority = text("priority");
  return {
    id,
    title: text("title") ?? id,
    priority: (TASK_PRIORITIES as readonly string[]).includes(priority ?? "") ? (priority as TaskPriority) : "normal",
    url: text("url"),
    route: text("route"),
    branch: text("branch"),
    commit: text("commit"),
    tags: list("tags"),
    files: list("files"),
    sections: splitSections(fm?.body ?? markdown),
    markdown,
    file,
    path,
    images: imagesOf(tasksDir, id),
  };
}

export interface RenderItemOptions {
  /** Where an image of the item is, for the reader of this rendering; null when it is not published. */
  image(image: FeedbackImage): string | null;
  /** The heading level of a section (`###` by default). */
  level?: number;
  /** Render the Definition of Done as written (a task list). Default true. */
  definitionOfDone?: boolean;
}

/** `Reviewed at 4f2a91c on main`, or what is known of it; "" when nothing is. */
export function reviewedAt(item: Pick<FeedbackItem, "branch" | "commit">): string {
  if (!item.commit && !item.branch) return "";
  return `reviewed ${item.commit ? `at \`${item.commit.slice(0, 7)}\`` : "with no commit yet"}${item.branch ? ` on \`${item.branch}\`` : ""}`;
}

/**
 * An item's sections as Markdown: Summary, Context, Evidence, Ask, Notes (when not empty) and the
 * Definition of Done, each under its heading. The Evidence's links to `assets/<id>/<image>` point
 * where `image` says; an image that is not published is named instead of linked. Pure.
 */
export function renderItemMarkdown(item: FeedbackItem, opts: RenderItemOptions): string {
  const h = "#".repeat(opts.level ?? 3);
  const byName = new Map(item.images.map((i) => [i.name, i]));
  const prefix = `${ASSETS_DIRNAME}/${item.id}/`;
  const relink = (text: string): string =>
    text.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, bang: string, alt: string, target: string) => {
      if (!target.startsWith(prefix)) return whole;
      const image = byName.get(target.slice(prefix.length));
      const url = image ? opts.image(image) : null;
      if (url) return `${bang}[${alt}](${url})`;
      return `_${alt || target.slice(prefix.length)}: \`${target.slice(prefix.length)}\` (not published; it stays with the review)_`;
    });
  const out: string[] = [];
  for (const name of ["Summary", "Context", "Evidence", "Ask", "Notes", "Definition of Done"]) {
    if (name === "Definition of Done" && opts.definitionOfDone === false) continue;
    const body = (item.sections[name] ?? "").trim();
    if (!body) continue;
    out.push(`${h} ${name}`, "", name === "Evidence" ? relink(body) : body, "");
  }
  return out.join("\n").trimEnd() + "\n";
}
