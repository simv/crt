# CRT visual polish — design review

**Two findings first:**

1. **The contact sheet's dark column is wrong for A, C, D and E.** `invert()` in `gen-logo.mjs` turns `#111111` into `#ffffff`, then rewrites *every* `fill="#ffffff"` back to ink — the bezel it just inverted, the cursor, the dots, the "1". Only B (strokes) was inverted, so dark-A/C/D/E render as invisible tiles and B is flattered. Fix the generator (swap via a `data-role` attribute) before the pick is signed off.
2. **`/__crt/doctor` does not exist**, and F-91 documents the landing page as "plain words, no scripts". The concept needs a PRD-embedded amendment: a same-origin script on `/` and a read-only doctor route.

## A. Logo

**Ranking: A · Tube › B · Sign-off › C · Select › E · Monogram › D · Speak.**

- **A** shows the product's own vocabulary — a screen with the overlay's numbered marker — and at 16 px stays "dark screen, pink corner dot". The badge *is* the launcher's count badge.
- **B** is the most elegant and reducible, but tells the pun (a TV switching *off*); at 16 px it reads as a battery or a minus-in-a-box.
- **C**: right verb, but the OS cursor is every screenshot tool's icon; dashes are mush below 24 px.
- **E** needs a type designer: 7-unit strokes are 0.9 px at 16 px.
- **D** turns the tube into a generic chat icon.

No sixth direction is clearly better. The refinement is A with B's discipline: drop the glass highlight, which vanishes below 48 px.

**Fix before A ships**

- *Geometry.* Centre the badge on the superellipse edge (compute it, not 98/30). The 8-unit bezel is a 1 px line at 16 px.
- *16 px.* Ship `crt-mark-small.svg` (viewBox 16, coordinates snapped to whole pixels): solid ink tube, no glass, plain dot ≥ 3.5 px, no "1". The glyph survives only at ≥ 48 px.
- *Badge.* A 2-unit ring in the background colour (`paint-order: stroke`) so it separates from the bezel on both themes, like the launcher's count badge.
- *Dark variant.* Bezel `#f2f2f4`, glass `#2b2b31`, glyph stays white. Ink on `#0f0f12` is invisible, so the dark variant is mandatory.
- *Launcher pill.* The real pill is always `#111` (`ui.ts` line 66); the sheet's inverted pill on dark is a fiction, and ink-on-ink leaves only the pink dot (see the light row). Put the **dark variant** in the pill at 16 px.
- *Favicon.* `/__crt/favicon.svg` = the small variant with an in-SVG `@media (prefers-color-scheme: dark)`, plus 32/16 PNG for Safari. Only the landing page links it; never touch the app's favicon.

**Deliverable set**

- `docs/brand/crt-mark.svg` (128), `-dark`, `-small`, `crt-lockup.svg` + dark ("CRT" as outlined paths, no font).
- `/__crt/favicon.svg` + PNG 32/16. Sizes: 128 (README hero, landing), 48 (welcome card), 32/24 (toolbar, tab @2x), 16 (tab, pill).
- Colours: ink `#111`, accent `#ff3d71` (badge and markers only), ok `#2e9e5b`, amber `#e0a800`, red `#d7263d` — the overlay's values; the mockup's `#111114`, `#b7791f`, `#d1323b` drift. One `packages/overlay/src/tokens.ts` feeds the overlay CSS and the page.
- Clear space one bezel width; mark alone below 24 px, lockup above.

## B. Landing page

**Hierarchy** is right: kicker → "Your app is at …" → Open. Make the kicker ink, not muted: for the by-accident visitor it is the most important line. The tube is 360 px of decoration above the fold; cap it at 280 px and hide it under 480 px — on mobile it fills a screen before step 1.

**Copy.** Step 2 says "chat with Claude"; the provider may be Codex or Antigravity — use the live name from `/__crt/providers`, chrome stays "CRT" (F-64). The hint hard-codes `Ctrl`; the server knows `process.platform`, so render `Cmd` on macOS.

**Hero, ≤ 3 lines** (app known):

> This is the CRT server — not your app.
> **Your app is at localhost:3100**
> Open it and look for the CRT button bottom-right: that is where you annotate, chat and file tasks.

