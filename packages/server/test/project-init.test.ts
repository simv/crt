import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CrtError } from "../src/errors.js";
import { DEFAULT_CONFIG, DEFAULT_CONFIG_FILE, detectIntegration, initProject, instructionsBlock, planInit, readConfig, readmeTemplate, renderPlan, renderSnippet, runInit, writeLocalConfig } from "../src/init.js";
import { findProjectRoot } from "../src/project.js";
import type { Prompter } from "../src/start.js";

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

describe("initProject (F-35, PRD-embedded F-100)", () => {
  it("creates .crt/README.md, .crt/tasks, .crt/config.json (mode embedded) and the .gitignore entries, one line each (F-35, F-43, F-100)", () => {
    const lines: string[] = [];
    const r = initProject(tmp, { version: "0.4.0", log: (l) => lines.push(l) });
    expect(existsSync(join(tmp, ".crt", "tasks"))).toBe(true);
    expect(readFileSync(join(tmp, ".crt", "README.md"), "utf8")).toBe(readmeTemplate("0.4.0"));
    expect(JSON.parse(readFileSync(join(tmp, ".crt", "config.json"), "utf8"))).toEqual(DEFAULT_CONFIG_FILE);
    expect(DEFAULT_CONFIG_FILE.mode).toBe("embedded");
    expect(readFileSync(join(tmp, ".gitignore"), "utf8")).toBe(".crt/captures/\n.crt/config.local.json\n");
    expect(r.created).toHaveLength(4);
    expect(lines).toEqual(["crt init: created .crt/README.md", "crt init: created .crt/tasks/", "crt init: created .crt/config.json", "crt init: added .crt/captures/ and .crt/config.local.json to .gitignore"]);
  });

  it("the README names the folder contents, how tasks are worked and the crt init footer, and is written only once (F-100)", () => {
    const readme = readmeTemplate("0.4.0");
    for (const s of ["`tasks/`", "`tasks/README.md`", "`tasks/assets/<ID>/`", "`captures/`", "`config.json`", "`config.local.json`", "`mode`", "`target`", "`port`", "`provider`", "/crt:next", "`crt tasks`", "`crt task <ID>`", "never hand-edit", "gitignored"]) {
      expect(readme).toContain(s);
    }
    expect(readme.trimEnd().endsWith("Written by crt init 0.4.0; https://github.com/simv/crt")).toBe(true);
    expect(readme).not.toContain("\r\n");
    initProject(tmp, { version: "0.4.0" });
    writeFileSync(join(tmp, ".crt", "README.md"), "# mine\n");
    expect(initProject(tmp, { version: "0.4.1" }).created).toEqual([]);
    expect(readFileSync(join(tmp, ".crt", "README.md"), "utf8")).toBe("# mine\n");
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

  it("names only the missing ignore line on a v0.1 checkout (F-100)", () => {
    initProject(tmp);
    const lines: string[] = [];
    writeFileSync(join(tmp, ".gitignore"), ".crt/captures/\n");
    initProject(tmp, { log: (l) => lines.push(l) });
    expect(lines).toEqual(["crt init: added .crt/config.local.json to .gitignore"]);
    expect(initProject(tmp, { log: (l) => lines.push(l) }).created).toEqual([]);
    expect(lines).toHaveLength(1);
  });
});

// PRD-embedded F-100: `crt init` end to end over a scratch root — the plan, the question, the writes,
// the "is set up" line and the snippet — with a scripted prompter and the provider fixed to `claude`.
describe("crt init (PRD-embedded F-100)", () => {
  const prompter = (answers: string[]): Prompter & { questions: string[] } => {
    const p = {
      questions: [] as string[],
      ask: async (q: string) => {
        p.questions.push(q);
        return answers.shift() ?? "";
      },
      waitFor: async () => ({ kind: "ready" as const }),
    };
    return p;
  };
  const run = (over: Partial<Parameters<typeof runInit>[1]> = {}) => {
    const lines: string[] = [];
    const done = runInit(tmp, { yes: false, instructions: true, snippet: false, json: false, interactive: false, version: "0.4.0", provider: async () => "claude", log: (l) => lines.push(l), ...over });
    return { lines, done };
  };

  it("prints the F-100 plan (only what is not in place), writes each item with one line, and ends with the snippet (F-100, F-102)", async () => {
    writeFileSync(join(tmp, ".gitignore"), ".crt/captures/\n");
    const { lines, done } = run();
    await done;
    expect(lines.slice(0, 6)).toEqual([`crt init will, in ${tmp}:`, "  create .crt/README.md", "  create .crt/tasks/", "  create .crt/config.json", "  add .crt/config.local.json to .gitignore", "  create CLAUDE.md with a CRT section"]);
    expect(lines.slice(6, 11)).toEqual([
      "crt init: created .crt/README.md",
      "crt init: created .crt/tasks/",
      "crt init: created .crt/config.json",
      "crt init: added .crt/config.local.json to .gitignore",
      "crt init: created CLAUDE.md with the CRT section",
    ]);
    expect(lines.slice(11)).toEqual(renderSnippet(detectIntegration(tmp)));
    expect(lines[11]).toBe("Add CRT to your app (development only):");
    expect(readFileSync(join(tmp, "CLAUDE.md"), "utf8")).toBe(instructionsBlock("0.4.0") + "\n");
    expect(readFileSync(join(tmp, ".crt", "README.md"), "utf8")).toBe(readmeTemplate("0.4.0"));
  });

  it('the second run prints the "is set up" line and the snippet, and writes nothing (F-100)', async () => {
    await run().done;
    const before = readFileSync(join(tmp, "CLAUDE.md"), "utf8");
    const { lines, done } = run();
    await done;
    expect(lines[0]).toBe(`crt init: ${tmp} is set up (.crt/README.md, tasks/, config.json, .gitignore entries, CRT section in CLAUDE.md)`);
    expect(lines[1]).toBe("Add CRT to your app (development only):");
    expect(readFileSync(join(tmp, "CLAUDE.md"), "utf8")).toBe(before);
  });

  it("--no-instructions leaves CLAUDE.md / AGENTS.md alone and out of the plan (F-100, F-101)", async () => {
    const { lines, done } = run({ instructions: false });
    await done;
    expect(lines.some((l) => /CRT section|CLAUDE\.md|AGENTS\.md/.test(l))).toBe(false);
    expect(existsSync(join(tmp, "CLAUDE.md"))).toBe(false);
    expect(existsSync(join(tmp, "AGENTS.md"))).toBe(false);
    const again = run({ instructions: false });
    await again.done;
    expect(again.lines[0]).toBe(`crt init: ${tmp} is set up (.crt/README.md, tasks/, config.json, .gitignore entries)`);
  });

  it("asks `Go ahead? [Y/n]` on a terminal without --yes: Enter applies, n cancels with exit 130 and writes nothing (F-100)", async () => {
    const no = prompter(["n"]);
    const refused = run({ interactive: true, prompt: no });
    await expect(refused.done).rejects.toBeInstanceOf(CrtError);
    await expect(refused.done).rejects.toMatchObject({ exitCode: 130, message: "cancelled" });
    expect(no.questions).toEqual(["Go ahead? [Y/n]"]);
    expect(existsSync(join(tmp, ".crt"))).toBe(false);
    const yes = prompter([""]);
    await run({ interactive: true, prompt: yes }).done;
    expect(yes.questions).toEqual(["Go ahead? [Y/n]"]);
    expect(existsSync(join(tmp, ".crt", "tasks"))).toBe(true);
    // --yes on a terminal: no question.
    rmSync(join(tmp, ".crt"), { recursive: true, force: true });
    const skipped = prompter([]);
    await run({ interactive: true, yes: true, prompt: skipped }).done;
    expect(skipped.questions).toEqual([]);
    expect(existsSync(join(tmp, ".crt", "tasks"))).toBe(true);
  });

  it("--snippet prints only the snippet and writes nothing; --json prints the F-102 object (F-100, F-102)", async () => {
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ dependencies: { next: "16.0.0" } }));
    const human = run({ snippet: true });
    await human.done;
    expect(human.lines).toEqual([
      "Add CRT to your app (development only):",
      "  your root layout",
      '    import { CrtDevTools } from "claude-review-tool/react";',
      "    …",
      "    <body>{children}<CrtDevTools /></body>",
      "Production builds contain nothing from CRT (README › Production). /crt:init in Claude Code applies this for you.",
    ]);
    expect(existsSync(join(tmp, ".crt"))).toBe(false);
    expect(existsSync(join(tmp, "CLAUDE.md"))).toBe(false);
    const json = run({ snippet: true, json: true });
    await json.done;
    expect(JSON.parse(json.lines.join("\n"))).toEqual({
      framework: "next",
      file: null,
      snippet: 'import { CrtDevTools } from "claude-review-tool/react";\n…\n<body>{children}<CrtDevTools /></body>',
      import: 'import { CrtDevTools } from "claude-review-tool/react";',
      usage: "<body>{children}<CrtDevTools /></body>",
    });
    expect(existsSync(join(tmp, ".crt"))).toBe(false);
  });

  it("planInit asks for the provider only when neither instruction file exists, and renderPlan is the F-100 layout (F-100, F-101)", async () => {
    let asked = 0;
    const provider = async () => {
      asked++;
      return "codex";
    };
    const plan = await planInit(tmp, { instructions: true, version: "0.4.0", provider });
    expect(asked).toBe(1);
    expect(plan.provider).toBe("codex");
    expect(renderPlan(plan)).toEqual([`crt init will, in ${tmp}:`, "  create .crt/README.md", "  create .crt/tasks/", "  create .crt/config.json", "  add .crt/captures/ and .crt/config.local.json to .gitignore", "  create AGENTS.md with a CRT section"]);
    writeFileSync(join(tmp, "CLAUDE.md"), "# app\n");
    const withFile = await planInit(tmp, { instructions: true, version: "0.4.0", provider });
    expect(asked).toBe(1);
    expect(withFile.provider).toBeNull();
    expect(renderPlan(withFile).at(-1)).toBe("  add a CRT section to CLAUDE.md");
  });
});

