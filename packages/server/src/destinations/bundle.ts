/**
 * `--to bundle` (PRD-zero F-137; behind the destination contract by PRD-destinations F-140,
 * unchanged — N-37): a folder `crt-review-<project>-<review>/` with `REVIEW.md`, the task files
 * and their assets, ids left as `R-NN` — for a project the reviewer cannot push to.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CrtError } from "../errors.js";
import { ASSETS_DIRNAME } from "../tasks.js";
import { assetsDirOf, count, exportName, ofLine, outFlag, planLines, renderSummary, reviewedLines } from "./shared.js";
import type { Destination } from "./types.js";

export const bundle: Destination = {
  apiVersion: 1,
  id: "bundle",
  title: "A folder with REVIEW.md, the task files and their assets",
  final: true,
  plan(input, ctx) {
    const dir = join(resolve(ctx.cwd, outFlag(ctx) ?? "."), exportName(input));
    if (existsSync(dir)) throw new CrtError(`${dir} already exists — remove it, or pass --out <dir>`);
    const items = input.items.map((item) => ({ item, id: item.id, file: item.file }));
    return {
      lines: [`Hand over review ${input.review.name} as a bundle: ${ofLine(input)}, ids left as they are.`, ...planLines(items), `Writes ${dir} (REVIEW.md, the task files and their assets).`],
      sends: [],
      state: dir,
    };
  },
  async *publish(input, plan, ctx) {
    const dir = plan.state as string;
    const items = input.items.map((item) => ({ item, id: item.id, file: item.file }));
    mkdirSync(dir, { recursive: true });
    const links = new Map<string, string | null>();
    for (const p of items) {
      writeFileSync(join(dir, p.file), readFileSync(p.item.path, "utf8"), "utf8");
      const assets = assetsDirOf(p.item);
      if (existsSync(assets)) cpSync(assets, join(dir, ASSETS_DIRNAME, p.id), { recursive: true });
      links.set(p.id, ["viewport-annotated.png", "viewport.png"].find((f) => existsSync(join(assets, f))) ?? null);
    }
    writeFileSync(join(dir, "REVIEW.md"), renderSummary({ input, items, reviewed: reviewedLines(input.items), tasksDir: ".", now: ctx.now, links }), "utf8");
    ctx.log(`Handed over review ${input.review.name}: ${count(items.length)} in ${dir} — send that folder to the project.`);
    ctx.record({ dir });
    for (const p of items) yield { item: p.id, id: p.id };
  },
};
