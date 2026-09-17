import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STALE_TOKEN_LINE } from "../src/mcp-stdio.js";
import { CLAUDE_INSTALL_HINT, CLAUDE_NOT_LOGGED_IN } from "../src/providers/claude.js";
import { CODEX_MCP_NEVER_CALLED, CODEX_NOT_FOUND, CODEX_NOT_LOGGED_IN, codexCouldNotResume, codexTooOld } from "../src/providers/codex.js";
import { CLAUDE_NOT_FOUND } from "../src/setup.js";

// Doc tests on the README: PRD-providers F-62 / §10 (every N-7 provider line verbatim in the
// Providers section) and PRD-setup F-88 / N-17 (Install is the §4 block, Troubleshooting opens
// with `crt doctor`, every new `crt:` line from F-71, F-73, F-76, F-80 and F-86 quoted verbatim).
// Runtime values are written as `<…>` in the README and here alike.

const readme = readFileSync(join(import.meta.dirname, "..", "..", "..", "README.md"), "utf8");
/** The text under `heading` up to the next heading of the same or a higher level (fenced code, where `# comments` live, is skipped). */
const section = (heading: string): string => {
  const lines = readme.split("\n");
  const start = lines.indexOf(heading);
  expect(start, `README has "${heading}"`).toBeGreaterThan(-1);
  const level = heading.match(/^#+/)![0].length;
  const out: string[] = [];
  let fenced = false;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("```")) fenced = !fenced;
    else if (!fenced && /^#{1,6} /.test(line) && line.match(/^#+/)![0].length <= level) break;
    out.push(line);
  }
  return out.join("\n");
};

describe("README › Providers (F-62, N-7)", () => {
  const providers = section("## Providers");

  it.each([
    ["claude: not logged in", CLAUDE_NOT_LOGGED_IN],
    ["claude: install hint", `(${CLAUDE_INSTALL_HINT})`],
    ["claude: binary missing", "Claude Code binary not found — reinstall claude-review-tool (`npm install`) so @anthropic-ai/claude-agent-sdk-<platform>-<arch> is present"],
    ["codex: not on PATH", CODEX_NOT_FOUND],
    ["codex: not logged in", CODEX_NOT_LOGGED_IN],
    ["codex: too old", codexTooOld("<version>")],
    ["codex: could not resume", codexCouldNotResume("<id>")],
    ["codex: MCP never called", CODEX_MCP_NEVER_CALLED],
    ["stale token", STALE_TOKEN_LINE],
  ])("quotes %s verbatim (N-7, F-62)", (_name, line) => {
    expect(providers).toContain(line);
  });

  it("lists the F-43 resolution order and the crt providers sample, and states telemetry per provider (F-45, N-12, F-64)", () => {
    expect(providers).toMatch(/1\. `provider` in the `POST \/__crt\/sessions` body[\s\S]*6\. `claude`\./);
    expect(providers).toContain("→ claude — .claude/, CLAUDE.md; codex not on PATH");
    expect(providers).toContain("-c analytics.enabled=false");
    expect(providers).toContain("CRT itself has no telemetry");
    expect(readme.split("\n")[2]).toContain("Claude Code remains the default. The name is historical.");
  });

  it("carries the N-13 resume note and the F-48 minimum-version note", () => {
    expect(providers).toContain("**Every later message is a new `codex exec resume` process.**");
    expect(section("## Install")).toContain("A project pinned to `claude-review-tool@0.1.x` fails `crt task --validate`");
  });
});

