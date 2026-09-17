import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rewriteSkill } from "../src/skills.js";
import { parseFrontmatter } from "../src/tasks.js";

// PRD-setup F-83: the guided /crt:serve — a doc test on the skill text, the way intake-skill.test.ts
// pins the intake instructions. The four reply lines and the two questions are load-bearing copy.

const skill = readFileSync(join(import.meta.dirname, "..", "..", "..", "plugin", "skills", "serve", "SKILL.md"), "utf8");

describe("serve skill (F-83)", () => {
  it("has valid frontmatter and never starts the dev server (F-83)", () => {
    const fm = parseFrontmatter(skill)!;
    expect(fm.data).toMatchObject({ name: "serve" });
    expect(String(fm.data["disable-model-invocation"])).toBe("true");
    expect(String(fm.data["allowed-tools"])).toContain("AskUserQuestion");
    expect(fm.body).toContain("Never start the user's dev server for them");
  });

  it("opens with the health step: reuse a CRT for the same project, ask when it belongs to another (F-83 step 0)", () => {
    expect(skill).toContain("curl -s http://localhost:<port>/__crt/health");
    expect(skill).toContain("its `projectRoot` equals `${CLAUDE_PROJECT_DIR}` → **reuse it**");
    expect(skill).toContain("(reused the CRT already running)");
    expect(skill).toMatch(/Ask \(AskUserQuestion\): "Port <port> is held by a CRT serving <its projectRoot>\. Replace it, or start this one on another port\?"/);
    expect(skill).toContain("`--replace`");
  });

  it("runs `crt proxy --open --yes [--target …]` in the background (proxy mode until M17, PRD-embedded F-92) and waits 5 min after the npx fallback, 30 s otherwise (F-83)", () => {
    expect(skill).toContain("crt proxy --open --yes  ");
    expect(skill).toContain("crt proxy --open --yes --target $ARGUMENTS");
    expect(skill).toContain("CRT ready at http://localhost:4400 → http://localhost:3000 (proxy; project: C:\\my-app, 3 tasks in .crt\\tasks, provider: claude (default), login: ok)");
    expect(skill).toMatch(/\*\*in the background\*\*/);
    expect(skill).toContain("**30 s** when `npx --no crt` resolved; **up to 5 minutes** when the `npx -y` fallback ran");
    expect(skill).toContain("no local install of claude-review-tool — npx may be downloading it (~220 MB on a first run)…");
    expect(skill).toContain("the ready line always names the port actually bound");
  });

  it("asks for the URL when no dev server is found and re-runs with --target (F-83)", () => {
    expect(skill).toContain('`crt: no dev server found on ports …` → ask (AskUserQuestion) **"Which URL or port is your dev server on?"**');
    expect(skill).toContain('**"not running yet"** as an option');
    expect(skill).toContain("re-run step 1 with `--target <answer>`");
    expect(skill).toContain("(target came from your answer; remembered in .crt/config.local.json)");
  });

  it("checks overlay.fetched 10 s after readiness and adds the fallback sentence when it is 0 (F-80, F-83)", () => {
    expect(skill).toContain("If `overlay.fetched` is `0`");
    expect(skill).toContain(
      "The page loaded but never asked for the overlay, so no CRT button will show. Check view-source for /__crt/overlay.js; if your app is a JS-rendered shell or sends a strict CSP, add the script tag from README › Script-tag fallback and browse http://localhost:3000 instead.",
    );
  });

  it("replies in the four lines (F-83)", () => {
    const lines = [
      "CRT is up at http://localhost:4400, proxying http://localhost:3000 (opened in your browser).",
      "Project C:\\my-app — tasks will be written to .crt\\tasks (3 there now).",
      "Agent: Claude, logged in.",
      "Next: click the CRT button bottom-right (or Ctrl/Cmd+Shift+.), Select the element, type a note, Send. Run /crt:tasks when a task lands.",
    ];
    expect(skill).toContain(lines.join("\n"));
  });

  it("survives the F-58 rewrite for other agents: no Claude-only tool names remain (F-58, F-83)", () => {
    const out = rewriteSkill(skill);
    expect(out).not.toContain("AskUserQuestion");
    expect(out).not.toContain("${CLAUDE_PROJECT_DIR}");
    expect(out).toContain("Which URL or port is your dev server on?");
  });
});
