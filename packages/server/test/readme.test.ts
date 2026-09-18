import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { STALE_TOKEN_LINE } from "../src/mcp-stdio.js";
import { CLAUDE_INSTALL_HINT, CLAUDE_NOT_LOGGED_IN } from "../src/providers/claude.js";
import { CODEX_MCP_NEVER_CALLED, CODEX_NOT_FOUND, CODEX_NOT_LOGGED_IN, codexCouldNotResume, codexTooOld } from "../src/providers/codex.js";
import { CLAUDE_NOT_FOUND } from "../src/setup.js";

// Doc tests on the README: PRD-providers F-62 / §10 (every N-7 provider line verbatim in the
// Providers section), PRD-setup F-88 / N-17 (Install is the §4 block, Troubleshooting opens
// with `crt doctor`, every new `crt:` line from F-71, F-73, F-76, F-80 and F-86 quoted verbatim)
// and PRD-embedded F-99, F-100, F-103 (the "CRT is not set up" entry and the v0.4 doctor rows —
// the M17 update) and F-107 (M18: Install is the PRD-embedded §4 block, the four snippets, Production,
// What lands in your repo, Proxy mode in place of the script-tag fallback, How it works embedded
// first, the flags rows, the N-22 Privacy paragraph, the two new Troubleshooting entries, every new
// `crt:` line from F-91, F-93, F-94 verbatim, and the package README's Install and snippet blocks).
// Runtime values are written as `<…>` in the README and here alike.

