import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadIntakePrompt } from "../src/serve.js";
import { parseFrontmatter } from "../src/tasks.js";

// F-55: the intake instructions are provider-neutral and the quick-note sentinel sentence that
// intake-message.ts and the stub depend on survives verbatim in the built copy (dist/intake.md).
// The build step is run here so the check is on the file the published package ships, whether or
// not `npm run build` has happened yet on this machine.

const here = import.meta.dirname;
const skill = join(here, "..", "..", "..", "plugin", "skills", "intake", "SKILL.md");
const dist = join(here, "..", "dist", "intake.md");
/** Load-bearing for intake-message.ts (QUICK_NOTE_INSTRUCTIONS) and providers/stub.ts. */
const SENTINEL = "When the first message ends with a paragraph starting `Quick note (F-14)`";

describe("intake skill (F-55)", () => {
  it("the built dist/intake.md carries the quick-note sentinel sentence verbatim and it reaches the agent (F-14, F-55)", () => {
    execFileSync(process.execPath, [join(here, "..", "scripts", "copy-intake.mjs")], { stdio: "ignore" });
    const built = readFileSync(dist, "utf8");
    expect(built).toBe(readFileSync(skill, "utf8"));
    expect(built).toContain(SENTINEL);
    expect(loadIntakePrompt(dist)).toContain(SENTINEL);
  }, 30_000); // copy-intake.mjs also emits the entry declarations through the TypeScript API (F-97), ~3 s cold

  it("names no Claude-only tools or variables, tells a sandboxed agent to stop after step 4, and keeps valid frontmatter (F-55)", () => {
    const text = readFileSync(skill, "utf8");
    expect(text).not.toMatch(/`Grep`|`Glob`|`Read`/);
    expect(text).not.toContain("${CLAUDE_SESSION_ID}");
    expect(text).not.toContain("${CLAUDE_PROJECT_DIR}");
    expect(text).toMatch(/prefer your file search and read tools over running code/i);
    expect(text).toContain("Set `session:` to your session id if your agent exposes one, else `session: null`.");
    expect(text).toContain("If your agent runs in a read-only sandbox, stop after step 4 and tell the developer to write the file with `crt` from a terminal.");
    expect(text).toContain("a `write_task` tool from the `crt` MCP server");
    // Neither Claude plugin nor Agent Skills frontmatter: name + description, nothing agent-specific.
    const fm = parseFrontmatter(text)!;
    expect(fm.data).toMatchObject({ name: "intake" });
    expect(String(fm.data.description)).toMatch(/^Turn a CRT capture/);
    expect(/\b(Claude|Codex|Gemini)\b/.test(fm.body)).toBe(false);
  });
});
