# CRT v0.6 — Polish: brand, landing page, README — PRD

| | |
|---|---|
| **Status** | Planned — 2026-09-21; M20–M24 are `.crt/tasks/CRT-0024…0028` |
| **Owner** | Simon (simv) |
| **Repo** | https://github.com/simv/crt |
| **Baseline** | `main` at 973b30c = v0.5.0 + PRD-providers M19 (Antigravity, F-111, unreleased) |
| **Amends** | `docs/PRD-embedded.md` (F-91, F-100, F-107), `docs/PRD-setup.md` (F-76, F-78, F-80, F-88, N-16, N-17), `docs/PRD-providers.md` (F-62), `docs/PRD.md` (§8, §9, §11 README rows), `CLAUDE.md` — every amended statement is listed in §9 |
| **Design inputs** | `docs/brand/options/` (five logo directions, `contact-sheet.html`, generator `gen-logo.mjs`), `docs/design/landing-mockup.html` (the landing page concept), `docs/design/design-review-2026-09-21.md` (the design review this document adopts; where the two disagree, this document wins) |

This document extends `docs/PRD.md`, `docs/PRD-providers.md`, `docs/PRD-setup.md` and `docs/PRD-embedded.md`. Everything in the four stays in force unless §9 amends it. Requirement IDs continue the numbering (F-112…F-118, N-23…N-27, after PRD-providers F-111 / PRD-embedded N-22); milestones are M20–M24 (after PRD-providers M19), one task file each. A build session reads the four earlier PRDs, this file, the design review, `CLAUDE.md` and its task file, and nothing else, to know what "correct" means. §12 tells the builder what to do when GitHub's Markdown renderer, Playwright or a font differs from what this document assumes.

---

## 1. Problem and scope

CRT works, and nothing about it looks finished. Simon's findings (2026-09-21), after v0.5:

- **The README is the spec wearing a manual's clothes.** 620 lines; the Install block is right, and everything after it is reference prose: the `crt` ready-line paragraph alone is one 1,400-word paragraph, Production is one paragraph naming four layers and three verified bundlers, Providers is 200 lines of error lines quoted verbatim for a doc test. There is no picture of the product anywhere — the only figure is an ASCII diagram. Someone who wants to install and try it cannot see what they will get or find what to click. The reference must not be lost (PRD-setup F-88, PRD-providers F-62 and PRD-embedded F-107 pin those lines for a reason), but it does not belong on the first page.
- **The landing page is a paragraph.** `http://localhost:4400/` (PRD-embedded F-91) says the server is running and links to the app. Someone who lands there — the terminal printed the URL, the browser opened it from a proxy-mode habit, `crt doctor` said `port 4400 held by CRT` — gets no more than that: not whether the agent is logged in, not whether the app carries the integration, not what the tool does or what to do next. `crt doctor` already computes all of that; it is one terminal away and not on the page.
- **No mark.** The plugin, the npm page, the README and the launcher all say "CRT" in text. A tool that lives in the corner of the developer's own page should be recognisable there and on GitHub.

**Scope of v0.6.** (1) **A brand mark**: one geometry — the 4:3 tube-TV screen, a superellipse — with a small deliverable set (mark, small mark, lockup, dark variants, favicon) used in the README, the npm page and the landing page, and one token module the overlay and the page share. (2) **A landing page that is a status page**: the app link, the loop in three steps, the `crt doctor` rows live with their fixes and the problems first, this server's facts, the Claude Code skills; delightful, offline, same-origin. (3) **Reproducible screenshots and two illustrations.** (4) **A README for someone who wants to install**: short, with the screenshots and illustrations; every reference paragraph moved into `docs/` and every pinned line pinned again where it landed. (5) **Release 0.6.0**, which also ships M19 (Antigravity).

## 2. Goals

1. **Three minutes to understanding.** A newcomer reads the root README top to bottom and knows what to install, what to add to their app and what to click — and has seen the button, an annotation, the chat and the marker states before installing anything.
2. **Nothing pinned is lost.** Every string `packages/server/test/readme.test.ts` pins at the baseline is pinned again after the move; the tests read the file it moved to.
3. **The landing page answers three questions in one screen** — where is my app, is anything wrong, what do I do next — with the same row text as `crt doctor`, the problems first and the fix on each.
4. **One mark, four places**: README hero, npm README, landing page header and favicon. The launcher stays text in v0.6 (§13 open question 1) but the mark is built to fit it.
5. **Nothing new leaves the machine** (N-4, N-16, N-20): the landing page loads nothing from anywhere but the CRT origin and asks only `/__crt/*`; the doctor route cannot be triggered from another origin.

## 3. Non-goals (v0.6)

- **Redesigning the overlay** (toolbar, popovers, chat). Its tokens — ink `#111`, accent `#ff3d71`, system-ui, the black pill, the tinted status pills — are the brand's inputs; v0.6 only moves them into one module.
- **Putting the mark in the launcher.** The pill stays `CRT` + dot (F-64). Open question 1.
- **A docs site, a GIF or a video.** Static screenshots and SVG illustrations only; a recorded loop is Open question 2.
- **Changing what `crt doctor` checks or prints.** The landing page reuses its row text; the CLI output is unchanged (F-76, F-103).
- **Any telemetry, analytics, update check or "was this page useful" control.** None, as before — the README promises CRT never checks a registry, and the landing page keeps that promise.

