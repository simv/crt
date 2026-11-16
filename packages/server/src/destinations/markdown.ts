/**
 * `--to markdown` (PRD-destinations F-144, §5.5): the review as one Markdown file — the collated
 * summary, then every item in full, in review order — with the images in a folder beside it,
 * linked relatively. An export: recorded, and the review stays open.
 */
import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { CrtError } from "../errors.js";
import { renderItemMarkdown, reviewedAt } from "./item.js";
import { count, exportName, noScreenshots, ofLine, outFlag, planLines, renderSummary, reviewedLines } from "./shared.js";
import type { Destination, DestinationContext, FeedbackItem, PublishInput } from "./types.js";

/** `--out`: a path ending in `ext` is the file; anything else is the directory the file goes in. */
export function exportFile(input: PublishInput, ctx: DestinationContext, ext: string): string {
  const out = outFlag(ctx);
  const target = resolve(ctx.cwd, out ?? ".");
  const isDir = (() => {
    try {
      return statSync(target).isDirectory();
    } catch {
      return false;
    }
  })();
  return out && !isDir && target.toLowerCase().endsWith(ext) ? target : join(target, `${exportName(input)}${ext}`);
}

/** One item in full: its heading, a line of what and where, its sections. */
export function renderExportItem(item: FeedbackItem, image: Parameters<typeof renderItemMarkdown>[1]["image"]): string {
  const facts = [`Priority: ${item.priority}`, item.url ? `Page: ${item.url}` : item.route ? `Route: ${item.route}` : "", reviewedAt(item).replace(/^r/, "R")].filter(Boolean);
  return [`## ${item.id} — ${item.title}`, "", facts.join(" · "), "", renderItemMarkdown(item, { image, level: 3 })].join("\n");
}

export const markdown: Destination = {
  apiVersion: 1,
  id: "markdown",
  title: "One Markdown file, the images beside it",
  final: false,
  plan(input, ctx) {
    const file = exportFile(input, ctx, ".md");
    if (existsSync(file)) throw new CrtError(`${file} already exists — remove it, or pass --out <file or dir>`);
    const assets = file.replace(/\.md$/i, "-assets");
    const images = noScreenshots(ctx) ? 0 : input.items.reduce((n, i) => n + i.images.length, 0);
    if (images && existsSync(assets)) throw new CrtError(`${assets} already exists — remove it, or pass --out <file or dir>`);
    return {
      lines: [
        `Export review ${input.review.name} as Markdown: ${ofLine(input)}.`,
        ...planLines(input.items.map((item) => ({ item, id: item.id, file: item.file }))),
        images ? `Writes ${file} and ${images} image${images === 1 ? "" : "s"} in ${basename(assets)}/ beside it. The review stays open.` : `Writes ${file}. The review stays open.`,
      ],
      sends: [],
      state: { file, assets, images },
    };
  },
  async *publish(input, plan, ctx) {
    const { file, assets, images } = plan.state as { file: string; assets: string; images: number };
    const items = input.items.map((item) => ({ item, id: item.id, file: item.file }));
    mkdirSync(dirname(file), { recursive: true });
    const parts = [renderSummary({ input, items, reviewed: reviewedLines(input.items), tasksDir: null, now: ctx.now, closing: [] }), "---", ""];
    for (const item of input.items) {
      if (images && item.images.length) {
        mkdirSync(join(assets, item.id), { recursive: true });
        for (const image of item.images) cpSync(image.path, join(assets, item.id, image.name));
      }
      parts.push(renderExportItem(item, (image) => (images ? `${encodeURI(basename(assets))}/${item.id}/${encodeURI(image.name)}` : null)));
    }
    writeFileSync(file, parts.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n", "utf8");
    ctx.log(`Exported review ${input.review.name}: ${count(items.length)} in ${file}.`);
    ctx.record({ file });
    for (const item of input.items) yield { item: item.id, id: item.id };
  },
};
