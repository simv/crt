/**
 * The landing page (PRD-polish F-114, §5.2; amends PRD-embedded F-91): what every non-/__crt/
 * request gets in embedded mode and what `GET /__crt/` serves in both modes — a status page.
 * Server-rendered and complete without JavaScript; one inline `<script>` enhances it and fetches
 * only `/__crt/health`, `/__crt/providers` (`?refresh=1` on Re-check, F-56), `/__crt/doctor` and
 * `/__crt/doctor?plugin=1` (N-23), on load, on **Re-check** and on `visibilitychange` — never on a
 * timer (PRD-setup §3 stands).
 *
 * Sections, top to bottom: the header (the mark, `CRT <version>`, the mode + project chip), the
 * hero (the kicker `This is the CRT server — not your app.` and one of three states: the app known,
 * no app, the app known but its page never loaded the CRT loader — plus the proxy-mode line at
 * `/__crt/`), the tube that powers on once per load, **Attention** (only when the doctor has a `FAIL`
 * or `warn` row), the three loop cards, **Checkup** (problems first, each with a copy button on its
 * command; the passes collapsed in a `<details>`; the decision line; `checked at HH:MM`; Re-check;
 * a `<noscript>` line naming `crt doctor`), **This server**, **In Claude Code** and the footer.
 *
 * The doctor rows come from doctor-route.ts: when that route has already answered once, the page
 * renders its last report as served (the server never computes one for the page, N-24); otherwise
 * the Checkup waits for the script. `renderRows` here and `rows()` in the script build the same
 * markup — the e2e (landing.spec.ts) checks the script's rows against the route's JSON, the unit
 * rows (test/landing.test.ts) check this side.
 *
 * Look: the overlay's tokens (`LANDING_TOKENS`, repeated from packages/overlay/src/tokens.ts — the
 * server never imports overlay source; test/landing.test.ts pins them equal), the tinted pills
 * for the chips (AA on both themes), dark mode by `prefers-color-scheme` with the tube's bezel
 * `#3a3a42` over glass `#1e1e24` and a 1 px line, `:focus-visible` = 2 px accent outline offset
 * 2 px on every control, a visually-hidden header row on the Checkup table, rows stacking under
 * 480 px, the tube ≤ 280 px and hidden under 480 px, the power-on by opacity ≤ 1.2 s and `none`
 * under `prefers-reduced-motion`. ≤ 32 KB rendered (N-25). The overlay is never mounted here.
 */
import type { DoctorPayload } from "./doctor-route.js";
import type { DoctorRow } from "./doctor.js";
import type { CrtMode } from "./init.js";
import type { ProviderStatus } from "./session.js";

/**
 * The overlay's colours this page uses (PRD-polish §5.1 decision 7): `packages/overlay/src/tokens.ts`
 * repeated, because the server never imports overlay source at runtime. test/landing.test.ts pins
 * each value to the token it names. `SKIP` (the `--` chip) is the PRD's own pair — the overlay has
 * no such state.
 */
export const LANDING_TOKENS = {
  /** tokens.INK */
  INK: "#111",
  /** tokens.ACCENT */
  ACCENT: "#ff3d71",
  /** tokens.GLASS */
  GLASS: "#2b2b31",
  /** tokens.OK, tokens.WARN, tokens.DANGER: the provider dots. */
  OK: "#2e9e5b",
  WARN: "#e0a800",
  DANGER: "#d7263d",
  /** tokens.EXPERIMENTAL — the `warn` chip. */
  PILL_WARN: ["#fff3cd", "#7a5200"],
  /** tokens.PILL.task — the `ok` chip. */
  PILL_OK: ["#d9f5e3", "#0a5b2b"],
  /** tokens.PILL.error — the `FAIL` chip. */
  PILL_FAIL: ["#fde2e2", "#8b0000"],
  /** PRD-polish §5.2 — the `--` chip. */
  PILL_SKIP: ["#eee", "#555"],
} as const;

