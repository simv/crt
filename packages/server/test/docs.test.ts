import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { STALE_TOKEN_LINE } from "../src/mcp-stdio.js";
import { CLAUDE_INSTALL_HINT, CLAUDE_NOT_LOGGED_IN } from "../src/providers/claude.js";
import { CODEX_MCP_NEVER_CALLED, CODEX_NOT_FOUND, CODEX_NOT_LOGGED_IN, codexCouldNotResume, codexTooOld } from "../src/providers/codex.js";
import { CLAUDE_NOT_FOUND } from "../src/setup.js";

// Doc tests on the README and the docs/ pages. Until v0.6 this file was `readme.test.ts` and read the
// root README alone: PRD-providers F-62 / §10 (every N-7 provider line verbatim in the Providers
// section), PRD-setup F-88 / N-17 (Install is the §4 block, Troubleshooting opens with `crt doctor`,
// every new `crt:` line from F-71, F-73, F-76, F-80 and F-86 quoted verbatim), PRD-embedded F-99,
// F-100, F-103 (the "CRT is not set up" entry and the v0.4 doctor rows — the M17 update) and F-107
// (M18: Install is the PRD-embedded §4 block, the four snippets, Production, What lands in your repo,
// Proxy mode in place of the script-tag fallback, How it works embedded first, the flags rows, the
// N-22 Privacy paragraph, the two new Troubleshooting entries, every new `crt:` line from F-91, F-93,
// F-94 verbatim, and the package README's Install and snippet blocks).
//
// PRD-polish F-115 / N-26 (M23) split the README into a front page and eight docs/ pages: every
// assertion below is the baseline's with the same expected string, read through `section(file,
// heading)` from the file its text moved to. The two exceptions are the server strings PRD-polish
// §5.4/§9 re-point in the same PR — `README › Production` → `docs/integration.md › Production` and
// `see README › Overlay does not appear` → `see docs/troubleshooting.md › Overlay does not appear`.
// The M23 rows at the end add what F-115 asks for: every relative link resolves (to a heading, where
// one is given), the length budgets, the lockup and the images on the front page, each docs page's
// opening line. Runtime values are written as `<…>` in the docs and here alike.

const root = join(import.meta.dirname, "..", "..", "..");
const read = (file: string): string => readFileSync(join(root, ...file.split("/")), "utf8");
const readme = read("README.md");
const packageReadme = read("packages/server/README.md");
/** The eight reference pages F-115 names. */
const PAGES = ["install", "integration", "cli", "providers", "task-format", "how-it-works", "troubleshooting", "develop"].map((n) => `docs/${n}.md`);
/**
 * The text under `heading` in `file` (repo-relative) up to the next heading of the same or a higher
 * level; the page's `# ` title gives the whole page. Fenced code, where `# comments` live, is skipped.
 */
const section = (file: string, heading: string): string => {
  const lines = read(file).split("\n");
  const start = lines.indexOf(heading);
  expect(start, `${file} has "${heading}"`).toBeGreaterThan(-1);
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

describe("docs/providers.md (F-62, N-7)", () => {
  const providers = section("docs/providers.md", "# Providers");

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
    expect(section("docs/install.md", "# Install")).toContain("A project pinned to `claude-review-tool@0.1.x` fails `crt task --validate`");
  });
});

