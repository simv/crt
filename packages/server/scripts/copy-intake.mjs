// Build step: the intake instructions are plugin/skills/intake/SKILL.md (PRD F-24, F-39 — one
// source). The published npm package only ships dist/, so copy the file next to cli.js.
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, "..", "..", "..", "plugin", "skills", "intake", "SKILL.md");
const to = join(here, "..", "dist", "intake.md");
mkdirSync(dirname(to), { recursive: true });
copyFileSync(from, to);
console.log(`copied ${from} -> ${to}`);
