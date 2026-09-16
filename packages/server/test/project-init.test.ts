import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, DEFAULT_CONFIG_FILE, describeInit, initProject, readConfig, writeLocalConfig } from "../src/init.js";
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
  it("creates .crt/tasks, .crt/config.json and the .gitignore entries (F-35, F-43)", () => {
    const r = initProject(tmp);
    expect(existsSync(join(tmp, ".crt", "tasks"))).toBe(true);
    expect(JSON.parse(readFileSync(join(tmp, ".crt", "config.json"), "utf8"))).toEqual(DEFAULT_CONFIG_FILE);
    expect(readFileSync(join(tmp, ".gitignore"), "utf8")).toBe(".crt/captures/\n.crt/config.local.json\n");
    expect(r.created).toHaveLength(3);
  });

  it("is idempotent and never rewrites an existing config", () => {
    writeFileSync(join(tmp, ".gitignore"), "node_modules/");
    initProject(tmp);
    writeFileSync(join(tmp, ".crt", "config.json"), '{"port": 5555}\n');
    const second = initProject(tmp);
    expect(second.created).toEqual([]);
    expect(readFileSync(join(tmp, ".gitignore"), "utf8")).toBe("node_modules/\n.crt/captures/\n.crt/config.local.json\n");
    expect(readConfig(tmp).port).toBe(5555);
  });

  it("adds only the missing ignore line to a v0.1 .gitignore (F-43)", () => {
    writeFileSync(join(tmp, ".gitignore"), ".crt/captures/\n");
    initProject(tmp);
    expect(readFileSync(join(tmp, ".gitignore"), "utf8")).toBe(".crt/captures/\n.crt/config.local.json\n");
    expect(initProject(tmp).created).toEqual([]);
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
    expect(readConfig(tmp)).toEqual({ ...DEFAULT_CONFIG, target: "http://localhost:5173", targetSource: "project" });
  });

  it("layers target and port from config.local.json over config.json (PRD-setup F-72, §5.3)", () => {
    mkdirSync(join(tmp, ".crt"));
    writeFileSync(join(tmp, ".crt", "config.json"), '{"target":"http://localhost:3000","port":4400}');
    writeFileSync(join(tmp, ".crt", "config.local.json"), '{"target":"http://localhost:3100","port":4411}');
    expect(readConfig(tmp)).toMatchObject({ target: "http://localhost:3100", targetSource: "local", port: 4411 });
    // A junk or empty local value falls through to the project file.
    writeFileSync(join(tmp, ".crt", "config.local.json"), '{"target":"  ","port":"x"}');
    expect(readConfig(tmp)).toMatchObject({ target: "http://localhost:3000", targetSource: "project", port: 4400 });
    // Only the local file sets it → local; neither → null.
    writeFileSync(join(tmp, ".crt", "config.json"), "{}");
    writeFileSync(join(tmp, ".crt", "config.local.json"), '{"target":"3100"}');
    expect(readConfig(tmp)).toMatchObject({ target: "3100", targetSource: "local", port: 4400 });
    writeFileSync(join(tmp, ".crt", "config.local.json"), "{}");
    expect(readConfig(tmp)).toMatchObject({ target: null, targetSource: null });
  });

  it("writeLocalConfig remembers a target next to the provider keys, touching nothing else (F-72)", () => {
    mkdirSync(join(tmp, ".crt"));
    writeFileSync(join(tmp, ".crt", "config.local.json"), '{"provider":"claude","models":{"claude":"m"}}');
    writeLocalConfig(tmp, { target: "http://localhost:3100" });
    expect(JSON.parse(readFileSync(join(tmp, ".crt", "config.local.json"), "utf8"))).toEqual({ provider: "claude", models: { claude: "m" }, target: "http://localhost:3100" });
    expect(readConfig(tmp)).toMatchObject({ target: "http://localhost:3100", targetSource: "local" });
    // Creating the file when absent.
    rmSync(join(tmp, ".crt", "config.local.json"));
    writeLocalConfig(tmp, { target: "http://localhost:5173" });
    expect(JSON.parse(readFileSync(join(tmp, ".crt", "config.local.json"), "utf8"))).toEqual({ target: "http://localhost:5173" });
  });

  it("describeInit prints the F-75 first-init line, and nothing when nothing was created (PRD-setup F-75)", () => {
    const first = initProject(tmp);
    expect(describeInit(tmp, first)).toBe("crt init: created .crt/tasks, .crt/config.json; added .crt/captures/ and .crt/config.local.json to .gitignore — commit .crt/");
    expect(describeInit(tmp, initProject(tmp))).toBeNull();
    // Only the second ignore line missing (a v0.1 checkout): named alone.
    writeFileSync(join(tmp, ".gitignore"), ".crt/captures/\n");
    expect(describeInit(tmp, initProject(tmp))).toBe("crt init: added .crt/config.local.json to .gitignore — commit .crt/");
  });
});

describe("readConfig provider keys (F-43, F-53, F-57)", () => {
  const write = (name: string, value: unknown) => {
    mkdirSync(join(tmp, ".crt"), { recursive: true });
    writeFileSync(join(tmp, ".crt", name), JSON.stringify(value));
  };

  it("reads provider, models and providers.<id>.command from config.json (F-43, F-53)", () => {
    write("config.json", {
      provider: "codex",
      models: { claude: "claude-sonnet-5", codex: "gpt 5" },
      providers: { codex: { command: ["C:\\tools\\codex.exe", "--flag"] }, bad: { command: [] } },
    });
    expect(readConfig(tmp)).toEqual({
      ...DEFAULT_CONFIG,
      provider: "codex",
      providerSource: "project",
      // "gpt 5" has a space: not a valid F-57 model string, dropped.
      models: { claude: "claude-sonnet-5" },
      providers: { codex: { command: ["C:\\tools\\codex.exe", "--flag"] } },
    });
  });

  it("layers config.local.json over config.json, key by key (F-43 steps 3–4)", () => {
    write("config.json", { provider: "codex", models: { claude: "a", codex: "b" }, providers: { codex: { command: ["x"] } } });
    write("config.local.json", { provider: "claude", models: { codex: "c" }, providers: { claude: { command: ["y"] } } });
    expect(readConfig(tmp)).toMatchObject({
      provider: "claude",
      providerSource: "local",
      models: { claude: "a", codex: "c" },
      providers: { codex: { command: ["x"] }, claude: { command: ["y"] } },
    });
    // The local file only sets models: the committed provider still applies, from its own file.
    write("config.local.json", { models: { codex: "d" } });
    expect(readConfig(tmp)).toMatchObject({ provider: "codex", providerSource: "project", models: { claude: "a", codex: "d" } });
  });

  it("accepts the ACP object form from files only and ignores junk provider values (F-54, N-8)", () => {
    write("config.json", { provider: { kind: "acp", command: "gemini", args: ["--experimental-acp"], name: "Gemini" } });
    expect(readConfig(tmp)).toMatchObject({
      provider: { kind: "acp", command: "gemini", args: ["--experimental-acp"], name: "Gemini" },
      providerSource: "project",
    });
    write("config.json", { provider: { kind: "http", url: "x" } });
    expect(readConfig(tmp)).toMatchObject({ provider: null, providerSource: null });
    write("config.json", { provider: 42, models: "nope", providers: [] });
    expect(readConfig(tmp)).toEqual(DEFAULT_CONFIG);
  });
});