/** The docs link in the footer: a navigation, never fetched (N-23). */
export const DOCS_URL = "https://github.com/simv/crt#readme";

export interface LandingOptions {
  version: string | null;
  sdkVersion: string | null;
  mode: CrtMode;
  projectRoot: string;
  /** The app URL (embedded: what CRT opens; proxy: the target); null when none is known (F-91). */
  app: string | null;
  /** Proxy mode: the CRT origin the visitor is browsing through (the request's Host); the page says so and links it. */
  crtOrigin?: string | null;
  tasks: number;
  backlog: number;
  startedAt: string | null;
  /** `process.platform`: `darwin` renders `Cmd`, everything else `Ctrl`. */
  platform: string;
  /** The inline marks (marks.ts: docs/brand/crt-mark.svg, -dark, -small): light, dark, and the ≤ 24 px one for the mobile header. */
  mark: string;
  markDark: string;
  markSmall: string;
  /** F-94: CRT opened the app and its page never asked for the loader — the third hero state. */
  loaderMissing?: boolean;
  /** Intake sessions open right now. */
  sessions?: number;
  /** The registry's rows and the resolved provider, when the server has one (the agent's name in card 2, the lines in This server). */
  providers?: { active: string; rows: ProviderStatus[] } | null;
  /** The doctor route's last report, if any — rendered as served, never computed for the page. */
  doctor?: DoctorPayload | null;
  /** The clock for "up … min" (tests). */
  now?: Date;
}