describe("README › Install, docs/install.md, the loop and docs/cli.md (F-88)", () => {
  const install = section("README.md", "## Install");
  const installPage = section("docs/install.md", "# Install");

  it("Install is the PRD-embedded §4 block: npm i -g + crt setup per machine, crt init per project, npm run dev + crt per session (F-88, F-107)", () => {
    expect(install).toContain("npm i -g claude-review-tool\ncrt setup ");
    expect(install).toMatch(/\n# one-time, per project\ncrt init {2,}# \.crt\/ \(README, tasks, config\), 2 \.gitignore lines, a CRT section in CLAUDE\.md/);
    expect(install).toMatch(/\n# per session\nnpm run dev {2,}# your dev server, your URL\ncrt {2,}# CRT server on :4400; opens your app; the CRT button is on your page\n/);
    expect(install).not.toContain("http://localhost:4400 opens");
    // F-86 / F-87: seven skills, the @0.6 fallback pin — what `crt setup` installs, on the install page.
    expect(installPage).toContain("`/crt:init`, `/crt:serve`, `/crt:next`, `/crt:tasks`, `/crt:task`, `/crt:done` and `/crt:intake`");
    expect(installPage).toContain("`npx -y claude-review-tool@0.6`");
  });

  it("offers -D for teams and npx zero-install with the ~220 MB note, and the Windows shim note (F-88, N-16)", () => {
    expect(installPage).toContain("`npm i -D claude-review-tool`");
    expect(installPage).toContain("`npx claude-review-tool`");
    expect(installPage).toContain("~220 MB");
    expect(installPage).toContain("`crt.ps1`");
    expect(installPage).toContain("execution policy");
    expect(installPage).toContain("`crt.cmd`");
  });

  it("the loop is npm run dev → crt → browse your app, and the flags table has the positional, --yes, --no-open, --replace, doctor, setup, --version, proxy, --mode, init (F-88, F-79, F-107)", () => {
    const loop = section("README.md", "## The loop");
    expect(loop).toMatch(/```bash\ncd my-app && npm run dev .*\ncrt {2,}# the CRT server on http:\/\/localhost:4400; opens your app — the CRT button is on your page\n/);
    expect(loop).toContain("1. **Browse your app as usual** — `http://localhost:3000`, your own URL, no proxied copy.");
    expect(loop).not.toContain("proxies your app at");
    const flags = section("docs/cli.md", "## `crt` flags");
    for (const row of ["| `[target]` |", "| `--yes` |", "| `--open` / `--no-open` |", "| `--replace` |", "| `crt doctor` |", "| `crt setup [--claude <path>]` |", "| `crt --version` |", "| `crt proxy [target]` |", "| `--mode <embedded\\|proxy>` |", "| `crt init [--yes] [--no-instructions] [--snippet [--json]]` |"]) {
      expect(flags).toContain(row);
    }
    expect(flags).toContain("crt proxy [target] …");
    expect(flags).toContain("crt init [--yes] [--no-instructions] [--snippet [--json]]   # set the project up");
    expect(flags).toContain("which any local process may call");
  });
});

describe("README › Troubleshooting and docs/troubleshooting.md (F-88, N-17)", () => {
  const readmeTrouble = section("README.md", "## Troubleshooting");
  const trouble = section("docs/troubleshooting.md", "# Troubleshooting");

  it("opens with `crt doctor` and its sample (F-76, F-88)", () => {
    expect(readmeTrouble.trimStart().startsWith("Run `crt doctor` first.")).toBe(true);
    expect(readmeTrouble).toContain("$ crt doctor\nok    node      v22.4.0 (needs 20 or newer)");
    expect(readmeTrouble).toContain("ok    .crt      README.md, tasks/ (4 tasks), config.json, config.local.json, .gitignore entries\nok    mode      embedded\n");
    expect(readmeTrouble).toContain("ok    integration next — app/layout.tsx imports claude-review-tool/react\nok    instructions CLAUDE.md carries the CRT section\n");
    expect(readmeTrouble).toContain("→ claude — codex not logged in");
    // The docs page repeats the sample so its row catalogue reads on its own (PRD-polish §12 rule 6).
    expect(trouble).toContain("$ crt doctor\nok    node      v22.4.0 (needs 20 or newer)");
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
    "FAIL  port      4400 held by CRT 0.6.0 → http://localhost:3000 (this project) — crt --replace",
    "FAIL  port      4400 in use by a non-CRT process — crt --port 4401",
    "--    plugin    claude not on PATH — skipped",
    "warn  plugin    crt@crt not installed — run crt setup",
    "warn  plugin    crt@crt 0.5.0 installed, this is 0.6.0 — run crt setup",
    // F-74
    `crt: ${CLAUDE_NOT_LOGGED_IN}`,
    `crt: ${CLAUDE_NOT_LOGGED_IN} (${CLAUDE_INSTALL_HINT})`,
    // F-80 (the first line re-pointed by PRD-polish §9, M23)
    "crt: injected the overlay into GET / but the browser never fetched /__crt/overlay.js — a Content-Security-Policy or a JS-rendered shell is blocking it; see docs/troubleshooting.md › Overlay does not appear",
    "crt: GET / answered application/json, not text/html — CRT injects only into HTML; use the script-tag fallback (README)",
    "crt: GET / sends a CSP with 'strict-dynamic' that CRT cannot relax — the overlay may be blocked; use the script-tag fallback",
    // F-86
    `crt: ${CLAUDE_NOT_FOUND}`,
    "crt setup: registered marketplace crt from <path>",
    "crt setup: installed crt@crt 0.6.0 — restart Claude Code to load /crt:serve, /crt:next, /crt:tasks, /crt:task, /crt:done, /crt:intake, /crt:init",
    "crt setup: crt@crt 0.6.0 is already installed",
    // F-84
    "CRT: plugin 0.6.0 but the project's claude-review-tool is 0.5.0 — npm update claude-review-tool (or crt setup after updating)",
  ])("quotes %s (F-88, N-17)", (line) => {
    expect(trouble).toContain(line);
  });

  it.each([
    // F-99
    "crt: C:\\my-app is not set up for CRT — run `crt init` (or `crt --yes`)",
    "Set up CRT in C:\\my-app? [Y/n]",
    "no tasks (CRT is not set up here — run crt init)",
    // F-100 (the Production footer re-pointed by PRD-polish §9, M23)
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
    "Production builds contain nothing from CRT (docs/integration.md › Production). /crt:init in Claude Code applies this for you.",
    // F-101
    "<!-- BEGIN:crt v0.6 -->",
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
    for (const page of ["README.md", ...PAGES]) expect(read(page), page).not.toContain("`crt` first runs `crt init`");
    expect(section("docs/cli.md", "## What `crt` prints")).toContain("`crt` never sets a project up on its own");
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

describe("README › Add CRT to your app and docs/integration.md › Production (PRD-embedded F-97, F-98)", () => {
  const add = section("README.md", "## Add CRT to your app");
  const production = section("docs/integration.md", "## Production");

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

describe("F-107 (PRD-embedded, M18) across the front page and the docs: the four snippets, Production, What lands in your repo, Proxy mode, How it works, Privacy, the new lines", () => {
  const add = section("README.md", "## Add CRT to your app");
  const integration = section("docs/integration.md", "# Add CRT to your app");
  const production = section("docs/integration.md", "## Production");
  const lands = section("README.md", "## What lands in your repo");
  const proxy = section("docs/integration.md", "## Proxy mode");
  const how = section("docs/how-it-works.md", "# How it works");
  const trouble = section("docs/troubleshooting.md", "# Troubleshooting");
  const prints = section("docs/cli.md", "## What `crt` prints");

  /** The four F-102 snippets, verbatim from PRD-embedded §4 (and what `crt init` prints). */
  const SNIPPETS = [
    '// Next.js (App Router) — app/layout.tsx\nimport { CrtDevTools } from "claude-review-tool/react";\n…\n<body>{children}<CrtDevTools /></body>',
    '// Vite — vite.config.ts\nimport { crt } from "claude-review-tool/vite";\nexport default defineConfig({ plugins: [react(), crt()] });',
    '// any bundled app — the client entry (src/main.tsx, src/index.ts, …)\nimport { mountCrt } from "claude-review-tool/loader";\nif (process.env.NODE_ENV !== "production") mountCrt();   // the guard is optional (F-98); it lets the bundler drop the import',
    '<!-- no bundler — the development page only -->\n<script src="http://localhost:4400/__crt/loader.js"></script>',
  ];

  it.each(SNIPPETS.map((s) => [s.split("\n")[0]!, s]))("Add CRT to your app carries the snippet %s verbatim, and so do the package README and docs/integration.md (F-102, F-107, F-115)", (_first, snippet) => {
    expect(add).toContain(snippet);
    expect(packageReadme).toContain(snippet);
    expect(integration).toContain(snippet);
  });

  it("says where each form starts capturing, the pill line, the loopback rule and the plain overlay tag (F-95, F-96, F-107)", () => {
    expect(integration).toContain("- **Vite / `crt()`** — before the app's first module");
    expect(integration).toContain("- **React / Next.js / `<CrtDevTools />`** — after hydration");
    expect(integration).toContain("- **`mountCrt()`** — from wherever you call it");
    expect(integration).toContain("- **The script tag** — from the tag onward");
    expect(integration).toContain("so there is no pill");
    expect(integration).toContain("CRT server not running on :4400 — run \\`crt\\` in the project, then click here");
    expect(integration).toContain("`localhost`, `*.localhost`, `127.0.0.1` or `[::1]`");
    expect(integration).toContain('<script src="http://localhost:4400/__crt/overlay.js" defer></script>');
    expect(integration).toContain('`data-crt-port="4401"`');
  });

  it("the package README has the Install block too (F-107)", () => {
    expect(packageReadme).toContain("npm i -g claude-review-tool\ncrt setup ");
    expect(packageReadme).toMatch(/\n# one-time, per project\ncrt init {2,}# /);
    expect(packageReadme).toMatch(/\n# per session\nnpm run dev {2,}# your dev server, your URL\ncrt {2,}# CRT server on :4400; opens your app; the CRT button is on your page\n/);
    expect(packageReadme).not.toContain("local proxy that injects");
  });

  it("Production names the verified bundlers (PRD-embedded §12 rule 2) and the no-request check (F-98, N-18)", () => {
    expect(production).toContain("esbuild 0.25 and Vite 8.3");
    expect(production).toContain("Next.js 16.3 (Turbopack)");
    expect(production).toContain("never requests the CRT port");
    expect(production).toContain("(or `.next/static`)");
  });

  it("What lands in your repo lists the five items, the markers, and the N-19 runtime rule (F-100, F-101, N-19)", () => {
    expect(lands).toContain("crt init will, in <root>:");
    for (const item of ["- `.crt/README.md`", "- `.crt/tasks/`", "- `.crt/config.json`", "- two `.gitignore` lines — `.crt/captures/`", "`.crt/config.local.json`", "- a CRT section in `CLAUDE.md` and `AGENTS.md`", "`<!-- BEGIN:crt v0.6 -->`", "`<!-- END:crt -->`"]) {
      expect(lands).toContain(item);
    }
    expect(lands).toContain("At runtime the server (`crt`, `crt serve`, `crt proxy`) writes only under `.crt/`");
    expect(lands).toContain("never touches `.gitignore`, `CLAUDE.md`, `AGENTS.md` or any app file");
    expect(lands).toContain("`crt init` is the one command that writes outside `.crt/`");
  });

  it("Proxy mode replaces the script-tag fallback: when, crt proxy, mode in config, what still applies (F-92, F-107, N-21)", () => {
    for (const page of ["README.md", ...PAGES]) {
      expect(read(page), page).not.toContain("## Script-tag fallback");
      expect(read(page), page).not.toContain("#script-tag-fallback");
    }
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
    const embedded = section("docs/troubleshooting.md", "### The CRT button does not appear (embedded)");
    expect(embedded).toContain("- **Is the snippet there?** `crt doctor`'s `integration` row");
    expect(embedded).toContain("- **Is it the pill?**");
    expect(embedded).toContain("`http://localhost:4400` in `script-src` (the loader and the overlay script) and in `connect-src` (the API and the SSE stream)");
    expect(embedded).toContain("With the script-tag form there is no pill: the script itself is missing while the server is down");
    expect(embedded).toContain("[Port in use](#port-in-use)");
    expect(embedded).toContain("`overlay.loader: 0`");
    for (const page of ["README.md", "docs/troubleshooting.md"]) expect(read(page), page).not.toContain("\n### Overlay does not appear\n");
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
  ])("docs/cli.md › What `crt` prints quotes %s (F-93, F-94, F-95)", (line) => {
    expect(prints).toContain(line);
  });

  it("The loop quotes the welcome card's line (F-95)", () => {
    expect(section("README.md", "## The loop")).toContain("`Talking to CRT at http://localhost:4400 for C:\\my-app.`");
  });

  it("no section presents the proxy as the default any more (F-107)", () => {
    for (const page of ["README.md", ...PAGES]) {
      expect(read(page), page).not.toContain("proxies your app at http://localhost:4400");
      expect(read(page), page).not.toContain("Browse as usual** on `localhost:4400`");
      expect(read(page), page).not.toContain("reverse proxy + HTML injection");
    }
    expect(readme.split("\n")[4]).toContain("v0.6.0.");
    expect(readme.split("\n")[4]).toContain("[docs/PRD-embedded.md](docs/PRD-embedded.md) (v0.4, embedded mode)");
  });
});

describe("the front page and the docs pages (PRD-polish F-115, N-26, M23)", () => {
  /** GitHub's heading anchor: lower-case, letters, digits, spaces and hyphens kept, spaces to hyphens. */
  const slug = (heading: string): string => heading.toLowerCase().replace(/[^\p{L}\p{N} -]/gu, "").replace(/ /g, "-");
  /** Headings outside fenced code, as anchors. */
  const anchors = (file: string): string[] => {
    const out: string[] = [];
    let fenced = false;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      if (line.startsWith("```")) fenced = !fenced;
      else if (!fenced) {
        const m = /^#{1,6} (.*)$/.exec(line);
        if (m) out.push(slug(m[1]!));
      }
    }
    return out;
  };
  /**
   * Every link target in `file` — Markdown `[…](…)` and `![…](…)`, `<a href>`, `<img src>`,
   * `<source srcset>` — outside fenced code and indented sample blocks (docs/PRD.md quotes a task
   * file, assets and all, indented under a list item; the same rule as docs-images.test.ts).
   */
  const links = (file: string): Array<{ line: number; target: string }> => {
    const out: Array<{ line: number; target: string }> = [];
    let fenced = false;
    for (const [i, line] of readFileSync(file, "utf8").split("\n").entries()) {
      if (line.startsWith("```")) fenced = !fenced;
      if (fenced || /^\s{2,}/.test(line)) continue;
      for (const m of line.matchAll(/\]\(([^)\s]+)(?:\s"[^"]*")?\)/g)) out.push({ line: i + 1, target: m[1]! });
      for (const m of line.matchAll(/<(?:a|img|source)\b[^>]*\b(?:href|src|srcset)="([^"]+)"/g)) out.push({ line: i + 1, target: m[1]! });
    }
    return out;
  };
  /** The three READMEs and every Markdown page directly under docs/ (the eight pages and the PRDs). */
  const files = (): string[] => {
    const docs = join(root, "docs");
    return [join(root, "README.md"), join(root, "packages", "server", "README.md"), join(docs, "images", "README.md"), join(docs, "brand", "README.md"), ...readdirSync(docs).filter((n) => n.endsWith(".md")).map((n) => join(docs, n))];
  };

  it("every relative link in the READMEs and docs/*.md resolves to a file, and to a heading when one is given (F-115)", () => {
    let seen = 0;
    for (const file of files()) {
      const rel = file.slice(root.length + 1);
      for (const { line, target } of links(file)) {
        if (/^(https?:|mailto:|data:|\/\/)/.test(target)) continue;
        seen++;
        const [path, anchor] = target.split("#");
        const abs = path ? resolve(dirname(file), path) : file;
        expect(existsSync(abs), `${rel}:${line} → ${target}`).toBe(true);
        if (anchor !== undefined && abs.endsWith(".md")) expect(anchors(abs), `${rel}:${line} → ${target}`).toContain(anchor);
      }
    }
    expect(seen).toBeGreaterThan(40);
  });

  it("the root README is ≤ 200 lines and the npm README ≤ 60 (F-115)", () => {
    expect(readme.split("\n").length - 1, "README.md lines").toBeLessThanOrEqual(200);
    expect(packageReadme.split("\n").length - 1, "packages/server/README.md lines").toBeLessThanOrEqual(60);
  });

  it("the front page carries the lockup as a <picture> on prefers-color-scheme, the five screenshots and the loop illustration in both themes (F-115, F-117)", () => {
    expect(readme).toMatch(/<picture>\s*<source media="\(prefers-color-scheme: dark\)" srcset="docs\/brand\/crt-lockup-dark\.svg">\s*<img [^>]*src="docs\/brand\/crt-lockup\.svg"/);
    for (const png of ["arrival", "select", "chat", "marker-states", "landing"]) expect(readme).toMatch(new RegExp(`!\\[[^\\]]+\\]\\(docs/images/${png}\\.png\\)`));
    expect(readme).toMatch(/<picture>\s*<source media="\(prefers-color-scheme: dark\)" srcset="docs\/images\/loop-dark\.svg">\s*<img [^>]*src="docs\/images\/loop\.svg"/);
    // The README's order (§5.4): title, pitch, the version line, the lockup, arrival.png, then Install.
    expect(readme.indexOf("crt-lockup.svg")).toBeLessThan(readme.indexOf("arrival.png"));
    expect(readme.indexOf("arrival.png")).toBeLessThan(readme.indexOf("\n## Install\n"));
    expect(readme).toContain("This README is the front page; the manual is [`docs/`](#docs).");
  });

  it("each docs page opens with its title, one line saying what it holds, and a link back to the README (F-115)", () => {
    for (const page of PAGES) {
      const lines = read(page).split("\n");
      expect(lines[0], page).toMatch(/^# \S/);
      expect(lines[1], page).toBe("");
      expect(lines[2], page).toMatch(/\]\(\.\.\/README\.md(#[a-z-]+)?\)/);
      expect(lines[2], page).not.toMatch(/^#/);
      expect(read(page).endsWith("\n") && !read(page).endsWith("\n\n"), `${page} ends with one newline`).toBe(true);
      expect(read(page), page).not.toContain("\r");
    }
    // The README's index names all eight.
    const index = section("README.md", "## Docs");
    for (const page of PAGES) expect(index).toContain(`[${page}](${page})`);
  });

  it("the npm README shows the lockup and one screenshot by absolute raw.githubusercontent.com URL and no relative image (F-115)", () => {
    expect(packageReadme).toContain('src="https://raw.githubusercontent.com/simv/crt/main/docs/brand/crt-lockup.svg"');
    expect(packageReadme).toMatch(/src="https:\/\/raw\.githubusercontent\.com\/simv\/crt\/main\/docs\/images\/[a-z-]+\.png"/);
    expect(packageReadme).not.toMatch(/!\[[^\]]*\]\((?!https?:)/);
    expect(packageReadme).not.toMatch(/src="(?!https?:)/);
    expect(packageReadme).toContain("https://github.com/simv/crt#readme");
  });

  it("the two re-pointed server strings name the docs pages, and the pages carry the sections they name (PRD-polish §5.4, F-115)", () => {
    expect(read("packages/server/src/init.ts")).toContain("(docs/integration.md › Production)");
    expect(read("packages/server/src/proxy.ts")).toContain("see docs/troubleshooting.md › Overlay does not appear");
    expect(anchors(join(root, "docs", "integration.md"))).toContain("production");
    expect(anchors(join(root, "docs", "troubleshooting.md"))).toContain("overlay-does-not-appear-proxy-mode");
    for (const page of ["README.md", ...PAGES]) for (const old of ["README › Production", "README › Overlay does not appear"]) expect(read(page), page).not.toContain(old);
  });
});

describe("PRD-chat §9 (M25): the folded capture bubble on the front page and in How it works (F-119)", () => {
  it("README › The loop step 3 and docs/how-it-works.md › Intake session say the note is the bubble and the detail sits behind a `Capture` pill (F-119)", () => {
    expect(readme).toContain("The overlay captures the page and the same popover becomes the chat. Your note is the first bubble; the page, selector and console detail Claude was given sits behind a `Capture` pill.");
    expect(read("docs/how-it-works.md")).toContain("The panel shows only your words for it — your note, or one line per annotation — and folds the rest behind a `Capture` pill; what the agent receives is unchanged.");
  });
});
