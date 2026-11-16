/**
 * `--to json` (PRD-destinations F-145, §5.5): the review as one JSON file — exactly the
 * `FeedbackItem`s a destination is given (types.ts), for a script that would rather read a file
 * than be a module. Image paths point into the review on this machine. An export: the review stays open.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CrtError } from "../errors.js";
import { exportFile } from "./markdown.js";
import { count, ofLine, planLines } from "./shared.js";
import type { Destination, PublishInput } from "./types.js";

/** The file's content: `schema` 1 is the destination contract's version 1. */
export function exportJson(input: PublishInput): { schema: 1; review: PublishInput["review"]; project: PublishInput["project"]; items: PublishInput["items"] } {
  return { schema: 1, review: input.review, project: input.project, items: input.items };
}

export const json: Destination = {
  apiVersion: 1,
  id: "json",
  title: "One JSON file with the items as data",
  final: false,
  plan(input, ctx) {
    const file = exportFile(input, ctx, ".json");
    if (existsSync(file)) throw new CrtError(`${file} already exists — remove it, or pass --out <file or dir>`);
    return {
      lines: [`Export review ${input.review.name} as JSON: ${ofLine(input)}.`, ...planLines(input.items.map((item) => ({ item, id: item.id, file: item.file }))), `Writes ${file}. The review stays open.`],
      sends: [],
      state: file,
    };
  },
  async *publish(input, plan, ctx) {
    const file = plan.state as string;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(exportJson(input), null, 2) + "\n", "utf8");
    ctx.log(`Exported review ${input.review.name}: ${count(input.items.length)} in ${file}.`);
    ctx.record({ file });
    for (const item of input.items) yield { item: item.id, id: item.id };
  },
};
