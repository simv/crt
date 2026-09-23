import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { INTEGRATION_CANDIDATES } from "../src/init.js";
import { rewriteSkill } from "../src/skills.js";
import { parseFrontmatter } from "../src/tasks.js";

// PRD-embedded F-104: /crt:init — a doc test on the skill text: the three steps, the four edit
// recipes, "never commit", and that it names no app file outside the F-102 snippet targets.

const skill = readFileSync(join(import.meta.dirname, "..", "..", "..", "plugin", "skills", "init", "SKILL.md"), "utf8");

describe("init skill (F-104)", () => {
  it("has the F-104 frontmatter: name, a description that triggers on setting CRT up, the allowed tools, model-invocable (F-104)", () => {
    const fm = parseFrontmatter(skill)!;
    expect(fm.data).toMatchObject({ name: "init" });
    expect(String(fm.data.description)).toMatch(/set up|set the Claude Review Tool up/i);
    expect(String(fm.data["allowed-tools"])).toBe("Bash(npx *) Read Edit Write Glob Grep AskUserQuestion");
    expect(fm.data["disable-model-invocation"]).toBeUndefined();
  });

  it("step 1 runs `crt init --yes` from the project root, relays every crt init: line, and stops on a crt: failure line (F-104)", () => {
    expect(skill).toContain("## 1. Run `crt init --yes`");
    expect(skill).toContain("Run `crt init --yes` from `${CLAUDE_PROJECT_DIR}` and relay every `crt init:` line it prints verbatim");
    expect(skill).toContain("If it prints a `crt: …` failure line instead, relay that line verbatim and stop.");
  });

  it("step 2 reads `crt init --snippet --json`, greps before editing, and applies the four recipes (F-104, F-102)", () => {
    expect(skill).toContain("Run `crt init --snippet --json`.");
    expect(skill).toContain('`{ "framework", "file", "snippet", "import", "usage" }`');
    expect(skill).toContain("Grep the file for `claude-review-tool/` and `/__crt/loader.js` **before editing**");
    expect(skill).toContain("when the snippet is already present, say so instead of editing");
    // Next: the import at the top, <CrtDevTools /> last in <body>, after {children}.
    expect(skill).toContain("`<CrtDevTools />` as the **last child of `<body>`**, after `{children}`");
    expect(skill).toContain("<body>{children}<CrtDevTools /></body>");
    // Vite: crt() appended to plugins, created when absent, never duplicated.
    expect(skill).toContain("append `crt()` to the `plugins` array (`plugins: [react(), crt()]`); create `plugins: [crt()]` when the config has no `plugins` key. Never add a second `crt()`.");
    // React / bundled: import + usage at the top of the entry.
    expect(skill).toContain("add `import` and the `usage` line at the **top of the entry**");
    expect(skill).toContain('import { mountCrt } from "claude-review-tool/loader";');
    expect(skill).toContain('if (process.env.NODE_ENV !== "production") mountCrt();');
    // Static: instructions only.
    expect(skill).toContain('<script src="http://localhost:4400/__crt/loader.js"></script>');
    expect(skill).toMatch(/\*\*static\*\* — .*and stop; edit nothing\./);
    // When file is null: Glob, and AskUserQuestion when several candidates exist.
    expect(skill).toContain("When `file` is `null`, find the target with Glob");
    expect(skill).toContain("when several candidates exist, ask (AskUserQuestion) which one is the app's entry");
  });

  it("never touches another file and never commits (F-104)", () => {
    expect(skill).toContain("Never touch any other file. Never commit.");
    expect(skill).toContain("You edit at most one app file — the snippet target — and you never commit.");
    expect(skill).not.toMatch(/git (add|commit|push)/);
  });

  it("names no app file outside the F-102 snippet targets (F-104)", () => {
    const allowed = new Set([...Object.values(INTEGRATION_CANDIDATES).flat(), "vite.config.*", "package.json", "CLAUDE.md", "AGENTS.md", ".crt/README.md", ".crt/tasks/", ".crt/config.json", ".gitignore"]);
    // Every backticked path-like token (a slash or a dot with an extension) must be an F-102 candidate or a crt init artefact.
    const paths = [...skill.matchAll(/`([^`\s]+\.(?:tsx?|jsx?|mts|mjs|json|md|\*)|[^`\s]*\/[^`\s]*)`/g)].map((m) => m[1]!).filter((p) => p !== "/" && !p.startsWith("/crt:") && !p.startsWith("${") && !p.startsWith("claude-review-tool/") && !p.startsWith("/__crt/") && !p.includes("http"));
    for (const p of paths) expect(allowed.has(p), p).toBe(true);
    expect(paths.length).toBeGreaterThan(5);
  });

  it("replies with the crt init lines, the one-file diff, the production sentence and the next step (F-104)", () => {
    expect(skill).toContain("the lines `crt init` printed");
    expect(skill).toContain("the diff of the one app file you edited");
    expect(skill).toContain('the sentence "Development only — production builds contain nothing from CRT."');
    expect(skill).toContain('"Next: `npm run dev`, then /crt:serve."');
  });

  it("resolves crt per F-87 and survives the F-58 rewrite for other agents (F-87, F-58)", () => {
    expect(skill).toContain("`npx --no crt`");
    expect(skill).toContain("`npx -y claude-review-tool@0.7`");
    const out = rewriteSkill(skill);
    expect(out).not.toContain("AskUserQuestion");
    expect(out).not.toContain("${CLAUDE_PROJECT_DIR}");
  });
});
