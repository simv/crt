// Build step: the intake instructions are plugin/skills/intake/SKILL.md (PRD F-24, F-39 — one
// source). The published npm package only ships dist/, so copy the file next to cli.js, and
// (PRD-providers F-58) every plugin skill to dist/skills/<name>/SKILL.md for `crt skills install`,
// and (PRD-setup F-85) the whole plugin plus a generated marketplace manifest to
// dist/plugin-marketplace/ for `crt setup`. The repo LICENSE is copied into the package dir too
// (gitignored there) so npm bundles it. Last, the package entries' no-op modules and .d.ts files
// (PRD-embedded F-97, F-98) go into dist/integrations/ (integrations.mjs). The favicon and its PNG
// fallbacks (PRD-polish F-112) come from docs/brand/ and land next to overlay.js (the marks the
// landing page inlines are constants in src/marks.ts, F-114). `copySkills` is exported so
// test/intake-skill.test.ts and test/skills.test.ts run the same copy into a temp dir.
import { copyFileSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildIntegrations } from "./integrations.mjs";
import { buildPluginMarketplace } from "./plugin-marketplace.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..");
const skills = join(repo, "plugin", "skills");
export const DEFAULT_DIST = join(here, "..", "dist");

function copy(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
  return [from, to];
}

/** The skill copies into `dist`: the intake skill as intake.md (F-24) and every skill under skills/<name>/ (F-58). Returns the [from, to] pairs. */
export function copySkills(dist = DEFAULT_DIST) {
  return [
    copy(join(skills, "intake", "SKILL.md"), join(dist, "intake.md")),
    ...readdirSync(skills).map((name) => copy(join(skills, name, "SKILL.md"), join(dist, "skills", name, "SKILL.md"))),
  ];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const copies = [
    ...copySkills(),
    copy(join(repo, "LICENSE"), join(here, "..", "LICENSE")),
    // PRD-polish F-112: the favicon the landing page links and its PNG fallbacks, served from dist/ like early.js.
    ...["favicon.svg", "favicon-32.png", "favicon-16.png"].map((name) => copy(join(repo, "docs", "brand", name), join(DEFAULT_DIST, name))),
  ];
  for (const [from, to] of copies) console.log(`copied ${from} -> ${to}`);
  const marketplace = join(DEFAULT_DIST, "plugin-marketplace");
  const manifest = buildPluginMarketplace({ repo, pkg: join(here, "..", "package.json"), out: marketplace });
  console.log(`built marketplace ${manifest.name} ${manifest.metadata.version} -> ${marketplace}`);
  for (const p of buildIntegrations()) console.log(`wrote ${p}`);
}
