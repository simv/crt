import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFrontmatter } from "../src/tasks.js";

// PRD-chat F-123 (CRT-0044): the /crt:next worker sees its PR's CI through in the same turn and,
// only when the project sets `"worker": { "merge": true }`, closes the task the F-122 way and
// merges. A doc test on the skill text, the way serve-skill.test.ts pins /crt:serve.

const repo = join(import.meta.dirname, "..", "..", "..");
const skill = readFileSync(join(repo, "plugin", "skills", "next", "SKILL.md"), "utf8");
const readme = readFileSync(join(repo, "README.md"), "utf8");

describe("next skill (F-37, F-123)", () => {
  it("keeps its frontmatter and numbers Wait for CI, Finish and Blocked as steps 7–9 (F-37, F-123)", () => {
    const fm = parseFrontmatter(skill)!;
    expect(fm.data).toMatchObject({ name: "next" });
    expect(String(fm.data["disable-model-invocation"])).toBe("true");
    const headings = [...skill.matchAll(/^## (\d)\. (.+)$/gm)].map((m) => `${m[1]} ${m[2]}`);
    expect(headings).toEqual(["1 Pick", "2 Claim", "3 Understand", "4 Implement", "5 Verify", "6 Hand over (all items ticked)", "7 Wait for CI (in the same turn)", '8 Finish (only with `"worker": { "merge": true }`)', "9 Blocked (anything unticked, or you cannot proceed)"]);
    expect(skill).toContain("mark the task `blocked` (step 9)");
  });

  it("waits for the checks in the same turn, fixes its own breakage at most twice, re-runs an unrelated failure once, and reports what is still red (F-123)", () => {
    expect(skill).toContain("- Otherwise go straight on to step 7, in the same turn.");
    expect(skill).toContain("Never end your turn while they run.");
    expect(skill).toContain("`gh pr checks <number> --watch --interval 15`");
    expect(skill).toContain("`no checks reported`");
    expect(skill).toContain("`gh run view <run-id> --log-failed`");
    expect(skill).toContain("At most two such rounds.");
    expect(skill).toContain("`gh run rerun <run-id> --failed` once");
    expect(skill).toContain("`status: review — CI red: <check>`");
    expect(skill).toContain("`status: review — CI green`");
    expect(skill).toContain("- Never end your turn while the PR's checks are running (step 7).");
  });

  it("merges only with worker.merge, after the done commit and its checks, never by auto-merge (F-122, F-123)", () => {
    expect(skill).toContain("read `.crt/config.local.json`, then `.crt/config.json`. The first one that has a `worker.merge` key decides.");
    expect(skill).toContain("Merging is then the developer's call (`/crt:done <ID>`).");
    const done = skill.indexOf("`- <stamp> — done; closed in <PR URL> (CI green on <short sha>)`");
    const checks = skill.indexOf("Wait for the checks on that commit as in step 7.");
    const merge = skill.indexOf("`gh pr merge <number> --squash --delete-branch`");
    expect(done).toBeGreaterThan(-1);
    expect(checks).toBeGreaterThan(done);
    expect(merge).toBeGreaterThan(checks);
    expect(skill).toContain("`gh pr view <number> --json state`");
    expect(skill).toContain("`status: done — merged`");
    expect(skill).toContain("never enable auto-merge; merge only in step 8.");
    expect(skill).not.toContain("Do not merge it and do not enable auto-merge.");
  });

  it("the README names the key and the local override (F-123)", () => {
    expect(readme).toContain('put `"worker": { "merge": true }` in `.crt/config.json`, or in `.crt/config.local.json` for yourself only.');
    expect(readme).toContain("Then it waits for the PR's checks and fixes what its own change broke.");
  });
});
