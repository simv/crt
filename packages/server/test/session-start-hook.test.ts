import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const HOOK = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "plugin", "hooks", "session-start.mjs");

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "crt-hook-"));
});
afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function runHook(projectDir: string) {
  // Exactly how Claude Code runs it: `node <hook>` with CLAUDE_PROJECT_DIR set and the hook JSON on stdin.
  const r = spawnSync(process.execPath, [HOOK], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir },
    input: JSON.stringify({ hook_event_name: "SessionStart", source: "startup", cwd: projectDir }),
    encoding: "utf8",
    shell: false,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const SECTION = "<!-- BEGIN:crt v0.4 -->\n## CRT (Claude Review Tool)\n<!-- END:crt -->\n";
/** A project whose CLAUDE.md carries the CRT section (F-101), so the F-106 line stays out of the backlog/drift rows. */
function withSection(dir: string): void {
  writeFileSync(join(dir, "CLAUDE.md"), `# App\n\n${SECTION}`);
}

function task(id: string, status: string): string {
  return `---\nid: ${id}\ntitle: t\nstatus: ${status}\npriority: normal\ncreated: 2026-09-14T10:00:00+08:00\nupdated: 2026-09-14T10:00:00+08:00\nurl: null\nroute: null\nsession: null\ntags: []\nfiles: []\n---\n\n## Summary\nx\n`;
}

describe("SessionStart hook (F-41)", () => {
  it("prints nothing and exits 0 when .crt/ is absent", () => {
    const r = runHook(tmp);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("");
  });

  it("prints nothing when no task is in backlog", () => {
    const dir = join(tmp, ".crt", "tasks");
    mkdirSync(dir, { recursive: true });
    withSection(tmp);
    writeFileSync(join(dir, "CRT-0001-a.md"), task("CRT-0001", "done"));
    writeFileSync(join(dir, "CRT-0002-b.md"), task("CRT-0002", "review"));
    writeFileSync(join(dir, "README.md"), "# index\n");
    const r = runHook(tmp);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("prints exactly one line naming the backlog count when backlog > 0", () => {
    const dir = join(tmp, ".crt", "tasks");
    mkdirSync(dir, { recursive: true });
    withSection(tmp);
    writeFileSync(join(dir, "CRT-0001-a.md"), task("CRT-0001", "done"));
    writeFileSync(join(dir, "CRT-0002-b.md"), task("CRT-0002", "backlog"));
    writeFileSync(join(dir, "CRT-0003-c.md"), task("CRT-0003", "backlog"));
    writeFileSync(join(dir, "notes.md"), "status: backlog\n"); // not a task file: ignored
    const r = runHook(tmp);
    expect(r.status).toBe(0);
    expect(r.stdout.split("\n").filter(Boolean)).toHaveLength(1);
    expect(r.stdout).toBe(
      "CRT: 2 of 3 tasks in backlog under .crt/tasks. Run /crt:next to work the next one, /crt:tasks to list.\n",
    );
  });

  it("never errors on an unreadable tasks dir (a file where the directory should be)", () => {
    mkdirSync(join(tmp, ".crt"));
    writeFileSync(join(tmp, ".crt", "tasks"), "not a directory");
    const r = runHook(tmp);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("");
  });

  it("falls back to cwd when CLAUDE_PROJECT_DIR is unset", () => {
    const dir = join(tmp, ".crt", "tasks");
    mkdirSync(dir, { recursive: true });
    withSection(tmp);
    writeFileSync(join(dir, "CRT-0001-a.md"), task("CRT-0001", "backlog"));
    const env = { ...process.env };
    delete env.CLAUDE_PROJECT_DIR;
    const r = spawnSync(process.execPath, [HOOK], { cwd: tmp, env, encoding: "utf8", shell: false });
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^CRT: 1 of 1 tasks in backlog/);
  });
});

describe("SessionStart hook version drift line (PRD-setup F-84)", () => {
  const PLUGIN_VERSION = (JSON.parse(readFileSync(resolve(dirname(HOOK), "..", ".claude-plugin", "plugin.json"), "utf8")) as { version: string }).version;
  const [major, minor] = PLUGIN_VERSION.split(".").map(Number) as [number, number];

  function installed(version: string): void {
    const dir = join(tmp, "node_modules", "claude-review-tool");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "claude-review-tool", version }));
  }

  it("prints exactly the drift line when the project's claude-review-tool has another major.minor (F-84)", () => {
    const other = `${major}.${minor + 1}.0`;
    installed(other);
    const r = runHook(tmp);
    expect(r.status).toBe(0);
    expect(r.stderr).toBe("");
    expect(r.stdout).toBe(`CRT: plugin ${PLUGIN_VERSION} but the project's claude-review-tool is ${other} — npm update claude-review-tool (or crt setup after updating)\n`);
  });

  it("is silent when major.minor match (a patch difference is not drift) (F-84)", () => {
    installed(`${major}.${minor}.99`);
    const r = runHook(tmp);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("is silent when the package is not installed in the project, or its package.json is unreadable (F-84, N-16)", () => {
    expect(runHook(tmp).stdout).toBe("");
    const dir = join(tmp, "node_modules", "claude-review-tool");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), "{ not json");
    const r = runHook(tmp);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    expect(r.stderr).toBe("");
  });

  it("prints the backlog line first and the drift line second when both apply (F-41, F-84)", () => {
    const dir = join(tmp, ".crt", "tasks");
    mkdirSync(dir, { recursive: true });
    withSection(tmp);
    writeFileSync(join(dir, "CRT-0001-a.md"), task("CRT-0001", "backlog"));
    installed(`${major + 1}.0.0`);
    const r = runHook(tmp);
    expect(r.stdout.split("\n").filter(Boolean)).toEqual([
      "CRT: 1 of 1 tasks in backlog under .crt/tasks. Run /crt:next to work the next one, /crt:tasks to list.",
      `CRT: plugin ${PLUGIN_VERSION} but the project's claude-review-tool is ${major + 1}.0.0 — npm update claude-review-tool (or crt setup after updating)`,
    ]);
  });
});

