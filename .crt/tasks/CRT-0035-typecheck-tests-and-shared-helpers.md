---
id: CRT-0035
title: Typecheck the tests and e2e as `lint`, and share the test helpers the suites copy
status: backlog
priority: high
created: 2026-09-24T12:15:00+08:00
updated: 2026-09-24T12:15:00+08:00
url: null
route: null
session: null
tags: [review-2026-09, tests, tooling, safety-net]
files: [packages/server/tsconfig.json, packages/server/package.json, package.json, packages/overlay/build.d.ts, packages/server/e2e/fixture/server.d.ts, packages/server/test/helpers/, packages/server/e2e/, packages/server/test/providers/, packages/server/test/skills.test.ts, packages/server/test/intake-skill.test.ts, packages/server/scripts/copy-intake.mjs]
---

## Summary
Nothing typechecks the roughly 60 test and e2e files, and they have drifted: `tsc` over them reports 171 errors. The refactors filed alongside this task (CRT-0040…CRT-0043) move types that these files use, so this is their safety net and should land first. The same files copy the fake-CLI, HTTP, scratch-project and spawn helpers between suites, and the copies already differ. Two unit tests also run the full build script into the real `dist/`, which accounts for about 20 s of the 26 s unit run.

## Context
- `packages/server/tsconfig.json` includes only `src`. Vitest and Playwright strip types without checking them. `lint` is a no-op (CLAUDE.md › Commands).
- Real drift that `tsc` finds today:
  - `test/doctor-route.test.ts:19` and `test/provider-routes.test.ts:31` build providers without `skillsDirs`;
  - `test/doctor.test.ts:101,106` build health objects without `mode`;
  - `test/providers/stub.test.ts:159` has a permission decision of the wrong type;
  - `test/session.test.ts:97` passes the wrong options to `startSession`;
  - `test/providers/acp.test.ts:251-260,529` has mismatched ACP types.
- Five e2e specs each declare their own `window.__crt` type, and the copies disagree: `capture.spec.ts:40`, `chat.spec.ts:46`, `embedded.spec.ts:44`, `focus.spec.ts:13`, `screenshots.spec.ts:37`.
- TypeScript never reads `packages/overlay/build.d.ts` or `e2e/fixture/server.d.ts`: under NodeNext a `.mjs` file pairs with `.d.mts`. `build.d.ts` also lacks `buildEntries` and `REACT_ESM`, which `test/helpers/entries.ts:3` imports.
- Helpers copied between suites:
  - `useFake` / env restore / `env()`: `test/providers/codex.test.ts:67-85`, `antigravity.test.ts:83-101`, `acp.test.ts:81ff`. Codex puts the fake first on PATH; Antigravity isolates PATH because `exec.ts` prefers a real `.exe` over a shim.
  - The `start()` + poll loop: `codex.test.ts:357`, `antigravity.test.ts:503`, `acp.test.ts:477`.
  - The esbuild step that bundles the `crt mcp` shim: 4 files.
  - `api()`: `sessions.test.ts:61`, `provider-routes.test.ts:78`. A fake provider: `doctor-route.test.ts:18`, `provider-routes.test.ts:30`.
  - About 10 hand-rolled `setTimeout(tick, 20)` polls.
- The e2e specs repeat `scratch()`, `startCrt()` (about 40 lines) and `health()` in `arrival.spec.ts:31-60`, `embedded.spec.ts:62-100` and `start.spec.ts:33-70`, and `shadow()` in 5 specs.
  - `arrival.spec.ts:19` hard-codes `http://localhost:3999`.
  - Port ranges are assigned by hand in comments.
  - There are fixed 300 ms sleeps at `arrival.spec.ts:94`, `embedded.spec.ts:124` and `start.spec.ts:107`.
- `test/skills.test.ts:92` and `test/intake-skill.test.ts:21` run `scripts/copy-intake.mjs`, which writes into `dist/`, writes `packages/server/LICENSE` and emits `.d.ts` files. They take about 10 s each and write the same files in parallel workers.

## Evidence
No page capture: from the code review in session e145e7ac, 2026-09-24. The review ran `tsc` over `test/**`, `e2e/**` and `*.config.ts` from a scratch tsconfig and counted the 171 errors.

## Ask
1. Add `packages/server/tsconfig.test.json`: `noEmit`, covering `test`, `e2e`, the configs and the overlay build types. Make the root `lint` script run it, so CI's existing `lint` step and `npm run check` pick it up.
2. Rename `build.d.ts` → `build.d.mts` and `server.d.ts` → `server.d.mts`, and complete them.
3. Fix the errors by correcting the tests, not by loosening types. Where a test deliberately passes a partial object, use a typed factory or `satisfies`.
4. Put one `window.__crt` type in `e2e/helpers.ts`, derived from or checked against the overlay's own debug type.
5. Add `test/helpers/fake-cli.ts` (isolated-PATH `useFake`, `restoreEnv`, `env`, a cached `buildMcpShim()`, a `driverHarness` on `vi.waitFor`) and `test/helpers/http.ts` (`api`, `listen0`, a fake provider). Move the provider, session and route tests onto them.
6. Add `e2e/helpers.ts` (`scratch`, `startCrt`, `health`, `shadow`, `FIXTURE_ORIGIN`, one port registry). Replace the fixed sleeps with `expect.poll`.
7. Export the skill-copy step from `copy-intake.mjs` with an output-directory parameter, and have the two tests call it into a temp dir.

## Definition of Done
- [ ] `npm run lint` typechecks `test/`, `e2e/` and the configs with 0 errors, and CI's `lint` step runs it.
- [ ] No `as any` / `@ts-expect-error` was added to silence a drift error. Any that remain carry a one-line reason.
- [ ] Codex, ACP and Antigravity tests use the shared fake-CLI helper with isolated PATH; no suite defines its own `useFake`.
- [ ] No e2e spec defines `scratch`, `startCrt`, `health`, `shadow` or its own `window.__crt` type; no fixed `waitForTimeout` sleeps remain in the three start specs.
- [ ] `test/skills.test.ts` and `test/intake-skill.test.ts` write nothing under `packages/server/`; the unit run is at least 15 s faster than 26 s on the same machine (record both).
- [ ] The same tests, the same count and the same expected strings as before: compare `vitest --reporter=json` test names before and after, and record the counts in the Log.
- [ ] `npm run check` green; `npm run e2e` green (`--workers=2` on Windows).

## Notes
- This is test-only work. `src/` changes only where a test reveals a type that is wrong at its source; name each one in the Log.
- ESLint was considered and not justified; typechecking the tests catches the real drift.

## Log
- 2026-09-24T12:15+08:00 — filed by hand from the code review in session e145e7ac (Simon's request).
