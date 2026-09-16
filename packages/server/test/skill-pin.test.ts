import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// PRD-setup F-87: one version everywhere it shows. The three manifests agree, and every plugin
// skill resolves `crt` as `npx --no crt` first and then `npx -y claude-review-tool@<major.minor>`
// pinned to the plugin's own major.minor — so a release bump that forgets a skill fails
// `npm run check`, and `@latest` (which would hand a v0.3 plugin a stale server) appears nowhere.

const REPO = join(import.meta.dirname, "..", "..", "..");
const read = (...p: string[]) => readFileSync(join(REPO, ...p), "utf8");
const json = (...p: string[]) => JSON.parse(read(...p)) as Record<string, unknown>;

const pkgVersion = json("packages", "server", "package.json").version as string;
const pluginVersion = json("plugin", ".claude-plugin", "plugin.json").version as string;
const marketplace = json(".claude-plugin", "marketplace.json") as { metadata: { version: string }; plugins: Array<{ version: string }> };
const majorMinor = pkgVersion.split(".").slice(0, 2).join(".");

const SKILLS_DIR = join(REPO, "plugin", "skills");
const skills = readdirSync(SKILLS_DIR).map((name) => ({ name, text: readFileSync(join(SKILLS_DIR, name, "SKILL.md"), "utf8") }));

describe("one version rule (F-87)", () => {
  it("the three manifests carry the same semver version (F-87)", () => {
    expect(pkgVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pluginVersion).toBe(pkgVersion);
    expect(marketplace.metadata.version).toBe(pkgVersion);
    expect(marketplace.plugins.map((p) => p.version)).toEqual([pkgVersion]);
  });

  it("there are six skills (F-36…F-40, F-87)", () => {
    expect(skills.map((s) => s.name).sort()).toEqual(["done", "intake", "next", "serve", "task", "tasks"]);
  });

  it.each(skills.map((s) => [s.name, s.text] as const))("%s pins npx -y claude-review-tool@<major.minor> after npx --no crt, and never @latest (F-87)", (_name, text) => {
    expect(text).toContain("npx --no crt");
    expect(text).toContain(`npx -y claude-review-tool@${majorMinor}`);
    const pins = [...text.matchAll(/claude-review-tool@([^\s`]+)/g)].map((m) => m[1]);
    expect(pins.length).toBeGreaterThan(0);
    expect(new Set(pins)).toEqual(new Set([majorMinor]));
    expect(text).not.toContain("@latest");
    expect(text.indexOf("npx --no crt")).toBeLessThan(text.indexOf(`npx -y claude-review-tool@${majorMinor}`));
  });
});