describe("SessionStart hook missing-section line (PRD-embedded F-106)", () => {
  const LINE = "CRT: .crt/ is set up but CLAUDE.md has no CRT section — run crt init to add it";

  it("prints exactly the F-106 line when .crt/tasks/ exists and neither CLAUDE.md nor AGENTS.md carries the marker (F-106)", () => {
    mkdirSync(join(tmp, ".crt", "tasks"), { recursive: true });
    const none = runHook(tmp);
    expect(none.status).toBe(0);
    expect(none.stderr).toBe("");
    expect(none.stdout).toBe(`${LINE}\n`);
    writeFileSync(join(tmp, "CLAUDE.md"), "# App\n");
    writeFileSync(join(tmp, "AGENTS.md"), "# Agents\n");
    expect(runHook(tmp).stdout).toBe(`${LINE}\n`);
  });

  it("is silent when either file carries the marker, or when .crt/tasks/ does not exist (F-106)", () => {
    // No .crt/tasks: nothing, even without any instruction file.
    expect(runHook(tmp).stdout).toBe("");
    mkdirSync(join(tmp, ".crt", "tasks"), { recursive: true });
    writeFileSync(join(tmp, "AGENTS.md"), `# Agents\n\n${SECTION}`);
    expect(runHook(tmp).stdout).toBe("");
    rmSync(join(tmp, "AGENTS.md"));
    writeFileSync(join(tmp, "CLAUDE.md"), `# App\n\n${SECTION}`);
    expect(runHook(tmp).stdout).toBe("");
  });

  it("comes after the backlog and drift lines when all three apply, and stays out when .crt/tasks is a file (F-41, F-84, F-106)", () => {
    const dir = join(tmp, ".crt", "tasks");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "CRT-0001-a.md"), task("CRT-0001", "backlog"));
    const pluginVersion = (JSON.parse(readFileSync(resolve(dirname(HOOK), "..", ".claude-plugin", "plugin.json"), "utf8")) as { version: string }).version;
    const major = Number(pluginVersion.split(".")[0]);
    const nm = join(tmp, "node_modules", "claude-review-tool");
    mkdirSync(nm, { recursive: true });
    writeFileSync(join(nm, "package.json"), JSON.stringify({ name: "claude-review-tool", version: `${major + 1}.0.0` }));
    const r = runHook(tmp);
    expect(r.stdout.split("\n").filter(Boolean)).toEqual([
      "CRT: 1 of 1 tasks in backlog under .crt/tasks. Run /crt:next to work the next one, /crt:tasks to list.",
      `CRT: plugin ${pluginVersion} but the project's claude-review-tool is ${major + 1}.0.0 — npm update claude-review-tool (or crt setup after updating)`,
      LINE,
    ]);
    rmSync(join(tmp, ".crt"), { recursive: true, force: true });
    rmSync(nm, { recursive: true, force: true });
    mkdirSync(join(tmp, ".crt"));
    writeFileSync(join(tmp, ".crt", "tasks"), "not a directory");
    expect(runHook(tmp).stdout).toBe("");
  });
});
