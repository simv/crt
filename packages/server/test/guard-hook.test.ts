import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const HOOK = join(ROOT, ".claude", "hooks", "guard.mjs");

type ToolInput = { file_path?: string; content?: string; old_string?: string; new_string?: string };

function runHook(toolInput: ToolInput | string, projectDir = ROOT) {
  // Exactly how Claude Code runs it: `node <hook>` with CLAUDE_PROJECT_DIR set and the hook JSON on stdin.
  const input =
    typeof toolInput === "string"
      ? toolInput
      : JSON.stringify({ hook_event_name: "PreToolUse", tool_name: "Edit", cwd: projectDir, tool_input: toolInput });
  const r = spawnSync(process.execPath, [HOOK], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    input,
    encoding: "utf8",
    shell: false,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const SDK_IMPORT = 'import { query } from "@anthropic-ai/claude-agent-sdk";\n';

describe("PreToolUse convention guard (.claude/hooks/guard.mjs)", () => {
  it("blocks edits to the generated task index (F-34)", () => {
    const r = runHook({ file_path: join(ROOT, ".crt", "tasks", "README.md"), content: "# x\n" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/README\.md is the F-34 task index/);
  });

  it("blocks edits to the lockfile and build output", () => {
    expect(runHook({ file_path: "package-lock.json", new_string: "x" }).status).toBe(2);
    expect(runHook({ file_path: join("packages", "server", "dist", "cli.js"), content: "x" }).status).toBe(2);
  });

  it("blocks Agent SDK imports in product scripts outside providers/claude.ts (PRD §12, F-63)", () => {
    // session.ts is now the registry and providers/codex.ts drives a CLI: neither may touch the SDK.
    const outside = ["packages/server/src/proxy.ts", "packages/server/src/session.ts", "packages/server/src/providers/codex.ts", "packages/overlay/src/index.ts", "plugin/hooks/x.mjs"];
    for (const file of outside) {
      const r = runHook({ file_path: join(ROOT, file), new_string: SDK_IMPORT });
      expect(r.status, file).toBe(2);
      expect(r.stderr).toMatch(/only in packages\/server\/src\/providers\/claude\.ts/);
    }
    const dynamic = runHook({
      file_path: join(ROOT, "packages", "server", "src", "serve.ts"),
      new_string: 'const m = await import("@anthropic-ai/claude-agent-sdk");',
    });
    expect(dynamic.status).toBe(2);
  });

  it("allows the SDK import in providers/claude.ts, in tests, and bare mentions anywhere (PRD §12, F-63)", () => {
    expect(runHook({ file_path: join(ROOT, "packages", "server", "src", "providers", "claude.ts"), new_string: SDK_IMPORT }).status).toBe(0);
    // Tests and e2e fixtures are not product code: they may import, mock or quote the package.
    expect(runHook({ file_path: join(ROOT, "packages", "server", "test", "s.test.ts"), new_string: SDK_IMPORT }).status).toBe(0);
    expect(runHook({ file_path: join(ROOT, "packages", "server", "e2e", "fixture", "x.mjs"), new_string: SDK_IMPORT }).status).toBe(0);
    // A comment or a doc names the package without importing it.
    expect(runHook({ file_path: join(ROOT, "packages", "server", "src", "http.ts"), new_string: "// see @anthropic-ai/claude-agent-sdk" }).status).toBe(0);
    expect(runHook({ file_path: join(ROOT, "docs", "PRD.md"), content: "`@anthropic-ai/claude-agent-sdk` is pinned" }).status).toBe(0);
  });

  it("blocks CRLF content (N-1)", () => {
    const r = runHook({ file_path: join(ROOT, "packages", "overlay", "src", "ui.ts"), content: "a\r\nb\r\n" });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/CRLF/);
    expect(runHook({ file_path: join(ROOT, "packages", "overlay", "src", "ui.ts"), content: "a\nb\n" }).status).toBe(0);
  });

  it("ignores files outside the project and never blocks on bad input", () => {
    expect(runHook({ file_path: join(dirname(ROOT), "elsewhere", "package-lock.json"), content: "x\r\n" }).status).toBe(0);
    expect(runHook("not json").status).toBe(0);
    expect(runHook({}).status).toBe(0);
  });

  it("falls back to cwd when CLAUDE_PROJECT_DIR is unset", () => {
    const env = { ...process.env };
    delete env.CLAUDE_PROJECT_DIR;
    const r = spawnSync(process.execPath, [HOOK], {
      cwd: ROOT,
      env,
      input: JSON.stringify({ tool_input: { file_path: "package-lock.json", new_string: "x" } }),
      encoding: "utf8",
      shell: false,
    });
    expect(r.status).toBe(2);
  });
});
