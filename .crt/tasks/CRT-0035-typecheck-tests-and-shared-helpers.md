---
id: CRT-0035
title: Typecheck the tests and e2e as `lint`, and share the test helpers the suites copy
status: blocked
priority: high
created: 2026-09-24T12:15:00+08:00
updated: 2026-09-24T14:50:00+08:00
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
- [x] `npm run lint` typechecks `test/`, `e2e/` and the configs with 0 errors, and CI's `lint` step runs it.
- [x] No `as any` / `@ts-expect-error` was added to silence a drift error. Any that remain carry a one-line reason.
- [x] Codex, ACP and Antigravity tests use the shared fake-CLI helper with isolated PATH; no suite defines its own `useFake`.
- [x] No e2e spec defines `scratch`, `startCrt`, `health`, `shadow` or its own `window.__crt` type; no fixed `waitForTimeout` sleeps remain in the three start specs.
- [ ] `test/skills.test.ts` and `test/intake-skill.test.ts` write nothing under `packages/server/`; the unit run is at least 15 s faster than 26 s on the same machine (record both).
- [x] The same tests, the same count and the same expected strings as before: compare `vitest --reporter=json` test names before and after, and record the counts in the Log.
- [x] `npm run check` green; `npm run e2e` green (`--workers=2` on Windows).

## Notes
- This is test-only work. `src/` changes only where a test reveals a type that is wrong at its source; name each one in the Log.
- ESLint was considered and not justified; typechecking the tests catches the real drift.

