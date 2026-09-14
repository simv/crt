---
id: CRT-0002
title: M2 — Annotation tools and capture engine
status: in_progress
priority: high
created: 2026-09-14T20:50:00+08:00
updated: 2026-09-15T07:55:00+08:00
url: null
route: null
session: null
tags: [m2, overlay, capture]
files: [packages/overlay/src/ui.ts, packages/overlay/src/capture.ts, packages/overlay/src/component.ts, packages/overlay/src/screenshot.ts, packages/server/src/capture-schema.ts, packages/server/src/captures.ts, packages/server/src/proxy.ts]
---

## Summary
Build the in-page markup experience: Select / Box / Pin tools with numbered notes, and the capture engine that freezes screenshots, element details, component chain, console errors and page metadata into `.crt/captures/<id>/`.

## Context
PRD §6.2 (F-7…F-13) and §6.3 (F-15…F-23), milestone M2. Depends on CRT-0001 (proxy serving the overlay and a `/__crt/` API). The overlay is framework-free TypeScript inside Shadow DOM; the server exposes `POST /__crt/captures` that writes the JSON and PNGs. Screenshots use DOM rasterisation (`html-to-image` or `modern-screenshot`) — evaluate both for fidelity on the trial Next.js app and pick one; document the choice in the Log.

## Evidence
None — greenfield task from the PRD.

## Ask
1. Launcher (F-7): draggable corner button, `Ctrl/Cmd+Shift+.` toggles the toolbar; toolbar has Select, Box, Pin, Clear, Send, and a count badge.
2. Select (F-8): hover outline + label (tag, id/classes, component name); click pins; `↑`/`↓` walk parent/first child; `Esc` cancels.
3. Box (F-9): drag rectangle; record intersecting elements (top 10 by area).
4. Pin (F-10): point annotation with no element.
5. Notes and numbering (F-11): each annotation gets a number badge and an inline note field; delete individually; annotations persist across SPA navigation (F-12) and, as a Should, across reloads via `sessionStorage`.
6. Capture engine (F-15…F-20, F-22): implement `capture(): Promise<CaptureBundle>` producing the schema in `packages/server/src/capture-schema.ts` (define it with a JSON-schema-like TS type and a runtime validator). Include React fiber walk for component chain and `_debugSource`, Vue fallback, console/error hooks installed at overlay load, framework detection.
7. Send (F-13): POST the bundle plus PNGs (multipart or base64) to `/__crt/captures`; server writes `.crt/captures/<capture-id>/capture.json`, `viewport.png`, `viewport-annotated.png`, `ann-<n>.png`; prunes captures older than 7 days on start (F-23). For M2 the UI simply shows the capture path; the chat panel arrives in M3.
8. e2e: Playwright drives the fixture page through the proxy, places one Select and one Box annotation via the overlay's `window.__crt` test hooks, sends, and asserts the written `capture.json` validates and PNGs exist. Unit-test the selector generator and the fiber walk against a small React 18 fixture rendered with `react-dom` in jsdom or a Playwright page.

## Definition of Done
- [x] All Must items F-7…F-13 and F-15…F-20, F-23 implemented and referenced in tests or the Log.
- [ ] `npm run check` and `npm run e2e` pass locally and in CI.
- [x] Manual on the trial Next.js app: selecting a component-rendered element records the React component chain and a source file; console errors thrown before Send appear in the bundle; screenshots are recognisable.
- [x] Overlay bundle ≤ 150 KB gzipped (N-3); measured size recorded in the Log.
- [x] `capture-schema.ts` documents every field with the F-id that requires it.

## Notes
Do not start the chat panel here; keep the M3 boundary clean so the SDK work is isolated.

