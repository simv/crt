import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rewriteSkill } from "../src/skills.js";
import { parseFrontmatter } from "../src/tasks.js";

// PRD-setup F-83 as amended by PRD-embedded F-105: the guided /crt:serve in embedded mode — a doc
// test on the skill text, the way intake-skill.test.ts pins the intake instructions. The four reply
// lines, the questions and the step ½ offer of /crt:init are load-bearing copy.

const skill = readFileSync(join(import.meta.dirname, "..", "..", "..", "plugin", "skills", "serve", "SKILL.md"), "utf8");

describe("serve skill (F-83, F-105)", () => {
  it("has valid frontmatter, takes --proxy, and never starts the dev server (F-83, F-105)", () => {
    const fm = parseFrontmatter(skill)!;
    expect(fm.data).toMatchObject({ name: "serve" });
    expect(String(fm.data["disable-model-invocation"])).toBe("true");
    expect(String(fm.data["allowed-tools"])).toContain("AskUserQuestion");
    expect(String(fm.data["argument-hint"])).toContain("--proxy");
    expect(fm.body).toContain("Never start the user's dev server for them");
  });

  it("opens with the health step: reuse a CRT for the same project and mode, ask when it belongs to another (F-83, F-105 step 0)", () => {
    expect(skill).toContain("curl -s http://localhost:<port>/__crt/health");
    expect(skill).toContain("its `projectRoot` equals `${CLAUDE_PROJECT_DIR}` and its `mode` equals the mode you are about to start");
    expect(skill).toContain("(reused the CRT already running)");
    expect(skill).toMatch(/Ask \(AskUserQuestion\): "Port <port> is held by a CRT serving <its projectRoot>\. Replace it, or start this one on another port\?"/);
    expect(skill).toContain("`--replace`");
  });

  it("step ½ asks before setting an un-initialised project up and runs the /crt:init steps on yes, stops on no (F-105)", () => {
    expect(skill).toContain("## ½. Is the project set up?");
    expect(skill).toContain("When `${CLAUDE_PROJECT_DIR}/.crt/tasks` does not exist, ask (AskUserQuestion): \"CRT is not set up in this project. Set it up now? (creates .crt/, two .gitignore lines and a CRT section in CLAUDE.md, then adds one line to your app)\"");
    expect(skill).toContain("run the `/crt:init` steps first");
    expect(skill).toContain('stop with "run /crt:init when you want it"');
  });

  it("runs `crt serve --open --yes [--target …]` in the background, `crt proxy …` under --proxy, and waits 5 min after the npx fallback, 30 s otherwise (F-105, F-92)", () => {
    expect(skill).toContain("crt serve --open --yes  ");
    expect(skill).toContain("crt serve --open --yes --target $ARGUMENTS");
    expect(skill).toContain("crt proxy --open --yes  ");
    expect(skill).toContain("crt proxy --open --yes --target $ARGUMENTS");
    expect(skill).toContain("CRT ready at http://localhost:4400 for http://localhost:3000 (embedded; project: C:\\my-app, 3 tasks in .crt\\tasks, provider: claude (default), login: ok)");
    expect(skill).toContain("CRT ready at http://localhost:4400 → http://localhost:3000 (proxy; project: C:\\my-app, 3 tasks in .crt\\tasks, provider: claude (default), login: ok)");
    expect(skill).toMatch(/\*\*in the background\*\*/);
    expect(skill).toContain("**30 s** when `npx --no crt` resolved; **up to 5 minutes** when the `npx -y` fallback ran");
    expect(skill).toContain("no local install of claude-review-tool — npx may be downloading it (~220 MB on a first run)…");
    expect(skill).toContain("the ready line always names the port actually bound");
  });

  it("relays the embedded 'no dev server' line and goes on; asks for the URL only in proxy mode (F-105 step 3)", () => {
    expect(skill).toContain("`crt: no dev server on ports … — start it and open it in your browser; …` (embedded mode) → **not a stop**");
    expect(skill).toContain('`crt: no dev server found on ports …` (proxy mode, exit) → ask (AskUserQuestion) **"Which URL or port is your dev server on?"**');
    expect(skill).toContain('**"not running yet"** as an option');
    expect(skill).toContain("re-run step 1 with `--target <answer>`");
    expect(skill).toContain("(target came from your answer; remembered in .crt/config.local.json)");
    expect(skill).toContain("`crt: <root> is not set up for CRT — run \\`crt init\\` (or \\`crt --yes\\`)` → step ½ was skipped; go back to it.");
  });

  it("checks overlay.loader and overlay.fetched 10 s after readiness and adds the F-105 sentence when both are 0 (F-105 step 4)", () => {
    expect(skill).toContain("if `overlay.loader` and `overlay.fetched` are both `0` and an app URL was opened");
    expect(skill).toContain(
      "The page never loaded the CRT loader, so no CRT button will show — the integration snippet is probably missing: run /crt:init, or /crt:serve --proxy to proxy the app instead.",
    );
    expect(skill).toContain("Proxy mode: if `overlay.fetched` is `0`");
  });

  it("replies in the four lines, with the embedded first line and the 'no dev server found' suffix (F-105)", () => {
    const lines = [
      "CRT is up at http://localhost:4400 for http://localhost:3000 (embedded; opened in your browser).",
      "Project C:\\my-app — tasks will be written to .crt\\tasks (3 there now).",
      "Agent: Claude, logged in.",
      "Next: click the CRT button bottom-right (or Ctrl/Cmd+Shift+.), Select the element, type a note, Send. Run /crt:tasks when a task lands.",
    ];
    expect(skill).toContain(lines.join("\n"));
    expect(skill).toContain("`CRT is up at http://localhost:4400, proxying http://localhost:3000 (opened in your browser).`");
    expect(skill).toContain("`(no dev server found — open your app; the button appears when the page loads)` when none was found");
  });

  it("survives the F-58 rewrite for other agents: no Claude-only tool names remain (F-58, F-83)", () => {
    const out = rewriteSkill(skill);
    expect(out).not.toContain("AskUserQuestion");
    expect(out).not.toContain("${CLAUDE_PROJECT_DIR}");
    expect(out).toContain("Which URL or port is your dev server on?");
  });
});