export function renderLanding(o: LandingOptions): string {
  const T = LANDING_TOKENS;
  const title = `CRT${o.version ? ` ${o.version}` : ""}`;
  const proxy = o.mode === "proxy";
  const mod = o.platform === "darwin" ? "Cmd" : "Ctrl";
  const agent = o.providers?.rows.find((r) => r.id === o.providers?.active)?.displayName ?? "the agent";
  const now = o.now ?? new Date();
  const problems = o.doctor ? problemRows(o.doctor.rows) : [];

  const hero = proxy
    ? [
        `<h1>You are browsing your app through CRT at <code>${escapeHtml(host(o.crtOrigin ?? ""))}</code>.</h1>`,
        `<p class="lead">Look for the CRT button bottom-right on any page: that is where you annotate, chat and file tasks.</p>`,
        ...(o.crtOrigin ? [`<a class="btn" id="open" href="${escapeHtml(o.crtOrigin)}/">Open ${escapeHtml(o.crtOrigin)} <span aria-hidden="true">↗</span></a>`] : []),
        `<p class="hint" id="hint"><kbd>${mod}</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd> toggles the toolbar on your page</p>`,
      ]
    : o.app
      ? [
          `<h1>Your app is at <code>${escapeHtml(host(o.app))}</code></h1>`,
          `<p class="lead">Open it and look for the CRT button bottom-right: that is where you annotate, chat and file tasks.</p>`,
          `<a class="btn" id="open" href="${escapeHtml(o.app)}">Open ${escapeHtml(o.app)} <span aria-hidden="true">↗</span></a>`,
          o.loaderMissing
            ? `<p class="hint" id="hint" data-state="missing">Your page has no CRT integration yet — <code>crt init</code> prints the snippet.</p>`
            : `<p class="hint" id="hint"><kbd>${mod}</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd> toggles the toolbar on your page</p>`,
        ]
      : [
          `<h1>No dev server found yet.</h1>`,
          `<p class="lead">Start yours and open it — the CRT button appears on any localhost page with the CRT integration.</p>`,
          `<p class="hint" id="hint"><code>crt 3000</code> remembers it.</p>`,
        ];

  const lines = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escapeHtml(title)}</title>`,
    '<link rel="icon" href="/__crt/favicon.svg">',
    `<style>${css(T)}</style>`,
    "</head>",
    `<body data-mod="${mod}">`,
    '<div class="wrap">',
    "<header>",
    `<span class="mark mark-l">${inlineSvg(o.mark, "ml")}</span><span class="mark mark-d">${inlineSvg(o.markDark, "md")}</span><span class="mark mark-s">${inlineSvg(o.markSmall, "ms")}</span>`,
    `<span class="name">CRT${o.version ? ` <span class="ver">${escapeHtml(o.version)}</span>` : ""}</span>`,
    '<span class="spacer"></span>',
    `<span class="chip" title="${escapeHtml(o.projectRoot)}"><i class="dot ok"></i>${o.mode} · <span class="path">${escapeHtml(o.projectRoot)}</span></span>`,
    "</header>",
    '<section class="hero">',
    "<div>",
    '<p class="kicker">This is the CRT server — not your app.</p>',
    ...hero,
    "</div>",
    `<div class="tube-wrap"><div class="tube" aria-hidden="true">${tube(T)}</div></div>`,
    "</section>",
    `<section class="attention card" id="attention"${problems.length ? "" : " hidden"}>`,
    "<h2>Attention</h2>",
    `<div id="attention-rows">${problems.length ? renderTable(problems, true) : ""}</div>`,
    "</section>",
    '<section class="steps" aria-label="The loop">',
    '<div class="step"><span class="n" aria-hidden="true">1</span><div><b>Point at the problem</b><span>Select an element, box an area or pin a spot on your page, and write a note.</span></div></div>',
    `<div class="step"><span class="n" aria-hidden="true">2</span><div><b>Talk it through in the page</b><span>Send opens a chat with <span id="agent">${escapeHtml(agent)}</span> right there; it reads the capture and your code.</span></div></div>`,
    '<div class="step"><span class="n" aria-hidden="true">3</span><div><b>Get a task file</b><span>It lands in <code>.crt/tasks</code>; any session picks it up with <code>/crt:next</code>.</span></div></div>',
    "</section>",
    '<section class="grid">',
    '<div class="card checkup">',
    '<h2>Checkup <span class="right"><span id="checked">' + (o.doctor ? `checked at ${escapeHtml(hhmm(new Date(o.doctor.checkedAt)))}` : "") + '</span> <button type="button" id="recheck">Re-check</button></span></h2>',
    "<noscript><p>Run <code>crt doctor</code> in a terminal for this checklist.</p></noscript>",
    `<div id="rows">${o.doctor ? renderRows(o.doctor) : ""}</div>`,
    "</div>",
    "<div>",
    '<div class="card">',
    "<h2>This server</h2>",
    "<dl>",
    `<dt>Version</dt><dd>${escapeHtml(o.version ?? "?")}${o.sdkVersion ? ` <span class="mono muted">agent sdk ${escapeHtml(o.sdkVersion)}</span>` : ""}</dd>`,
    `<dt>Up since</dt><dd id="since">${o.startedAt ? escapeHtml(since(o.startedAt, now)) : "—"}</dd>`,
    `<dt>Project</dt><dd class="mono">${escapeHtml(o.projectRoot)}</dd>`,
    `<dt>Tasks</dt><dd id="tasks">${count(o.tasks)} in <span class="mono">.crt/tasks</span> · ${count(o.backlog)} in backlog</dd>`,
    `<dt>Sessions</dt><dd id="sessions">${count(o.sessions ?? 0)} running</dd>`,
    "</dl>",
    `<ul class="agents" id="agents">${o.providers ? o.providers.rows.map((r) => providerLine(r, o.providers!.active)).join("") : ""}</ul>`,
    "</div>",
    '<div class="card">',
    "<h2>In Claude Code</h2>",
    "<dl>",
    "<dt><code>/crt:tasks</code></dt><dd>what is outstanding</dd>",
    "<dt><code>/crt:next</code></dt><dd>take the next task to a PR</dd>",
    "<dt><code>/crt:serve</code></dt><dd>start or reuse this server</dd>",
    "</dl>",
    "</div>",
    "</div>",
    "</section>",
    "<footer>",
    `<span><kbd>${mod}</kbd>+<kbd>C</kbd> in the terminal stops CRT; your dev server keeps running.</span>`,
    "<span>Run <code>crt init</code> for the one-line snippet for your framework, or <code>crt proxy</code> to proxy your app instead.</span>",
    `<a href="${DOCS_URL}" id="docs">Docs <span class="muted">(github.com ↗)</span></a>`,
    "</footer>",
    "</div>",
    `<script>${script()}</script>`,
    "</body>",
    "</html>",
    "",
  ];
  return lines.join("\n");
}

/** Three SVGs share one document: prefix their ids (`id="a"`, `url(#a)`) so the clip paths stay their own. */
function inlineSvg(svg: string, prefix: string): string {
  return svg.replace(/\bid="([^"]+)"/g, (_m, id: string) => `id="${prefix}-${id}"`).replace(/url\(#([^)]+)\)/g, (_m, id: string) => `url(#${prefix}-${id})`);
}

