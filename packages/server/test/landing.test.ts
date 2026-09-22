import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCENT, DANGER, EXPERIMENTAL, GLASS, INK, OK, PILL, WARN } from "../../overlay/src/tokens.js";
import type { DoctorPayload } from "../src/doctor-route.js";
import { commandOf, DOCS_URL, LANDING_TOKENS, type LandingOptions, renderLanding, renderRows } from "../src/landing.js";
import { MARK, MARK_DARK, MARK_SMALL } from "../src/marks.js";
import type { ProviderStatus } from "../src/session.js";

// PRD-polish F-114 / N-23 / N-25: the landing page as rendered — the strings, the three hero states,
// one inline script that reaches only /__crt/*, the Attention block exactly when a row is FAIL or
// warn, the look rules that are visible in the markup, the size budget, and the tokens pinned to
// packages/overlay/src/tokens.ts (decision 7: the server repeats them, a test keeps them equal).

const brand = join(__dirname, "..", "..", "..", "docs", "brand");
const mark = readFileSync(join(brand, "crt-mark.svg"), "utf8").trim();
const markDark = readFileSync(join(brand, "crt-mark-dark.svg"), "utf8").trim();
const markSmall = readFileSync(join(brand, "crt-mark-small.svg"), "utf8").trim();
/** The page prints local wall-clock times; the expectations follow the machine's zone (CI runs in UTC). */
const hhmm = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function provider(id: string, over: Partial<ProviderStatus> = {}): ProviderStatus {
  return {
    id,
    displayName: id[0]!.toUpperCase() + id.slice(1),
    agentName: `${id} CLI`,
    installed: true,
    loggedIn: true,
    version: "1.0.0",
    problem: null,
    markers: [],
    capabilities: { streaming: true, toolEvents: true, permissions: "interactive", images: "inline", resume: true, interrupt: true, instructions: "system" },
    state: "ready",
    hints: { install: `install ${id}`, login: `${id} login` },
    ...over,
  };
}

const HEALTHY: DoctorPayload = {
  checkedAt: "2026-09-22T01:12:00.000Z",
  rows: [
    { status: "ok", name: "node", detail: "v22.4.0 (needs 20 or newer)" },
    { status: "ok", name: "project", detail: "C:\\my-app (.git)" },
    { status: "ok", name: ".crt", detail: "README.md, tasks/ (4 tasks), config.json, .gitignore entries" },
    { status: "ok", name: "mode", detail: "embedded" },
    { status: "ok", name: "target", detail: "http://localhost:3100 (remembered) — responding" },
    { status: "ok", name: "integration", detail: "next — app/layout.tsx imports claude-review-tool/react" },
    { status: "--", name: "instructions", detail: "no CLAUDE.md or AGENTS.md — crt init creates one" },
    { status: "ok", name: "port", detail: "4400 — this server" },
    { status: "ok", name: "claude", detail: "Claude Code (Agent SDK 0.3.270) — logged in" },
  ],
  decision: "→ claude (default)",
  exitCode: 0,
};

const TROUBLED: DoctorPayload = {
  ...HEALTHY,
  rows: [
    ...HEALTHY.rows.slice(0, 4),
    { status: "warn", name: "target", detail: "http://localhost:3100 (remembered) — not responding" },
    ...HEALTHY.rows.slice(5, 7),
    { status: "FAIL", name: "port", detail: "4400 held by CRT 0.5.0 → http://localhost:3000 (this project) — crt --replace" },
    { status: "warn", name: "codex", detail: "Codex CLI 0.154.0 — not logged in — codex login" },
    { status: "warn", name: "plugin", detail: "crt@crt 0.5.0 installed, this is 0.6.0 — run crt setup" },
  ],
  decision: "→ claude — codex not logged in",
  exitCode: 1,
};

