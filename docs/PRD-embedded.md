# CRT v0.4 — Embedded by default — PRD

| | |
|---|---|
| **Status** | Built — M15–M18 landed (CRT-0019…0022, 2026-09-17 → 2026-09-18); §10 ticked with evidence by M18; release `0.4.0` is CRT-0022's last step |
| **Owner** | Simon (simv) |
| **Repo** | https://github.com/simv/crt |
| **Baseline** | `main` at 9d46230 = v0.3.0 (PRD v1.0 + PRD-providers M6–M9 + anchored threads + PRD-setup M12–M14) |
| **Amends** | `docs/PRD.md` v1.0 (§2 Goal 5, §3 Non-goal 3, §4, §5, §5.1, §5.2, §8, F-1, F-2, F-3, F-5, F-6, F-20, F-23, F-35, F-36, F-41, N-5, N-6, §11 rows, §12), `docs/PRD-providers.md` (N-8), `docs/PRD-setup.md` (§3, F-71, F-73, F-75, F-76, F-78, F-80, F-82, F-83, F-86, F-87, N-16) — every amended statement is listed in §9 |

This document extends `docs/PRD.md`, `docs/PRD-providers.md` and `docs/PRD-setup.md`. Everything in the three stays in force unless §9 amends it. Requirement IDs continue the numbering (F-91…F-110, N-18…N-22); milestones are M15–M18, one task file each (`.crt/tasks/CRT-0019…0022`). A build session reads the three earlier PRDs, this file, `CLAUDE.md` and its task file, and nothing else, to know what "correct" means. §12 tells the builder what to do when the real tools differ from what this document assumes.

---

## 1. Problem and scope

CRT v0.1–v0.3 put the overlay on the page by **proxying** the app: browse `http://localhost:4400` instead of `http://localhost:3000` and CRT rewrites every HTML response on the way through (PRD §5.2). That was the right call for v0.1 — nothing to add to the app, one command — and it still works. After three weeks of daily use on real projects, Simon's findings (2026-09-17) are:

- **The proxy is the thing in the way.** Two URLs for one app. Everything an app does with its own origin behaves differently on the proxied one: absolute links and redirects, cookies scoped to a port, OAuth callbacks and `postMessage` targets registered for `:3000`, service workers, strict CSP, HMR sockets that CRT must replay byte for byte (F-3). Each of those is a class of bug that is CRT's to own and that no user of the app would otherwise meet. The F-6 script-tag fallback — the overlay loaded by the app from its own origin, talking to CRT cross-origin — already exists and its e2e (`e2e/script-tag.spec.ts`) proves a full Send works that way. It is the better default, left unproductised.
- **Next.js shows what the tool should feel like.** The Next dev overlay and its devtools indicator appear on the app's own dev URL, are part of the development build, and are absent from `next build` output. CRT should behave the same way: present on the app's own URL in development, never in a production build, with the CRT server (the agent host) an implementation detail behind it.
- **CRT's writes surprise the project's agents.** `crt` runs `crt init` implicitly on first start (F-35): `.crt/` appears, `.gitignore` gains two lines, and later task files land under `.crt/tasks/` while an agent session in that project is mid-task. Nothing in the project explains any of it. Agents ask what the files are, offer to delete them, or treat the `.gitignore` change as their own mistake. Next.js 16 meets the same problem and solves it by writing a marked block into `AGENTS.md` (`<!-- BEGIN:nextjs-agent-rules -->`, `next/dist/server/lib/generate-agent-files.js`); CRT needs the same courtesy.
- **`.crt/` should read like `docs/`.** Its contents are committed already, but they arrive as a side effect rather than as a deliberate, documented part of the repository: no README in the folder, no line in `CLAUDE.md`, no moment where the developer said yes.

**Scope of v0.4.** (1) **Embedded mode** becomes the default: `crt` runs the CRT server without a proxy, the app loads the overlay from it with one dev-only integration, and the CRT button appears on the app's own URL. (2) **Proxy mode** stays, under `crt proxy`, unchanged and still tested, for apps that cannot or should not be touched. (3) **Setup is explicit**: `crt init` names every file it will create or touch, asks once on a terminal, writes a README into `.crt/` and a marked CRT section into the project's `CLAUDE.md` / `AGENTS.md`; nothing else ever writes outside `.crt/`. (4) **A production guarantee**: a production build of an app that uses any CRT integration contains nothing from CRT, enforced by four layers and a test that builds and greps. (5) Release `0.4.0`.

## 2. Goals

1. **The CRT button is on the app's own URL.** `npm run dev`, then `crt`, then browse `http://localhost:3000` as always; the button is there. No second URL, no proxied copy.
2. **Nothing from CRT in production.** A production build makes no request to the CRT port and contains no CRT code or URL, whichever bundler built it; the README says how to verify.
3. **Adding CRT to a project is one command plus one snippet.** `crt init` prints the snippet for the detected framework; `/crt:init` applies it. The snippet is one import and one line for Next.js, Vite, any bundled app, or a plain page.
4. **Every file CRT adds is announced, documented in-repo, and explained to the project's agents.** `.crt/README.md` explains the folder to humans on GitHub; the CRT section in `CLAUDE.md` / `AGENTS.md` explains it to agents; `crt init` prints its plan before writing.
5. **Proxy mode is not degraded.** Every proxy requirement (F-1…F-6, F-71…F-73, F-80) keeps its ID, its tests and its behaviour under `crt proxy`.
6. **Nothing new leaves the machine** (N-4/N-12/N-16): the loader talks to `127.0.0.1` only, and only from a loopback page.

## 3. Non-goals (v0.4)

- **A browser extension** (unchanged since v1.0).
- **Starting the CRT server from the app's dev server** (a Vite plugin that spawns `crt`). PRD-setup §3 dropped `crt --run` over orphaned process trees and guessed commands; the same applies in reverse. Open question 1.
- **Serving the CRT API same-origin from inside the dev server** (Vite middleware, Next `rewrites`). Cross-origin with loopback-only CORS (F-6) works for every framework and is already proven; revisit only if a framework's CSP defaults block it (Open question 4).
- **Frameworks with no JS entry and no dev-only hook** (server-rendered PHP/Rails/Django templates): they use the script-tag form (F-96) in their development layout, or proxy mode.
- **Moving the tasks directory.** `tasksDir` is already configurable, but the hook and the skills assume `.crt/tasks`; Open question 2.
- **Changing the intake, the worker or the task format.** F-27, F-32, F-37 stand.

## 4. Scenario changes

PRD §4 step 1 becomes: *Simon's app already includes the CRT integration (added once by `/crt:init`, one import and one line). He runs `npm run dev` as always, then `crt` in the project folder (or `/crt:serve` in Claude Code). CRT starts the CRT server on `http://localhost:4400`, checks that Claude Code is logged in, and opens the app's own URL, `http://localhost:3100`; the CRT button is there because the page loaded the overlay from the CRT server. There is no proxied copy of the app.*

PRD §4 step 6 gains: *Task files appear under `.crt/tasks/` as the intake writes them. The project's `CLAUDE.md` says what they are (the CRT section `crt init` wrote), so a parallel Claude Code session treats them as work items, not as strays.*

PRD §8 "Setup experience (the whole thing)", as amended by PRD-setup §4, becomes:

```bash
# one-time, per machine
npm i -g claude-review-tool
crt setup                         # registers the bundled plugin with Claude Code: /crt:init, /crt:serve, /crt:next, …

# one-time, per project
crt init                          # .crt/ (README, tasks, config), 2 .gitignore lines, a CRT section in CLAUDE.md — each announced,
                                  # then it prints the one-line snippet for your framework; /crt:init in Claude Code applies it for you

# per session
npm run dev                       # your dev server, your URL
crt                               # CRT server on :4400; opens your app; the CRT button is on your page
```

The snippets `crt init` prints (F-102), by framework:

```tsx
// Next.js (App Router) — app/layout.tsx
import { CrtDevTools } from "claude-review-tool/react";
…
<body>{children}<CrtDevTools /></body>
```

```ts
// Vite — vite.config.ts
import { crt } from "claude-review-tool/vite";
export default defineConfig({ plugins: [react(), crt()] });
```

```ts
// any bundled app — the client entry (src/main.tsx, src/index.ts, …)
import { mountCrt } from "claude-review-tool/loader";
if (process.env.NODE_ENV !== "production") mountCrt();   // the guard is optional (F-98); it lets the bundler drop the import
```