## 4. Scenario changes

PRD §4 step 1 gains: *If Simon opens `http://localhost:4400` instead of his app, the page says where the app is, shows anything `crt doctor` would flag with the fix beside it, then the three steps of the loop; the mark in its corner is the one on the README.*

PRD §4 (before step 1) gains: *Simon found CRT on GitHub. The README showed him the button on a page, an annotation with its popover, the chat with a permission card, and the marker states from `thinking…` to a task ID, in five screenshots; the Install block was the first code he saw.*

## 5. Design

### 5.1 The mark and the tokens

One geometry: a **superellipse at 4:3** (|x/a|⁴ + |y/b|⁴ = 1 — the "squircle"), the shape of a tube-TV screen. `docs/brand/gen-logo.mjs` generates the five directions in `docs/brand/options/` (A Tube, B Sign-off, C Select, D Speak, E Monogram) and the contact sheet that renders each at 128 / 48 / 32 / 24 / 16 px, in the launcher pill, on light and on dark. The design review ranked them A › B › C › E › D and found no better sixth; the chosen direction is §13 decision 1. Whatever the direction, the review's rules apply:

- **Colour.** Ink `#111` on light; on dark the bezel is `#f2f2f4` and the glass stays `#2b2b31` (a second file, not a CSS variable — GitHub and npm render SVG as `<img>` and apply no page CSS). The accent `#ff3d71` appears once, in the badge, and never as the screen fill. No glass highlight: it vanishes below 48 px.
- **Geometry.** The final asset uses cubic Bézier corners (continuous curvature), not the 96-point polyline the generator emits. The badge is centred on the superellipse's edge (computed, not eyeballed) and carries a 2-unit ring in the background colour (`paint-order="stroke"`) so it separates from the bezel on both themes, like the launcher's count badge. Nothing thinner than 1/16 of the mark's height.
- **Small.** A separate `crt-mark-small.svg` for 24 px and below: `viewBox="0 0 16 16"`, whole-pixel coordinates, solid ink tube, no glass, a plain dot ≥ 3.5 px in place of the numeral. The numeral survives only at ≥ 48 px.
- **Files.** `docs/brand/crt-mark.svg`, `crt-mark-dark.svg`, `crt-mark-small.svg`, `crt-lockup.svg` and `crt-lockup-dark.svg` (mark + wordmark "CRT" as outlined paths — no font dependency), `favicon.svg` (the small variant with an in-SVG `@media (prefers-color-scheme: dark)` rule — the one file allowed a `<style>`, ≤ 2 KB) and, **Should**, `favicon-32.png` / `favicon-16.png` for browsers that ignore SVG favicons. Every SVG has a `viewBox`, no `width`/`height`, no external reference; ≤ 4 KB.
- **Served.** `GET /__crt/favicon.svg` (F-112) from the server so the landing page can link it; the file is copied into `dist/` at build time like `intake.md`. Only the landing page links it; the app's own favicon is never touched.
- **Tokens.** `packages/overlay/src/tokens.ts` exports the ink, the accent, the status greens/ambers/reds and the tinted pill pairs that `ui.ts` and `screenshot.ts` use today; both read from it. The landing page (server code) repeats the values and a unit test pins the two equal — the server never imports overlay source at runtime.
- **Usage.** Clear space one bezel width; the mark alone below 24 px, the lockup above; never recoloured beyond the two variants, never rotated. `docs/brand/README.md` states this in ten lines.

### 5.2 The landing page

Today's F-91 page becomes a status page (concept: `docs/design/landing-mockup.html`; the review's changes below supersede it). It is server-rendered HTML with one inline script, no external resource of any kind (N-23), and reads only `/__crt/health`, `/__crt/providers` and the new `GET /__crt/doctor` (F-113). It is complete without JavaScript; the script enhances.