## Log
- 2026-09-24T12:15+08:00 — filed by hand from the code review in session e145e7ac (Simon's request).
- 2026-09-24T14:16+08:00 — claimed by /crt:next, session 6dea7f5e-3832-4f29-8d7a-f3bf9b1230a8, branch crt/CRT-0035-typecheck-tests-and-shared-helpers (worked in the worktree .claude/worktrees/CRT-0035 off origin/main c1f21dc, so parallel sessions keep the main checkout)
- 2026-09-24T14:18+08:00 — baseline before any change: `vitest run --reporter=json` 51 files, 701 tests (699 passed, 2 skipped), 25.5 s wall (cold run); `tsc` over `test/`, `e2e/` and `*.config.ts` (the new tsconfig.test.json, nothing else changed yet) 172 errors (the review counted 171), 107 of them in e2e/chat.spec.ts from the five disagreeing `window.__crt` declarations.
- 2026-09-24T14:50+08:00 — built: `packages/server/tsconfig.test.json` (noEmit; `test`, `e2e`, `*.config.ts`, `../overlay/build.d.mts`) as the server's `lint` script, which the root `lint` and CI's existing `npm run lint --if-present` step run (CI runs it before the build; it passes with no `dist/`). `build.d.ts` → `build.d.mts` (+ `DEFAULT_DIST`, `REACT_ESM`, `buildEntries`) and `server.d.ts` → `server.d.mts`; new `.d.mts` for the other `.mjs` the tests import (`scripts/{copy-intake,integrations,plugin-marketplace}`, `e2e/fixture/fake-codex-install`). `test/helpers/fake-cli.ts` (`setEnv`/`restoreEnv`, isolated-PATH `useFake(bin)`, `env(bin)`, a per-process memoised `buildMcpShim()` — the esbuild bundle takes ~0.2 s, so no disk cache — `driverOptions`, `waitForEvent`/`driverHarness` on `vi.waitFor`) and `test/helpers/http.ts` (`listen0`, `apiAt`, `fakeProvider` with `skillsDirs`); codex, acp, antigravity, mcp-stdio, conformance, sessions, session, provider-routes and doctor-route tests moved onto them (the six hand-rolled `setTimeout(tick)` polls are gone). `e2e/helpers.ts`: the `PORTS` registry (both Playwright configs take their ports from it; `scratch(spec, name, port)` refuses a port outside the spec's range), `FIXTURE_ORIGIN`, one `window.__crt` type (`CrtTestHooks` from overlay/src/index.ts plus `loader?: CrtLoader`), `shadow`, `scratch`, `startCrt`, `stopCrts` (kills and `expect.poll`s until every child exited, replacing the three 300 ms sleeps), `health`. `copy-intake.mjs` exports `copySkills(dist)` and runs its build body only as a script (the build.mjs guard); skills.test and intake-skill.test copy into a temp dir. CLAUDE.md: the lint line and one convention line on the shared helpers.
- 2026-09-24T14:50+08:00 — src change (a type wrong at its source, Notes): `src/providers/acp.ts` `AcpUpdate` was `{ content?: AcpContentBlock } & Partial<AcpToolCall>`, which intersects the two `content` shapes (acp.test.ts could not type a message chunk); now `content?: AcpContentBlock | AcpToolCallContent[]` with `Omit<…, "content">`, and `agent_message_chunk` narrows with `Array.isArray` — same runtime behaviour (an array never had `.type === "text"`). No other src change.
- 2026-09-24T14:50+08:00 — other drift fixes, test side: doctor.test health objects gain `mode: null` (a pre-v0.4 server, which is what their 0.2.0/0.3.0 versions are); stub.test's deny carries a `reason`; session.test (the opt-in live smoke) passes `mcp` and `model: null`; acp.test types `authMethods`; antigravity.test's fixture type gains `num_turns` and `step_update.conversation_id` (both are in the recordings); codex-fixtures and intake-message use optional chaining where the value may be absent; react-entry uses loader.test's `outputFiles!` idiom; screenshots.spec drops an unused `page` parameter; proxy.spec's and chat/screenshots' local `shadow`/`health` variables renamed (`root`/`served`) so no spec has a local of a helper's name. `@types/react-dom@^18.3.7` added as a server devDependency (react-dom 18.3.1 is already one) instead of a hand-written module declaration that could drift.
- 2026-09-24T14:50+08:00 — verified: lint — `npm run lint` → `tsc -p tsconfig.test.json` exit 0 (172 → 0 errors); ci.yml's check job runs `npm run lint --if-present` before `npm test`.
- 2026-09-24T14:50+08:00 — verified: no silencing — `git diff -U0` adds no `as any`, `@ts-expect-error`, `@ts-ignore` or `as unknown as`; none remain anywhere under `packages/server/test` or `e2e` (the arrival.spec `as unknown as { __crt: … }` casts became plain `window.__crt` calls).
- 2026-09-24T14:50+08:00 — verified: fake CLI — the only `useFake` definition is test/helpers/fake-cli.ts:46 (isolated PATH: the fake's bin, node's dir, System32 or /usr/bin:/bin); codex, acp and antigravity suites 84/84 three times in a row with mcp-stdio.
- 2026-09-24T14:50+08:00 — verified: e2e helpers — grep finds no `function scratch|startCrt|health`, `const shadow|scratch|health`, `declare global` or `__crt:` in any `e2e/*.spec.ts`; no `waitForTimeout` or `setTimeout(r, …)` sleep in arrival/embedded/start.spec.ts.
- 2026-09-24T14:50+08:00 — verified (first half of the speed row only): skills.test and intake-skill.test call `copySkills(<temp dir>)`; a full `vitest run` after touching a marker file leaves nothing newer than the marker under `packages/server` (no dist/, LICENSE or .d.ts writes).
- 2026-09-24T14:50+08:00 — NOT met (second half of the speed row): same machine, three alternating rounds of `vitest run` in a fresh origin/main checkout and in this branch: before 17.2 / 22.7 / 18.3 s (median 18.3; the first cold run earlier was 25.5 s), after 14.7 / 15.4 / 15.5 s (median 15.4; 16.1–16.9 s in other runs). The two tests took 7.2 s and 4.1 s of worker time before; test-execution span 21.0 → 12.9 s. At least 15 s faster (≤ 11 s) is below the floor: `test/providers/stub.test.ts` alone runs 9.6 s (three conformance runs of ~2 s and a 2.4 s re-proposal case, all paced by the stub's fixed `TICK_MS = 15` in src/providers/stub.ts), sessions/antigravity/acp 7.2–7.6 s each, plus ~3–4 s of Vitest start-up; `--pool=threads` measured 17.0 s. The review's "about 20 s of the 26 s" overestimated the build step's share.
- 2026-09-24T14:50+08:00 — verified: same tests — `vitest run --reporter=json` before and after: 51 files, 701 tests, 699 passed, 2 skipped (exec.test's POSIX-only case, session.test's opt-in live smoke); the sorted `file › full name › status` lists are identical (`diff` empty). Every changed `expect(` line keeps its expected value; only how the actual is reached changed (`env(bin)`, `?.`, a typed field instead of a cast).
- 2026-09-24T14:50+08:00 — verified: `npm run check` exit 0 (typecheck, lint, 699 passed + 2 skipped, build; the build still writes intake.md, the 7 skills, LICENSE, 3 favicons, the marketplace and the 7 integration files). `npx playwright test --workers=2` 66/66 (1.6 min); a first full run had 65/66 — chat.spec.ts:522 "Chat in the toolbar …" timed out waiting for the dot's `idle` at 12.3 s under load, then passed 3/3 alone (`--repeat-each=3`, 2.1 s each) and in the full re-run. `playwright test -c playwright.screenshots.config.ts --list` loads the config (5 tests; nothing regenerated).
- 2026-09-24T14:50+08:00 — blocked: the DoD row "the unit run is at least 15 s faster than 26 s" cannot be met by Ask 7 (see the NOT met line: 18.3 → 15.4 s median, floor ≈ 13 s set by the stub's pacing). Which do you want? (a) accept the measured gain — amend the row to "faster than before on the same machine, both recorded" and re-run /crt:next CRT-0035 to hand it over as is; (b) allow a src change so unit tests can run the stub with a shorter tick (e.g. a `tickMs` option on `makeStubProfile`, default 15 ms for e2e and screenshots) — outside this task's Notes; (c) allow splitting stub.test.ts so its three conformance runs are separate files (test names unchanged, file paths change). Answer in ## Notes and re-run /crt:next CRT-0035.
