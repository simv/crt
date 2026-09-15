// Build step: the intake instructions are plugin/skills/intake/SKILL.md (PRD F-24, F-39 — one
// source). The published npm package only ships dist/, so copy the file next to cli.js. The repo
// LICENSE is copied into the package dir too (gitignored there) so npm bundles it.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..");
const copies = [
  [join(repo, "plugin", "skills", "intake", "SKILL.md"), join(here, "..", "dist", "intake.md")],
  [join(repo, "LICENSE"), join(here, "..", "LICENSE")],
];
for (const [from, to] of copies) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`copied ${from} -> ${to}`);
}
