---
id: CRT-0034
title: CI and repo hygiene — shipped assets are not docs-only, no live model call in npm test, faster e2e job
status: done
priority: high
created: 2026-09-24T12:15:00+08:00
updated: 2026-09-24T14:13:00+08:00
url: null
route: null
session: null
tags: [review-2026-09, ci, hygiene, tooling]
files: [.github/workflows/ci.yml, CLAUDE.md, .gitignore, packages/server/test/session.test.ts, packages/server/package.json, packages/overlay/package.json, tsconfig.base.json, packages/server/src/provider-routes.ts, packages/server/src/session.ts]
---

## Summary
Small, independent fixes from the 2026-09-24 code review, filed together because each is a few lines long. Four are real gaps: a docs-only CI skip that covers files the build ships, a unit test that calls the real model on any machine that has a Claude login, a `dist` that is never cleaned, and a package that imports `react` without declaring it. The rest shortens CI and turns on two cheap compiler checks.

## Context
- `.github/workflows/ci.yml:59` treats `docs/brand/*` and `docs/images/*` as docs-only. But `packages/server/scripts/copy-intake.mjs:23` copies `docs/brand/favicon*` into the published `dist/`, and `test/brand.test.ts`, `test/docs-images.test.ts` and `test/docs.test.ts` read both folders. So a favicon-only PR merges without running any test. `CLAUDE.md` › Commands repeats the list.
- `packages/server/test/session.test.ts:13-16` runs the live Agent SDK smoke test whenever `~/.claude/.credentials.json` exists. So every local `npm test` spends tokens, needs the network, and takes about 14 s. The model not calling `write_task` has already produced one spurious failure (CRT-0033 Log).
- Nothing cleans `packages/server/dist`. `dist/session-stub.js` (source removed in #21) is still inside local `npm pack` tarballs, which the manual-review recipe installs. CI release builds start from a fresh checkout and are unaffected.
- `packages/server/*.tgz` are untracked and not ignored.
- `packages/overlay/src/react.ts:11` imports `react`, which `packages/overlay/package.json` doesn't declare; it resolves only because npm hoists the server's copy.
- Turning on `noUnusedLocals` / `noUnusedParameters` in `tsconfig.base.json` reports 2 errors today: `src/provider-routes.ts:56` (`file`) and `src/session.ts:24` (`DEFAULT_PROVIDER`).
- In the e2e job (`ci.yml`):
  - `:115` `needs: [changes, check]` waits for both matrix legs, even though e2e runs `npm ci` + `npm run build` itself (`:123-124`).
  - Playwright's browser download is not cached.
  - The `if: hashFiles('packages/server/playwright.config.ts') != ''` at `:127` is always true.
  - `:104-107` runs `npx -y @anthropic-ai/claude-code@latest plugin validate` four times on both OSes, unpinned.

## Evidence
No page capture: from the code review in session e145e7ac on Simon's request, 2026-09-24. Each line above was checked against the file.

## Ask
1. Remove `docs/brand/*` and `docs/images/*` from the docs-only `case` in `ci.yml` and from the matching sentence in `CLAUDE.md` › Commands.
2. Gate the live smoke test in `test/session.test.ts` on `CRT_SESSION_SMOKE=1` or `CLAUDE_CODE_OAUTH_TOKEN` only (drop the credentials-file check), and update its comment.
3. Clean `packages/server/dist` before the build. The overlay build writes into it first, so the clean must run before `packages/overlay/build.mjs`; for example a root `prebuild`, or a clean step at the top of the root `build` script.
4. Add `*.tgz` to `.gitignore`. Add `react` (same version as the server's) as a devDependency of `packages/overlay`.
5. Turn on `noUnusedLocals` and `noUnusedParameters` in `tsconfig.base.json` and fix the two hits.
6. In the e2e job:
   - `needs: [changes]` only;
   - cache `~/.cache/ms-playwright` keyed on the installed Playwright version;
   - drop the dead `if`.
   Run plugin validation on the ubuntu leg only, with a pinned `@anthropic-ai/claude-code` version. Keep every job and check name unchanged: the ruleset requires `check (ubuntu-latest)`, `check (windows-latest)` and `e2e (ubuntu)` exactly.

## Definition of Done
- [x] A PR touching only `docs/brand/favicon.svg` runs the full `check` steps: the `changes` job prints `code=true`.
- [x] `npm test` on a machine with `~/.claude/.credentials.json` and no `CRT_SESSION_SMOKE` skips the live smoke test; it runs with `CRT_SESSION_SMOKE=1`.
- [x] `npm run build` after creating `packages/server/dist/stale.js` leaves no `stale.js`; `npm pack --dry-run` lists no `session-stub.js`.
- [x] `git status` in a checkout with `packages/server/*.tgz` shows no tarballs; `npm ls react -w packages/overlay` resolves.
- [x] `noUnusedLocals` and `noUnusedParameters` are on; `npm run typecheck` green.
- [x] CI on the PR: `check (ubuntu-latest)`, `check (windows-latest)` and `e2e (ubuntu)` all report under their exact names and are green; e2e starts without waiting for `check`.
- [x] `npm run check` green; no test's expected string changed.

## Notes
- Required check names are load-bearing: renaming a job blocks every PR.
- When `e2e` no longer depends on `check`, a broken build fails both jobs independently. That is acceptable.
- Out of scope: typechecking the tests (CRT-0035).

## Log
- 2026-09-24T12:15+08:00 — filed by hand from the code review in session e145e7ac (Simon's request).
- 2026-09-24T12:55+08:00 — claimed by /crt:next, session 4bf8b4eb-eaf7-4067-b66b-c83470b8dd8f, branch crt/CRT-0034-ci-and-repo-hygiene (worked in the sibling worktree review-tool-crt-0034 so concurrent sessions in the main checkout are unaffected)
- 2026-09-24T13:08+08:00 — verified: favicon-only PR → code=true — the new `case` pattern evaluated in bash against docs/brand/favicon.svg and docs/images/chat.png gives code=true (docs/PRD-chat.md and .crt/tasks/x.md stay docs-only)
- 2026-09-24T13:08+08:00 — verified: live smoke test — `npx vitest run test/session.test.ts` with ~/.claude/.credentials.json present and no CRT_SESSION_SMOKE: 5 passed, 1 skipped; with CRT_SESSION_SMOKE=1: 6 passed
- 2026-09-24T13:08+08:00 — verified: clean dist — created packages/server/dist/stale.js and dist/session-stub.js, ran `npm run check` (the root prebuild runs before the overlay build): both gone; `npm pack --dry-run` in packages/server lists no session-stub.js
- 2026-09-24T13:08+08:00 — verified: tarballs + react — a new packages/server/x-1.0.0.tgz does not show in `git status --porcelain`; `npm ls react -w packages/overlay` → react@18.3.1
- 2026-09-24T13:08+08:00 — verified: noUnusedLocals/noUnusedParameters on in tsconfig.base.json; `npm run typecheck` green (hits fixed: provider-routes.ts unused `file`, session.ts unused `DEFAULT_PROVIDER` import — its re-export stays)
- 2026-09-24T13:08+08:00 — verified: CI on #89 (run 35958115683) — changes, check (ubuntu-latest), check (windows-latest), e2e (ubuntu) all pass under their exact names; e2e started 05:01:32Z, before either check leg (05:01:34Z/35Z); plugin validate ran on ubuntu only with @anthropic-ai/claude-code@2.1.281
- 2026-09-24T13:08+08:00 — verified: `npm run check` green (51 files, 699 passed, 2 skipped); the only test diff is the session.test.ts gate and its comment — no expected string changed
- 2026-09-24T13:08+08:00 — ready for review: changed .github/workflows/ci.yml, CLAUDE.md, .gitignore, package.json (root prebuild), package-lock.json, packages/overlay/package.json, tsconfig.base.json, packages/server/src/provider-routes.ts, packages/server/src/session.ts, packages/server/test/session.test.ts. Pinned claude-code 2.1.281 (latest on npm today) and actions/cache v4.3.0 by SHA to match the other v4 actions. Worked in the sibling worktree review-tool-crt-0034; the claim line's stamp was corrected to the real claim time. PR https://github.com/simv/crt/pull/89
- 2026-09-24T14:13+08:00 — done; closed in https://github.com/simv/crt/pull/89