App unknown (`target: null`): "No dev server found yet. / Start yours and open it — the CRT button appears on any localhost page with the CRT integration. / `crt 3000` remembers it." Loader never fetched (`overlay.loader: 0` after CRT opened the app): the hint under Open becomes "Your page has no CRT integration yet — `crt init` prints the snippet." The mockup shows only the happy path; these two states are where newcomers land.

**Checkup card.** Mirroring the *text* of each `crt doctor` row is right — the row is the fix, and page and terminal must agree. Mirroring the *order and volume* is not: eleven green rows bury the two that matter. Group by status: FAIL, then warn, each with a copyable command; then "9 checks pass — same rows as `crt doctor`", expanding to the verbatim list in doctor's order. Keep the decision line; add the `--` status (styled, never shown). `doctorRows` has no "self" case — against the live server the `port` row reads `FAIL … held by CRT`; the route needs a fact that renders "4400 — this server".

**Delight.** Keep the power-on, once per load, never on Re-check. In dark mode `brightness(3)` on a `#f2f2f4` tube is a white flash — animate opacity, or cap at 1.6. Scanlines: drop, or 3 % — at 5 % they band at fractional DPR (visible on mobile). Drop the row stagger; a status list is there at first paint. Reduced-motion handling is correct.

**Dark mode.** Good, except the white bezel is the brightest object on the page and fights the pink button — `#3a3a42` bezel over `#1e1e24` glass with a 1 px `--line` outline.

**Accessibility.** The chips fail AA: white on `#b7791f` is 3.0:1, white on `#2e9e5b` 3.6:1 at 11 px. Use the overlay's own tinted pills (`#fff3cd/#7a5200`, `#d9f5e3/#0a5b2b`, `#fde2e2/#8b0000`), 7:1+ and consistent. No `:focus-visible` anywhere: `outline: 2px solid var(--accent); outline-offset: 2px`. The table has no `<th>`: add a visually-hidden header row.

**Mobile.** The header chip wraps the project path over three lines — ellipsis; the full path is in This server. Stack Checkup rows under 480 px.

**Final order.** Header → hero → **attention callout only when doctor has FAIL/warn** → three steps → Checkup (passes collapsed) | This server + In Claude Code → footer. A problem belongs before the tutorial.

**Live vs static.** Server-rendered, no JS needed: version, SDK version, mode, project, app URL, uptime, task counts, OS for the shortcut. Client-fetched, same origin only: `/__crt/providers` and a new `GET /__crt/doctor` (rows + decision, cached, `?refresh=1` behind a 5 s cooldown, refusing any request with an `Origin` header as `/__crt/internal/*` does — doctor spawns `claude plugin list` and `codex login status`; a page on another port must not trigger that). Static: steps, skills, footer. Complete without JS; JS enhances. The `Docs` link is a navigation, not a resource — allowed, labelled "github.com ↗".

**Missing.** A "copy" button on each fix command (no clipboard library needed); a `<noscript>` line pointing at `crt doctor`; a `Re-check` result that names what changed.

## C. README information architecture

**Root README, ≤ 190 lines**

1. Title, pitch paragraph, hero screenshot — 8 (pinned intro lines stay).
2. Install — the §4 block verbatim (pinned) + two sentences — 20.
3. Add CRT to your app — four snippets verbatim (pinned), one sentence on where each starts capturing, link — 35.
4. The loop — `npm run dev` / `crt`, three steps with a screenshot each, the slash-command block — 35.
5. Production — two lines + link — 5.
6. What lands in your repo — the five bullets (pinned) — 12.
7. Providers — one table (agent, status, install, login) + link — 15.
8. Troubleshooting — "run `crt doctor` first", the sample (pinned), "every failure is one `crt:` line; the catalogue is in docs/troubleshooting.md" — 20.
9. Docs index, Repository table, Develop, MIT — 25.

**Moves** (verbatim; tests re-pointed):

- `docs/cli.md` ← `### crt flags` (table + the "On success" wall), `### What Claude gets`.
- `docs/integration.md` ← "Where each one starts capturing", the loader paragraph, full Production text, `## Proxy mode`.
- `docs/providers.md` ← `## Providers` entire.
- `docs/task-format.md` ← `## Task format`.
- `docs/how-it-works.md` ← `## How it works` (ASCII stays here; README gets the SVG).
- `docs/troubleshooting.md` ← everything after the doctor sample.
- `docs/install.md` ← "Other ways to install", Windows note, "Older task files".
- `docs/develop.md` ← `## Develop`, release recipe.