```html
<!-- no bundler — the development page only -->
<script src="http://localhost:4400/__crt/loader.js"></script>
```

Inside Claude Code, `/crt:init` runs `crt init` and applies the snippet to the app; `/crt:serve` does what `crt` does and offers `/crt:init` first when the project is not set up. `crt proxy` (or `/crt:serve --proxy`) is the v0.3 experience for an app that cannot be touched.

## 5. Design

### 5.1 Two modes, one server

The server becomes the **agent host**: the `/__crt/*` API, the overlay and loader bundles, the session registry and the task store, on `127.0.0.1:4400`, exactly as today. What changes is what happens to every other request. In **embedded** mode (the default) a request outside `/__crt/` gets a small landing page (F-91) — the server proxies nothing. In **proxy** mode (`crt proxy`, `--mode proxy`, or `mode: "proxy"` in `.crt/config.json`) it is today's reverse proxy with injection, HMR passthrough, CSP relaxing and the F-80 lines, unchanged. Whether `createProxyServer` grows a `target: null` branch or is split into a route server plus a proxy handler is the builder's call; the route tests run in both modes.

The guided start (PRD-setup §5.1) keeps its shape. In proxy mode the target is what CRT forwards to, so it is required and the F-71 machine may ask and wait. In embedded mode the target is only **the app URL CRT opens for you** and prints, so the same resolution runs but never waits and never fails (F-91): none found is one line, several found is the F-71 list on a terminal, a remembered one that is down is one line. F-72 remembering is unchanged.

### 5.2 The loader

The app does not load `overlay.js` directly; it loads a **loader**, one small script (≤ 5 KB gzipped, N-20) that (a) installs the F-20/F-21 console and network hooks at once, so errors the app logs before the overlay arrives are still captured — the reason `early.js` existed in proxy mode; (b) appends the `<script src="http://localhost:4400/__crt/overlay.js" defer>` tag, so the overlay always comes from the running server and its version always equals the server's; (c) when that script fails to load, shows a small pill on the page — "CRT server not running — run `crt` in the project" — that retries when the tab regains focus or is clicked, so starting `crt` after the page is open needs no reload; (d) does nothing at all unless the page is on a loopback hostname; (e) is idempotent.

The loader exists in two forms from one source (`packages/overlay/src/loader.ts`): an IIFE served by CRT at `/__crt/loader.js` for pages without a bundler (it auto-mounts; when the server is down the script itself is missing, so there is no pill — the README says so), and an ES module in the npm package (`claude-review-tool/loader`, exporting `mountCrt`, no side effect on import) that bundlers ship with the app in development, so the pill works even when nothing is listening on `:4400`.

### 5.3 Framework entries

Three thin entries in the npm package, each ≤ 40 lines, importing nothing from the server runtime:

- `claude-review-tool/react` — `CrtDevTools`, a `"use client"` component rendering `null` whose effect calls `mountCrt`; it drops into a Next.js App Router root layout (the trial app) or any React tree.
- `claude-review-tool/vite` — `crt()`, a Vite plugin with `apply: "serve"` whose `transformIndexHtml` prepends an inline module `import { mountCrt } from "claude-review-tool/loader"; mountCrt({ port })` to `<head>`, so the hooks install before the app's own module runs; the port is read from `.crt/config.local.json` / `.crt/config.json` of the nearest project root (`readConfig` in `init.ts`, pure `node:fs`).
- `claude-review-tool/loader` — `mountCrt(options)` for everything else with a bundler.

Why not more: Next needs a component because App Router layouts have no `index.html`; Vite has a first-class dev-only HTML hook; every other bundled app has a client entry. Angular, SvelteKit, Nuxt and the rest are "any bundled app" until a maintainer asks for a first-class entry (Open question 3).

### 5.4 The production guarantee (N-18)

Four layers, each sufficient on its own, and a test that builds and greps:

1. **Export conditions.** `package.json` `exports` maps every browser entry (`./loader`, `./react`) through the `production` condition to a no-op module exporting the same names as no-ops. Vite, webpack 5, Rspack, Turbopack and esbuild (with `--conditions`) resolve that condition in production builds.
2. **Dead code.** Each entry's body sits behind `process.env.NODE_ENV !== "production"`, which every bundler above defines statically, so the loader code is dropped even where the condition is not honoured.
3. **Runtime guard.** `mountCrt` returns without side effects unless `location.hostname` is `localhost`, `*.localhost`, `127.0.0.1` or `[::1]` (the F-6 list) — a production page on a real host never makes a request even if the code shipped.
4. **Dev-only by construction.** The Vite plugin is `apply: "serve"`; the script-tag form lives in the development page only (README).

The F-98 test builds fixture apps for production with esbuild (`--define:process.env.NODE_ENV='"production"' --conditions=production`) and with Vite (`vite build`, plugin and React component both present) and asserts the outputs contain none of `__crt`, `/loader.js`, `overlay.js`, `mountCrt`, `4400`. A `next build` of the trial app is the Manual row (F-109).

### 5.5 Explicit setup, agents in the loop

`crt init` becomes the one command that writes outside `.crt/`, and it says what it will do before doing it (F-100). `crt` no longer initialises a project silently (F-99). Two artefacts make `.crt/` a documented part of the repository: `.crt/README.md`, written once for humans reading the folder on GitHub, and a marked section in `CLAUDE.md` and `AGENTS.md` (F-101), regenerated by `crt init` and never touched at runtime, that tells the project's agents what `.crt/tasks/*.md` are, that they appear during intake, that they are committed with the project, and how they are worked. The section uses `<!-- BEGIN:crt -->` / `<!-- END:crt -->` markers, the Next.js 16 precedent, so re-running `crt init` replaces rather than duplicates it.

