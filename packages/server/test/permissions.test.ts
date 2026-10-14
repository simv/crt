import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { decidePermission, describeRule, isReadOnlyGit, isUnderCrtDir, projectAllowList, ruleAllows, subjectOf, suggestRule } from "../src/permissions.js";
import { acpSubject } from "../src/providers/acp.js";

const root = resolve("/proj");

describe("permission policy (F-26, N-4, N-5)", () => {
  it("allows reads and searches silently", () => {
    for (const tool of ["Read", "Glob", "Grep"]) expect(decidePermission(tool, { file_path: "/etc/passwd" }, root)).toEqual({ kind: "allow" });
  });

  it("allows CRT's own MCP tool", () => {
    expect(decidePermission("mcp__crt__write_task", { title: "x" }, root)).toEqual({ kind: "allow" });
  });

  it("denies WebFetch / WebSearch with a reason (N-4)", () => {
    expect(decidePermission("WebFetch", { url: "https://x" }, root)).toMatchObject({ kind: "deny", reason: expect.stringContaining("WebFetch") });
    expect(decidePermission("WebSearch", { query: "x" }, root).kind).toBe("deny");
  });

  it("allows read-only git in Bash and asks for anything else", () => {
    expect(decidePermission("Bash", { command: "git status" }, root)).toEqual({ kind: "allow" });
    expect(decidePermission("Bash", { command: "git log --oneline -20 -- src/" }, root)).toEqual({ kind: "allow" });
    expect(decidePermission("Bash", { command: "git -C /proj diff HEAD~1" }, root)).toEqual({ kind: "allow" });
    expect(decidePermission("Bash", { command: "npm test" }, root)).toEqual({ kind: "ask" });
    expect(decidePermission("Bash", { command: "git commit -m x" }, root)).toEqual({ kind: "ask" });
    expect(decidePermission("Bash", { command: "git status && rm -rf ." }, root)).toEqual({ kind: "ask" });
    expect(decidePermission("Bash", { command: "git log | tee out" }, root)).toEqual({ kind: "ask" });
    expect(decidePermission("Bash", {}, root)).toEqual({ kind: "ask" });
  });

  it("classifies git subcommands and flags", () => {
    expect(isReadOnlyGit("git show HEAD:src/a.ts")).toBe(true);
    expect(isReadOnlyGit("git branch -a")).toBe(true);
    expect(isReadOnlyGit("git branch -D feature")).toBe(false);
    expect(isReadOnlyGit("git tag -a v1")).toBe(false);
    expect(isReadOnlyGit("git tag v1")).toBe(false);
    expect(isReadOnlyGit("git tag -l v*")).toBe(true);
    expect(isReadOnlyGit("git branch feature")).toBe(false);
    expect(isReadOnlyGit("git branch -avv")).toBe(true);
    expect(isReadOnlyGit("git branch --contains abc123")).toBe(true);
    expect(isReadOnlyGit("git branch --show-current")).toBe(true);
    expect(isReadOnlyGit("git remote -v")).toBe(true);
    expect(isReadOnlyGit("git remote add origin x")).toBe(false);
    expect(isReadOnlyGit("git stash list")).toBe(true);
    expect(isReadOnlyGit("git stash pop")).toBe(false);
    expect(isReadOnlyGit("git config --get user.name")).toBe(true);
    expect(isReadOnlyGit("git config user.name x")).toBe(false);
    expect(isReadOnlyGit("git push")).toBe(false);
    expect(isReadOnlyGit("git log $(cat x)")).toBe(false);
    expect(isReadOnlyGit("gitk")).toBe(false);
  });

  it("allows Write/Edit only under <root>/.crt/ (N-5)", () => {
    expect(decidePermission("Write", { file_path: join(root, ".crt", "tasks", "CRT-0001-x.md") }, root)).toEqual({ kind: "allow" });
    expect(decidePermission("Edit", { file_path: ".crt/config.json" }, root)).toEqual({ kind: "allow" });
    expect(decidePermission("Write", { file_path: join(root, "src", "a.ts") }, root)).toEqual({ kind: "ask" });
    expect(decidePermission("Write", { file_path: join(root, ".crt", "..", "src", "a.ts") }, root)).toEqual({ kind: "ask" });
    expect(decidePermission("Write", { file_path: join(root, ".crtx", "a") }, root)).toEqual({ kind: "ask" });
    expect(decidePermission("Write", {}, root)).toEqual({ kind: "ask" });
    expect(decidePermission("NotebookEdit", { notebook_path: join(root, ".crt", "n.ipynb") }, root)).toEqual({ kind: "allow" });
  });

  it("isUnderCrtDir handles the directory itself and relative paths", () => {
    expect(isUnderCrtDir(join(root, ".crt"), root)).toBe(false);
    expect(isUnderCrtDir(join(root, ".crt", "x"), root)).toBe(true);
    expect(isUnderCrtDir(".crt/tasks/a.md", root)).toBe(true);
    expect(isUnderCrtDir("../.crt/a.md", root)).toBe(false);
  });

  it("asks for unknown tools", () => {
    expect(decidePermission("SomethingNew", {}, root)).toEqual({ kind: "ask" });
  });
});

