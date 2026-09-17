---
id: CRT-0020
title: M16 — Package entries (react, vite, loader) and the production guarantee
status: backlog
priority: high
created: 2026-09-17T08:54:00+08:00
updated: 2026-09-17T08:54:00+08:00
url: null
route: null
session: null
tags: [m16, embedded, integrations, production, f-97, f-98, n-18, f-110, prd-embedded]
files: [packages/server/package.json, packages/server/src/integrations/vite.ts, packages/overlay/src/react.ts, packages/overlay/src/loader.ts, packages/overlay/package.json, packages/server/scripts/copy-intake.mjs, packages/server/test, README.md, CLAUDE.md]
---

## Summary
Ship the three dev-only entries an app imports to put CRT on its own page — `claude-review-tool/react` (`<CrtDevTools />`), `claude-review-tool/vite` (`crt()`), `claude-review-tool/loader` (`mountCrt`) — and prove, with a test that builds and greps, that a production build of an app using any of them contains nothing from CRT. `docs/PRD-embedded.md` §5.3, §5.4, §6.3 (F-97, F-98, N-18) and their F-110 rows.

## Context
M15 (CRT-0019) added the loader source `packages/overlay/src/loader.ts` and its ESM build `dist/integrations/loader.js`; this milestone makes it importable (`exports` in `packages/server/package.json`, which today has none — only `bin`) and adds the two framework entries around it. The trial Next.js app (`C:\Projects\Claude\tool-validation`, Next 16.3, App Router, `app/layout.tsx`) is the React target; Vite's `transformIndexHtml` with `apply: "serve"` is the Vite target. The production guarantee is four layers (PRD-embedded §5.4): the `production` export condition mapping the browser entries to no-op modules, the `process.env.NODE_ENV !== "production"` guard around every body, the loader's loopback guard (already in M15), and `apply: "serve"`. esbuild is already a devDependency; `vite` becomes one for the F-98 build test. `react` and `vite` are optional peer dependencies; no runtime dependency is added (PRD-providers N-11).

## Evidence
No page capture: created from `docs/PRD-embedded.md` milestone M16 by the planning session that wrote it.

## Ask
1. `exports` (F-97): `packages/server/package.json` gains `"exports": { "./loader": { "types", "production": "./dist/integrations/noop-loader.js", "default": "./dist/integrations/loader.js" }, "./react": { "types", "production": "./dist/integrations/noop-react.js", "default": "./dist/integrations/react.js" }, "./vite": { "types", "default": "./dist/integrations/vite.js" }, "./package.json": "./package.json" }` and nothing else (no main). `peerDependencies` `react >=18`, `vite >=5`, both optional in `peerDependenciesMeta`. `keywords` gains `devtools`, `vite-plugin`, `nextjs`. Confirm `npx --no crt`, the hook's `node_modules/claude-review-tool/package.json` read (F-84) and `crt setup`'s `dist/plugin-marketplace` path still work with `exports` present (they use `bin` and direct fs reads).
2. React entry (F-97): `packages/overlay/src/react.ts` — `"use client"` first, `import { useEffect } from "react"`, `export function CrtDevTools(props: { port?: number; origin?: string }): null` calling `mountCrt(props)` once in an effect; SSR-safe; built to `dist/integrations/react.js` (ESM, `react` external) with the directive preserved (esbuild keeps directives at the top — verify, §12 rule 1) and a hand-written or generated `react.d.ts`.
3. Vite entry (F-97): `packages/server/src/integrations/vite.ts` — `export function crt(options?: { port?: number; root?: string })` returning `{ name: "claude-review-tool", apply: "serve", transformIndexHtml: { order: "pre", handler } }` that prepends the inline module `import { mountCrt } from "claude-review-tool/loader"; mountCrt({ port: <n> })` to `<head>`; `<n>` from `options.port`, else `readConfig(findProjectRoot(options.root ?? config.root)).port`, else 4400; imports `init.ts` and `project.ts` only; types via tsc (`import type { Plugin } from "vite"` — a devDependency; if Vite's types are too heavy for the server's tsc, declare the small structural type locally).
4. No-ops and guards (F-98): `dist/integrations/noop-loader.js` (`export function mountCrt() {}`) and `noop-react.js` (`"use client"; export function CrtDevTools() { return null; }`) — none of the F-98 strings inside; every entry body behind `process.env.NODE_ENV !== "production"` (the loader's `mountCrt` too, in addition to its loopback guard); the Vite plugin `apply: "serve"`.
5. Build (F-97): the overlay `package.json` build gains the React entry and the ESM loader outputs; `copy-intake.mjs` (or the overlay build) writes the no-op files and the `.d.ts` files into `dist/integrations/`; `files` already includes `dist`; a unit test asserts every built entry exists after `npm run build`.
6. F-98 test (`test/production-guard.test.ts`, both runners): (a) esbuild-bundle a temp entry `import { mountCrt } from "claude-review-tool/loader"; import { CrtDevTools } from "claude-review-tool/react"; mountCrt(); CrtDevTools({});` with `--define:process.env.NODE_ENV='"production"' --conditions=production --bundle --format=esm --external:react` resolved against `packages/server` (a temp `node_modules/claude-review-tool` symlink or `alias`) → output contains none of `__crt`, `/loader.js`, `overlay.js`, `mountCrt`, `4400`; the same with `development` and no condition → contains `mountCrt` and `localhost`; (b) `vite build` of a fixture (`index.html` + `main.ts` importing the React entry rendering `CrtDevTools`, `vite.config` with `crt()` and `react` external or a tiny stub) → `dist/` clean; `vite`'s dev `transformIndexHtml` (call the plugin's handler directly, and once through `createServer` in middleware mode if cheap) → the inline module with the port; `vite` added as a devDependency (pinned range like the others).
7. Docs kept green: README gains the three import forms in a short "Add CRT to your app" stub and a "Production" stub (the full rewrite is M18); `CLAUDE.md` conventions line about the entries and the build line per PRD-embedded §9.

