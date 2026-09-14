import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, initProject, readConfig } from "../src/init.js";
import { findProjectRoot } from "../src/project.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "crt-test-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("findProjectRoot (PRD §5.1)", () => {
  it("returns the nearest ancestor containing .git", () => {
    mkdirSync(join(tmp, ".git"));
    const deep = join(tmp, "packages", "app", "src");
    mkdirSync(deep, { recursive: true });
    expect(findProjectRoot(deep)).toBe(tmp);
  });

  it("treats a .git file (worktree) as a root marker", () => {
    writeFileSync(join(tmp, ".git"), "gitdir: elsewhere\n");
    expect(findProjectRoot(join(tmp))).toBe(tmp);
  });

  it("falls back to the start directory when no .git exists", () => {
    const deep = join(tmp, "a", "b");
    mkdirSync(deep, { recursive: true });
    // tmpdir itself may live under a git repo on a dev machine; only assert when it does not.
    const root = findProjectRoot(deep);
    expect(root === deep || existsSync(join(root, ".git"))).toBe(true);
  });
});

describe("initProject (F-35)", () => {
  it("creates .crt/tasks, .crt/config.json and a .gitignore entry", () => {
    const r = initProject(tmp);
    expect(existsSync(join(tmp, ".crt", "tasks"))).toBe(true);
    expect(JSON.parse(readFileSync(join(tmp, ".crt", "config.json"), "utf8"))).toEqual(DEFAULT_CONFIG);
    expect(readFileSync(join(tmp, ".gitignore"), "utf8")).toBe(".crt/captures/\n");
    expect(r.created).toHaveLength(3);
  });

  it("is idempotent and never rewrites an existing config", () => {
    writeFileSync(join(tmp, ".gitignore"), "node_modules/");
    initProject(tmp);
    writeFileSync(join(tmp, ".crt", "config.json"), '{"port": 5555}\n');
    const second = initProject(tmp);
    expect(second.created).toEqual([]);
    expect(readFileSync(join(tmp, ".gitignore"), "utf8")).toBe("node_modules/\n.crt/captures/\n");
    expect(readConfig(tmp).port).toBe(5555);
  });

  it("recognises an existing ignore of the whole .crt directory", () => {
    writeFileSync(join(tmp, ".gitignore"), ".crt/\n");
    initProject(tmp);
    expect(readFileSync(join(tmp, ".gitignore"), "utf8")).toBe(".crt/\n");
  });
});

describe("readConfig (F-1)", () => {
  it("returns defaults when the file is missing or malformed", () => {
    expect(readConfig(tmp)).toEqual(DEFAULT_CONFIG);
    mkdirSync(join(tmp, ".crt"));
    writeFileSync(join(tmp, ".crt", "config.json"), "{ not json");
    expect(readConfig(tmp)).toEqual(DEFAULT_CONFIG);
  });

  it("reads target and port, ignoring junk values", () => {
    mkdirSync(join(tmp, ".crt"));
    writeFileSync(join(tmp, ".crt", "config.json"), '{"target":"http://localhost:5173","port":"nope"}');
    expect(readConfig(tmp)).toEqual({ ...DEFAULT_CONFIG, target: "http://localhost:5173" });
  });
});