describe("Always allow rules (PRD-chat F-124)", () => {
  const cmd = (command: string) => ({ kind: "command" as const, command });
  const edit = (...paths: string[]) => ({ kind: "edit" as const, paths });

  it("names the same subject for Claude's tools and an ACP agent's, so one rule covers every agent (F-124)", () => {
    expect(subjectOf("Bash", { command: "npm test" })).toEqual(cmd("npm test"));
    expect(acpSubject({ toolCallId: "1", kind: "execute", rawInput: { command: "npm test" } })).toEqual(cmd("npm test"));
    expect(subjectOf("Edit", { file_path: join(root, "src", "a.ts") })).toEqual(edit(join(root, "src", "a.ts")));
    expect(subjectOf("NotebookEdit", { notebook_path: "n.ipynb" })).toEqual(edit("n.ipynb"));
    expect(acpSubject({ toolCallId: "1", kind: "edit", locations: [{ path: join(root, "src", "a.ts") }] })).toEqual(edit(join(root, "src", "a.ts")));
    expect(subjectOf("mcp__figma__get_screenshot", {})).toEqual({ kind: "tool", name: "mcp__figma__get_screenshot" });
    // `other` is any tool: too coarse for a rule.
    expect(acpSubject({ toolCallId: "1", kind: "other", locations: [{ path: "/x" }] })).toBeUndefined();
  });

  it("suggests a command prefix of up to three words before the first flag, else the exact command (F-124)", () => {
    expect(suggestRule(cmd("npm test"), root)).toBe("Bash(npm test:*)");
    expect(suggestRule(cmd("npm run build -- --watch"), root)).toBe("Bash(npm run build:*)");
    expect(suggestRule(cmd("npx vitest run src/cart.test.ts"), root)).toBe("Bash(npx vitest run:*)");
    expect(suggestRule(cmd("rm -rf dist"), root)).toBe("Bash(rm -rf dist)");
    expect(suggestRule(cmd("ls"), root)).toBe("Bash(ls)");
    expect(suggestRule(cmd("npm test && rm -rf ."), root)).toBe("Bash(npm test && rm -rf .)");
    expect(suggestRule(cmd("  "), root)).toBeNull();
  });

  it("suggests the directory of the edited files inside the project, and nothing outside it (F-124)", () => {
    expect(suggestRule(edit(join(root, "src", "components", "Cart.tsx")), root)).toBe("Edit(src/components/**)");
    expect(suggestRule(edit("src/components/Cart.tsx", join(root, "src", "lib", "x.ts")), root)).toBe("Edit(src/**)");
    expect(suggestRule(edit(join(root, "package.json")), root)).toBe("Edit(**)");
    expect(suggestRule(edit(resolve("/elsewhere/a.ts")), root)).toBeNull();
    expect(suggestRule(edit(), root)).toBeNull();
    expect(suggestRule({ kind: "tool", name: "mcp__x__y" }, root)).toBe("mcp__x__y");
  });

  it("matches commands by prefix without shell operators, exact rules exactly (F-124)", () => {
    expect(ruleAllows("Bash(npm test:*)", cmd("npm test"), root)).toBe(true);
    expect(ruleAllows("Bash(npm test:*)", cmd("npm test -- cart"), root)).toBe(true);
    expect(ruleAllows("Bash(npm test:*)", cmd("npm tester"), root)).toBe(false);
    expect(ruleAllows("Bash(npm test:*)", cmd("npm test; rm -rf ."), root)).toBe(false);
    expect(ruleAllows("Bash(npm test:*)", cmd("npm test $(rm -rf .)"), root)).toBe(false);
    expect(ruleAllows("Bash(rm -rf dist)", cmd("rm -rf dist"), root)).toBe(true);
    expect(ruleAllows("Bash(rm -rf dist)", cmd("rm -rf dist src"), root)).toBe(false);
    expect(ruleAllows("Bash(npm test:*)", edit("npm"), root)).toBe(false);
  });

  it("matches edits under the rule's directory and inside the project only (F-124)", () => {
    expect(ruleAllows("Edit(src/**)", edit(join(root, "src", "a", "b.ts")), root)).toBe(true);
    expect(ruleAllows("Edit(src/**)", edit("src/a.ts", "lib/b.ts"), root)).toBe(false);
    expect(ruleAllows("Edit(src/**)", edit(join(root, "src", "..", "..", "x.ts")), root)).toBe(false);
    expect(ruleAllows("Edit(**)", edit(join(root, "README.md")), root)).toBe(true);
    expect(ruleAllows("Edit(**)", edit(resolve("/elsewhere/x.ts")), root)).toBe(false);
    expect(ruleAllows("Edit(**)", edit(), root)).toBe(false);
    expect(ruleAllows("mcp__x__y", { kind: "tool", name: "mcp__x__y" }, root)).toBe(true);
    expect(ruleAllows("mcp__x__y", { kind: "tool", name: "mcp__x__z" }, root)).toBe(false);
  });

  it("names a rule for the card (F-124)", () => {
    expect(describeRule("Bash(npm test:*)")).toBe('commands starting with "npm test"');
    expect(describeRule("Bash(rm -rf dist)")).toBe('the command "rm -rf dist"');
    expect(describeRule("Edit(src/components/**)")).toBe("file edits under src/components/");
    expect(describeRule("Edit(**)")).toBe("file edits anywhere");
    expect(describeRule("mcp__x__y")).toBe("the tool mcp__x__y");
  });

  it("saves rules to .crt/config.local.json once, keeps its other keys, and reads both files (F-124)", () => {
    const dir = mkdtempSync(join(tmpdir(), "crt-allow-"));
    try {
      mkdirSync(join(dir, ".crt"));
      writeFileSync(join(dir, ".crt", "config.local.json"), JSON.stringify({ provider: "gemini", permissions: { deny: ["x"] } }));
      writeFileSync(join(dir, ".crt", "config.json"), JSON.stringify({ permissions: { allow: ["Bash(make:*)"] } }));
      const list = projectAllowList(dir);
      expect(list.allows(cmd("make all"))).toBe(true);
      expect(list.allows(cmd("npm test"))).toBe(false);
      list.add("Bash(npm test:*)");
      list.add("Bash(npm test:*)");
      expect(list.allows(cmd("npm test"))).toBe(true);
      expect(JSON.parse(readFileSync(join(dir, ".crt", "config.local.json"), "utf8"))).toEqual({ provider: "gemini", permissions: { deny: ["x"], allow: ["Bash(npm test:*)"] } });
      // The shared file is never written.
      expect(JSON.parse(readFileSync(join(dir, ".crt", "config.json"), "utf8"))).toEqual({ permissions: { allow: ["Bash(make:*)"] } });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
