// Build step: the intake instructions are plugin/skills/intake/SKILL.md (PRD F-24, F-39 — one
// source). The published npm package only ships dist/, so copy the file next to cli.js, and
// (PRD-providers F-58) every plugin skill to dist/skills/<name>/SKILL.md for `crt skills install`,
// and (PRD-setup F-85) the whole plugin plus a generated marketplace manifest to
// dist/plugin-marketplace/ for `crt setup`. The repo LICENSE is copied into the package dir too
// (gitignored there) so npm bundles it. Last, the package entries' no-op modules and .d.ts files
// (PRD-embedded F-97, F-98) go into dist/integrations/ (integrations.mjs). The favicon and its PNG
// fallbacks (PRD-polish F-112) come from docs/brand/ and land next to overlay.js.
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIntegrations } from "./integrations.mjs";
import { buildPluginMarketplace } from "./plugin-marketplace.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..");
const skills = join(repo, "plugin", "skills");
const copies = [
  [join(skills, "intake", "SKILL.md"), join(here, "..", "dist", "intake.md")],
  [join(repo, "LICENSE"), join(here, "..", "LICENSE")],
  // PRD-polish F-112: the favicon the landing page links and its PNG fallbacks, served from dist/ like early.js.
  ...["favicon.svg", "favicon-32.png", "favicon-16.png"].map((name) => [join(repo, "docs", "brand", name), join(here, "..", "dist", name)]),
  ...readdirSync(skills).map((name) => [join(skills, name, "SKILL.md"), join(here, "..", "dist", "skills", name, "SKILL.md")]),
];
for (const [from, to] of copies) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  console.log(`copied ${from} -> ${to}`);
}
const marketplace = join(here, "..", "dist", "plugin-marketplace");
const manifest = buildPluginMarketplace({ repo, pkg: join(here, "..", "package.json"), out: marketplace });
console.log(`built marketplace ${manifest.name} ${manifest.metadata.version} -> ${marketplace}`);
for (const p of buildIntegrations()) console.log(`wrote ${p}`);
