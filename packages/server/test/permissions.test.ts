import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decidePermission, isReadOnlyGit, isUnderCrtDir } from "../src/permissions.js";

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
