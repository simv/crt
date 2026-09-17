# CRT — Claude Review Tool

Read `docs/PRD.md`, `docs/PRD-providers.md` and `docs/PRD-setup.md` before doing anything non-trivial. The first defines scope, requirement IDs (F-n, N-n), milestones (M1–M5) and the project definition of done; the second amends it for v0.2 (provider-agnostic intake: F-42…F-64, N-7…N-13, milestones M6–M11) and its §9 lists which v1.0 statements and CLAUDE.md lines change as each milestone lands; the third amends both for v0.3 setup and first run (guided `crt [target]`, `crt doctor`, `crt setup`, login preflight, arrival UX: F-69…F-90, N-14…N-17, milestones M12–M14) with its own §9 list. Requirement IDs are referenced in code comments, tests, commits and PRs.

## What this is

A local proxy + in-page overlay that lets a developer annotate their running site and talk to a coding agent in the page (Claude Code by default; the agent is a *provider*, resolved per PRD-providers F-43); the agent writes a self-contained task file to `.crt/tasks/` that any later session can complete with `/crt:next`. One repo, three deliverables: `packages/server` (npm `claude-review-tool`, bin `crt`), `packages/overlay` (bundled into the server), `plugin/` (Claude Code plugin, marketplace at repo root).

Entry points: `packages/server/src/cli.ts` → `serve.ts` (wires `proxy.ts`, `inject.ts`, `captures.ts`, `session.ts` (the provider registry), `sessions.ts`, `provider-routes.ts`, `tasks.ts`, `target.ts`), `start.ts` (the guided start: target and busy-port steps as a pure state machine over injected probes), `prompt.ts` (the readline prompter, interactive runs only), `doctor.ts` (`crt doctor`), `setup.ts` (`crt setup`: registers the plugin bundled in `dist/plugin-marketplace/` with Claude Code), `probes.ts` (health / port / shutdown probes) and → `mcp-stdio.ts` (`crt mcp`, the stdio `write_task` server non-Claude agents spawn; `write-task.ts` holds the one tool schema); provider profiles and drivers under `packages/server/src/providers/` (`claude.ts`, `codex.ts`, `stub.ts`, plus `detect.ts`, `exec.ts`, `types.ts`); `packages/overlay/src/index.ts` (UI) and `early.ts` (console/network hooks, injected before the app's own scripts).

## Commands

- `npm ci` — install (npm workspaces, Node ≥ 20)
- `npm run check` — typecheck + unit tests + build (what CI runs; `lint` is a no-op — no package has a lint script yet)
- `npm test` — Vitest unit tests (`packages/server/test`)
- `npm run e2e` — Playwright smoke (`packages/server/e2e`): fixture app on :3999 behind a real `crt serve` on :4499. Needs `npm run build` first and `npx playwright install chromium` once. Runs with `CRT_SESSION_STUB=1` from a scratch project, so no Claude login and nothing lands in this repo's `.crt/`.
- `npm run build` — bundles overlay into `packages/server/dist/{overlay,early}.js`, then builds the server (which also copies `plugin/skills/intake/SKILL.md` → `dist/intake.md` and `plugin/` → `dist/plugin-marketplace/` with a generated marketplace manifest, PRD-setup F-85)
- `claude plugin validate ./plugin && claude plugin validate .` — CI runs both, plus `dist/plugin-marketplace` and `dist/plugin-marketplace/plugin` after the build. Try a skill edit before merge with `claude --plugin-dir ./plugin` in a target project.
- Release: bump `version` in `packages/server/package.json` and both plugin manifests and the pinned `claude-review-tool@<major.minor>` in the six skills (F-87; `test/skill-pin.test.ts` fails when they disagree), merge, `git tag v<version> && git push origin v<version>`. The release workflow fails if tag ≠ package version. It *stages* the version on npm via trusted publishing (no token); the release is live only after Simon promotes the staged version on npmjs.com (package → Versions), with 2FA.

## Conventions

- TypeScript strict, ESM, no default exports. Node built-ins over dependencies; add a dependency only when it removes real code.
- All Agent SDK usage lives in `packages/server/src/providers/claude.ts`; every other agent's CLI or protocol is driven only from `providers/<id>.ts` and `providers/exec.ts`, all behind `SessionDriver` (PRD §12, PRD-providers §5).
- `@anthropic-ai/claude-agent-sdk` is pinned to an exact version (PRD §12) — no `^`.
- `CRT_SESSION_STUB=1` selects the `stub` provider (`providers/stub.ts`, scripted intake, no login) ahead of every other resolution step. Unit tests and e2e exercise the chat path this way.
- Intake instructions have one source, `plugin/skills/intake/SKILL.md`; edit the skill, never `dist/intake.md`.
- Overlay pure logic is unit-tested from `packages/server/test` by importing `../../overlay/src/*` directly (e.g. `owner-stack.test.ts`).
- Overlay is framework-free, renders inside Shadow DOM, no globals except `window.__crt` for debugging.
- Every CRT HTTP/WS route is under `/__crt/`. Server binds `127.0.0.1` only.
- Windows is the primary dev platform: use `node:path`, never hand-build paths; spawn with `shell: false`; write files with `\n`.
- Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`), squash-merge PRs, short-lived branches `crt/<id>-<slug>` or `feat/<topic>`.
- Reference the PRD requirement in tests: `it("injects overlay script (F-2)", …)`.

## Work tracking

This repo dogfoods CRT. Work items are `.crt/tasks/CRT-NNNN-*.md` in the PRD F-32 format; statuses run `backlog → in_progress → review → done` (or `blocked`). `/crt:tasks` lists them, `/crt:next [ID]` takes one to an open PR, `/crt:done <ID> <pr-url>` closes it after merge. Working a task by hand: claim it first (status → `in_progress`, Log entry), append to its Log as you go, set `review` when its Definition of Done is fully ticked. A task is finished only when it is `done`, its branch is merged to `main`, and no PR is open. `.crt/tasks/README.md` is generated by `crt tasks` — never hand-edit it.

## Don'ts

- Don't add features not traceable to a PRD requirement; propose a PRD change first.
- Don't write outside `.crt/` from the server at runtime.
- Don't send anything off-machine except the model calls Claude Code already makes.