Sections, top to bottom (the review's final order):

1. **Header** — the mark, `CRT <version>`, a chip with the mode and the project root (ellipsised; the full path is in This server).
2. **Hero** — the kicker `This is the CRT server — not your app.` in ink (for the by-accident visitor it is the most important line), then one of three states:
   - app known: `Your app is at <host:port>`, `Open it and look for the CRT button bottom-right: that is where you annotate, chat and file tasks.`, the **Open <app>** button; the hint `Ctrl+Shift+.` (`Cmd` on macOS — the server knows `process.platform`) `toggles the toolbar on your page`;
   - no app (`app: null`): `No dev server found yet.` / `Start yours and open it — the CRT button appears on any localhost page with the CRT integration.` / `` `crt 3000` remembers it. ``;
   - app known but the loader never fetched (health `overlay.loader` and `overlay.fetched` both 0 after CRT opened the app): the hint under **Open** reads `Your page has no CRT integration yet — \`crt init\` prints the snippet.`.
   In proxy mode (`/__crt/`): `You are browsing your app through CRT at <origin>.` A tube illustration beside the hero (≤ 280 px wide, hidden under 480 px) powers on once per load — never on Re-check — by opacity, ≤ 1.2 s, none under `prefers-reduced-motion`; no scanlines.
3. **Attention** — only when the doctor has a `FAIL` or `warn` row: those rows, each with its detail and a copy button on the command. A problem belongs before the tutorial.
4. **The loop** — three cards: Point at the problem / Talk it through in the page / Get a task file, one sentence each; the agent's live display name from `/__crt/providers` in card 2 (`Claude`, `Codex`, …); the chrome stays `CRT` (F-64).
5. **Checkup** — grouped by status: `FAIL` rows, then `warn` rows, each with the verbatim doctor detail and a copy button; then `N checks pass — same rows as \`crt doctor\`` as a `<details>` that expands to the `ok` and `--` rows in the doctor's order; the decision line; `checked at HH:MM`; a **Re-check** button; a `<noscript>` line: `Run \`crt doctor\` in a terminal for this checklist.` **Should:** Re-check names what changed.
6. **This server** — version and agent SDK version, up since, project, tasks (`N in .crt/tasks · M in backlog`), sessions running; then one line per provider with its state.
7. **In Claude Code** — `/crt:tasks`, `/crt:next`, `/crt:serve`, one clause each.
8. **Footer** — `Ctrl+C in the terminal stops CRT; your dev server keeps running.`, the F-91 sentence `Run \`crt init\` for the one-line snippet for your framework, or \`crt proxy\` to proxy your app instead.`, and `Docs (github.com ↗)` — a navigation link, never fetched.

**Where the facts come from.** Server-rendered: version, SDK version, mode, project, app URL, uptime, task counts, platform. Client-fetched, same origin only, on load, on **Re-check** and on `visibilitychange` (visible) — never on a timer (PRD-setup §3 stands): `/__crt/health` (sessions, `overlay`), `/__crt/providers` (names, states), `/__crt/doctor` and `/__crt/doctor?plugin=1`. Static: the steps, the skills, the footer.

**The doctor route** computes `doctorRows()` over facts gathered *inside the running server*: `mode` and the app URL from the server's own state (the `target` row probes the app once, 1.5 s), a new `port` fact `state: "self"` that renders `ok    port      4400 — this server` (the CLI's probe would find itself and print `FAIL … held by CRT`), the provider rows from the registry's last refresh, and node / project / `.crt` / integration / instructions from the machine as `crt doctor` does. It refuses any request that carries an `Origin` header (`403`, as `/__crt/internal/*` does) — the route spawns CLIs and a page on another port must not be able to trigger it; the landing page's own same-origin `fetch` carries none. The default response is computed at most once per 5 s (a later call within the window gets the cached result) and never includes the `plugin` row, whose fact spawns `claude plugin list --json` (up to 10 s): `?plugin=1` adds it, cached for 30 s, one spawn shared by concurrent callers (N-24). The page asks for the fast rows first and the plugin row second; `/` itself never waits on any of this. Nothing runs at server start; N-15 stands.

**Look.** The overlay's tokens (§5.1): ink `#111`, accent `#ff3d71`, the tinted pills for the chips (`#fff3cd`/`#7a5200` warn, `#d9f5e3`/`#0a5b2b` ok, `#fde2e2`/`#8b0000` FAIL, `#eee`/`#555` `--`) — the mockup's white-on-amber and white-on-green chips fail AA and are not used. Dark mode by `prefers-color-scheme`: bezel `#3a3a42` over glass `#1e1e24` with a 1 px line, never a white bezel. `:focus-visible` = `outline: 2px solid <accent>; outline-offset: 2px` on every control; the Checkup table has a visually-hidden header row; rows stack under 480 px. ≤ 32 KB rendered.

**Modes.** In embedded mode every non-`/__crt/` request still gets the page (F-91). `GET /__crt/` serves it in both modes, so proxy-mode users have it too; in proxy mode `/` stays the app.

### 5.3 Screenshots and illustrations

Five screenshots in `docs/images/`, PNG, light, 800 × 600 CSS px at DPR 2, taken by `npm run screenshots` against the e2e fixture app's `/shop` page and a `CRT_SESSION_STUB=1` embedded server so every image is reproducible (F-116):

> Amended 2026-09-22 (Simon, after M23; task CRT-0029): the viewport was 1280 × 800 and the page the fixture's `/app` playground. The screenshots now show the trial shop (the `tool-validation` app's home page) ported into the fixture as `/shop` — its markup and CSS, rendered with the fixture's React 18 dev build so the component names show — at 800 × 600, so everything is tighter. The port keeps N-27: a reviewer regenerates from this repo alone. Two small product changes came with it: a popover is clamped above the dock when the dock is in the lower half of the window (F-65's "inside the viewport", §9), and the stub names the component and source file the first message reports (§12 rule 4).

| File | Shows |
|---|---|
| `arrival.png` | The shop page with the CRT pill bottom-right and the first-visit welcome card |
| `select.png` | Select hovering an element: outline, tag/component label, one pinned marker with its popover and a note |
| `chat.png` | The popover as the chat: streamed text, a collapsed tool line, an **Allow / Deny** card (the stub scripts it) |
| `marker-states.png` | Three markers side by side: `thinking…`, `your turn`, `CRT-0007` |
| `landing.png` | The F-114 landing page on the stub server |

