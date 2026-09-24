import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copySkills } from "../scripts/copy-intake.mjs";
import { CrtError } from "../src/errors.js";
import { claudeProfile } from "../src/providers/claude.js";
import { codexProfile } from "../src/providers/codex.js";
import { makeStubProfile } from "../src/providers/stub.js";
import { CLAUDE_REFUSAL, INSTALLED_PARAGRAPH, installSkills, rewriteSkill, SKILL_NAMES, skillsTargetDir } from "../src/skills.js";
import { parseFrontmatter } from "../src/tasks.js";

// `crt skills install` (PRD-providers F-58): seven Agent Skills, rewritten from the plugin's text,
// idempotent, refused for Claude, `--dir` required when the profile records no directory.

const here = import.meta.dirname;
const pluginSkills = join(here, "..", "..", "..", "plugin", "skills");

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "crt-skills-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("crt skills install (F-58)", () => {
  it("--provider codex --dir <tmp> writes seven SKILL.md files with no ${CLAUDE_ token and no AskUserQuestion; a second run changes nothing (F-58, F-104)", () => {
    const dir = join(root, "skills");
    const first = installSkills({ sourceDir: pluginSkills, root, profile: codexProfile, dir });
    expect(first.dir).toBe(dir);
    expect(first.written.map((p) => p.slice(dir.length + 1).split(/[\\/]/)[0])).toEqual([...SKILL_NAMES]);
    expect(first.unchanged).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual([...SKILL_NAMES].sort());
    for (const name of SKILL_NAMES) {
      const text = readFileSync(join(dir, name, "SKILL.md"), "utf8");
      expect(text, name).not.toContain("${CLAUDE_");
      expect(text, name).not.toContain("AskUserQuestion");
      expect(text, name).not.toMatch(/^disable-model-invocation:/m);
      expect(text, name).not.toMatch(/^allowed-tools:/m);
      expect(text, name).not.toContain("\r\n");
      // Valid Agent Skills frontmatter (name + description), then the added first paragraph.
      const fm = parseFrontmatter(text)!;
      expect(fm.data, name).toMatchObject({ name });
      expect(typeof fm.data.description, name).toBe("string");
      expect(fm.body.trimStart().startsWith(INSTALLED_PARAGRAPH), name).toBe(true);
    }
    const stamps = SKILL_NAMES.map((n) => statSync(join(dir, n, "SKILL.md")).mtimeMs);
    const second = installSkills({ sourceDir: pluginSkills, root, profile: codexProfile, dir });
    expect(second.written).toEqual([]);
    expect(second.unchanged.length).toBe(7);
    expect(SKILL_NAMES.map((n) => statSync(join(dir, n, "SKILL.md")).mtimeMs)).toEqual(stamps);
  });

  it("rewrites the Claude-only tokens as F-58 lists them and keeps the rest verbatim (F-58)", () => {
    const next = readFileSync(join(pluginSkills, "next", "SKILL.md"), "utf8");
    const out = rewriteSkill(next);
    expect(out).toContain("Project root: `the project root (your working directory)`. Your session ID: `your session id`.");
    expect(out).toContain("Never resort to asking the user, never end your turn on a question");
    expect(out).toContain("session your session id, branch crt/<ID>-<slug>");
    expect(out).toContain("## 9. Blocked (anything unticked, or you cannot proceed)");
    expect(out.startsWith("---\nname: next\ndescription: ")).toBe(true);
    expect(out).toContain('argument-hint: "[CRT-ID]"\n---\n\n' + INSTALLED_PARAGRAPH + "\n\nYou are the CRT worker");
    // The intake skill has nothing to rewrite besides the paragraph (F-55 already made it neutral).
    const intake = readFileSync(join(pluginSkills, "intake", "SKILL.md"), "utf8");
    expect(rewriteSkill(intake)).toBe(intake.replace(/^(---\n[\s\S]*?\n---\n)\s*/, `$1\n${INSTALLED_PARAGRAPH}\n\n`));
    expect(rewriteSkill("no frontmatter ${CLAUDE_PROJECT_DIR}")).toBe(`${INSTALLED_PARAGRAPH}\n\nno frontmatter the project root (your working directory)`);
  });

  it("targets the profile's project dir, the user dir with --global, an explicit --dir, and demands --dir when the profile records none (F-58, §12 rule 4)", () => {
    expect(skillsTargetDir({ root, profile: codexProfile })).toBe(join(root, ".agents", "skills"));
    expect(skillsTargetDir({ root, profile: codexProfile, global: true, env: { CODEX_HOME: join(root, "cx") } })).toBe(join(root, "cx", "skills"));
    expect(skillsTargetDir({ root, profile: codexProfile, dir: "elsewhere" })).toBe(join(root, "elsewhere"));
    expect(skillsTargetDir({ root, profile: null, dir: join(root, "abs") })).toBe(join(root, "abs"));
    const stub = makeStubProfile();
    expect(() => skillsTargetDir({ root, profile: stub })).toThrow(/records no project-level skills directory for the tested version — pass --dir <path>/);
    expect(() => skillsTargetDir({ root, profile: stub, global: true })).toThrow(/user-level/);
    expect(() => skillsTargetDir({ root, profile: null })).toThrow(/needs --provider <id> or --dir <path>/);
    // Nothing is written on a refusal.
    expect(() => installSkills({ sourceDir: pluginSkills, root, profile: stub })).toThrow(CrtError);
    expect(existsSync(join(root, ".agents"))).toBe(false);
  });

  it("refuses --provider claude even with --dir, pointing at the plugin (F-58)", () => {
    expect(() => installSkills({ sourceDir: pluginSkills, root, profile: claudeProfile, dir: join(root, "x") })).toThrow(CLAUDE_REFUSAL);
    expect(CLAUDE_REFUSAL).toContain("claude plugin install crt@crt");
    expect(existsSync(join(root, "x"))).toBe(false);
  });

  it("the build ships every plugin skill under dist/skills, the source the CLI installs from (F-58)", () => {
    // The build's own copy step (scripts/copy-intake.mjs), into a temp dist: nothing is written under packages/server.
    const distSkills = join(root, "dist", "skills");
    copySkills(join(root, "dist"));
    for (const name of SKILL_NAMES) {
      expect(readFileSync(join(distSkills, name, "SKILL.md"), "utf8"), name).toBe(readFileSync(join(pluginSkills, name, "SKILL.md"), "utf8"));
    }
    const r = installSkills({ sourceDir: distSkills, root, profile: codexProfile });
    expect(r.dir).toBe(join(root, ".agents", "skills"));
    expect(r.written.length).toBe(7);
  });
});