const readme = readFileSync(join(import.meta.dirname, "..", "..", "..", "README.md"), "utf8");
const packageReadme = readFileSync(join(import.meta.dirname, "..", "README.md"), "utf8");
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

  it("Install is the PRD-embedded §4 block: npm i -g + crt setup per machine, crt init per project, npm run dev + crt per session (F-88, F-107)", () => {
    expect(install).toContain("npm i -g claude-review-tool\ncrt setup ");
    expect(install).toMatch(/\n# one-time, per project\ncrt init {2,}# \.crt\/ \(README, tasks, config\), 2 \.gitignore lines, a CRT section in CLAUDE\.md/);
    expect(install).toMatch(/\n# per session\nnpm run dev {2,}# your dev server, your URL\ncrt {2,}# CRT server on :4400; opens your app; the CRT button is on your page\n/);
    expect(install).not.toContain("http://localhost:4400 opens");
    // F-86 / F-87: seven skills, the @0.4 fallback pin.
    expect(install).toContain("`/crt:init`, `/crt:serve`, `/crt:next`, `/crt:tasks`, `/crt:task`, `/crt:done` and `/crt:intake`");
    expect(install).toContain("`npx -y claude-review-tool@0.4`");
  });

  it("offers -D for teams and npx zero-install with the ~220 MB note, and the Windows shim note (F-88, N-16)", () => {
    expect(install).toContain("`npm i -D claude-review-tool`");
    expect(install).toContain("`npx claude-review-tool`");
    expect(install).toContain("~220 MB");
    expect(install).toContain("`crt.ps1`");
    expect(install).toContain("execution policy");
    expect(install).toContain("`crt.cmd`");
  });

  it("the loop is npm run dev → crt → browse your app, and the flags table has the positional, --yes, --no-open, --replace, doctor, setup, --version, proxy, --mode, init (F-88, F-79, F-107)", () => {
    const loop = section("## The loop");
    expect(loop).toMatch(/```bash\ncd my-app && npm run dev .*\ncrt {2,}# the CRT server on http:\/\/localhost:4400; opens your app — the CRT button is on your page\n/);
    expect(loop).toContain("1. **Browse your app as usual** — `http://localhost:3000`, your own URL, no proxied copy.");
    expect(loop).not.toContain("proxies your app at");
    const flags = section("### `crt` flags");
    for (const row of ["| `[target]` |", "| `--yes` |", "| `--open` / `--no-open` |", "| `--replace` |", "| `crt doctor` |", "| `crt setup [--claude <path>]` |", "| `crt --version` |", "| `crt proxy [target]` |", "| `--mode <embedded\\|proxy>` |", "| `crt init [--yes] [--no-instructions] [--snippet [--json]]` |"]) {
      expect(flags).toContain(row);
    }
    expect(flags).toContain("crt proxy [target] …");
    expect(flags).toContain("crt init [--yes] [--no-instructions] [--snippet [--json]]   # set the project up");
    expect(flags).toContain("which any local process may call");
  });
});

describe("README › Troubleshooting (F-88, N-17)", () => {
  const trouble = section("## Troubleshooting");

  it("opens with `crt doctor` and its sample (F-76, F-88)", () => {
    expect(trouble.trimStart().startsWith("Run `crt doctor` first.")).toBe(true);
    expect(trouble).toContain("$ crt doctor\nok    node      v22.4.0 (needs 20 or newer)");
    expect(trouble).toContain("ok    .crt      README.md, tasks/ (4 tasks), config.json, config.local.json, .gitignore entries\nok    mode      embedded\n");
    expect(trouble).toContain("ok    integration next — app/layout.tsx imports claude-review-tool/react\nok    instructions CLAUDE.md carries the CRT section\n");
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
    "--    .crt      not initialised — run crt init",
    "FAIL  target    none set and nothing on the probed ports — crt <port>",
    "FAIL  target    http://localhost:3100 (remembered) — not responding",
    "FAIL  port      4400 held by CRT 0.4.0 → http://localhost:3000 (this project) — crt --replace",
    "FAIL  port      4400 in use by a non-CRT process — crt --port 4401",
    "--    plugin    claude not on PATH — skipped",
    "warn  plugin    crt@crt not installed — run crt setup",
    "warn  plugin    crt@crt 0.3.0 installed, this is 0.4.0 — run crt setup",
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
    "crt setup: installed crt@crt 0.4.0 — restart Claude Code to load /crt:serve, /crt:next, /crt:tasks, /crt:task, /crt:done, /crt:intake, /crt:init",
    "crt setup: crt@crt 0.4.0 is already installed",
    // F-84
    "CRT: plugin 0.4.0 but the project's claude-review-tool is 0.3.0 — npm update claude-review-tool (or crt setup after updating)",
  ])("quotes %s (F-88, N-17)", (line) => {
    expect(trouble).toContain(line);
  });

  it.each([
    // F-99
    "crt: C:\\my-app is not set up for CRT — run `crt init` (or `crt --yes`)",
    "Set up CRT in C:\\my-app? [Y/n]",
    "no tasks (CRT is not set up here — run crt init)",
    // F-100
    "crt init will, in C:\\my-app:\n  create .crt/README.md\n  create .crt/tasks/\n  create .crt/config.json\n  add .crt/captures/ and .crt/config.local.json to .gitignore\n  add a CRT section to CLAUDE.md",
    "Go ahead? [Y/n]",
    "crt init: created .crt/README.md",
    "crt init: created .crt/tasks/",
    "crt init: created .crt/config.json",
    "crt init: added .crt/captures/ and .crt/config.local.json to .gitignore",
    "crt init: added the CRT section to CLAUDE.md",
    "crt init: created CLAUDE.md with the CRT section",
    "crt init: updated the CRT section in CLAUDE.md",
    "crt init: C:\\my-app is set up (.crt/README.md, tasks/, config.json, .gitignore entries, CRT section in CLAUDE.md)",
    "Add CRT to your app (development only):",
    "Production builds contain nothing from CRT (README › Production). /crt:init in Claude Code applies this for you.",
    // F-101
    "<!-- BEGIN:crt v0.4 -->",
    "<!-- END:crt -->",
    // F-103
    "warn  .crt      tasks/ (4 tasks), config.json, .gitignore entries — no README.md — run crt init",
    "ok    mode      proxy (.crt/config.json)",
    "--    target    none set; crt opens nothing (crt <port> to remember one)",
    "warn  target    http://localhost:3100 (remembered) — not responding",
    "ok    integration vite — vite.config.ts uses claude-review-tool/vite",
    "ok    integration loader — src/main.tsx imports claude-review-tool/loader",
    "warn  integration not found (next) — run crt init for the snippet, or crt proxy",
    "--    integration static page — add the <script> tag (crt init --snippet)",
    "--    integration proxy mode",
    "warn  instructions CLAUDE.md has no CRT section — crt init adds it",
    "--    instructions no CLAUDE.md or AGENTS.md — crt init creates one",
    // F-106
    "CRT: .crt/ is set up but CLAUDE.md has no CRT section — run crt init to add it",
  ])("quotes %s (PRD-embedded F-99, F-100, F-103, F-106)", (line) => {
    expect(trouble).toContain(line);
  });

  it("has the CRT is not set up entry, and the loop no longer claims an implicit init (F-99)", () => {
    expect(trouble).toContain("### CRT is not set up");
    expect(readme).not.toContain("`crt` first runs `crt init`");
    expect(section("## The loop")).toContain("`crt` never sets a project up on its own");
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

describe("README › Add CRT to your app and Production (PRD-embedded F-97, F-98)", () => {
  const add = section("## Add CRT to your app");
  const production = section("## Production");

  it.each([
    ["react", 'import { CrtDevTools } from "claude-review-tool/react";'],
    ["vite", 'import { crt } from "claude-review-tool/vite";'],
    ["loader", 'import { mountCrt } from "claude-review-tool/loader";'],
  ])("shows the %s import form verbatim (F-97)", (_name, line) => {
    expect(add).toContain(line);
  });

  it("states the four F-98 layers, the grep check and the string list (F-98, N-18)", () => {
    expect(production).toContain("`production` export condition");
    expect(production).toContain('`process.env.NODE_ENV !== "production"`');
    expect(production).toContain('`apply: "serve"`');
    expect(production).toContain('`grep -r "__crt" dist/`');
    expect(production).toContain("`__crt`, `/loader.js`, `overlay.js`, `mountCrt`, `4400`");
  });
});

describe("README › F-107 (PRD-embedded, M18): the four snippets, Production, What lands in your repo, Proxy mode, How it works, Privacy, the new lines", () => {
  const add = section("## Add CRT to your app");
  const production = section("## Production");
  const lands = section("## What lands in your repo");
  const proxy = section("## Proxy mode");
  const how = section("## How it works");
  const trouble = section("## Troubleshooting");

  /** The four F-102 snippets, verbatim from PRD-embedded §4 (and what `crt init` prints). */
  const SNIPPETS = [
    '// Next.js (App Router) — app/layout.tsx\nimport { CrtDevTools } from "claude-review-tool/react";\n…\n<body>{children}<CrtDevTools /></body>',
    '// Vite — vite.config.ts\nimport { crt } from "claude-review-tool/vite";\nexport default defineConfig({ plugins: [react(), crt()] });',
    '// any bundled app — the client entry (src/main.tsx, src/index.ts, …)\nimport { mountCrt } from "claude-review-tool/loader";\nif (process.env.NODE_ENV !== "production") mountCrt();   // the guard is optional (F-98); it lets the bundler drop the import',
    '<!-- no bundler — the development page only -->\n<script src="http://localhost:4400/__crt/loader.js"></script>',
  ];

  it.each(SNIPPETS.map((s) => [s.split("\n")[0]!, s]))("Add CRT to your app carries the snippet %s verbatim, and so does the package README (F-102, F-107)", (_first, snippet) => {
    expect(add).toContain(snippet);
    expect(packageReadme).toContain(snippet);
  });

  it("says where each form starts capturing, the pill line, the loopback rule and the plain overlay tag (F-95, F-96, F-107)", () => {
    expect(add).toContain("- **Vite / `crt()`** — before the app's first module");
    expect(add).toContain("- **React / Next.js / `<CrtDevTools />`** — after hydration");
    expect(add).toContain("- **`mountCrt()`** — from wherever you call it");
    expect(add).toContain("- **The script tag** — from the tag onward");
    expect(add).toContain("so there is no pill");
    expect(add).toContain("CRT server not running on :4400 — run \\`crt\\` in the project, then click here");
    expect(add).toContain("`localhost`, `*.localhost`, `127.0.0.1` or `[::1]`");
    expect(add).toContain('<script src="http://localhost:4400/__crt/overlay.js" defer></script>');
    expect(add).toContain('`data-crt-port="4401"`');
  });

  it("the package README has the Install block too (F-107)", () => {
    expect(packageReadme).toContain("npm i -g claude-review-tool\ncrt setup ");
    expect(packageReadme).toMatch(/\n# one-time, per project\ncrt init {2,}# /);
    expect(packageReadme).toMatch(/\n# per session\nnpm run dev {2,}# your dev server, your URL\ncrt {2,}# CRT server on :4400; opens your app; the CRT button is on your page\n/);
    expect(packageReadme).not.toContain("local proxy that injects");
  });

  it("Production names the verified bundlers and the no-request check (F-98, N-18, §12 rule 2)", () => {
    expect(production).toContain("esbuild 0.25 and Vite 8.3");
    expect(production).toContain("Next.js 16.3 (Turbopack)");
    expect(production).toContain("never requests the CRT port");
    expect(production).toContain("(or `.next/static`)");
  });

  it("What lands in your repo lists the five items, the markers, and the N-19 runtime rule (F-100, F-101, N-19)", () => {
    expect(lands).toContain("crt init will, in <root>:");
    for (const item of ["- `.crt/README.md`", "- `.crt/tasks/`", "- `.crt/config.json`", "- two `.gitignore` lines — `.crt/captures/`", "`.crt/config.local.json`", "- a CRT section in `CLAUDE.md` and `AGENTS.md`", "`<!-- BEGIN:crt v0.4 -->`", "`<!-- END:crt -->`"]) {
      expect(lands).toContain(item);
    }
    expect(lands).toContain("At runtime the server (`crt`, `crt serve`, `crt proxy`) writes only under `.crt/`");
    expect(lands).toContain("never touches `.gitignore`, `CLAUDE.md`, `AGENTS.md` or any app file");
    expect(lands).toContain("`crt init` is the one command that writes outside `.crt/`");
  });

  it("Proxy mode replaces the script-tag fallback: when, crt proxy, mode in config, what still applies (F-92, F-107, N-21)", () => {
    expect(readme).not.toContain("## Script-tag fallback");
    expect(readme).not.toContain("#script-tag-fallback");
    expect(proxy).toContain("`crt proxy [target]` ≡ `crt serve --mode proxy [target]`");
    expect(proxy).toContain('`"mode": "proxy"` in `.crt/config.json`');
    expect(proxy).toContain("`/crt:serve --proxy`");
    for (const still of ["HTML injection of the early hook and the overlay tag", "WebSocket/HMR passthrough", "a CSP that would block the script relaxed for `'self'`", "crt: injected the overlay into GET / but the browser never fetched /__crt/overlay.js", "`Proxying http://localhost:3000 for C:\\my-app.`", "`Dev server URL or port:`", "`Which one? [1]`"]) {
      expect(proxy).toContain(still);
    }
    expect(proxy).toContain("ok    mode      proxy (.crt/config.json)");
    expect(proxy).toContain("--    integration proxy mode");
  });

  it("How it works is embedded first, with proxy mode as the alternative, and the diagram is the app's own origin (F-107)", () => {
    expect(how).toContain("Browser tab  http://localhost:3000 ──── your app, on its own origin");
    expect(how).toContain("/__crt/* cross-origin (loopback CORS)");
    expect(how).toContain("landing page at / (proxy mode: your app, proxied)");
    const bullets = how.split("\n").filter((l) => l.startsWith("- **"));
    expect(bullets[0]).toMatch(/^- \*\*Embedded mode\*\* \(`crt`\)\./);
    expect(bullets[1]).toMatch(/^- \*\*Proxy mode\*\* \(`crt proxy`\)\./);
    expect(how).toContain("proxies nothing");
    expect(how).not.toContain("your app, proxied from :3000");
  });

  it("Privacy states N-22 and the N-19 runtime rule (N-19, N-22)", () => {
    const privacy = how.split("\n").find((l) => l.startsWith("- **Privacy.**"))!;
    expect(privacy).toContain("At runtime the server writes only under `.crt/`");
    expect(privacy).toContain("the loader talks to `127.0.0.1` only, and only from a page on a loopback hostname");
    expect(privacy).toContain("can call the CRT API cross-origin exactly as the overlay does (loopback CORS) — the same capability page scripts had on the proxied origin in proxy mode");
    expect(privacy).toContain("There is no new route and no new page-writable key; `/__crt/internal/*` refuses any request carrying an `Origin` header, and the loader carries no token.");
  });

  it("Troubleshooting has the embedded entry and the proxy-scoped overlay entry (F-94, F-107)", () => {
    expect(trouble).toContain("### The CRT button does not appear (embedded)");
    expect(trouble).toContain("### Overlay does not appear (proxy mode)");
    const embedded = section("### The CRT button does not appear (embedded)");
    expect(embedded).toContain("- **Is the snippet there?** `crt doctor`'s `integration` row");
    expect(embedded).toContain("- **Is it the pill?**");
    expect(embedded).toContain("`http://localhost:4400` in `script-src` (the loader and the overlay script) and in `connect-src` (the API and the SSE stream)");
    expect(embedded).toContain("With the script-tag form there is no pill: the script itself is missing while the server is down");
    expect(embedded).toContain("[Port in use](#port-in-use)");
    expect(embedded).toContain("`overlay.loader: 0`");
    expect(readme).not.toContain("\n### Overlay does not appear\n");
  });

  it.each([
    // F-91
    "crt: no dev server on ports 3000, 5173, 8080, 4200, 8000, 3001 — start it and open it in your browser; the CRT button appears when the page loads the CRT loader (crt <port> to have CRT open it next time)",
    "crt: found N dev servers (…); opening http://localhost:3000 — run `crt <port>` to pick another",
    "crt: http://localhost:3100 (remembered) is not responding — start it; CRT is ready for it",
    "No dev server on ports … — start it and open it in your browser; the CRT button appears when the page loads the CRT loader (crt <port> to have CRT open it next time).",
    "`Which one should I open? [1]`",
    // F-93
    "crt: your app's CRT loader expects :4400 — run `crt --replace`, or set port in .crt/config.json and in the snippet",
    "CRT <version> is already serving this project (embedded) at http://localhost:4400 (since 09:12) — opened http://localhost:3000.",
    // F-94
    "crt: opened http://localhost:3000 but the page never loaded the CRT loader — add the integration (`crt init` prints the snippet, /crt:init applies it), or run `crt proxy`",
    // F-99
    "`crt: cancelled`",
  ])("Troubleshooting quotes %s (F-91, F-93, F-94, F-99, F-107)", (line) => {
    expect(trouble).toContain(line);
  });

  it.each([
    "CRT ready at http://localhost:4400 for http://localhost:3000 (embedded; project: C:\\my-app, 3 tasks in .crt\\tasks, provider: claude (default), login: ok)",
    "CRT ready at http://localhost:4400 → http://localhost:3000 (proxy; project: …)",
    "Open http://localhost:3000 → CRT button bottom-right (Ctrl/Cmd+Shift+.) → Select · note · Send. Ctrl+C stops CRT; your dev server keeps running.",
    "`Found http://localhost:3000.`",
    "crt: overlay loaded in the browser (from http://localhost:3000)",
    "crt: your app's CRT loader expects :4400 — run \\`crt --replace\\`, or set port in .crt/config.json and in the snippet",
    "`Talking to CRT at http://localhost:4400 for C:\\my-app.`",
  ])("The loop quotes %s (F-93, F-94, F-95)", (line) => {
    expect(section("## The loop")).toContain(line);
  });

  it("no section presents the proxy as the default any more (F-107)", () => {
    expect(readme).not.toContain("proxies your app at http://localhost:4400");
    expect(readme).not.toContain("Browse as usual** on `localhost:4400`");
    expect(readme).not.toContain("reverse proxy + HTML injection");
    expect(readme.split("\n")[4]).toContain("v0.4.0.");
    expect(readme.split("\n")[4]).toContain("[docs/PRD-embedded.md](docs/PRD-embedded.md) (v0.4, embedded mode)");
  });
});