Determinism: a fixed clock, cleared storage, the stub's fixed session ids, `animations: "disabled"` on capture, waits on the overlay's own signals (`data-health`, the pill's `data-state`) rather than fixed sleeps over 500 ms (N-27). `docs/images/README.md` says how to regenerate; the script never runs in CI (pixel diffs flake).

Two illustrations, hand-drawn SVG on the brand geometry (the tube for the browser, the pill for the button, the badge for annotations), light and dark files, fixed colours (GitHub renders SVG through `<img>`, where `currentColor` is black — so no `currentColor`, no CSS variables), ≤ 10 KB each, used through `<picture>` (F-117): `loop.svg` (annotate → chat → task file → `/crt:next` → PR, one arrow back) and `architecture.svg` (the app on its own origin with loader and overlay ⇄ `127.0.0.1:4400` → agent → `write_task`; replaces the ASCII diagram on the front page).

### 5.4 The README, split in two

The root README becomes the front page (≤ 200 lines); the reference becomes eight pages under `docs/`. Nothing is deleted: a paragraph that moves keeps its wording, and the doc test that pins it reads the new file.

**Root README, in order** (the review's outline): title, pitch, `<picture>` lockup and `arrival.png`; Install (the PRD-embedded §4 block verbatim + two sentences); Add CRT to your app (the four snippets verbatim, one sentence on where each starts capturing, a link); The loop (`npm run dev` / `crt`, the steps with `select.png`, `chat.png`, `marker-states.png` and `loop.svg`, the landing page in one sentence with `landing.png`, the slash-command block); Production (two lines + the grep + a link); What lands in your repo (the five bullets); Providers (one table — agent, status, install, login — + link); Troubleshooting (`run crt doctor first`, the sample verbatim, `every failure is one crt: line; the catalogue is in docs/troubleshooting.md`); Docs index, Repository table, Develop in three lines, MIT. Line 3's "…Claude Code remains the default. The name is historical." and the line-5 version reference stay where the test indexes them (or the index moves with them).

| Section today | v0.6 |
|---|---|
| Install: "Other ways to install", the Windows note, "Older task files" | `docs/install.md` |
| Add CRT to your app: "where each one starts capturing", the loader paragraph; Production (layers, verified bundlers); Proxy mode | `docs/integration.md` |
| `crt` flags table, the "On success it prints …" paragraph; What Claude gets | `docs/cli.md` |
| Providers, entire | `docs/providers.md` |
| Task format | `docs/task-format.md` |
| How it works (with the ASCII diagram and the Privacy paragraph) | `docs/how-it-works.md` |
| Troubleshooting, everything after the doctor sample | `docs/troubleshooting.md` |
| Develop, Release, the Repository table, the PRD links | `docs/develop.md` |

Two server strings point at README sections and are pinned by tests and quoted in the docs: the F-80 line's `see README › Overlay does not appear` (`proxy.ts`) becomes `see docs/troubleshooting.md › Overlay does not appear`, and `crt init`'s footer `README › Production` becomes `docs/integration.md › Production` — both changed in the same PR as the move (§9).

The npm README (`packages/server/README.md`, ≤ 60 lines): title, pitch, the lockup by absolute `raw.githubusercontent.com` URL (the one image npm shows), the Install block (pinned), the four snippets (pinned), three "what you get" bullets, requirements, one screenshot, a docs link.

### 5.5 What changes where

| Path | Change |
|---|---|
| `packages/overlay/src/tokens.ts` (new), `ui.ts`, `screenshot.ts` | the token module; the two files read from it (M20) |
| `docs/brand/` | the seven brand files and `README.md`; `options/` and `gen-logo.mjs` stay as the record, with a "Final" row in the contact sheet (M20) |
| `packages/server/src/proxy.ts` | `GET /__crt/favicon.svg` (M20); `landingPage()` replaced by `landing.ts`, `GET /__crt/` (M21) |
| `packages/server/src/doctor.ts`, new `doctor-route.ts` | the `port: self` fact, the F-113 route, cooldown and plugin cache, the `Origin` refusal (M21) |
| `packages/server/src/landing.ts` (new) | the page: HTML, inline CSS and script as template strings; the three hero states; ≤ 32 KB rendered (M21) |
| `packages/server/e2e/screenshots.spec.ts` (or `scripts/screenshots.mjs`), root `package.json` `screenshots` | the F-116 pipeline over the e2e fixture and servers (M22) |
| `docs/images/` | five PNGs, four SVGs, `README.md` (M22) |
| `README.md`, `packages/server/README.md`, `docs/{install,integration,cli,providers,task-format,how-it-works,troubleshooting,develop}.md` | the split (M23) |
| `packages/server/test/readme.test.ts` → `docs.test.ts` | the same assertions, each pointed at the file its text moved to; link, image and length rows (M23) |
| `packages/server/src/init.ts`, `proxy.ts` (the F-80 line), their tests | the two `README › …` strings re-pointed (M23) |
| `.github/workflows/ci.yml` | the docs-only classifier narrowed: `docs/PRD*.md`, `docs/spikes/**`, `docs/brand/**`, `docs/design/**`, `docs/images/**` — the new `docs/*.md` pages are read by tests (M23) |
| `CLAUDE.md` | the read-line (this PR), Commands (`npm run screenshots`, M22), Don'ts (never hand-edit `docs/images/*.png`, M22), the CI line (M23), Release (M24) |

## 6. Functional requirements

**Must** = v0.6 DoD. **Should** = v0.6 if time allows, else later.

### 6.1 Brand

- **F-112 (Must) The mark and the tokens.** The files, geometry, colour and size rules of §5.1; `docs/brand/README.md`; `packages/overlay/src/tokens.ts` read by `ui.ts` and `screenshot.ts` (the overlay's rendered CSS is byte-identical before and after — a unit row). `GET /__crt/favicon.svg` serves `favicon.svg` (`image/svg+xml`, `cache-control: max-age=86400`, the F-6 CORS rules, `HEAD` allowed) in both modes; the build copies it into `dist/`. A unit test asserts each SVG parses with an `<svg>` root, has a `viewBox` and no `width`/`height` on the root, no `<text>`, `<image>`, `<script>`, `href` or `xlink:href`, no `<style>` except in `favicon.svg`, is under its budget (N-25), and that the dark files contain no `#111`. The contact sheet gains a "Final" row that inlines the final mark and its dark variant, with the dark variant in the pill cell (the real pill is always `#111`).

### 6.2 Landing page

- **F-113 (Must) `GET /__crt/doctor`.** Answers `200 application/json` `{ checkedAt: <ISO-8601>, rows: [{ status, name, detail }], decision, exitCode }` with the rows `doctorRows()` produces over in-process facts (§5.2): `port` is `{ status: "ok", name: "port", detail: "<port> — this server" }`, `target` probes the server's app URL (`--` when none is known, `warn` when it is down — the embedded rules of F-103), `mode` is the running mode, the provider rows come from the registry (`503` without one, like `/__crt/providers`); `plugin` is present only with `?plugin=1`, its fact cached for 30 s per server and shared by concurrent callers; the default response is cached for 5 s (N-24). Any request carrying an `Origin` header gets `403`; `HEAD` allowed; any other method `405`. `crt doctor` on the terminal is unchanged and does not use the route.
- **F-114 (Must) The landing page.** Served for every non-`/__crt/` request in embedded mode (F-91) and at `GET /__crt/` in both modes. Sections, states and copy per §5.2; the strings `This is the CRT server — not your app.`, `Open <app>` (when known), the F-91 `crt init` / `crt proxy` sentence, `<title>CRT <version></title>` and `<link rel="icon" href="/__crt/favicon.svg">` are present in the HTML as served; the mark is inlined (both variants, switched by `prefers-color-scheme`); `<noscript>` names `crt doctor`. One `<script>`, inline, that fetches only `/__crt/health`, `/__crt/providers`, `/__crt/doctor` and `/__crt/doctor?plugin=1` on load, on **Re-check** and on `visibilitychange` (visible); no timers. Copy buttons use `navigator.clipboard` with a select-the-text fallback and no library. Look, motion, contrast, focus and mobile rules per §5.2 (N-25). The overlay is never mounted on it (`#crt-host` absent). Tested: unit rows on the rendered HTML (the strings, the three hero states, exactly one `<script>` and no `src`, no `href`/`src`/`url(` to any origin but `/__crt/`, the app link and the docs anchor, the `<noscript>`, the size budget, the Attention block present exactly when a row is `FAIL`/`warn`); an e2e on the stub server that sees the Checkup rows equal `doctorRows(facts)` for the same facts, opens the passes `<details>`, clicks **Re-check** and counts the requests, asserts every request went to the CRT origin (N-23), asserts the tube's computed `animation-name` is `none` under `reducedMotion: "reduce"`, and tabs Open → Re-check → Docs with a visible outline; `/__crt/` serves the page on the proxy server too.

### 6.3 Screenshots and illustrations

- **F-116 (Must) Reproducible screenshots.** `npm run screenshots` starts the e2e fixture app and a `CRT_SESSION_STUB=1` embedded server on spare ports, drives the overlay through `window.__crt` and the page, and writes the five PNGs of §5.3 to `docs/images/`, each ≤ 400 KB (target 250 KB), at 1280 × 800 CSS px, DPR 2, light. It reuses the e2e fixture and server startup, runs by hand (documented in `CLAUDE.md` and `docs/images/README.md`), never in CI; a unit test asserts every image referenced from the README and docs exists and is under budget. The images are committed. The stub's script is extended minimally where a state is missing (an Allow/Deny card, the three marker states) without changing `CRT_SESSION_STUB=1`'s e2e behaviour (§12 rule 4).
- **F-117 (Should) Illustrations.** `docs/images/loop.svg`, `loop-dark.svg`, `architecture.svg`, `architecture-dark.svg` per §5.3, ≤ 10 KB each, fixed colours, used through `<picture>` in the README; the ASCII diagram lives in `docs/how-it-works.md` beneath the illustration.

### 6.4 README and docs

- **F-115 (Must) The front page and the reference.** The root README follows §5.4's outline, ≤ 200 lines; the eight pages exist under `docs/` with the moved text unchanged in wording, each opening with a one-line description and a link back to the README; the two `README › …` server strings are re-pointed with their tests; every relative link in `README.md`, `packages/server/README.md` and `docs/*.md` resolves to an existing file (and heading, where one is given); `docs.test.ts` carries every assertion `readme.test.ts` had at the baseline, re-pointed through a `section(file, heading)` helper (N-26), plus the link, image and length rows; the npm README follows §5.4's outline and budget with the lockup by absolute URL.

### 6.5 Release

- **F-118 (Must) Release 0.6.0.** Version `0.6.0` in `packages/server/package.json`, both plugin manifests and the seven skills' pin (`claude-review-tool@0.6`; `test/skill-pin.test.ts` green); the README's version reference; §9 rows applied; §10 ticked with evidence; the release notes name M19 (Antigravity) and M20–M23; `v0.6.0` tagged, the release workflow green, the staged version promoted on npm; `crt setup` from the published package installs `crt@crt 0.6.0`.

## 7. Non-functional requirements

- **N-23 Same-origin only.** The landing page references no resource — script, style, font, image, `fetch`, `<link>` — from any origin but the CRT server's own, with one exception: the docs link in the footer (`href` only, never fetched, labelled `github.com ↗`). A Playwright test listens to every request the page makes and fails on any other origin. The doctor route refuses any request with an `Origin` header.
- **N-24 Doctor on demand, bounded.** Nothing in F-113 runs at server start; `/` answers without waiting on it; the default response completes within 2 s on a warm machine (its slowest fact is the 1.5 s target probe) and is computed at most once per 5 s; the plugin spawn happens only for `?plugin=1`, at most once per 30 s per server; concurrent requests share one computation.
- **N-25 Size, motion, contrast.** Mark files ≤ 4 KB, favicon ≤ 2 KB (PNG favicons ≤ 2 KB each), illustrations ≤ 10 KB, screenshots ≤ 400 KB each; landing HTML ≤ 32 KB; the power-on animation ≤ 1.2 s, once per load, by opacity, disabled under `prefers-reduced-motion`; WCAG AA contrast (4.5:1 text, 3:1 chips and focus rings) in light and dark, checked by an accessibility pass recorded in the task Log.
- **N-26 Nothing pinned is lost.** Every `expect` in `test/readme.test.ts` at the baseline commit survives in `test/docs.test.ts` with the same expected string and only the source file changed; a script in the M23 Log compares the two lists.
- **N-27 Reproducible images.** A reviewer runs `npm run screenshots` on `main` and gets images that differ from the committed ones only by font rasterisation; the script pins the viewport, DPR, the fixture page, the clock, the stub's script and the overlay state it drives, and waits on the overlay's own signals, never on fixed sleeps over 500 ms.

## 8. Milestones

Each milestone is one task file. DoD items are **worker-checkable** unless marked **Manual**; by the standing rule of 2026-09-18 the worker session runs the Manual rows itself (trial app, browser, `npm pack` tarball) and involves Simon only on a failure or when a step is user-only. Order: M20 → M21 → M22 → M23 → M24. M21 needs M20 (the mark, the favicon route, the tokens). M22 needs M20 (the tokens for the illustrations) and, for `landing.png`, M21 — M21 and M22 may run in parallel if M22 leaves `landing.png` to M23. M23 needs M20–M22. M24 needs all.

**M20 — The mark and the tokens (`.crt/tasks/CRT-0024`).** F-112, N-25 (files). Deliver the seven brand files from the chosen direction (§13 decision 1) with the review's fixes, `docs/brand/README.md`, `tokens.ts`, the favicon route, the build copy, the SVG unit test, the contact sheet's Final row. DoD: `npm run check` green; the overlay CSS byte-identical (unit row); `GET /__crt/favicon.svg` answers on the e2e stub server; the Final row re-rendered on light and dark at DPR 1 and 2 (**Manual**, screenshots in the Log); the small mark reads in Chromium's tab strip at 16 px (**Manual**).

**M21 — Landing page and doctor route (`.crt/tasks/CRT-0025`).** F-113, F-114, N-23, N-24, N-25 (page). Depends on M20. DoD: unit rows for the route (self port row, target rows, plugin gating, 30 s and 5 s caches, `Origin` → 403, 503 without registry, 405, `checkedAt`) and the page (F-114's list); `e2e/landing.spec.ts` green; `embedded.spec.ts`'s F-91 assertions updated per §9 and green; the mockup in `docs/design/` replaced by a note pointing at `landing.ts`; **Manual**: on the trial app with a real Claude login, the three hero states (app up; app down; loader never fetched with the integration removed), the Attention block after `codex logout`, the plugin row arriving after the fast rows, dark mode, keyboard order, the accessibility pass — screenshots in the Log.

**M22 — Screenshots and illustrations (`.crt/tasks/CRT-0026`).** F-116, F-117, N-27, the `CLAUDE.md` Commands and Don'ts lines. Depends on M20 (and M21 for `landing.png`). DoD: `npm run screenshots` writes the five PNGs from a clean checkout and a second run differs only by rasterisation (Log); budgets enforced by the unit row; the four SVGs render on GitHub light and dark (**Manual**: a gist or the PR's file view in both themes, screenshots in the Log); `docs/images/README.md` says how to regenerate; `npm run e2e` still green.

**M23 — README front page and the docs split (`.crt/tasks/CRT-0027`).** F-115, N-26, the two `README › …` strings, `ci.yml`, the `CLAUDE.md` CI line. Depends on M20–M22. DoD: root README ≤ 200 lines with the lockup, the five screenshots and `loop.svg`; the eight docs pages; `docs.test.ts` green with every baseline assertion present (the comparison script in the Log); links resolve; `crt init`'s footer and the F-80 line re-pointed with their tests; the classifier narrowed; **Manual**: the PR branch's README on github.com in light and dark, screenshots in the Log.

**M24 — Release 0.6.0 (`.crt/tasks/CRT-0028`).** F-118, the §9 rows not yet applied, §10 evidence. Depends on M20–M23. DoD: versions and pins `0.6.0` / `@0.6`; `v0.6.0` tagged; the release workflow green; promoted on npm (**Manual (Simon)** — the one user-only step); `crt setup` from a clean `npm i -g claude-review-tool@0.6.0` installs the plugin; the npm page shows the lockup and the Install block; every §10 row ticked with evidence.

## 9. Amendments to the earlier PRDs and `CLAUDE.md`

| Statement | v0.6 |
|---|---|
| PRD F-65 "inside the viewport" | inside the viewport and above the dock: when the toolbar is open in the lower half of the window, the popover is clamped above it (at 600 px a chat popover would otherwise end under the toolbar) — CRT-0029. |
| PRD-embedded F-91 "a landing page that says, in plain words … and nothing else (no scripts)" | the F-114 page: the same sentences (the kicker now reads `This is the CRT server — not your app.`), the app link, plus Attention, the loop, Checkup and this server's facts; one inline script, same-origin only (N-23). The e2e/unit assertions `not.toMatch(/<script/)` become "exactly one inline `<script>` and no `src`". |
| PRD-embedded F-100 `crt init` footer "Production builds contain nothing from CRT (README › Production)" | "… (docs/integration.md › Production)" (M23). |
| PRD-embedded F-107 "README quotes every new line (doc test)" | the line is quoted in the README **or** in the `docs/` page the section moved to (§5.4); `docs.test.ts` is the doc test. |
| PRD-setup F-80 line "… see README › Overlay does not appear" | "… see docs/troubleshooting.md › Overlay does not appear" (M23; the line stays one line, N-17). |
| PRD-setup F-88 / N-17 "quoted in the README verbatim" | README or `docs/troubleshooting.md` / `docs/cli.md`. |
| PRD-providers F-62 / §10 "every N-7 provider line verbatim in the Providers section" | in `docs/providers.md`; the README keeps the providers table. |
| PRD-setup F-76 `crt doctor` | unchanged on the terminal; its row text is also served by F-113 with the in-process differences named there (`port … — this server`). |
| PRD-setup F-78 health | unchanged; the landing page reads it. |
| PRD-setup N-16 "No new network" | the landing page and F-113 add none: same-origin fetches and the existing localhost target probe (N-23, N-24). |
| PRD F-64 "product chrome stays CRT" | holds on the landing page: the agent's display name appears in the loop card and the provider rows, the chrome says CRT. |
| PRD §8 "Setup experience", §9 repository layout, §11 rows naming "README" | the README front page keeps the §8 block; the reference rows point at `docs/`. |
| CLAUDE.md "Read `docs/PRD.md`, … and `docs/PRD-embedded.md`" | "… `docs/PRD-embedded.md` and `docs/PRD-polish.md`" (applied in the PR that adds this document). |
| CLAUDE.md Commands | gains `npm run screenshots` (M22); the CI docs-only line lists the narrowed docs paths (M23). |
| CLAUDE.md Conventions | "Overlay colours come from `packages/overlay/src/tokens.ts`; the landing page repeats them and a test pins the two equal" (M20). |
| CLAUDE.md Don'ts | gains "Don't hand-edit `docs/images/*.png` — `npm run screenshots` regenerates them" (M22). |
| CLAUDE.md Release | gains "re-run `npm run screenshots` when the overlay's UI changed since the last release" (M24). |

## 10. Definition of done (v0.6)

Ticked by M24 with evidence (test name, e2e spec, task Log entry or run URL).

- [ ] The seven brand files exist, pass the SVG unit test, `tokens.ts` feeds the overlay with its CSS unchanged, and `GET /__crt/favicon.svg` serves the favicon (M20).
- [ ] `http://localhost:4400/` on the trial app shows the app link, Attention when a row fails, the Checkup with passes collapsed, this server's facts and the three steps; `/__crt/` shows it in proxy mode; every request the page makes is same-origin (`e2e/landing.spec.ts`, M21 Manual).
- [ ] `GET /__crt/doctor` answers within 2 s without `?plugin=1`, refuses an `Origin`, caches 5 s / 30 s (unit rows, M21).
- [ ] `npm run screenshots` reproduces the five committed PNGs; the four SVGs render on GitHub in both themes (N-27, M22).
- [ ] The root README is ≤ 200 lines with the lockup, five screenshots and the loop illustration; the npm README ≤ 60 lines; every relative link resolves (M23, doc tests).
- [ ] Every assertion of the baseline `readme.test.ts` survives in `docs.test.ts` (N-26, M23 Log).
- [ ] The README renders on GitHub in light and dark with the lockup switching (M23 Manual).
- [ ] CI green on `main`; `v0.6.0` tagged, published and promoted; the GitHub Release names M19–M23; the npm page shows the lockup (M24).

## 11. Risks

- **Screenshots go stale as the overlay changes.** Mitigation: F-116 makes them one command; the Release line in `CLAUDE.md` says when to re-run; the image-existence test catches a renamed file.
- **GitHub renders SVG through `<img>`: no CSS, no dark-mode variables, `currentColor` is black.** Mitigation: separate light and dark files and `<picture>` with `prefers-color-scheme` (F-115, F-117); colours fixed in the files.
- **A browser-triggered route that spawns CLIs.** Mitigation: F-113 refuses `Origin`, caches 5 s and 30 s, gates the spawn behind `?plugin=1`; `/` never waits on it (N-24).
- **The doc test split silently drops a pinned line.** Mitigation: N-26 and the M23 DoD row that diffs the assertion lists.
- **The landing page grows into a dashboard.** Mitigation: §3 non-goals, the 32 KB budget, no timers, no routes beyond F-113.
- **16 px legibility on Windows Chromium.** Mitigation: the pixel-snapped small mark (§5.1) and the M20 Manual row.
- **Font rasterisation makes screenshot diffs noisy.** Mitigation: N-27 accepts rasterisation differences; the script pins everything else.

## 12. Verification protocol for the builder

1. **GitHub does not render `<picture>` in a README** (it does today, inside HTML blocks): fall back to a single light-mode lockup on a transparent background that reads on both themes; note it in the Log.
2. **npm strips or blocks the image**: keep the absolute URL (npm allows `raw.githubusercontent.com`); if it still fails, the npm README goes without the lockup and says so in the Log.
3. **Playwright's Chromium rasterises fonts differently from Simon's**: accepted by N-27; do not add a pixel diff.
4. **The stub provider cannot produce the state a screenshot wants** (`chat.png`'s permission card, `marker-states.png`): extend the stub's script in `providers/stub.ts` minimally rather than faking the DOM; keep `CRT_SESSION_STUB=1`'s e2e behaviour unchanged.
5. **`claude plugin list --json` is slow or absent on the machine**: the plugin row shows `--    plugin    claude not on PATH — skipped` or the `warn` with the error, as `crt doctor` does; never block the fast rows.
6. **A moved paragraph no longer reads well out of context**: add a one-line lead-in above it in the docs page; never change the pinned sentence.
7. **Browsers ignore the SVG favicon** (Safari): the Should PNGs of F-112 are the answer; do not add an `.ico` route.

## 13. Decisions taken and open questions

**Decisions** (the builder does not revisit these):

1. **The mark's direction: A (Tube)** — Simon's pick, 2026-09-21, from `docs/brand/options/` (the design review's first choice). The review's fixes (§5.1) apply.
2. The mark's geometry is the 4:3 superellipse; ink / dark bezel / accent only; the accent is the badge, never the screen; no glass highlight; a pixel-snapped small variant for ≤ 24 px.
3. The landing page is server-rendered with one inline script and no timers; complete without JavaScript; the doctor rows come from a route, not from the CLI's output; the row text is the doctor's verbatim, the order is by status with passes collapsed.
4. The doctor route refuses any request carrying an `Origin` header, computes at most once per 5 s, and spawns the plugin check only on `?plugin=1`, cached 30 s.
5. The reference moves to eight `docs/` pages and stays pinned; the root README has a 200-line budget.
6. Screenshots are generated, committed and reproducible; illustrations are hand-drawn SVG with light and dark files and fixed colours.
7. Colours live in `packages/overlay/src/tokens.ts`; the landing page repeats them and a test pins the two equal.
8. `/favicon.ico` gets no route: the page links `/__crt/favicon.svg`; PNG favicons are a Should.
9. Version `0.6.0`; the skills pin `@0.6`; M19 (Antigravity) ships in it.

**Open:**

1. **The mark in the launcher.** Replacing the pill's `CRT` text with the small mark at 16 px (F-64 keeps the chrome's name). Decide after v0.6 has been seen on real pages for a week.
2. **A recorded loop** (GIF or WebM) in the README. Only if the five screenshots leave a reader unsure; recordings are not reproducible by F-116.
3. **A docs site** (GitHub Pages from `docs/`). Not before the pages have stabilised for a release.
4. **A `modes.svg` illustration** (embedded vs proxy). Only if cheap once the first two exist.
5. **The rename** (carried from PRD-providers Open question 1 and PRD-embedded Open question 5): the lockup's wordmark is "CRT"; a rename would replace the wordmark file only.