After v0.4 the runtime writes of the server are strictly under `.crt/`: captures, tasks, the index, `config.local.json` (F-72, F-57). The explicit CLI exceptions are `crt init` (`.gitignore`, `CLAUDE.md`, `AGENTS.md`), `crt skills install` (F-58) and `crt setup` (Claude Code's own store, F-86) — each printed line by line (N-19).

### 5.6 What changes where

| Area | Change |
|---|---|
| `packages/server/src/cli.ts`, `args.ts` | `crt proxy [target]`, `--mode <embedded\|proxy>`; `crt init [--yes] [--no-instructions] [--snippet [--json]]`; usage text |
| `packages/server/src/serve.ts`, `start.ts` | `mode`; the soft target step in embedded mode (F-91); reuse comparison by mode (F-93); no implicit init (F-99); the "loader never fetched" line (F-94) |
| `packages/server/src/proxy.ts` | embedded branch: landing page, `/__crt/loader.js`, health `mode` / `app` / `overlay.loader` (F-91, F-93, F-94) |
| `packages/server/src/init.ts` | the plan, `.crt/README.md`, the instructions block, snippet detection (F-100…F-102); `readConfig` gains `mode` |
| `packages/server/src/doctor.ts` | `.crt` row without implicit init; `target` row soft in embedded mode; new `integration` and `instructions` rows (F-103) |
| `packages/overlay/src/loader.ts` (new), `base.ts`, `ui.ts`, `welcome.ts` | the loader (F-96); embedded-mode welcome copy and no script-tag suppression (F-95) |
| `packages/overlay/src/react.ts` (new), `packages/server/src/integrations/vite.ts` (new), `dist/integrations/*` | the entries and their no-ops (F-97, F-98); overlay `package.json` build gains the loader (IIFE + ESM) and the React entry |
| `packages/server/package.json` | `exports`, optional peer dependencies `react`, `vite`; `keywords` |
| `plugin/skills/init/SKILL.md` (new), `plugin/skills/serve/SKILL.md`, `plugin/hooks/session-start.mjs` | `/crt:init` (F-104), embedded `/crt:serve` (F-105), the missing-section line (F-106) |
| `packages/server/e2e/fixture/server.mjs`, `crt.mjs`, `playwright.config.ts`, specs | `/embedded` page, `--proxy` for the fixture, `embedded.spec.ts`; the axis flip in M18 (F-110) |
| `README.md`, `docs/PRD.md`, `docs/PRD-providers.md`, `docs/PRD-setup.md`, `CLAUDE.md`, `.claude/agents/prd-reviewer.md` | §9 (F-107, F-108) |

## 6. Functional requirements

**Must** = v0.4 DoD. **Should** = v0.4 if time allows, else later.

### 6.1 Server modes

- **F-91 (Must) Embedded mode is the default.** `crt [app]` / `crt serve [app]` start the CRT server on `127.0.0.1:<port>` and proxy nothing. Every request outside `/__crt/` is answered `200 text/html` with a landing page that says, in plain words: `CRT <version> is running for <projectRoot>. This is the CRT server, not your app.`, a link to the app URL when known (`Open http://localhost:3000 — the CRT button appears there once your app includes the CRT integration`), the sentence `Run \`crt init\` for the one-line snippet for your framework, or \`crt proxy\` to proxy your app instead.`, and nothing else (no scripts). The positional, `--target`, the remembered and the committed `target` mean **the app URL**: CRT opens it (`--open` / interactive) and prints it; F-72 remembering is unchanged. Resolution runs the F-71 order but never waits and never fails:
  - one found → `Found http://localhost:3000.`, used; not remembered;
  - several found → interactive: the F-71 list with `Which one should I open? [1]`; non-interactive: the first, with `crt: found N dev servers (…); opening http://localhost:3000 — run \`crt <port>\` to pick another`;
  - none found → interactive: `No dev server on ports 3000, 5173, 8080, 4200, 8000, 3001 — start it and open it in your browser; the CRT button appears when the page loads the CRT loader (crt <port> to have CRT open it next time).` plus the `npm run dev` hint when `scripts.dev` exists; non-interactive: the same as one `crt:` line; the browser is not opened;
  - explicit or remembered target down → `crt: http://localhost:3100 (remembered) is not responding — start it; CRT is ready for it` (no wait loop, no "Use 3000?" question); the browser is not opened.
  The ready line is F-93's. `.crt/config.json` and `.crt/config.local.json` accept `mode: "embedded" | "proxy"` (local over project); `--mode` outranks both.
- **F-92 (Must) Proxy mode on request.** `crt proxy [target]` ≡ `crt serve --mode proxy [target]`: the v0.3 flow verbatim — the guided target with its wait loop and questions (F-71), busy-port diagnosis (F-73), HTML injection (F-2), WebSocket passthrough (F-3), CSP relaxing, the F-80 lines, the `Proxying …` welcome copy (F-82). Every proxy-mode requirement keeps its ID, tests and wording; `e2e/proxy.spec.ts` runs against a `crt proxy` server. `mode: "proxy"` in `.crt/config.json` makes it a project's default so `crt` alone proxies there; the ready line then says `(proxy; …)`.
- **F-93 (Must) Health, ready line and reuse know the mode.** `GET /__crt/health` gains `mode: "embedded" | "proxy"` and `app: string | null` (the app URL: the resolved target in either mode, null when embedded mode found none); `target` stays and equals `app` (compatibility for the skills and the e2e assertions); `overlay` gains `loader: n` (requests for `/__crt/loader.js`). The ready line (F-75 shape) becomes `CRT ready at http://localhost:4400 for http://localhost:3000 (embedded; project: C:\my-app, 3 tasks in .crt\tasks, provider: claude (default), login: ok)` — `for <app>` is omitted when none is known, `embedded;` reads `proxy →` in proxy mode: `CRT ready at http://localhost:4400 → http://localhost:3000 (proxy; project: …)`. The interactive next-action line reads `Open http://localhost:3000 → CRT button bottom-right (Ctrl/Cmd+Shift+.) → Select · note · Send. Ctrl+C stops CRT; your dev server keeps running.` (`Open your dev server in the browser → …` when no app is known). The F-73 reuse test compares `projectRoot` **and** `mode` (and `target` in proxy mode only); the reuse line reads `CRT 0.4.0 is already serving this project (embedded) at http://localhost:4400 (since 09:12) — opened http://localhost:3000.` (`— open your app in the browser.` when none is known). When the bound port differs from the configured one (a step-around, F-73) the embedded ready line adds one line: `crt: your app's CRT loader expects :4400 — run \`crt --replace\`, or set port in .crt/config.json and in the snippet`.
- **F-94 (Must) The loader's absence is reported.** `GET /__crt/loader.js` serves the IIFE loader (`dist/loader.js`) with the F-6 CORS rules and `cache-control: no-store`. In embedded mode, when CRT opened the browser on the app and neither `/__crt/loader.js` nor `/__crt/overlay.js` was requested within 15 s, the terminal says once per server: `crt: opened http://localhost:3000 but the page never loaded the CRT loader — add the integration (\`crt init\` prints the snippet, /crt:init applies it), or run \`crt proxy\``. The F-80 injected-page timer and its three lines are proxy-mode only. `crt: overlay loaded in the browser (GET /)` (F-75) reads `crt: overlay loaded in the browser (from http://localhost:3000)` in embedded mode, with the requesting page's `Origin`/`Referer` origin.

### 6.2 Overlay and loader

- **F-95 (Must) The overlay works embedded.** Every overlay requirement — F-7…F-30, F-56, F-65…F-68, F-81, F-82 — holds when `overlay.js` is loaded by the loader on the app's own origin: `base.ts` keeps reading the CRT origin from the overlay script's `src` (the loader sets it absolute), every API call and the SSE stream go cross-origin as F-6 already proves, `sessionStorage` thread restore and the `localStorage` welcome key are per app origin (which is right: one CRT server, several apps). The F-82 welcome card is **shown** in embedded mode (the "never in script-tag mode" rule is dropped; iframe, stub, restored and health-failed suppressions stay); its second line reads `Talking to CRT at http://localhost:4400 for C:\my-app. Tasks are written to .crt\tasks (3 there now).` in embedded mode and keeps `Proxying …` in proxy mode (from health's `mode`). The launcher tooltip (F-81) is unchanged. The F-20/F-21 hooks come from the loader (F-96), so `early.js` is only injected in proxy mode; the README says console errors logged before the loader runs are missed and where to put the snippet.
- **F-96 (Must) The loader.** One source, `packages/overlay/src/loader.ts`, framework-free, no dependencies, ≤ 5 KB gzipped (N-20), built to `dist/loader.js` (IIFE, auto-mounts) and `dist/integrations/loader.js` (ESM, exports `mountCrt(options?: { origin?: string; port?: number })`, no side effect on import). `mountCrt`:
  1. returns at once, doing nothing, unless `location.hostname` is a loopback name (F-6 list) and `window.top === window`;
  2. is idempotent: a second call (or a second loader script) returns the first result;
  3. installs the console/error and network hooks (the `early.ts` code) immediately;
  4. resolves the CRT origin: `options.origin`, else `http://localhost:<options.port>`, else the IIFE's own script `src` origin, else `http://localhost:4400`;
  5. appends `<script src="<origin>/__crt/overlay.js" defer>` to `<head>` (or `<html>`);
  6. on that script's `error` event mounts a pill in its own shadow root, bottom-right, `CRT server not running on :4400 — run \`crt\` in the project, then click here` with a close control; a click retries the script; the pill also retries once on the next `visibilitychange` to visible or window `focus` (no timers, N-20); closing it hides it for the tab (`sessionStorage`); a successful load removes it;
  7. exposes `window.__crt.loader = { origin, retry() }` and no other global (CLAUDE.md: `window.__crt` is the only global).
  The IIFE form reads `data-crt-port` on its own `<script>` tag as `options.port`. The pure parts — the loopback guard, the origin resolution, idempotence — are unit-tested from `packages/server/test` by importing the source (the `owner-stack.test.ts` pattern).

### 6.3 Package entries and the production guarantee

- **F-97 (Must) Three entries.** `packages/server/package.json` gains `exports`: `"./loader"`, `"./react"`, `"./vite"`, `"./package.json"` (and nothing else: the package has no main). Types (`.d.ts`) ship for each.
  - `claude-review-tool/react` (`packages/overlay/src/react.ts`, `createElement`-free — it returns `null` — so no JSX config): `export function CrtDevTools(props: { port?: number; origin?: string }): null` with `"use client"` as the first line of the built file, calling `mountCrt(props)` from `useEffect` once; SSR-safe (no `document` access at render).
  - `claude-review-tool/vite` (`packages/server/src/integrations/vite.ts`): `export function crt(options?: { port?: number; root?: string }): Plugin` — `name: "claude-review-tool"`, `apply: "serve"`, `transformIndexHtml` with `order: "pre"` returning one `{ tag: "script", attrs: { type: "module" }, children: 'import { mountCrt } from "claude-review-tool/loader"; mountCrt({ port: <n> })', injectTo: "head-prepend" }`; `<n>` is `options.port`, else `readConfig(findProjectRoot(options.root ?? config.root)).port`, else 4400. It imports `init.ts` and `project.ts` only (pure `node:fs`), never the server, providers or SDK.
  - `claude-review-tool/loader` is F-96's ESM form.
  `react` (≥ 18) and `vite` (≥ 5) are `peerDependencies` marked optional in `peerDependenciesMeta`; no runtime dependency is added (N-11). The three entry sources are typechecked in their packages and the built files are asserted to exist by a unit test.
- **F-98 (Must) Nothing from CRT in a production build (N-18).** (a) `exports` routes `./loader` and `./react` through the `production` condition to `dist/integrations/noop-loader.js` / `noop-react.js` (same export names, empty bodies, no strings from the list below); (b) each entry's body is behind `process.env.NODE_ENV !== "production"` — in the ESM entries the app's bundler defines it; the IIFE served at `/__crt/loader.js` is built with esbuild `--define:process.env.NODE_ENV='"development"'` so the guard folds away and no `process` reference reaches a browser; (c) `mountCrt`'s loopback guard (F-96 step 1); (d) the Vite plugin's `apply: "serve"`. A unit test builds two fixture apps for production and asserts their output contains none of `__crt`, `/loader.js`, `overlay.js`, `mountCrt`, `4400`: (1) an esbuild bundle of an entry importing `claude-review-tool/loader` and `claude-review-tool/react`, with `--define:process.env.NODE_ENV='"production"' --conditions=production` (esbuild is already a devDependency); (2) `vite build` of a minimal fixture (`index.html` + `main.ts` importing the React entry, `vite.config` with `crt()`), with `vite` as a devDependency. The same test asserts the **development** builds (`NODE_ENV=development`, no `production` condition, `vite` dev transform of `index.html`) **do** contain `mountCrt` and the origin — so the guard proves both directions. A `next build` of the trial app is the Manual row in F-109.

### 6.4 Project setup

- **F-99 (Must) No implicit init.** `crt`, `crt serve` and `crt proxy` create nothing. When `<root>/.crt/` has no `tasks/` directory: interactive → the F-100 plan followed by `Set up CRT in C:\my-app? [Y/n]` (Enter → init runs, then start continues; `n` → `crt: cancelled`, exit 130); non-interactive without `--yes` → `crt: C:\my-app is not set up for CRT — run \`crt init\` (or \`crt --yes\`)`, exit 1; with `--yes` → init runs, every line printed, start continues. Capture pruning runs only when `.crt/captures/` exists. `crt tasks` on an un-initialised project prints `no tasks (CRT is not set up here — run crt init)`, exit 0; `crt tasks --json` answers `{ "tasksDir": null, "tasks": [] }`. `crt doctor`'s `.crt` row reads `-- .crt not initialised — run crt init`.
- **F-100 (Must) `crt init [--yes] [--no-instructions] [--snippet [--json]]`.** Explicit, itemised, idempotent. It prints the plan first — one line per item it would create or change, only the items not already in place:
  ```
  crt init will, in C:\my-app:
    create .crt/README.md
    create .crt/tasks/
    create .crt/config.json
    add .crt/captures/ and .crt/config.local.json to .gitignore
    add a CRT section to CLAUDE.md
  ```
  then, on a terminal without `--yes`, `Go ahead? [Y/n]` (`n` → `crt: cancelled`, 130). Off a terminal it applies without asking (the command is explicit; `--yes` only skips the question). Every write is one line as it happens: `crt init: created .crt/README.md`, `crt init: added .crt/captures/ and .crt/config.local.json to .gitignore`, `crt init: added the CRT section to CLAUDE.md`. Nothing to do → `crt init: C:\my-app is set up (.crt/README.md, tasks/, config.json, .gitignore entries, CRT section in CLAUDE.md)`. It ends with the F-102 snippet unless `--snippet` was given (then it prints only the snippet and writes nothing). Items:
  - `.crt/README.md`, written only when absent (hand-editable afterwards), from a template in `init.ts`: what CRT is (two sentences), the folder — `tasks/` (work items, one Markdown file each, F-32 format in brief), `tasks/README.md` (generated index, never hand-edited), `tasks/assets/<ID>/` (screenshots), `captures/` (transient, gitignored), `config.json` (committed, per project: `mode`, `target`, `port`, `provider`), `config.local.json` (per machine, gitignored) — how tasks are worked (`/crt:next` in Claude Code, `crt tasks`, `crt task <ID>`), and `Written by crt init <version>; https://github.com/simv/crt`.
  - `.crt/tasks/`, `.crt/config.json` (`DEFAULT_CONFIG_FILE`, now with `mode: "embedded"`), the two `.gitignore` lines — as today.
  - the instructions block (F-101) unless `--no-instructions`.
- **F-101 (Must) The CRT section for agents.** `crt init` writes one marked section into the project's agent instruction files:
  - targets: every existing one of `<root>/CLAUDE.md` and `<root>/AGENTS.md`; when `CLAUDE.md` consists only of `@`-import lines (the trial app's `@AGENTS.md`), it is skipped in favour of the file it imports; when neither exists, `CLAUDE.md` is created if the resolved provider is `claude`, else `AGENTS.md`;
  - shape: `<!-- BEGIN:crt v0.4 -->` … `<!-- END:crt -->`, appended after a blank line, replaced in place on later runs (the version stamp lets a future `crt init` know the text is stale; the block is regenerated when the stamp's major.minor differs, otherwise left alone even if edited);
  - text (≤ 15 lines, fixed in `init.ts`, provider-neutral): a `## CRT (Claude Review Tool)` heading; `.crt/` is part of this repository and is documented in `.crt/README.md`; `.crt/tasks/*.md` are work items filed from the browser with CRT — they can appear while a CRT intake session runs, that is expected: keep them, commit them with the project, never delete or "clean up" one; `.crt/tasks/README.md` is generated by `crt tasks` — never hand-edit it; `.crt/captures/` and `.crt/config.local.json` are per-machine and gitignored; to work a task: `/crt:next [ID]` in Claude Code, or read the task file — it is self-contained; the CRT integration in the app (the snippet, F-102) is development-only and stays; `crt init` maintains this section.
  - never written at runtime, never by `crt serve`; `--no-instructions` skips it; the block and the `.gitignore` lines are `crt init`'s documented writes outside `.crt/` (N-19).
- **F-102 (Must) The framework snippet.** `crt init` (and `crt init --snippet`, `--json` for tooling) detects the framework from the root `package.json` (`dependencies` + `devDependencies`, names only, no recursion): `next` → the React entry in the root layout (`app/layout.tsx`, `src/app/layout.tsx`, `.jsx`/`.js` variants — the first that exists, else "your root layout"); `vite` → the Vite plugin in `vite.config.{ts,mts,js,mjs}` (the first that exists); `react` / `react-dom` without either → the React entry in the client entry (`src/main.tsx`, `src/index.tsx`, `src/main.jsx`, `src/index.jsx`, `src/main.ts`, `src/index.ts`, the first that exists); any other `package.json` with a `dev`/`start` script → the loader import in the client entry (same candidates, else "your client entry"); no `package.json` → the script-tag form. Output: a heading `Add CRT to your app (development only):`, the file, the snippet from §4 verbatim, and `Production builds contain nothing from CRT (README › Production). /crt:init in Claude Code applies this for you.` `--json` prints `{ "framework": "next" | "vite" | "react" | "bundled" | "static", "file": "<relative path or null>", "snippet": "<text>", "import": "<the import line>", "usage": "<the usage line>" }`. It never edits app files.
- **F-103 (Must) `crt doctor` rows.** Added or changed rows (F-76 style, words not glyphs):
  - `.crt`: `-- .crt not initialised — run crt init` (was "crt creates it"); `ok .crt README.md, tasks/ (4 tasks), config.json, .gitignore entries`; `warn .crt tasks/ (4 tasks), config.json — no README.md — run crt init` when the folder predates v0.4.
  - `mode`: `ok mode embedded` / `ok mode proxy (.crt/config.json)`.
  - `target` in embedded mode: never `FAIL` — `-- target none set; crt opens nothing (crt <port> to remember one)`, `ok target http://localhost:3100 (remembered) — responding`, `warn target http://localhost:3100 (remembered) — not responding`; proxy mode rows unchanged.
  - `integration` (embedded mode): `ok integration next — app/layout.tsx imports claude-review-tool/react`, `ok integration vite — vite.config.ts uses claude-review-tool/vite`, `ok integration loader — src/main.tsx imports claude-review-tool/loader`, `warn integration not found (next) — run crt init for the snippet, or crt proxy`, `-- integration static page — add the <script> tag (crt init --snippet)`; `-- integration proxy mode` in proxy mode. The check reads only the F-102 candidate files for the detected framework and greps them for `claude-review-tool/` or `/__crt/loader.js`; nothing else is opened.
  - `instructions`: `ok instructions CLAUDE.md carries the CRT section` (both names when both do), `warn instructions CLAUDE.md has no CRT section — crt init adds it`, `-- instructions no CLAUDE.md or AGENTS.md — crt init creates one`.
  `FAIL` stays reserved for what stops `crt` from serving (F-76); none of the new rows can fail.

### 6.5 Skills and hook

- **F-104 (Must) `/crt:init`.** New skill, seventh in the plugin (`plugin/skills/init/SKILL.md`, `allowed-tools: Bash(npx *) Read Edit Write Glob Grep AskUserQuestion`), user-invoked or invoked when the user asks to add or set up CRT in the project. Steps: (1) from `${CLAUDE_PROJECT_DIR}` run `crt init --yes` (resolved per F-87) and relay every `crt init:` line; a `crt:` failure line is relayed verbatim and the skill stops. (2) Run `crt init --snippet --json`; open the named file (or find the layout / entry with Glob when `file` is null, asking with AskUserQuestion when several candidates exist); apply the snippet with Edit: Next → the import at the top and `<CrtDevTools />` as the last child of `<body>`; Vite → the import and `crt()` appended to `plugins` (creating `plugins: [crt()]` when absent); React/bundled → the import and the usage line at the top of the entry; static → tell the user which page to put the tag in and stop. Never touch any other file; never commit. (3) Reply: the lines `crt init` printed, the diff of the one app file (or the tag to add), the sentence "Development only — production builds contain nothing from CRT.", and "Next: `npm run dev`, then /crt:serve." When the snippet is already present (grep before editing) say so instead of editing.
- **F-105 (Must) `/crt:serve` in embedded mode.** Step 0 (health reuse) compares `projectRoot` and `mode`. New step ½: when `${CLAUDE_PROJECT_DIR}/.crt/tasks` does not exist, ask (AskUserQuestion) "CRT is not set up in this project. Set it up now? (creates .crt/, two .gitignore lines and a CRT section in CLAUDE.md, then adds one line to your app)" — yes → run the `/crt:init` steps first; no → stop with "run /crt:init when you want it". Step 1 runs `crt serve --open --yes [--target <arg>]` (embedded by default); `/crt:serve --proxy [target]` runs `crt proxy --open --yes [--target <arg>]` with the v0.3 steps and reply. The ready line to wait for is F-93's; health polling unchanged. Step 3 gains: `crt: no dev server on ports …` is now a line, not a stop — relay it and go on. Step 4 becomes: 10 s after readiness, if `overlay.loader` and `overlay.fetched` are both 0 and an app URL was opened, add "The page never loaded the CRT loader, so no CRT button will show — the integration snippet is probably missing: run /crt:init, or /crt:serve --proxy to proxy the app instead." Reply, four lines: `CRT is up at http://localhost:4400 for http://localhost:3000 (embedded; opened in your browser).` / `Project C:\my-app — tasks will be written to .crt\tasks (3 there now).` / `Agent: Claude, logged in.` / `Next: click the CRT button bottom-right (or Ctrl/Cmd+Shift+.), Select the element, type a note, Send. Run /crt:tasks when a task lands.` — with the existing suffixes, and `(no dev server found — open your app; the button appears when the page loads)` when none was found.
- **F-106 (Should) Hook line.** The SessionStart hook (F-41, F-84) adds one line when `.crt/tasks/` exists and neither `CLAUDE.md` nor `AGENTS.md` in the project contains `<!-- BEGIN:crt`: `CRT: .crt/ is set up but CLAUDE.md has no CRT section — run crt init to add it`. Two extra file reads, no spawn, still exit 0 within 5 s.

### 6.6 Docs and release

- **F-107 (Must) README.** Install: the machine block unchanged, then the project block from §4, then a "Add CRT to your app" section with the four snippets verbatim and one line each on where the hooks start capturing; "The loop" starts `npm run dev` → `crt` → browse your app; a new "Production" section states the four layers of F-98 and how to verify (`grep -r "__crt" dist/` after a production build, and that the CRT port is never requested); a "What lands in your repo" section lists `.crt/README.md`, `.crt/tasks/`, `.crt/config.json`, the two `.gitignore` lines, the CRT section with its markers, and says the server writes only under `.crt/` at runtime; "Proxy mode" replaces "Script-tag fallback" (when to use it, `crt proxy`, `mode` in `.crt/config.json`, what still applies: F-2/F-3, CSP relaxing, the F-80 lines); "How it works" redrawn for embedded mode with proxy mode as the alternative; the flags table gains `crt proxy`, `--mode`, `crt init --yes/--no-instructions/--snippet`; Troubleshooting gains "The CRT button does not appear (embedded)" (the loader pill, `crt doctor`'s `integration` row, a CSP that needs `http://localhost:4400` in `script-src` and `connect-src`, the script-tag form's silent failure when the server is down) and "CRT is not set up" and quotes every new `crt:` line from F-91, F-93, F-94, F-99, F-100, F-103 verbatim (doc test). `packages/server/README.md` gets the same Install and snippet blocks.
- **F-108 (Must) PRD, CLAUDE.md and reviewer amendments.** The §9 rows are applied inline to `docs/PRD.md`, `docs/PRD-providers.md` and `docs/PRD-setup.md` as "v0.4:" notes; `CLAUDE.md`: "What this is" (embedded by default, proxy optional), entry points (`integrations/`, `loader.ts`, `react.ts`), a conventions line "The browser entries (`packages/overlay/src/{loader,react}.ts`) and `packages/server/src/integrations/` import nothing from the server runtime (`init.ts`/`project.ts` excepted) and are dev-only by construction (PRD-embedded N-18)", the build line (`dist/loader.js`, `dist/integrations/`), the Don'ts ("`crt init` is the only command that writes `.gitignore`, `CLAUDE.md` or `AGENTS.md`, and only inside the `<!-- BEGIN:crt -->` markers") and the Release line (seven skills); `.claude/agents/prd-reviewer.md`: reads `docs/PRD-setup.md` and this file too, the N-5 row's allowed list gains `CLAUDE.md`/`AGENTS.md` in `init.ts`, and a new row "N-18: added lines under `packages/server/src/integrations/` or in `packages/overlay/src/{loader,react}.ts` import nothing from `serve.ts`, `proxy.ts`, `sessions.ts`, `session.ts`, `providers/` or the SDK, and every browser-facing body sits behind the `NODE_ENV` guard".
- **F-109 (Must) Release 0.4.0.** Version `0.4.0` in the three manifests, `package-lock.json`'s workspace entry and the seven skill pins (`@0.4`, F-87); tag `v0.4.0`, `release.yml`, GitHub Release, Simon promotes on npm. **Manual (Simon)** on the trial Next.js app (`C:\Projects\Claude\tool-validation`, Next 16.3): `/crt:init` adds `<CrtDevTools />` to `app/layout.tsx` and the CRT section to `AGENTS.md` (its `CLAUDE.md` is `@AGENTS.md`); `npx next dev -p 3100` then `crt` opens `:3100` with the CRT button and the welcome card; a `console.error` fired by the page is in the capture; a full Send writes a task; `npx next build` completes and `grep -r "__crt\|loader.js\|mountCrt" .next/static` finds nothing; a scratch `npm create vite@latest` app with `crt()` shows the button and its `vite build` output is clean.

### 6.7 Tests

- **F-110 (Must) Coverage.** Unit (`packages/server/test`, both runners): mode selection (`crt`, `crt proxy`, `--mode`, config `mode` local-over-project, `--mode` outranking both); the embedded target rows (one / several interactive and `--yes` / none / down — each a `start.test.ts` row with the F-91 wording); health `mode`, `app`, `overlay.loader`; the landing page; the F-94 line (timer shortened like F-80's); reuse by mode (F-93); `serve()` refusing an un-initialised project non-interactively and initialising with `--yes` (F-99); `crt init` plan / apply / second-run / `--no-instructions` / `--snippet [--json]`; the instructions block — append, replace by marker, the `@AGENTS.md`-only `CLAUDE.md`, create-when-neither per provider, untouched when the stamp matches; `.crt/README.md` written once; snippet detection for next / vite / react / bundled / static with and without the candidate files; the doctor rows of F-103; the loader's pure parts (F-96) from `../../overlay/src/loader.ts`; the Vite plugin's `transformIndexHtml` output and port resolution; the React entry returning `null` and the no-op modules exporting the same names; the F-98 production and development builds; the built entries existing after `npm run build`; `test/serve-skill.test.ts` pinning the new steps, a new `test/init-skill.test.ts` pinning `/crt:init`'s steps and that it names no file outside the snippet targets; `test/skill-pin.test.ts` covering seven skills; `test/session-start-hook.test.ts` for F-106; `test/readme.test.ts` for every new line. e2e (ubuntu): `e2e/embedded.spec.ts` — the fixture's `/embedded?crt=<origin>` page loads `/__crt/loader.js`; a `console.error` the page logs **before** the overlay script executes is in `consoleEntries()`; the launcher is visible; Send → the chat streams → a task file exists; a reload re-attaches the thread; against a server the spec spawns and stops (the `start.spec.ts` pattern): health carries `mode: "embedded"`, the F-94 line appears in its log when a page never loads the loader, and a fresh load after the server stops shows the loader pill (the ESM loader bundled into a fixture page by esbuild in the fixture build step, so the pill exists without a server); `e2e/proxy.spec.ts` runs against a `crt proxy` server (the fixture `crt.mjs` passes `--proxy` for it); `start.spec.ts` rows updated for the F-93 ready line. In M18 the primary e2e servers flip to embedded mode: `baseURL` becomes the fixture origin, every fixture page includes the loader tag, and `capture.spec.ts`, `chat.spec.ts`, `arrival.spec.ts`, `focus.spec.ts` run on the app's origin where the change is mechanical (URL and origin assertions); a spec that needs more stays on the proxy server and the Log says which and why.

## 7. Non-functional requirements

- **N-18 Nothing from CRT in a production build.** For an app that uses any CRT entry or snippet: its production bundle contains no CRT code, no CRT URL and no CRT string from the F-98 list, and the running production page makes no request to the CRT port, whichever of Vite, webpack/Next, Rspack, Turbopack or esbuild built it. Enforced by the four layers of F-98 and its test; the Manual row covers Next.
- **N-19 No writes without saying so.** Every file the CLI creates or modifies outside `.crt/` is named on stdout in the run that does it and appears in `crt init`'s plan before it is written. The server at runtime (`crt`, `crt serve`, `crt proxy`) writes only under `.crt/` — captures, tasks, the index, `config.local.json` (F-72, F-57) — and creates `.crt/` never. Nothing at runtime touches `.gitignore`, `CLAUDE.md`, `AGENTS.md` or any app file. N-5 is restated accordingly (§9).
- **N-20 The loader is quiet.** ≤ 5 KB gzipped; one script request and one retry per user action; no timers; no console output of its own (the browser's own network error for a failed script is the only trace when the server is down); no request of any kind unless the page's hostname is loopback; no measurable jank (N-3 applies to loader + overlay together).
- **N-21 Proxy mode is not degraded.** Every test that cites F-1…F-6, F-71…F-73 or F-80 keeps passing under `crt proxy` with its wording unchanged; the proxy code path is not refactored beyond what mode selection needs.
- **N-22 Same-origin exposure unchanged.** In embedded mode the app's own scripts run on the app's origin and can call the CRT API cross-origin exactly as the overlay does (loopback CORS, F-6) — the same capability page scripts had on the proxied origin (N-8). No new route, no new page-writable key; `/__crt/internal/*` stays Origin-refused; the loader carries no token. Stated in the README's Privacy paragraph.

## 8. Milestones

Each milestone is one task file. DoD items are **worker-checkable** unless marked **Manual (Simon)**; the worker ticks what it verified, leaves Manual items unticked, sets `review`, and names the unticked items in its reply. Order: M15 → M16 → M18; M17 needs M15 (the mode) and can run before or in parallel with M16 (the import names it prints are fixed by §4 and F-97).

**M15 — Embedded server mode and the loader (`.crt/tasks/CRT-0019`).** F-91, F-92, F-93, F-94, F-95, F-96, N-20, N-21, N-22, the server/overlay/`embedded.spec.ts` halves of F-110. DoD: `npm run check` green with every F-91 row in `start.test.ts`; `crt` on this repo (with a dev server on any probed port) prints the embedded ready line and a request to `/` returns the landing page; `crt proxy 3999` against the e2e fixture behaves exactly as `crt 3999` did in v0.3 (`e2e/proxy.spec.ts` and `start.spec.ts` green on the proxy server); `e2e/embedded.spec.ts` green in the PR run; the loader is ≤ 5 KB gzipped and `dist/loader.js` + `dist/integrations/loader.js` are built; **Manual (Simon):** on the trial app with `<script src="http://localhost:4400/__crt/loader.js">` pasted into `app/layout.tsx` for the test, `crt` opens `:3100` with the CRT button and the welcome card's embedded copy, and a full Send writes a task.

**M16 — Package entries and the production guarantee (`.crt/tasks/CRT-0020`).** F-97, F-98, N-18, their F-110 rows. Depends on M15 (`loader.ts`). DoD: `npm run build` produces `dist/integrations/{loader,react,vite,noop-loader,noop-react}.js` with `.d.ts`; `npm pack --dry-run` lists them; the F-98 test passes on both runners (production outputs clean, development outputs carry the loader); the Vite plugin's `transformIndexHtml` output is asserted; **Manual (Simon):** `<CrtDevTools />` in the trial app's layout shows the button under `next dev` and `next build`'s `.next/static` is clean; a scratch Vite app with `crt()` works and its `vite build` is clean.

**M17 — Explicit setup and agent awareness (`.crt/tasks/CRT-0021`).** F-99, F-100, F-101, F-102, F-103, F-104, F-105, F-106, N-19, their F-110 rows. Depends on M15. DoD: `npm run check` green; `crt init` on a scratch project prints the plan, writes the five items, prints each, and the second run says it is set up; the block lands in `CLAUDE.md` and `AGENTS.md` fixtures per F-101 including the `@AGENTS.md`-only case; `crt --yes` on an un-initialised scratch project initialises and starts, `crt` without `--yes` off a terminal refuses with the F-99 line; `claude plugin validate ./plugin` passes with seven skills and the pin test covers them; `crt init` run on **this repository** adds `.crt/README.md` and the CRT section to `CLAUDE.md`, both committed in the PR (dogfooding); **Manual (Simon):** in Claude Code on the trial app, `/crt:init` adds `<CrtDevTools />` to `app/layout.tsx` and the CRT section to `AGENTS.md`, and a fresh Claude Code session there lists the section's guidance when asked what `.crt/` is.

**M18 — Docs, e2e flip, PRD amendments, release 0.4.0 (`.crt/tasks/CRT-0022`).** F-107, F-108, F-109, the M18 half of F-110, §10 evidence, version bump, tag, publish. Depends on M15–M17. DoD: README quotes every new line (doc test); the e2e primary servers run embedded with the fixture pages carrying the loader and `capture`/`chat`/`arrival`/`focus` specs green on the app origin (or the Log names the ones left on the proxy server and why); every §9 row applied; every §10 row ticked with evidence; versions `0.4.0` everywhere the pin test looks; **Manual (Simon):** the F-109 trial-app and Vite rows; `v0.4.0` tagged, release workflow green, promoted on npm.

## 9. Amendments to `docs/PRD.md` v1.0, `docs/PRD-providers.md`, `docs/PRD-setup.md` and `CLAUDE.md`

| Statement | v0.4 |
|---|---|
| PRD §2 Goal 5 "No changes to the target app's code are required." | "One dev-only line in the app (the F-102 snippet) puts CRT on the app's own URL; proxy mode still needs no change to the app." |
| PRD §3 Non-goal 3 "The overlay is injected by a local proxy (or a script tag)" | "The overlay is loaded by a dev-only integration in the app (default) or injected by a local proxy (`crt proxy`)." |
| PRD §4 steps 1 and 6 | replaced/extended by §4 above. |
| PRD §5 diagram and §5.1 "run an HTTP reverse proxy that rewrites HTML responses…" | the CRT server is the agent host; in embedded mode it serves `/__crt/*` and a landing page; the proxy is `crt proxy`. Diagram redrawn in the README (F-107) and noted inline. |
| PRD §5.2 "Why a proxy" | "Why a proxy — and why it is no longer the default (v0.4)": the paragraph stands as history; PRD-embedded §1 and §5.2 give the reversal. |
| PRD §8 Setup experience | replaced by the block in §4 above. |
| F-1 `crt serve` "starts the proxy" | starts the CRT server in embedded mode (F-91); `crt proxy` starts the proxy (F-92). |
| F-2, F-3 | proxy mode only (F-92); unchanged there. |
| F-5 status line | the F-93 shape. |
| F-6 script-tag mode (Should) | superseded by the loader (F-96) and the entries (F-97): embedded mode *is* script-tag mode, productised; the CORS rule stays. |
| F-20 "the overlay hooks these at injection time" | the loader hooks them (F-96) in embedded mode; `early.js` in proxy mode. |
| F-23 "pruned on server start" | only when `.crt/captures/` exists (F-99). |
| F-35 "`crt init` (run automatically by `serve`)" | `crt init` is explicit (F-99, F-100); it also writes `.crt/README.md` and the F-101 section; `config.json` gains `mode`. |
| F-36 `/crt:serve` | F-105: embedded by default, `--proxy` for proxy mode, offers `/crt:init` when the project is not set up. |
| F-41 SessionStart hook | may add the F-106 line. |
| N-5 "The server never writes outside `.crt/` and the OS temp dir" plus its three exceptions | true again at runtime with no exceptions (N-19); the explicit CLI exceptions are `crt init` (`.gitignore`, `CLAUDE.md`, `AGENTS.md` inside the markers), `crt skills install` (F-58) and `crt setup` (F-86). |
| N-6 | extended by the lines in F-91, F-93, F-94, F-99, F-100, F-103. |
| PRD §11 rows "`/crt:serve` … proxies it with HMR intact, and opens the browser on `localhost:4400`" | reads "…starts the CRT server and opens the app's own URL; `crt proxy` proxies it with HMR intact"; evidence unchanged for proxy mode. |
| PRD §12 risk "Proxying breaks some apps" | mitigation: "embedded mode is the default (v0.4); proxy mode remains for apps that cannot be touched". |
| PRD-providers N-8 "Page scripts in the proxied app run on CRT's origin." | "…on CRT's origin (proxy mode) or on their own loopback origin with CORS to CRT (embedded mode) — the same capability either way (N-22)." |
| PRD-setup §3 "Periodic health polling from the overlay" | still a non-goal; the loader's retry is event-driven (F-96, N-20). |
| PRD-setup F-71 guided target | proxy mode only; embedded mode runs the soft form in F-91. |
| PRD-setup F-73 reuse "same `projectRoot` and `target`" | same `projectRoot` and `mode` (and `target` in proxy mode) (F-93). |
| PRD-setup F-75 ready line and first-init line | the F-93 line; the first-init line is `crt init`'s output (F-100), never printed by `crt` unless `--yes` ran init. |
| PRD-setup F-76 rows | `.crt`, `target` (embedded), new `mode`, `integration`, `instructions` (F-103). |
| PRD-setup F-78 health | gains `mode`, `app`, `overlay.loader` (F-93). |
| PRD-setup F-80 | proxy mode only; embedded mode has the F-94 line. |
| PRD-setup F-82 welcome card "Never shown … in script-tag mode" | shown in embedded mode with the F-95 copy. |
| PRD-setup F-83 | replaced by F-105. |
| PRD-setup F-86 "restart Claude Code to load /crt:serve, /crt:next, /crt:tasks, /crt:task, /crt:done, /crt:intake" | the list gains `/crt:init` (seven skills); F-87's "six skills" reads "seven". |
| PRD-setup N-16 | the loader and the entries add no network: loopback only, and only from a loopback page (N-20). |
| CLAUDE.md "Read `docs/PRD.md`, `docs/PRD-providers.md` and `docs/PRD-setup.md`" | "…and `docs/PRD-embedded.md`" (applied in the PR that adds this document). |
| CLAUDE.md "What this is": "A local proxy + in-page overlay" | "A local CRT server + in-page overlay loaded by a dev-only integration in the app (or by a proxy, `crt proxy`)" (applied by M15). |
| CLAUDE.md entry points, conventions, build, Don'ts, Release lines | per F-108 (applied by M15, M16, M17, M18 as each lands). |

## 10. Definition of done (v0.4)

Ticked by M18 with evidence (test name, e2e spec, task Log entry or run URL).

- [x] `crt` in a project whose app carries the snippet opens the app's own URL with the CRT button on it and no proxied copy; the ready line reads `(embedded; …)` (M15 Manual + `e2e/embedded.spec.ts`). — CRT-0019 Log 2026-09-17T13:40 (worker run on the trial app: `CRT ready at http://localhost:4400 for http://localhost:3100 (embedded; …)`, launcher `connected` on `:3100`) and 2026-09-17T14:05 (Simon: "that worked"); `e2e/embedded.spec.ts` "health says embedded, / is the landing page, the ready and reuse lines …" (F-91, F-93); since M18 every browser spec (`capture`, `chat`, `arrival`, `focus`) runs on the app origin `http://localhost:3999` against the embedded server on `:4499` (`playwright.config.ts`, CRT-0022 Log).
- [x] A `console.error` fired by the page before the overlay script ran is in the capture (F-96 hooks; `embedded.spec.ts`). — `e2e/embedded.spec.ts` "the loader is fetched, a console.error fired before the overlay ran is captured …" (`fixture: after the loader, before the overlay` present, `fixture: before the loader` absent by design, F-95); `e2e/capture.spec.ts` "console hooks (F-20)" now on the app origin through the loader (M18).
- [x] Stopping `crt` and reloading an app page shows the loader pill; starting `crt` and focusing the tab brings the overlay back without a reload (`embedded.spec.ts` for the pill; M15 Manual for the retry). — `e2e/embedded.spec.ts` "the ES module loader bundled into a page shows the pill once the server is gone and brings the overlay back on focus when it is running again (F-96)"; CRT-0020 Log 2026-09-18T10:45 on the trial app (Next 16.3.5): server stopped + reload → the pill, server restarted + pill click → overlay back with no reload.
- [x] `crt proxy` behaves as v0.3 `crt` did: `proxy.spec.ts`, the F-71/F-73 rows and the F-80 line all green under proxy mode (N-21). — `e2e/proxy.spec.ts` (6 tests) against the dedicated `crt proxy` server on `:4496` (M18); `e2e/start.spec.ts` F-71/F-73 rows and `e2e/arrival.spec.ts` "a page whose CSP blocks the overlay script produces the F-80 line …" on `crt proxy` servers of their own; `test/start.test.ts` every F-71 row unchanged (CRT-0019 Log 2026-09-17T13:40); the proxy code path untouched beyond mode selection (CRT-0019).
- [x] The F-98 test proves production builds (esbuild, Vite) are clean and development builds carry the loader; `next build` of the trial app is clean (M16 Manual). — `test/production-guard.test.ts` (5 tests: esbuild `--define … --conditions=production` clean, the NODE_ENV guard alone clean once minified, development carries `mountCrt` / `http://localhost:4400` / `/__crt/overlay.js`, `vite build` with `crt()` + `<CrtDevTools />` clean); CRT-0020 Log 2026-09-18T10:45: `npx next build` (Turbopack, Next 16.3.5) → `.next/static` has none of `__crt`, `loader.js`, `mountCrt`, `4400` (the no-op module's `CrtDevTools` export name is the only trace — §12 rule 4); scratch Vite 8.3.0 app `vite build` → 0 hits.
- [x] `crt init` prints its plan, writes `.crt/README.md`, `.crt/tasks/`, `.crt/config.json`, the `.gitignore` lines and the CRT section, each announced; the second run says it is set up; `crt` off a terminal refuses an un-initialised project with the F-99 line (unit rows + Log). — `test/project-init.test.ts` (plan / apply / second run / `--no-instructions` / `--snippet [--json]` / README written once / `mode: "embedded"`), `test/start.test.ts` "ensureInitialised" rows, `e2e/start.spec.ts` "an un-initialised project: `crt` off a terminal refuses with the F-99 line, `crt tasks` is not an error, `crt --yes` sets it up and starts (F-99, F-100)"; the scratch-project transcript in CRT-0021 Log 2026-09-18T10:50.
- [x] The CRT section lands in `CLAUDE.md` / `AGENTS.md` per F-101 in every fixture case, and this repository's own `CLAUDE.md` carries it (M17). — `test/instructions-block.test.ts` (append, `@AGENTS.md`-only `CLAUDE.md` skipped, create per provider, unchanged on a matching stamp, replaced by markers on an older one, LF only); this repo's `CLAUDE.md` "## CRT (Claude Review Tool)" between `<!-- BEGIN:crt v0.4 -->` / `<!-- END:crt -->` and `.crt/README.md`, both written by the built `crt init` (CRT-0021 Log 2026-09-18T10:50, byte-identical to the templates per the prd-reviewer).
- [x] `crt init --snippet --json` names the right framework and file for next / vite / react / bundled / static fixtures (unit rows). — `test/project-init.test.ts` `detectIntegration` rows for next / vite / react / bundled / static with and without the candidate files (CRT-0021 Log 2026-09-18T10:50).
- [x] `/crt:init` adds the snippet to the trial app and the section to its `AGENTS.md`; `/crt:serve` offers it when `.crt/` is missing (M17 Manual + skill tests). — CRT-0021 Log 2026-09-21T09:50: `claude -p "/crt:init"` with the 0.4.0 plugin dir on the trial app applied the snippet to `app/layout.tsx` and the section to `AGENTS.md`; a fresh session answered "what is .crt/?" from the section; `/crt:serve` on a scratch project without `.crt/` asked and created nothing. The skill half is covered: `test/init-skill.test.ts` (the three steps, the four recipes, grep before editing, never commit, no file outside the snippet targets) and `test/serve-skill.test.ts` (step ½ question and both outcomes, `crt serve --open --yes` / `crt proxy …` under `--proxy`); the CLI half by CRT-0022's manual pass on the trial app (`crt init` from the 0.4.0 tarball added the section to `AGENTS.md`, not to the `@AGENTS.md` `CLAUDE.md` — CRT-0022 Log).
- [x] `crt doctor` shows the `mode`, `integration` and `instructions` rows and never fails on them (unit rows). — `test/doctor.test.ts`: the F-76 sample with the F-103 rows verbatim, `.crt` `--`/ok/warn, `mode` embedded / proxy (.crt/config.json) / embedded (.crt/config.local.json), embedded `target` `--`/ok/warn (never FAIL), `integration` next/vite/loader/script/not found/static/proxy mode, `instructions` one/both/none/lacking, an un-initialised embedded root exits 0 (CRT-0021 Log 2026-09-18T10:50).
- [x] README: Install, snippets, Production, What lands in your repo, Proxy mode; every new `crt:` line quoted (doc test). — `test/readme.test.ts` "README › F-107 (PRD-embedded, M18) …" (the four snippets verbatim in both READMEs, Production's verified bundlers, What lands in your repo's five items and the N-19 rule, Proxy mode in place of the script-tag fallback, How it works embedded first, the N-22 Privacy paragraph, the two Troubleshooting entries, every F-91/F-93/F-94 line) plus the earlier F-99/F-100/F-103/F-106 rows (CRT-0022 Log).
- [x] CI green on `main`; `v0.4.0` tagged, published and promoted; GitHub Release exists. — PR #55 checks green on main (91252db); tag `v0.4.0` at 4c5dffe; `release` workflow run 35548655339 succeeded 2026-09-21; GitHub Release v0.4.0; `npm view claude-review-tool version` → `0.4.0` after promotion (CRT-0022 Log 2026-09-21T10:05).

## 11. Risks

| Risk | Mitigation |
|---|---|
| A bundler does not honour the `production` export condition | Layers 2–4 of F-98 stand on their own; the test covers esbuild and Vite; the README says how to verify any build. |
| Next.js treats `"use client"` from a package entry differently in a future major | The entry is one file with the directive first; §12 rule 1; the trial app on Next 16 is the Manual row. |
| A `console.error` logged before the React effect runs is missed in Next apps | Documented (F-95); the Vite plugin and the loader import run earliest; a Should for a Next `instrumentation-client` hook is Open question 3. |
| CSP in the app blocks `script-src http://localhost:4400` or `connect-src` | README Troubleshooting names both directives; proxy mode relaxes CSP for its own origin and stays available. |
| The stepped port (F-73) leaves the app's loader pointing at 4400 | The F-93 extra line; `crt --replace`; `port` in `.crt/config.json` is read by the Vite plugin. |
| `crt init` edits `CLAUDE.md` in a repo where that file is owned by a team | The plan is printed first and confirmed on a terminal; `--no-instructions`; the markers make removal one deletion; nothing at runtime ever touches it. |
| Existing users run `crt` after upgrading and the browser opens their app without a button | The F-94 line and `/crt:serve`'s step-4 sentence name `crt init` and `crt proxy`; the landing page on `:4400` explains itself; `crt doctor`'s `integration` row. |
| The e2e axis flip (M18) is larger than it looks | M15 keeps the primary servers in proxy mode; M18 flips spec by spec and may leave one on the proxy server with a Log entry. |
| Overlay budget (N-3) with the loader added | The loader is separate (≤ 5 KB); the overlay bundle itself does not grow beyond the welcome copy change. |

## 12. Verification protocol for the builder

This document was written from the code on `main` at 9d46230, the F-6 e2e, and the documented Vite/Next/esbuild behaviours. When the real tool differs:

1. **A hook or option differs but the capability exists** (e.g. Vite's `transformIndexHtml` `order`, `injectTo` names, Next's handling of `"use client"` in a dependency): use the real one, record the tested versions in the module header and the fixture, proceed.
2. **A bundler ignores the `production` condition**: keep the condition (it costs nothing), rely on layers 2–4, record the bundler and version in the README's Production section, and keep the F-98 assertions on the strings.
3. **The cross-origin `EventSource` or a CORS preflight fails in some browser**: Chromium is the tested browser (Playwright); document the other browser in the README; never widen the CORS rule beyond loopback.
4. **A Next production bundle keeps the string `CrtDevTools`** (an export name in an RSC manifest): acceptable — the F-98 list deliberately excludes the component name; what must be absent is the loader code, the CRT paths and the port.
5. **`crt init` finds a `CLAUDE.md` that already mentions CRT without the markers**: append the marked section anyway (the markers are the contract); note it in the Log.
6. **The e2e flip breaks a spec for a non-mechanical reason**: leave that spec on the proxy server, say why in the task Log, and keep the proxy server in `playwright.config.ts` for it.

## 13. Decisions taken and open questions

**Decisions** (the builder does not revisit these):

1. Embedded mode is the default; proxy mode is `crt proxy` and stays fully supported and tested — §5.1.
2. The overlay is always fetched from the running CRT server, never bundled into the app, so overlay and server versions cannot drift; only the loader (≤ 5 KB) is bundled — §5.2.
3. The ESM loader entry has no side effect on import; the IIFE served at `/__crt/loader.js` auto-mounts — F-96.
4. The loader never polls; it retries on focus/visibility and on a click — N-20 (PRD-setup §3 stands).
5. `crt` refuses or asks on an un-initialised project; `crt init` is the only path that creates `.crt/` — F-99, F-100.
6. The agent section goes into `CLAUDE.md` and `AGENTS.md` behind markers, versioned; `.crt/README.md` is written once and hand-editable — F-100, F-101.
7. The config key stays `target` in both modes (it is the app's origin in both); the README calls it "your app's URL" — F-91.
8. Three entries (`react`, `vite`, `loader`) plus the script tag; no per-framework entry beyond those until asked — §5.3.
9. Version `0.4.0`; the skills pin `@0.4` — F-109.
10. M15 keeps the e2e primary servers in proxy mode; the flip is M18's — F-110.

**Open:**

1. **Autostart from the Vite plugin** (`crt({ start: true })` spawning `crt` when nothing answers on the port). Decide after v0.4 has been used for a week; the process-tree concerns of PRD-setup §3 apply.
2. **Tasks outside `.crt/`** (`docs/crt/tasks`). `tasksDir` exists; the hook and the skills would need to read config. Decide when a project asks for it.
3. **A Next.js `instrumentation-client` entry** so the hooks run before hydration, and first-class entries for SvelteKit/Nuxt/Angular. Add when a maintainer asks; each is ≤ 40 lines under §5.3.
4. **Same-origin API through dev-server middleware** (Vite `configureServer` proxying `/__crt` to CRT). Only if CSP-heavy apps make cross-origin impractical.
5. **Rename** (carried from PRD-providers Open question 1): with the proxy gone from the default path, the product is "an in-page review tool for coding agents"; the name decision is still after users on two providers.