## Definition of Done
- [ ] `npm run build` produces `dist/integrations/{loader,react,vite,noop-loader,noop-react}.js` and their `.d.ts`; `npm pack --dry-run` lists them; a unit test asserts they exist.
- [ ] `test/production-guard.test.ts` passes on both runners: esbuild production output and `vite build` output are clean of every F-98 string; the development builds carry `mountCrt` and the CRT origin.
- [ ] The Vite plugin's `transformIndexHtml` output is asserted (inline module first in `<head>`, port from options, then `.crt/config.local.json`, then `.crt/config.json`, then 4400) and `apply` is `"serve"`.
- [ ] The React entry returns `null` at render, keeps `"use client"` as its first line in the built file, and the no-op modules export the same names (unit).
- [ ] `exports` breaks nothing: `npx --no crt --version`, the session-start hook's drift read and `crt setup`'s marketplace path are exercised by existing tests or a Log line.
- [ ] `npm run check` green; no new runtime dependency (`dependencies` unchanged; `react`/`vite` optional peers; `vite` a devDependency).
- [ ] Manual (Simon): in the trial app, `import { CrtDevTools } from "claude-review-tool/react"` + `<CrtDevTools />` in `app/layout.tsx` (with `claude-review-tool` installed as a devDependency or npm-linked from this repo) shows the button under `npx next dev -p 3100` with `crt` running; `npx next build` completes and `grep -r "__crt\|loader.js\|mountCrt\|4400" .next/static` finds nothing; a scratch `npm create vite@latest` (react-ts) app with `crt()` in `vite.config.ts` shows the button and its `vite build` output is clean.

## Notes
The entries must import nothing from `serve.ts`, `proxy.ts`, `sessions.ts`, `session.ts`, `providers/` or the SDK (PRD-embedded F-108's reviewer row; `init.ts`/`project.ts` are the allowed imports for the Vite plugin). The F-98 string list deliberately excludes `CrtDevTools`: an export name may survive in an RSC manifest (§12 rule 4). If a bundler ignores the `production` condition, keep it and record the bundler/version in the README (§12 rule 2). Keep the loader's size budget (N-20) — the React and Vite entries are separate files. `process.env.NODE_ENV` does not exist in a browser: the ESM entries leave the guard for the app's bundler to define (every bundler in F-98 does), while the IIFE loader from M15 is built with esbuild `--define:process.env.NODE_ENV='"development"'`; the React entry's built file must keep `"use client"` as its very first statement (esbuild preserves directives; verify after minification and add `--keep-names`/no-minify for that file if it does not). Pin the `vite` devDependency the way `esbuild` is pinned (`^` range); it is a build-time test tool, not a runtime dependency (N-11).

## Log
- 2026-09-17T08:54+08:00 — created from docs/PRD-embedded.md milestone M16 by the planning session that wrote it.