function opts(over: Partial<LandingOptions> = {}): LandingOptions {
  return {
    version: "0.6.0",
    sdkVersion: "0.3.270",
    mode: "embedded",
    projectRoot: "C:\\Projects\\Claude\\tool-validation",
    app: "http://localhost:3100",
    tasks: 14,
    backlog: 3,
    startedAt: "2026-09-22T01:12:00+08:00",
    platform: "win32",
    mark,
    markDark,
    markSmall,
    sessions: 1,
    providers: { active: "claude", rows: [provider("claude"), provider("codex", { loggedIn: false, problem: "not logged in", state: "not logged in" })] },
    now: new Date("2026-09-22T01:53:00+08:00"),
    ...over,
  };
}

const page = (over: Partial<LandingOptions> = {}) => renderLanding(opts(over));
/** Every URL the page references: href, src and CSS url(). */
function references(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/\b(?:href|src)="([^"]*)"/g)) out.push(m[1]!);
  // SVG `url(#id)` fragments point inside the document — not a reference to anything.
  for (const m of html.matchAll(/url\(([^)]*)\)/g)) if (!m[1]!.startsWith("#")) out.push(m[1]!.replace(/^['"]|['"]$/g, ""));
  return out;
}

describe("the landing page (PRD-polish F-114)", () => {
  it("carries the F-114 strings: the kicker, Open <app>, the F-91 sentence, the title, the favicon link, the noscript line, the sections and the skills (F-114)", () => {
    const html = page();
    expect(html).toContain("<title>CRT 0.6.0</title>");
    expect(html).toContain('<link rel="icon" href="/__crt/favicon.svg">');
    expect(html).toContain("This is the CRT server — not your app.");
    expect(html).toContain("<h1>Your app is at <code>localhost:3100</code></h1>");
    expect(html).toContain("Open it and look for the CRT button bottom-right: that is where you annotate, chat and file tasks.");
    expect(html).toContain('<a class="btn" id="open" href="http://localhost:3100">Open http://localhost:3100 <span aria-hidden="true">↗</span></a>');
    expect(html).toContain("<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd> toggles the toolbar on your page");
    expect(html).toContain("<noscript><p>Run <code>crt doctor</code> in a terminal for this checklist.</p></noscript>");
    expect(html).toContain("<h2>Attention</h2>");
    expect(html).toContain("<b>Point at the problem</b>");
    expect(html).toContain('<b>Talk it through in the page</b><span>Send opens a chat with <span id="agent">Claude</span> right there');
    expect(html).toContain("<b>Get a task file</b>");
    expect(html).toContain("<h2>Checkup ");
    expect(html).toContain('<button type="button" id="recheck">Re-check</button>');
    expect(html).toContain("<h2>This server</h2>");
    expect(html).toContain('<dt>Version</dt><dd>0.6.0 <span class="mono muted">agent sdk 0.3.270</span></dd>');
    expect(html).toContain(`<dt>Up since</dt><dd id="since">${hhmm("2026-09-22T01:12:00+08:00")} · 41 min</dd>`);
    expect(html).toContain('<dt>Project</dt><dd class="mono">C:\\Projects\\Claude\\tool-validation</dd>');
    expect(html).toContain('<dt>Tasks</dt><dd id="tasks">14 in <span class="mono">.crt/tasks</span> · 3 in backlog</dd>');
    expect(html).toContain('<dt>Sessions</dt><dd id="sessions">1 running</dd>');
    expect(html).toContain('<span class="who">Claude</span><span class="what">ready · logged in · default</span>');
    expect(html).toContain('<span class="who">Codex</span><span class="what">not logged in</span>');
    expect(html).toContain("<h2>In Claude Code</h2>");
    for (const skill of ["/crt:tasks", "/crt:next", "/crt:serve"]) expect(html).toContain(`<dt><code>${skill}</code></dt>`);
    expect(html).toContain("<kbd>Ctrl</kbd>+<kbd>C</kbd> in the terminal stops CRT; your dev server keeps running.");
    expect(html).toContain("Run <code>crt init</code> for the one-line snippet for your framework, or <code>crt proxy</code> to proxy your app instead.");
    expect(html).toContain(`<a href="${DOCS_URL}" id="docs">Docs <span class="muted">(github.com ↗)</span></a>`);
    // The header chip: the mode and the project, ellipsised by CSS with the full path in the title.
    expect(html).toContain('<span class="chip" title="C:\\Projects\\Claude\\tool-validation"><i class="dot ok"></i>embedded · <span class="path">C:\\Projects\\Claude\\tool-validation</span></span>');
    // Never the overlay.
    expect(html).not.toContain("crt-host");
    expect(html).not.toContain("overlay.js");
  });

  it("renders the three hero states: the app known, no app, and the app whose page never loaded the loader — plus the proxy-mode line at /__crt/ (F-114)", () => {
    const none = page({ app: null });
    expect(none).toContain("<h1>No dev server found yet.</h1>");
    expect(none).toContain("Start yours and open it — the CRT button appears on any localhost page with the CRT integration.");
    expect(none).toContain('<p class="hint" id="hint"><code>crt 3000</code> remembers it.</p>');
    expect(none).not.toContain('id="open"');
    expect(none).not.toContain("Open http");
    const missing = page({ loaderMissing: true });
    expect(missing).toContain('<a class="btn" id="open" href="http://localhost:3100">Open http://localhost:3100');
    expect(missing).toContain('<p class="hint" id="hint" data-state="missing">Your page has no CRT integration yet — <code>crt init</code> prints the snippet.</p>');
    expect(missing).not.toContain("toggles the toolbar on your page</p>");
    const proxy = page({ mode: "proxy", app: "http://localhost:3999", crtOrigin: "http://localhost:4496" });
    expect(proxy).toContain("<h1>You are browsing your app through CRT at <code>localhost:4496</code>.</h1>");
    expect(proxy).toContain('<a class="btn" id="open" href="http://localhost:4496/">Open http://localhost:4496 <span aria-hidden="true">↗</span></a>');
    expect(proxy).toContain('<i class="dot ok"></i>proxy · ');
    // Cmd on macOS, Ctrl elsewhere (the server knows process.platform).
    expect(page({ platform: "darwin" })).toContain("<kbd>Cmd</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd> toggles the toolbar on your page");
    expect(page({ platform: "darwin" })).toContain("<kbd>Cmd</kbd>+<kbd>C</kbd> in the terminal");
    expect(page({ platform: "linux" })).toContain("<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd>");
  });

  it("has exactly one <script>, inline, that fetches only /__crt/health, /__crt/providers (?refresh=1 on Re-check), /__crt/doctor and /__crt/doctor?plugin=1, with no timers (F-114, N-23)", () => {
    const html = page();
    const scripts = [...html.matchAll(/<script\b[^>]*>/gi)];
    expect(scripts).toHaveLength(1);
    expect(scripts[0]![0]).toBe("<script>");
    const script = /<script>([\s\S]*?)<\/script>/i.exec(html)![1]!;
    const urls = [...script.matchAll(/"(\/__crt\/[^"]*)"/g)].map((m) => m[1]).sort();
    // Re-check asks for a fresh preflight (F-56, the same route) so a new `codex login` is noticed.
    expect(urls).toEqual(["/__crt/doctor", "/__crt/doctor?plugin=1", "/__crt/health", "/__crt/providers", "/__crt/providers?refresh=1"]);
    expect(script).not.toMatch(/setInterval|setTimeout|requestAnimationFrame|XMLHttpRequest|WebSocket|EventSource|import\(/);
    expect(script.match(/fetch\(/g)).toHaveLength(1);
    // Copy buttons: navigator.clipboard with a select-the-text fallback and no library.
    expect(script).toContain("navigator.clipboard.writeText");
    expect(script).toContain("getSelection()");
    expect(script).toContain('execCommand("copy")');
    // On load, on Re-check, on visibilitychange (visible) — and nothing else.
    expect(script).toContain('$("recheck").addEventListener("click"');
    expect(script).toContain('d.addEventListener("visibilitychange",function(){if(d.visibilityState==="visible")check(false)})');
    expect(script.trim().endsWith("check(false);\n})();")).toBe(true);
  });

  it("references nothing outside /__crt/ except the app link and the docs anchor (N-23)", () => {
    for (const html of [page(), page({ app: null }), page({ mode: "proxy", app: "http://localhost:3999", crtOrigin: "http://localhost:4496" }), page({ doctor: TROUBLED })]) {
      const refs = references(html);
      expect(refs).toContain(DOCS_URL);
      for (const ref of refs) {
        expect(ref === DOCS_URL || ref === "http://localhost:3100" || ref === "http://localhost:4496/" || ref.startsWith("/__crt/"), ref).toBe(true);
      }
      expect(html).not.toMatch(/@import|<link[^>]*rel="(?:stylesheet|preload|prefetch)"|<img\b|<iframe\b|fonts\.googleapis/i);
    }
    // No app and no docs? The docs anchor is still there, the app link is not.
    expect(references(page({ app: null })).filter((r) => r.startsWith("http"))).toEqual([DOCS_URL]);
  });

  it("inlines the mark in both variants, switched by prefers-color-scheme, and the small mark for the mobile header (F-114)", () => {
    // marks.ts is docs/brand/ verbatim — the server reads no file at request time.
    expect(MARK).toBe(mark);
    expect(MARK_DARK).toBe(markDark);
    expect(MARK_SMALL).toBe(markSmall);
    const html = page();
    // The ids are prefixed per copy so the three clip paths do not collide in one document.
    const prefixed = (svg: string, prefix: string) => svg.replace(/\bid="([^"]+)"/g, `id="${prefix}-$1"`).replace(/url\(#([^)]+)\)/g, `url(#${prefix}-$1)`);
    expect(html).toContain(`<span class="mark mark-l">${prefixed(mark, "ml")}</span>`);
    expect(html).toContain(`<span class="mark mark-d">${prefixed(markDark, "md")}</span>`);
    expect(html).toContain(`<span class="mark mark-s">${prefixed(markSmall, "ms")}</span>`);
    expect(html).toContain('id="ml-a"');
    expect(html).toContain('clip-path="url(#md-a)"');
    expect(html.match(/ id="[^"]+"/g)!.map((m) => m.trim()).filter((v, i, a) => a.indexOf(v) !== i)).toEqual([]); // no duplicate ids
    expect(html).toContain("@media (prefers-color-scheme: dark){");
    expect(html).toContain(".mark-l{display:none!important}.mark-d{display:block!important}");
    expect(html).toContain("@media (max-width:479px){.tube-wrap{display:none}.mark{width:20px;height:20px}.mark-l,.mark-d{display:none!important}.mark-s{display:block}");
  });

  it("shows the Attention block exactly when a row is FAIL or warn, with the problems first and their commands copyable; the passes collapse into a <details> in the doctor's order (F-114)", () => {
    const calm = page({ doctor: HEALTHY });
    expect(calm).toContain('<section class="attention card" id="attention" hidden>');
    expect(calm).toContain('<div id="attention-rows"></div>');
    expect(calm).toContain(`checked at ${hhmm(HEALTHY.checkedAt)}`);
    expect(calm).toContain("<summary>8 checks pass — same rows as <code>crt doctor</code></summary>");
    expect(calm).toContain('<p class="decision">→ claude (default)</p>');
    // No problems: the Checkup body is the <details> and the decision line only.
    const body = /<div id="rows">([\s\S]*?)<\/div>\n<\/div>/.exec(calm)![1]!;
    expect(body.startsWith("<details")).toBe(true);
    expect(body.match(/<tr class="row">/g)).toHaveLength(9);
    // Before the first check: nothing to show, the block hidden, the script fills it.
    const fresh = page();
    expect(fresh).toContain('<section class="attention card" id="attention" hidden>');
    expect(fresh).toContain('<div id="rows"></div>');
    expect(fresh).toContain('<span id="checked"></span>');

    const troubled = page({ doctor: TROUBLED });
    expect(troubled).toContain('<section class="attention card" id="attention">');
    expect(troubled).not.toContain('id="attention" hidden');
    const rows = renderRows(TROUBLED);
    // FAIL first, then the warn rows in the doctor's order, each with the verbatim detail and the copy button on its command.
    const problems = /<tbody>([\s\S]*?)<\/tbody>/.exec(rows)![1]!;
    expect([...problems.matchAll(/<td class="nm">([^<]*)<\/td>/g)].map((m) => m[1])).toEqual(["port", "target", "codex", "plugin"]);
    expect(problems).toContain('<td class="st"><span class="chip-s fail">FAIL</span></td><td class="nm">port</td><td class="dt">4400 held by CRT 0.5.0 → http://localhost:3000 (this project) — crt --replace</td><td class="cp"><button type="button" class="copy" data-cmd="crt --replace">Copy</button></td>');
    expect(problems).toContain('<td class="dt">http://localhost:3100 (remembered) — not responding</td><td class="cp"></td>');
    expect(problems).toContain('data-cmd="codex login"');
    expect(problems).toContain('data-cmd="crt setup"');
    expect(rows).toContain("<summary>5 checks pass — same rows as <code>crt doctor</code></summary>");
    const passes = /<details[\s\S]*<tbody>([\s\S]*?)<\/tbody>/.exec(rows)![1]!;
    expect([...passes.matchAll(/<td class="nm">([^<]*)<\/td>/g)].map((m) => m[1])).toEqual(["node", "project", ".crt", "mode", "integration", "instructions"]);
    expect(passes).toContain('<span class="chip-s skip">--</span>');
    expect(passes).not.toContain("copy");
    expect(rows).toContain('<p class="decision">→ claude — codex not logged in</p>');
    // The Attention block carries the same problem rows.
    expect(/<div id="attention-rows">([\s\S]*?)<\/div>\n<\/section>/.exec(troubled)![1]).toBe(`<table><thead class="sr"><tr><th>Status</th><th>Check</th><th>Detail</th><th>Fix</th></tr></thead><tbody>${problems}</tbody></table>`);
    // A visually-hidden header row on every table.
    expect(rows.match(/<thead class="sr"><tr><th>Status<\/th><th>Check<\/th><th>Detail<\/th><th>Fix<\/th><\/tr><\/thead>/g)).toHaveLength(2);
  });

  it.each([
    ["4400 held by CRT 0.5.0 → http://localhost:3000 (this project) — crt --replace", "crt --replace"],
    ["4400 in use by a non-CRT process — crt --port 4401", "crt --port 4401"],
    ["Codex CLI 0.154.0 — not logged in — codex login", "codex login"],
    ["Claude Code (Agent SDK 0.3.270) — not logged in — run `claude` in a terminal and complete /login", "claude"],
    ["crt@crt 0.5.0 installed, this is 0.6.0 — run crt setup", "crt setup"],
    ["crt@crt not installed — run crt setup", "crt setup"],
    ["tasks/ (2 tasks), config.json, .gitignore entries — no README.md — run crt init", "crt init"],
    ["CLAUDE.md has no CRT section — crt init adds it", "crt init adds it"],
    ["none set and nothing on the probed ports — crt <port>", "crt <port>"],
    ["http://localhost:3100 (remembered) — not responding", null],
    ["v18.20.0 — CRT needs Node 20 or newer", null],
    ["C:\\my-app\\src — no .git above; .crt/ will be created here (run from the repo root, or git init)", null],
    ["embedded", null],
  ])("commandOf(%j) → %j: the last ` — ` segment, `run ` dropped, a backticked word preferred, only when it starts with a CLI (F-114)", (detail, expected) => {
    expect(commandOf(detail)).toBe(expected);
  });

  it("keeps the look rules that live in the markup: focus rings, reduced motion, the power-on ≤ 1.2 s by opacity, the tube ≤ 280 px, the dark bezel, the tinted chips, rows stacking under 480 px (N-25)", () => {
    const html = page();
    expect(html).toContain(":focus-visible{outline:2px solid var(--accent);outline-offset:2px}");
    expect(html).toContain("@media (prefers-reduced-motion: reduce){.tube{animation:none}}");
    expect(html).toContain("@keyframes power-on{from{opacity:0}to{opacity:1}}");
    const duration = Number(/\.tube\{[^}]*animation:power-on ([\d.]+)s/.exec(html)![1]);
    expect(duration).toBeLessThanOrEqual(1.2);
    expect(html).toContain(".tube{width:100%;max-width:280px;aspect-ratio:4/3;");
    expect(html).not.toMatch(/scanline|brightness\(/);
    expect(html).toContain("--bezel:#3a3a42;--glass:#1e1e24;--bezel-line:#2a2a30");
    expect(html).toContain(`.chip-s.ok{background:${LANDING_TOKENS.PILL_OK[0]};color:${LANDING_TOKENS.PILL_OK[1]}}`);
    expect(html).toContain(`.chip-s.warn{background:${LANDING_TOKENS.PILL_WARN[0]};color:${LANDING_TOKENS.PILL_WARN[1]}}`);
    expect(html).toContain(`.chip-s.fail{background:${LANDING_TOKENS.PILL_FAIL[0]};color:${LANDING_TOKENS.PILL_FAIL[1]}}`);
    expect(html).toContain(`.chip-s.skip{background:${LANDING_TOKENS.PILL_SKIP[0]};color:${LANDING_TOKENS.PILL_SKIP[1]}}`);
    expect(html).toContain('@media (max-width:479px){.tube-wrap{display:none}');
    expect(html).toContain(".row{display:grid;grid-template-columns:auto 1fr;");
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1">');
    // The tube's fixed colours are the tokens'.
    expect(html).toContain(`stroke="${ACCENT}" stroke-width="2" stroke-dasharray="4 3"`);
  });

  it("stays under 32 KB rendered, with the marks, a full report and the providers (N-25)", () => {
    const html = page({ doctor: TROUBLED });
    expect(Buffer.byteLength(html)).toBeLessThanOrEqual(32 * 1024);
    expect(Buffer.byteLength(page({ doctor: HEALTHY }))).toBeLessThanOrEqual(32 * 1024);
  });

  it("repeats the overlay's tokens exactly (packages/overlay/src/tokens.ts; PRD-polish decision 7) (F-112, F-114)", () => {
    expect(LANDING_TOKENS.INK).toBe(INK);
    expect(LANDING_TOKENS.ACCENT).toBe(ACCENT);
    expect(LANDING_TOKENS.GLASS).toBe(GLASS);
    expect(LANDING_TOKENS.OK).toBe(OK);
    expect(LANDING_TOKENS.WARN).toBe(WARN);
    expect(LANDING_TOKENS.DANGER).toBe(DANGER);
    expect(LANDING_TOKENS.PILL_WARN).toEqual(EXPERIMENTAL);
    expect(LANDING_TOKENS.PILL_OK).toEqual(PILL.task);
    expect(LANDING_TOKENS.PILL_FAIL).toEqual(PILL.error);
    // The PRD's values for the chips (§5.2), spelled out so a token change is a visible decision.
    expect(LANDING_TOKENS.PILL_WARN).toEqual(["#fff3cd", "#7a5200"]);
    expect(LANDING_TOKENS.PILL_OK).toEqual(["#d9f5e3", "#0a5b2b"]);
    expect(LANDING_TOKENS.PILL_FAIL).toEqual(["#fde2e2", "#8b0000"]);
    expect(LANDING_TOKENS.PILL_SKIP).toEqual(["#eee", "#555"]);
  });

  it("escapes what it interpolates (F-114)", () => {
    const html = page({ projectRoot: "C:\\<app>&\"co\"", app: "http://localhost:3100/?a=<b>", version: "0.6.0<x>" });
    expect(html).toContain("<title>CRT 0.6.0&lt;x&gt;</title>");
    expect(html).toContain('title="C:\\&lt;app&gt;&amp;&quot;co&quot;"');
    expect(html).toContain('href="http://localhost:3100/?a=&lt;b&gt;"');
    expect(html).not.toContain("<app>");
  });
});
