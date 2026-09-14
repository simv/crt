# CRT — Claude Review Tool

Read `docs/PRD.md` before doing anything non-trivial. It defines scope, requirement IDs (F-n, N-n), milestones (M1–M5) and the project definition of done. Requirement IDs are referenced in code comments, tests, commits and PRs.

## What this is

A local proxy + in-page overlay that lets a developer annotate their running site and talk to Claude in the page; Claude writes a self-contained task file to `.crt/tasks/` that any later session can complete with `/crt:next`. One repo, three deliverables: `packages/server` (npm `claude-review-tool`, bin `crt`), `packages/overlay` (bundled into the server), `plugin/` (Claude Code plugin, marketplace at repo root).

## Commands

- `npm ci` — install (npm workspaces, Node ≥ 20)
- `npm run check` — typecheck + lint + unit tests + build (what CI runs)
- `npm test` — Vitest unit tests (`packages/server/test`)
- `npm run e2e` — Playwright smoke tests (added in M1; fixture app behind the proxy)
- `npm run build` — builds overlay into `packages/server/dist/overlay.js`, then the server

## Conventions

- TypeScript strict, ESM, no default exports. Node built-ins over dependencies; add a dependency only when it removes real code.
- All Agent SDK usage lives in `packages/server/src/session.ts` behind a small interface (PRD §12).
- Overlay is framework-free, renders inside Shadow DOM, no globals except `window.__crt` for debugging.
- Every CRT HTTP/WS route is under `/__crt/`. Server binds `127.0.0.1` only.
- Windows is the primary dev platform: use `node:path`, never hand-build paths; spawn with `shell: false`; write files with `\n`.
- Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`), squash-merge PRs, short-lived branches `crt/<id>-<slug>` or `feat/<topic>`.
- Reference the PRD requirement in tests: `it("injects overlay script (F-2)", …)`.

## Work tracking

This repo dogfoods CRT. Work items are `.crt/tasks/CRT-NNNN-*.md` in the PRD F-32 format. Claim a task before starting it (status → `in_progress`, Log entry), append to its Log as you go, set `review` when its Definition of Done is fully ticked. Once `/crt:next` exists (M4), use it.

## Don'ts

- Don't add features not traceable to a PRD requirement; propose a PRD change first.
- Don't write outside `.crt/` from the server at runtime.
- Don't send anything off-machine except the model calls Claude Code already makes.