Watch: server strings point at README sections — `see README › Overlay does not appear` (`proxy.ts`), `README › Production` (`crt init`) — and tests pin them. Re-point to `docs/… › …` in the same PR.

**Screenshots** (`docs/img/`, DPR 2, 1280×800, light, ≤ 250 KB, from the e2e fixture + `CRT_SESSION_STUB=1`):

1. `arrival.png` — the fixture page, pill bottom-right, first-visit welcome card.
2. `select.png` — Select hovering an element: outline, tag/component label, one pinned marker with its popover.
3. `chat.png` — the popover as chat: streamed text, a collapsed tool line, an Allow/Deny card (the stub scripts it).
4. `marker-states.png` — three markers: `thinking…`, `your turn`, `CRT-0007`.
5. `landing.png` — the new landing page.
6. (optional, manual) `crt-next.png` — `/crt:next` opening a PR.

**Illustrations** (hand-drawn SVG, `currentColor`, ≤ 10 KB, legible on GitHub dark): `loop.svg` (annotate → chat → task file → `/crt:next` → PR, one arrow back); `architecture.svg` (app origin with loader + overlay ⇄ `127.0.0.1:4400` → agent → `write_task`); `modes.svg` only if cheap.

**npm README (≤ 60 lines):** title + pitch + mark (raw.githubusercontent URL is fine on npmjs.com), Install block (pinned), the four snippets (pinned), three "what you get" bullets, requirements, one screenshot, docs link.

## D. Delivery plan

**T1 Brand mark + tokens** (no deps). Fix `invert()`, pick A, produce the set into `docs/brand/`, `tokens.ts`, `GET /__crt/favicon.svg` (+ PNGs, cache 1 day). *Risk:* 16 px legibility on Chrome/Windows. *Checks:* `gen-logo.mjs` byte-stable (unit test); Playwright renders the sheet at DPR 1 and 2 into `docs/brand/renders/`; favicon ≤ 2 KB; reviewer views both variants on `#fff` and `#0f0f12`.

**T2 Landing page + doctor route** (mark from T1; placeholder OK). Replace `landingPage()`; three hero states; `GET /__crt/doctor`; PRD-embedded amendment (F-91 scripts, a new F-n for the route, the "self" port fact). *Risk:* a browser-triggered route that spawns CLIs — refuse `Origin`, cooldown, async so `/` answers in < 50 ms. *Checks:* a unit test fails on any `src`/`href` outside `/__crt/` except the app link and the docs anchor; HTML ≤ 32 KB; Playwright captures light/dark/mobile into `docs/img/landing-*.png` and asserts no running animation under reduced-motion; axe contrast ≥ 4.5 on chips; Tab reaches Open → Re-check → Docs with a visible outline; e2e: Checkup rows equal `doctorRows(facts)`; favicon `<link>` present.

**T3 Screenshots + illustrations** (needs the e2e infra; T1 for the welcome-card mark). `packages/server/e2e/screenshots.spec.ts` writing `docs/img/*.png` deterministically (fixed clock, stub session id, cleared localStorage, `animations: "disabled"`); two SVGs by hand. *Risk:* determinism of the stub's streaming and the pill position. *Checks:* `npm run screenshots` regenerates; sizes enforced; SVGs render on GitHub dark; not in CI (pixel diffs flake) — `docs/img/README.md` says how to regenerate.

**T4 README + docs split** (last; embeds T2/T3 images). Create the eight docs by moving text, rewrite the root README, re-point `readme.test.ts` through a `doc(file, heading)` helper, update the `README › …` strings and their tests, npm README. *Risk:* the ~100 pinned strings and the intro-line index asserts (`readme.split("\n")[2]`, `[4]`). *Checks:* `npm test` green; a one-off script proves every moved `section()` is verbatim in its new file; a unit test resolves every relative link and `#anchor` across README and `docs/*.md`; root README ≤ 200 lines asserted.

**Order:** T1 → T2 ∥ T3 → T4.

**Conflicts with the constraints:** `/__crt/doctor` and a script vs F-91; doctor's `port` row on the live server; chip contrast; token drift; the inverted pill; "Claude" in step 2 vs provider-agnostic chrome; the invert bug. Nothing in the concepts sends anything off-machine; keep it so — no update check on the landing page (the README promises CRT never checks a registry).