## Log
- 2026-09-14T20:50+08:00 — created from PRD milestone M2 during project setup.
- 2026-09-15T07:15+08:00 — claimed by worker session d88bfc31-01d0-4811-b430-0b1454f12e52. Decision: CRT-0001 (the dependency) is in `review` on PR #2, not yet on `main`, so this branch `crt/CRT-0002-m2-annotate-and-capture` is stacked on `crt/CRT-0001-m1-skeleton-and-proxy` and the PR targets that branch; retarget to `main` once #2 merges. The untracked `Claude outputs/` folder in the working tree is not part of the repo and is left alone.
- 2026-09-15T07:55+08:00 — worker session 2773e99b-bd95-408e-ae17-f7a88369c6cc: implementation complete, verification below.
  - **Files.** Overlay split into modules: `console-hook.ts` (F-20 ring buffer, shared by `early.ts`), `selector.ts` (F-17 unique CSS selector + XPath), `component.ts` (F-18 React/Vue chain + source, F-22 framework hints), `element.ts` (F-17/F-19 element details), `annotations.ts` (F-11/F-12 store + `sessionStorage`), `screenshot.ts` (F-16), `capture.ts` (F-13/F-15 bundle + POST), `ui.ts` (F-7…F-10 launcher, tools, markers, notes panel), `index.ts` (boot + `window.__crt` test hooks). Server: `capture-schema.ts` (schema DSL → inferred TS types + runtime validator; every field's `doc` starts with its F-id and a unit test enforces that), `captures.ts` (write + 7-day prune, F-23), `POST /__crt/captures` and `GET /__crt/early.js` in `proxy.ts`, prune on `serve`. Tests: `test/{capture-schema,captures,owner-stack}.test.ts` + 3 proxy tests (72 unit); `e2e/capture.spec.ts` (16 Playwright tests: selector/XPath, React 18 fiber walk incl. forwardRef/memo/`_debugSource`, console hooks, launcher click/shortcut/drag, Select hover+↑/↓+Enter, Esc, Box drag, Pin, notes/renumber/delete/clear, SPA nav + reload persistence, full Send → files on disk validated, detached element, React page chain). Fixture gained `/app` (rich DOM, fixed header, load-time errors) and `/react` (React 18 UMD from node_modules with `__source`). `react`/`react-dom` and `modern-screenshot` were already added as devDependencies by the claiming session.
  - **Screenshot library (Ask 6).** `modern-screenshot` 4.7.0 chosen over `html-to-image`: same lineage/API, maintained, clones shadow roots, and its `restoreScrollPosition` renders scrolled containers correctly (we rely on it for the document scroll). Its one gap vs html-to-image — it skips cross-origin `<link>` stylesheets it cannot read, so Google-Fonts pages lost their webfont (trial app rendered in a fallback font, nav wrapped) — is closed in `screenshot.ts` by fetching those sheets, inlining the loaded families' `@font-face` as data URLs into a temporary same-origin `<style>` for the capture. The browser already fetched those fonts for the page, so this is page traffic, not CRT traffic (N-4). `position: fixed` elements are re-anchored absolutely in the clone (they would otherwise shift with the scroll translate). Rasterisation capped at 2× DPR, 8 s timeout; failure yields `screenshots.error` and null image names rather than a failed Send.
  - **F-20 early hook.** A deferred overlay runs after the page's inline scripts, so load-time `console.error`s were missed. The proxy now injects `<script src="/__crt/early.js"></script>` (1.4 KB, 739 B gz, blocking, same-origin so CSP `'self'` still suffices) right before the overlay tag; it installs the hooks and parks the buffer on `window.__crt.__console`, which overlay.js adopts. F-2's overlay tag is unchanged; the M1 tests that asserted the exact `</head>` position now assert `INJECT_TAGS`.
  - **React 19 (trial app is Next 15.5 + React 19.2).** `_debugSource` is gone, so `component.ts` parses the fiber's `_debugStack` owner stack: first non-React/Next frame → file (exact, after stripping `about://React/Server/`, `webpack-internal:///(rsc)/./` and `?id`), line (the dev bundle's line, so approximate) — recorded as `source.via: "owner_stack"` vs `"debug_source"` so Claude knows how far to trust the line. The chain walks `_debugOwner` (owners: the components whose JSX rendered the element; includes Server Components as `kind: "server"`) and falls back to `.return` (parent tree) only when no owner info exists; the parent tree on an app-router page is all Next internals (`SegmentViewNode`, `InnerLayoutRouter`, …), the owner chain is the app's.
  - **Box semantics (Ask 3).** "Intersecting elements, top 10 by area" refined to: elements with ≥ 50 % of their own area inside the box, largest first, max 10; else the deepest element at the box centre. Plain intersection always ranks `body`/page wrappers first, which is never what was boxed.
  - **Other decisions.** Selectors skip hashed/generated ids and classes (css-modules, emotion, React `useId`) in favour of structural steps so they survive HMR. Sent annotations are cleared after a successful Send and the panel shows the capture path (M3 replaces this with the chat). Annotations persist across reloads via `sessionStorage` (F-12 Should) and re-resolve elements by selector; an element that left the DOM is sent from its snapshot with `detached: true`. F-21 (failed network requests, Should) not done — not in this task's Ask.
  - **Size (N-3).** `dist/overlay.js` 58.4 KB raw / **20.8 KB gzipped** (+ `early.js` 0.7 KB gz), of which modern-screenshot is ~14 KB gz. Idle cost: one rAF loop repositioning markers only while annotations exist; nothing when there are none.
  - **Verification.** `npm run check` green on Windows (Node 24.18): typecheck both packages, 72 unit tests, build. `npm run e2e` green: 22 Playwright tests (6 M1 + 16 M2). Manual, trial Next.js app (`C:\Projects\Claude\Apex\apps\web`, Next 15.5.25 / React 19.2.8, `next dev` on :3000, `crt serve` run from a scratch dir so the Apex repo was not touched; driven by a Playwright script through `window.__crt`): (a) Select on the header logo link → `components: LinkComponent (function) → SiteHeader (server) → HomePage (server)`, `source: components/SiteHeader.tsx:93 (owner_stack)` — the JSX is actually at line 103, file correct; nav links likewise resolve to `SiteHeader.tsx`. (b) `console.error("trial: …")` fired before Send appears in `console` with level `error`. (c) `viewport.png`/`viewport-annotated.png` are pixel-faithful to a real Playwright screenshot of the same page (Archivo webfont embedded, layout identical, badge on the selected element). (d) `framework: { name: "next", version: "15.5.25", bundler: "webpack" }`; `route` is null on app-router pages (no `__NEXT_DATA__.page`). The fixture app additionally confirmed a scrolled page with a fixed header renders correctly. Simon can repeat (a)–(c) interactively: start the trial app, run `node C:\Projects\Claude\review-tool\packages\server\dist\cli.js serve --open` from its folder, click **CRT → Select**, pick an element, add a note, **Send to Claude**, then open the printed `.crt/captures/<id>/capture.json` and PNGs.
  - **CI.** DoD item 2 stays unticked until the PR's `check (ubuntu-latest)`, `check (windows-latest)` and `e2e (ubuntu)` jobs are green; status → `review` in the follow-up commit. PR targets `crt/CRT-0001-m1-skeleton-and-proxy` (stacked; #2 is still open) — retarget to `main` once #2 merges.