// PRD-embedded F-102: framework detection from the root package.json names and the candidate files.
describe("detectIntegration (PRD-embedded F-102)", () => {
  const pkg = (deps: Record<string, string>, scripts: Record<string, string> = {}) => writeFileSync(join(tmp, "package.json"), JSON.stringify({ dependencies: deps, scripts }));
  const touch = (rel: string) => {
    const parts = rel.split("/");
    if (parts.length > 1) mkdirSync(join(tmp, ...parts.slice(0, -1)), { recursive: true });
    writeFileSync(join(tmp, ...parts), "");
  };

  it.each([
    ["next, no layout", { next: "16" }, [], "next", null, "claude-review-tool/react"],
    ["next, app/layout.tsx first", { next: "16", react: "19" }, ["app/layout.tsx", "src/app/layout.tsx"], "next", "app/layout.tsx", "claude-review-tool/react"],
    ["next, src/app/layout.js only", { next: "16" }, ["src/app/layout.js"], "next", "src/app/layout.js", "claude-review-tool/react"],
    ["vite (a devDependency), vite.config.ts first", { vite: "8" }, ["vite.config.ts", "vite.config.js"], "vite", "vite.config.ts", "claude-review-tool/vite"],
    ["vite, no config", { vite: "8" }, [], "vite", null, "claude-review-tool/vite"],
    ["react without next or vite, src/main.tsx", { react: "19", "react-dom": "19" }, ["src/main.tsx"], "react", "src/main.tsx", "claude-review-tool/loader"],
    ["react-dom alone, no entry", { "react-dom": "19" }, [], "react", null, "claude-review-tool/loader"],
    ["bundled (a dev script), src/index.ts", { svelte: "5" }, ["src/index.ts"], "bundled", "src/index.ts", "claude-review-tool/loader"],
    ["bundled, no entry", { svelte: "5" }, [], "bundled", null, "claude-review-tool/loader"],
  ] as const)("%s → %s (F-102)", (name, deps, files, framework, file, imported) => {
    const vite = name.startsWith("vite");
    writeFileSync(join(tmp, "package.json"), JSON.stringify(vite ? { devDependencies: deps } : { dependencies: deps, scripts: { dev: "x" } }));
    for (const f of files) touch(f);
    const i = detectIntegration(tmp);
    expect(i.framework).toBe(framework);
    expect(i.file).toBe(file);
    expect(i.import).toContain(imported);
    expect(i.snippet.startsWith(i.import)).toBe(true);
  });

  it("no package.json, or one without a framework or a dev/start script → static: the script tag (F-102)", () => {
    const tag = '<script src="http://localhost:4400/__crt/loader.js"></script>';
    expect(detectIntegration(tmp)).toEqual({ framework: "static", file: null, snippet: tag, import: tag, usage: tag });
    pkg({ lodash: "4" });
    expect(detectIntegration(tmp).framework).toBe("static");
    pkg({ lodash: "4" }, { start: "node server.js" });
    expect(detectIntegration(tmp).framework).toBe("bundled");
    writeFileSync(join(tmp, "package.json"), "{ not json");
    expect(detectIntegration(tmp).framework).toBe("static");
  });

  it("the snippet texts are PRD-embedded §4 verbatim and the human form has the heading, the file and the production sentence (F-102)", () => {
    pkg({ next: "16" });
    touch("app/layout.tsx");
    expect(detectIntegration(tmp).snippet).toBe('import { CrtDevTools } from "claude-review-tool/react";\n…\n<body>{children}<CrtDevTools /></body>');
    writeFileSync(join(tmp, "package.json"), JSON.stringify({ devDependencies: { vite: "8" } }));
    expect(detectIntegration(tmp).snippet).toBe('import { crt } from "claude-review-tool/vite";\nexport default defineConfig({ plugins: [react(), crt()] });');
    pkg({ react: "19" });
    expect(detectIntegration(tmp).snippet).toBe('import { mountCrt } from "claude-review-tool/loader";\nif (process.env.NODE_ENV !== "production") mountCrt();   // the guard is optional (F-98); it lets the bundler drop the import');
    expect(detectIntegration(tmp).usage).toBe('if (process.env.NODE_ENV !== "production") mountCrt();');
    pkg({ next: "16" });
    expect(renderSnippet(detectIntegration(tmp))).toEqual([
      "Add CRT to your app (development only):",
      "  app/layout.tsx",
      '    import { CrtDevTools } from "claude-review-tool/react";',
      "    …",
      "    <body>{children}<CrtDevTools /></body>",
      "Production builds contain nothing from CRT (README › Production). /crt:init in Claude Code applies this for you.",
    ]);
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