/** The FAIL rows, then the warn rows, each group in the doctor's order. */
function problemRows(rows: DoctorRow[]): DoctorRow[] {
  return [...rows.filter((r) => r.status === "FAIL"), ...rows.filter((r) => r.status === "warn")];
}

/** A count for the page: a whole non-negative number, or 0 — never anything but digits. */
function count(n: number): string {
  return Number.isFinite(n) && n > 0 ? String(Math.trunc(n)) : "0";
}

/** `http://localhost:3100` → `localhost:3100`; anything unparseable as written. */
function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** `09:12 · 41 min` — the start time and how long ago (hours past the first). */
function since(startedAt: string, now: Date): string {
  const start = new Date(startedAt);
  if (Number.isNaN(start.getTime())) return startedAt;
  const min = Math.max(0, Math.round((now.getTime() - start.getTime()) / 60_000));
  return `${hhmm(start)} · ${min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`}`;
}

/**
 * The command a doctor detail ends with, for the copy button: the last ` — ` segment with a leading
 * `run ` dropped, a backticked word preferred (`run \`claude\` in a terminal …` → `claude`); null when
 * that segment does not start with a CLI (`… — not responding`). The script repeats this.
 */
export function commandOf(detail: string): string | null {
  const i = detail.lastIndexOf(" — ");
  if (i === -1) return null;
  const tail = detail.slice(i + 3).trim();
  const tick = /`([^`]+)`/.exec(tail);
  const cmd = tick ? tick[1]! : tail.replace(/^run /, "");
  return /^(crt|codex|claude|gemini|agy|git|npm)\b/.test(cmd) ? cmd : null;
}

/** One `<li>` of This server's provider list: dot, display name, `ready · logged in · default` / `not logged in` / the problem. */
function providerLine(r: ProviderStatus, active: string): string {
  const tone = r.state === "ready" ? "ok" : r.state === "not on PATH" ? "skip" : "warn";
  const what = r.state === "ready" ? `ready · ${r.loggedIn === true ? "logged in" : r.loggedIn === false ? "not logged in" : "login unknown"}` : r.state;
  return `<li><i class="dot ${tone}"></i><span class="who">${escapeHtml(r.displayName)}</span><span class="what">${escapeHtml(what)}${r.id === active ? " · default" : ""}</span></li>`;
}

/** The status chips: a class per status; the text is the doctor's word. */
const CHIP: Record<DoctorRow["status"], string> = { ok: "ok", FAIL: "fail", warn: "warn", "--": "skip" };

function renderTable(rows: DoctorRow[], fixes: boolean): string {
  const body = rows
    .map((r) => {
      const cmd = fixes ? commandOf(r.detail) : null;
      return `<tr class="row"><td class="st"><span class="chip-s ${CHIP[r.status]}">${r.status}</span></td><td class="nm">${escapeHtml(r.name)}</td><td class="dt">${escapeHtml(r.detail)}</td><td class="cp">${cmd ? `<button type="button" class="copy" data-cmd="${escapeHtml(cmd)}">Copy</button>` : ""}</td></tr>`;
    })
    .join("");
  return `<table><thead class="sr"><tr><th>Status</th><th>Check</th><th>Detail</th><th>Fix</th></tr></thead><tbody>${body}</tbody></table>`;
}

/** The Checkup body for a report: problems first, the passes collapsed, the decision line. */
export function renderRows(d: DoctorPayload): string {
  const problems = problemRows(d.rows);
  const rest = d.rows.filter((r) => r.status === "ok" || r.status === "--");
  const passes = rest.filter((r) => r.status === "ok").length;
  return [
    problems.length ? renderTable(problems, true) : "",
    `<details class="passes"><summary>${passes} check${passes === 1 ? "" : "s"} pass — same rows as <code>crt doctor</code></summary>${renderTable(rest, false)}</details>`,
    `<p class="decision">${escapeHtml(d.decision)}</p>`,
  ].join("");
}

/** The tube: the mark's 4:3 superellipse as a screen with the CRT pill and a numbered selection on it. */
function tube(T: typeof LANDING_TOKENS): string {
  return [
    '<svg viewBox="0 0 160 120">',
    '<path class="bezel" d="M156 60C156 112.3 149.8 117 80 117C10.2 117 4 112.3 4 60C4 7.7 10.2 3 80 3C149.8 3 156 7.7 156 60Z"/>',
    '<path class="glass" d="M148 60C148 106.8 142.4 111 80 111C17.6 111 12 106.8 12 60C12 13.2 17.6 9 80 9C142.4 9 148 13.2 148 60Z"/>',
    `<rect x="30" y="30" width="44" height="28" rx="2" fill="none" stroke="${T.ACCENT}" stroke-width="2" stroke-dasharray="4 3"/>`,
    `<circle cx="74" cy="30" r="7" fill="${T.ACCENT}"/><path fill="#fff" d="M72.9 26h2.6v8h-2.6v-5.6h-2.3z"/>`,
    `<rect x="88" y="78" width="46" height="18" rx="9" fill="#fff"/><text x="97" y="91" font-family="system-ui,sans-serif" font-size="11" font-weight="700" fill="${T.INK}">CRT</text><circle cx="125" cy="87" r="3.5" fill="${T.OK}"/>`,
    "</svg>",
  ].join("");
}

function css(T: typeof LANDING_TOKENS): string {
  return [
    `:root{--bg:#f6f6f7;--panel:#fff;--ink:${T.INK};--muted:#6b6b73;--line:#e5e5ea;--code:#f1f1f4;--accent:${T.ACCENT};--ok:${T.OK};--warn:${T.WARN};--fail:${T.DANGER};--skip:#9a9aa3;--btn:${T.INK};--btn-ink:#fff;--bezel:${T.INK};--glass:${T.GLASS};--bezel-line:transparent}`,
    "@media (prefers-color-scheme: dark){:root{--bg:#0f0f12;--panel:#17171b;--ink:#f2f2f4;--muted:#9a9aa3;--line:#2a2a30;--code:#202026;--btn:#f2f2f4;--btn-ink:#111;--bezel:#3a3a42;--glass:#1e1e24;--bezel-line:#2a2a30}.mark-l{display:none!important}.mark-d{display:block!important}.mark-s path{fill:#f2f2f4}}",
    "*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,\"Segoe UI\",Roboto,sans-serif}",
    "code,.mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px}code{background:var(--code);padding:1px 6px;border-radius:5px}a{color:inherit}.muted{color:var(--muted)}",
    ".wrap{max-width:1040px;margin:0 auto;padding:20px 24px 40px}",
    "header{display:flex;align-items:center;gap:12px;padding:6px 0 22px}.mark{width:34px;height:34px;flex:none}.mark svg{width:100%;height:100%;display:block}.mark-d,.mark-s{display:none}",
    "header .name{font-weight:700;font-size:17px}header .ver{color:var(--muted);font-weight:500}header .spacer{flex:1}",
    ".chip{display:inline-flex;align-items:center;gap:6px;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;background:var(--code);color:var(--muted);max-width:50%;min-width:0;white-space:nowrap}.chip .path{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,Menlo,Consolas,monospace}",
    ".dot{width:8px;height:8px;border-radius:50%;background:var(--skip);flex:none;display:inline-block}.dot.ok{background:var(--ok)}.dot.warn{background:var(--warn)}.dot.fail{background:var(--fail)}",
    ".hero{display:grid;grid-template-columns:1.3fr 1fr;gap:28px;align-items:center;padding:8px 0 28px}.kicker{margin:0 0 8px;font-weight:600}.hero h1{font-size:32px;line-height:1.15;margin:0 0 10px;letter-spacing:-.3px}.hero h1 code{font-size:.85em;background:none;padding:0}.lead{margin:0 0 18px;color:var(--muted);max-width:46ch}",
    ".btn{display:inline-flex;align-items:center;gap:8px;padding:12px 18px;border-radius:12px;background:var(--btn);color:var(--btn-ink);font-weight:700;text-decoration:none;font-size:15px}.btn:hover{background:var(--accent);color:#fff}.hint{color:var(--muted);font-size:13px;margin:10px 0 0}",
    "kbd{font:600 11px/1 ui-monospace,Menlo,Consolas,monospace;padding:3px 6px;border-radius:5px;border:1px solid var(--line);background:var(--panel);color:var(--ink)}",
    ".tube-wrap{display:grid;place-items:center}.tube{width:100%;max-width:280px;aspect-ratio:4/3;animation:power-on 1.1s ease-out both}.tube svg{width:100%;height:100%;display:block}.bezel{fill:var(--bezel);stroke:var(--bezel-line);stroke-width:1}.glass{fill:var(--glass)}",
    "@keyframes power-on{from{opacity:0}to{opacity:1}}@media (prefers-reduced-motion: reduce){.tube{animation:none}}",
    ".steps{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:0 0 22px}.step{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px;display:flex;gap:14px;align-items:flex-start}.step .n{width:26px;height:26px;border-radius:13px;border:2px solid var(--accent);color:var(--ink);font-weight:700;font-size:13px;display:grid;place-items:center;flex:none}.step b{display:block;margin-bottom:2px}.step span{color:var(--muted);font-size:14px}",
    ".grid{display:grid;grid-template-columns:1.5fr 1fr;gap:14px;align-items:start}.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px}.card+.card{margin-top:14px}.card h2{font-size:14px;text-transform:uppercase;letter-spacing:.6px;color:var(--muted);margin:0 0 12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}.card h2 .right{margin-left:auto;text-transform:none;letter-spacing:0;font-weight:500;font-size:12px;display:inline-flex;gap:8px;align-items:center}",
    ".attention{margin:0 0 22px;border-color:var(--warn)}.attention h2{color:var(--ink)}",
    "button{font:inherit;cursor:pointer}#recheck{color:var(--ink);background:var(--code);border:1px solid var(--line);border-radius:8px;padding:3px 10px;font-weight:600;font-size:12px}#recheck:hover{border-color:var(--ink)}.copy{color:var(--ink);background:var(--code);border:1px solid var(--line);border-radius:6px;padding:2px 8px;font-size:12px}.copy:hover{border-color:var(--ink)}",
    "table{width:100%;border-collapse:collapse}.row td{padding:7px 0;border-top:1px solid var(--line);vertical-align:top;font-size:14px}.row:first-child td{border-top:0}td.st{width:58px}td.nm{width:110px;font-weight:600;padding-right:8px}td.dt{color:var(--muted);overflow-wrap:anywhere}td.cp{width:60px;text-align:right}",
    `.chip-s{display:inline-block;min-width:44px;text-align:center;padding:1px 7px;border-radius:999px;font-size:11px;font-weight:700;letter-spacing:.3px}.chip-s.ok{background:${T.PILL_OK[0]};color:${T.PILL_OK[1]}}.chip-s.warn{background:${T.PILL_WARN[0]};color:${T.PILL_WARN[1]}}.chip-s.fail{background:${T.PILL_FAIL[0]};color:${T.PILL_FAIL[1]}}.chip-s.skip{background:${T.PILL_SKIP[0]};color:${T.PILL_SKIP[1]}}`,
    ".passes{margin-top:10px}.passes summary{cursor:pointer;color:var(--muted);font-size:14px;padding:6px 0}.passes[open] summary{border-bottom:1px solid var(--line);margin-bottom:4px}.decision{margin:12px 0 0;padding-top:10px;border-top:1px solid var(--line);color:var(--muted);font-size:14px}#checked{color:var(--muted)}",
    ".sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}",
    "dl{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0;font-size:14px}dt{color:var(--muted)}dd{margin:0;overflow-wrap:anywhere}",
    ".agents{list-style:none;margin:10px 0 0;padding:10px 0 0;border-top:1px solid var(--line);font-size:14px}.agents:empty{display:none}.agents li{display:flex;gap:8px;align-items:center;padding:3px 0}.agents .who{font-weight:600;min-width:92px}.agents .what{color:var(--muted)}",
    "footer{margin-top:22px;color:var(--muted);font-size:13px;display:flex;gap:18px;flex-wrap:wrap;align-items:center}",
    ":focus-visible{outline:2px solid var(--accent);outline-offset:2px}",
    "@media (max-width:760px){.hero,.grid,.steps{grid-template-columns:1fr}.hero h1{font-size:26px}.wrap{padding:16px}.chip{max-width:100%}}",
    "@media (max-width:479px){.tube-wrap{display:none}.mark{width:20px;height:20px}.mark-l,.mark-d{display:none!important}.mark-s{display:block}.row{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;padding:7px 0;border-top:1px solid var(--line)}.row:first-child{border-top:0}.row td{display:block;padding:0;border:0;width:auto}td.dt{grid-column:1/-1}td.cp{text-align:left;grid-column:1/-1}header .spacer{display:none}header{flex-wrap:wrap}}",
  ].join("");
}

