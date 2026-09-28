import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { SERVER_DIR } from "./helpers/entries.js";

// CRT-0042: which modules a server entry loads. The graph is the one Node walks: each file is
// transpiled the way tsc emits it (type-only imports and imports used only as types disappear),
// then every top-level `import` and `export … from` of the output is followed. Dynamic `import()`
// loads nothing until it runs, so it is not an edge (cli.ts relies on that for `crt mcp`).

const SRC = join(SERVER_DIR, "src");
const SDK = "@anthropic-ai/claude-agent-sdk";

/** Relative `src/` paths (with `/`) and bare package specifiers reachable from `entry` by static imports. */
function staticGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string) => {
    const rel = relative(SRC, file).split("\\").join("/");
    if (seen.has(rel)) return;
    seen.add(rel);
    const js = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      fileName: file,
    }).outputText;
    for (const statement of ts.createSourceFile(file, js, ts.ScriptTarget.ES2022).statements) {
      if (!(ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement))) continue;
      const specifier = statement.moduleSpecifier;
      if (!specifier || !ts.isStringLiteral(specifier)) continue;
      if (specifier.text.startsWith(".")) visit(resolve(dirname(file), specifier.text.replace(/\.js$/, ".ts")));
      else seen.add(specifier.text);
    }
  };
  visit(join(SRC, entry));
  return seen;
}

describe("module boundaries (CRT-0042)", () => {
  it("the walker sees the heavy edges: serve.ts reaches proxy.ts and the Agent SDK (PRD §12)", () => {
    const graph = staticGraph("serve.ts");
    expect(graph).toContain("proxy.ts");
    expect(graph).toContain("providers/claude.ts");
    expect(graph).toContain(SDK);
  });

  it("`crt setup` (setup.ts) and the probes (probes.ts) load neither the Agent SDK nor proxy.js (F-73, F-79, F-86, PRD §12)", () => {
    for (const entry of ["setup.ts", "probes.ts"]) {
      const graph = staticGraph(entry);
      expect(graph, entry).not.toContain(SDK);
      expect(graph, entry).not.toContain("proxy.ts");
      expect(graph, entry).not.toContain("providers/claude.ts");
      expect(graph, entry).not.toContain("session.ts");
    }
  });

  it("routes.ts imports nothing; the vite plugin's server imports are config.ts and project.ts only (N-18)", () => {
    expect([...staticGraph("routes.ts")]).toEqual(["routes.ts"]);
    const vite = [...staticGraph("integrations/vite.ts")].filter((m) => m !== "integrations/vite.ts" && m !== "vite" && !m.startsWith("node:"));
    expect(vite.sort()).toEqual(["config.ts", "errors.ts", "project.ts"]);
  });

  it("start.ts never imports init.ts, not even for a type, so the two cannot form a cycle (F-99, F-100)", () => {
    expect(staticGraph("start.ts")).not.toContain("init.ts");
    expect(readFileSync(join(SRC, "start.ts"), "utf8")).not.toMatch(/from "\.\/init\.js"/);
    expect(readFileSync(join(SRC, "prompt.ts"), "utf8")).not.toMatch(/from "\.\/start\.js"/);
  });

  it("init.ts is plan and apply only: at most 250 lines (F-100)", () => {
    expect(readFileSync(join(SRC, "init.ts"), "utf8").trimEnd().split("\n").length).toBeLessThanOrEqual(250);
  });
});