describe("README › Install and the loop (F-88)", () => {
  const install = section("## Install");

  it("Install is the PRD-setup §4 block: npm i -g, crt setup, then crt per project (F-88)", () => {
    expect(install).toContain("npm i -g claude-review-tool\ncrt setup ");
    expect(install).toContain("cd my-app && npm run dev ");
    expect(install).toMatch(/\ncrt {2,}# finds it \(or asks for its URL once\)/);
  });

  it("offers -D for teams and npx zero-install with the ~220 MB note, and the Windows shim note (F-88, N-16)", () => {
    expect(install).toContain("`npm i -D claude-review-tool`");
    expect(install).toContain("`npx claude-review-tool`");
    expect(install).toContain("~220 MB");
    expect(install).toContain("`crt.ps1`");
    expect(install).toContain("execution policy");
    expect(install).toContain("`crt.cmd`");
  });

  it("the loop starts with `crt`, and the flags table has the positional, --yes, --no-open, --replace, doctor, setup, --version (F-88, F-79)", () => {
    expect(section("## The loop")).toMatch(/```bash\ncd my-app && npm run dev .*\ncrt {2,}/);
    const flags = section("### `crt` flags");
    for (const row of ["| `[target]` |", "| `--yes` |", "| `--open` / `--no-open` |", "| `--replace` |", "| `crt doctor` |", "| `crt setup [--claude <path>]` |", "| `crt --version` |"]) {
      expect(flags).toContain(row);
    }
    expect(flags).toContain("which any local process may call");
  });
});

describe("README › Troubleshooting (F-88, N-17)", () => {
  const trouble = section("## Troubleshooting");

  it("opens with `crt doctor` and its sample (F-76, F-88)", () => {
    expect(trouble.trimStart().startsWith("Run `crt doctor` first.")).toBe(true);
    expect(trouble).toContain("$ crt doctor\nok    node      v22.4.0 (needs 20 or newer)");
    expect(trouble).toContain("→ claude — codex not logged in");
  });

  it.each([
    // F-69
    'crt: unknown command "<x>" — a target is a port, host:port or URL; `crt help` lists commands',
    // F-71
    "crt: no dev server found on ports 3000, 5173, 8080, 4200, 8000, 3001 — start it, or run `crt <port>`",
    "crt: found N dev servers (…); using http://localhost:3000 — run `crt <port>` to pick another",
    "crt: target <origin> is not responding — start your dev server there, or run `crt <port>`",
    // F-73
    "crt: port 4400 is held by another CRT (→ <target>, project <root>); using 4401",
    "crt: port 4400 is in use by a process that is not CRT; using 4401",
    "crt: could not stop the CRT on port 4400 (<reason>) — stop it yourself, or run `crt --port 4401`",
    "crt: port <port> is already in use by CRT <version> (→ <target>, project <root>) — stop the other process, run `crt --replace`, or pass --port <n>",
    // F-76
    "FAIL  node      v18.20.0 — CRT needs Node 20 or newer",
    "warn  project   C:\\my-app\\src — no .git above; .crt/ will be created here (run from the repo root, or git init)",
    "--    .crt      not initialised — crt creates it",
    "FAIL  target    none set and nothing on the probed ports — crt <port>",
    "FAIL  target    http://localhost:3100 (remembered) — not responding",
    "FAIL  port      4400 held by CRT 0.3.0 → http://localhost:3000 (this project) — crt --replace",
    "FAIL  port      4400 in use by a non-CRT process — crt --port 4401",
    "--    plugin    claude not on PATH — skipped",
    "warn  plugin    crt@crt not installed — run crt setup",
    "warn  plugin    crt@crt 0.2.0 installed, this is 0.3.0 — run crt setup",
    // F-74
    `crt: ${CLAUDE_NOT_LOGGED_IN}`,
    `crt: ${CLAUDE_NOT_LOGGED_IN} (${CLAUDE_INSTALL_HINT})`,
    // F-80
    "crt: injected the overlay into GET / but the browser never fetched /__crt/overlay.js — a Content-Security-Policy or a JS-rendered shell is blocking it; see README › Overlay does not appear",
    "crt: GET / answered application/json, not text/html — CRT injects only into HTML; use the script-tag fallback (README)",
    "crt: GET / sends a CSP with 'strict-dynamic' that CRT cannot relax — the overlay may be blocked; use the script-tag fallback",
    // F-86
    `crt: ${CLAUDE_NOT_FOUND}`,
    "crt setup: registered marketplace crt from <path>",
    "crt setup: installed crt@crt 0.3.0 — restart Claude Code to load /crt:serve, /crt:next, /crt:tasks, /crt:task, /crt:done, /crt:intake",
    "crt setup: crt@crt 0.3.0 is already installed",
    // F-84
    "CRT: plugin 0.3.0 but the project's claude-review-tool is 0.2.0 — npm update claude-review-tool (or crt setup after updating)",
  ])("quotes %s (F-88, N-17)", (line) => {
    expect(trouble).toContain(line);
  });

  it("every quoted crt: line is one line (N-17)", () => {
    for (const block of trouble.matchAll(/```\n([\s\S]*?)```/g)) {
      for (const line of block[1]!.split("\n").filter((l) => l.startsWith("crt: "))) {
        expect(line.endsWith(" ")).toBe(false);
        expect(line).not.toContain("\t");
      }
    }
  });
});