/**
 * The one inline script (F-114): on load, on Re-check and when the tab becomes visible, fetch
 * /__crt/health, /__crt/providers and /__crt/doctor (same origin, no timers), render, then
 * /__crt/doctor?plugin=1 for the slow row. Re-check asks /__crt/providers?refresh=1 first — the F-56
 * preflight, so a `codex login` since the last check is noticed — and only then the doctor rows.
 * Copy buttons use navigator.clipboard with a select-the-text fallback. Re-check names what changed
 * (Should). Plain ES5-ish for size; no library.
 */
function script(): string {
  return `(function(){
var d=document,ORD={FAIL:0,warn:1,ok:2,"--":3},CHIP={ok:"ok",FAIL:"fail",warn:"warn","--":"skip"},last=null,busy=false;
function $(id){return d.getElementById(id)}
function escapeHtml(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
function hhmm(t){var x=new Date(t);return (x.getHours()<10?"0":"")+x.getHours()+":"+(x.getMinutes()<10?"0":"")+x.getMinutes()}
function cmd(detail){var i=detail.lastIndexOf(" — ");if(i<0)return null;var t=detail.slice(i+3).trim(),m=/\`([^\`]+)\`/.exec(t),c=m?m[1]:t.replace(/^run /,"");return /^(crt|codex|claude|gemini|agy|git|npm)\\b/.test(c)?c:null}
function table(rows,fixes){var h='<table><thead class="sr"><tr><th>Status</th><th>Check</th><th>Detail</th><th>Fix</th></tr></thead><tbody>';rows.forEach(function(r){var c=fixes?cmd(r.detail):null;h+='<tr class="row"><td class="st"><span class="chip-s '+CHIP[r.status]+'">'+r.status+'</span></td><td class="nm">'+escapeHtml(r.name)+'</td><td class="dt">'+escapeHtml(r.detail)+'</td><td class="cp">'+(c?'<button type="button" class="copy" data-cmd="'+escapeHtml(c)+'">Copy</button>':"")+"</td></tr>"});return h+"</tbody></table>"}
function rows(p){var bad=p.rows.filter(function(r){return r.status==="FAIL"||r.status==="warn"}).sort(function(a,b){return ORD[a.status]-ORD[b.status]}),rest=p.rows.filter(function(r){return r.status==="ok"||r.status==="--"}),n=rest.filter(function(r){return r.status==="ok"}).length,open=$("rows").querySelector("details[open]");
$("rows").innerHTML=(bad.length?table(bad,true):"")+'<details class="passes"'+(open?" open":"")+'><summary>'+n+" check"+(n===1?"":"s")+' pass — same rows as <code>crt doctor</code></summary>'+table(rest,false)+'</details><p class="decision">'+escapeHtml(p.decision)+"</p>";
$("attention-rows").innerHTML=bad.length?table(bad,true):"";$("attention").hidden=!bad.length}
function diff(a,b){if(!a)return "";var out=[],m={};a.rows.forEach(function(r){m[r.name]=r.status});b.rows.forEach(function(r){if(m[r.name]!==undefined&&m[r.name]!==r.status)out.push(r.name+" "+m[r.name]+" → "+r.status)});return " · "+(out.length?out.join(", "):"no change")}
function doctor(p,before,named){last=p;rows(p);$("checked").textContent="checked at "+hhmm(p.checkedAt)+(named?diff(before,p):"")}
function health(h){$("sessions").textContent=h.sessions+" running";if(h.overlay&&(h.overlay.loader>0||h.overlay.fetched>0)){var hint=$("hint");if(hint&&hint.getAttribute("data-state")==="missing"){hint.removeAttribute("data-state");hint.innerHTML="<kbd>"+d.body.getAttribute("data-mod")+"</kbd>+<kbd>Shift</kbd>+<kbd>.</kbd> toggles the toolbar on your page"}}}
function providers(p){var h="";p.providers.forEach(function(r){var st=!r.installed?"not on PATH":r.loggedIn===false?"not logged in":r.problem===null?"ready":/too old/i.test(r.problem)?"too old":"unknown",tone=st==="ready"?"ok":st==="not on PATH"?"skip":"warn",what=st==="ready"?"ready · "+(r.loggedIn===true?"logged in":r.loggedIn===false?"not logged in":"login unknown"):st;h+='<li><i class="dot '+tone+'"></i><span class="who">'+escapeHtml(r.displayName)+'</span><span class="what">'+escapeHtml(what)+(r.id===p.active?" · default":"")+"</span></li>";if(r.id===p.active)$("agent").textContent=r.displayName});$("agents").innerHTML=h}
function get(u){return fetch(u,{credentials:"same-origin"}).then(function(r){if(!r.ok)throw new Error(u+" "+r.status);return r.json()})}
function check(named){if(busy)return;busy=true;$("recheck").disabled=true;var before=last;
var prov=get(named?"/__crt/providers?refresh=1":"/__crt/providers");
(named?prov:Promise.resolve()).then(function(){return Promise.all([get("/__crt/health"),prov,get("/__crt/doctor")])}).then(function(r){health(r[0]);providers(r[1]);doctor(r[2],before,named);return get("/__crt/doctor?plugin=1").then(function(p){doctor(p,before,named)})}).catch(function(e){$("checked").textContent="could not reach this server ("+e.message+")"}).then(function(){busy=false;$("recheck").disabled=false})}
function select(el){var s=window.getSelection(),r=d.createRange();r.selectNodeContents(el);s.removeAllRanges();s.addRange(r);try{d.execCommand("copy")}catch(e){}}
d.addEventListener("click",function(e){var b=e.target.closest&&e.target.closest(".copy");if(!b)return;var c=b.getAttribute("data-cmd"),done=function(){b.textContent="Copied"};if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(c).then(done,function(){select(b.parentNode.previousSibling);done()});else{select(b.parentNode.previousSibling);done()}});
d.addEventListener("focusout",function(e){if(e.target.classList&&e.target.classList.contains("copy"))e.target.textContent="Copy"});
$("recheck").addEventListener("click",function(){check(true)});
d.addEventListener("visibilitychange",function(){if(d.visibilityState==="visible")check(false)});
check(false);
})();`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
