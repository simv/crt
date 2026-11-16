---
id: CRT-0053
title: M32 — Plain crt picks the CRT browser when the app has no integration; doctor rows, docs, release 0.8.0
status: backlog
priority: normal
created: 2026-11-16T13:20:00+08:00
updated: 2026-11-16T15:05:00+08:00
url: null
route: null
session: null
tags: [m32, release, docs, doctor, start, f-131, f-132, f-138, n-36, prd-zero]
files: [docs/PRD-zero.md, packages/server/src/serve.ts, packages/server/src/start.ts, packages/server/src/doctor.ts, packages/server/src/doctor-route.ts, packages/server/src/landing.ts, packages/server/src/proxy.ts, plugin/skills/serve/SKILL.md, README.md, docs/cli.md, docs/how-it-works.md, docs/integration.md, docs/task-format.md, docs/troubleshooting.md, docs/review.md, docs/develop.md, docs/PRD.md, docs/PRD-setup.md, docs/PRD-embedded.md, packages/server/test/docs.test.ts, packages/server/e2e/screenshots.spec.ts, docs/images/README.md, .github/workflows/ci.yml, packages/server/package.json, plugin/.claude-plugin/plugin.json, .claude-plugin/marketplace.json, CLAUDE.md]
---

## Summary
M28–M31 add the CRT browser, guest start, reviews, collation and hand-over as things a developer asks for by name. Make them the default path and ship it: plain `crt` opens the CRT browser when the app carries no integration (and says how to proceed when there is no Chromium browser either), `crt doctor` and the landing page know about guests, the browser and the review, the README leads with the zero-integration flow, the earlier PRDs get their `v0.8` notes, and `0.8.0` is released.

## Context
- Today plain `crt` in embedded mode opens the app in the default browser and, when the page never asks for the loader, logs `crt: opened <url> but the page never loaded the CRT loader — add the integration (…), or run `crt proxy`` after a wait (`proxy.ts`, F-94). `crt doctor`'s `integration` row (`doctor.ts`, F-103) already detects whether the app carries the integration.
- The guided start is a pure state machine over injected probes (`start.ts`); the open decision belongs there.
- `/crt:serve` (`plugin/skills/serve/SKILL.md`) asks to set the project up when `.crt/tasks` is missing (F-105 step ½).
- The release procedure is in `CLAUDE.md` › Commands › Release: versions in `packages/server/package.json` and both plugin manifests, the seven skills' pin (`test/skill-pin.test.ts`), `npm run screenshots`, the tag, the staged publish that Simon promotes. Cloud sessions cannot push tags; give Simon the two `git` commands.
- `test/docs.test.ts` pins README and reference-page strings, the README's 200-line budget and the list of reference pages; the CI `changes` job lists the reference pages that count as code.

## Evidence
No page capture: created from `docs/PRD-zero.md` milestone M32. Goal 1 of the PRD is the acceptance test: `npm run dev`, then `npx claude-review-tool`, and a browser opens on the app's own URL with the CRT button, with nothing written to the project.

## Ask
1. **F-132.** The open decision as a pure function of `{ integration, browser, mode, open }`: integration → the default browser as today; no integration and a browser found → the CRT browser; neither → the F-132 line, CRT stays up. The ready line names it (`(embedded; …)` / `(embedded, CRT browser; …)`). The F-94 line fires only when the integration was found and gains `, or run `crt browse``.
2. **F-131.** The `.crt` (guest), `browser` and `review` rows in `crt doctor` and `GET /__crt/doctor`; the `integration` row's advice; the landing page's suggestion.
3. **`/crt:serve`** per PRD-zero §9: no set-up question; it starts CRT as a guest and says `/crt:init` adopts CRT in the project.
4. **F-138 docs.** README front page per PRD-zero §4 (≤ 200 lines); `docs/cli.md`, `how-it-works.md`, `integration.md`, `task-format.md`, `troubleshooting.md` completed for everything M28–M31 added; the new `docs/review.md` (nine reference pages — `docs.test.ts`, the CI `changes` filter and `CLAUDE.md`'s "eight reference pages" together); `docs/develop.md`'s list of PRDs; `review.png` added to `e2e/screenshots.spec.ts`, `docs/images/README.md` and the README; `npm run screenshots` re-run and the PNGs committed.
5. **PRD notes.** Every §9 row not yet applied; the `*v0.8: …*` notes inline in `docs/PRD.md`, `PRD-setup.md` and `PRD-embedded.md`; PRD-zero added to PRD.md's Amended-by row and the README's version line; PRD-zero's Status row; §10 ticked with evidence.
6. **Release.** `0.8.0` in the package and both manifests, `claude-review-tool@0.8` in the seven skills; merge; give Simon the tag commands; after his promotion, verify `npm view claude-review-tool version` and a clean `npm i -g claude-review-tool@0.8.0` + `crt setup`.

## Definition of Done
- [ ] Plain `crt` opens the default browser with the integration, the CRT browser without it, and prints the F-132 line with neither; unit rows for the decision and the ready lines (F-132).
- [ ] A set-up project with the integration behaves as in 0.7.2: `e2e/embedded.spec.ts`, `proxy.spec.ts` and `chat.spec.ts` pass with only the strings PRD-zero §9 names changed (N-36).
- [ ] The doctor rows and the landing copy of F-131, on the terminal and at `/__crt/doctor`.
- [ ] README ≤ 200 lines and leading with the zero-integration block; `docs/review.md` exists; `docs.test.ts` and the CI filter know nine pages; six screenshots regenerated and under budget (F-138).
- [ ] Versions and pins `0.8.0` / `@0.8`; `test/skill-pin.test.ts` green; `npm run check` and `npm run e2e` green.
- [ ] Every PRD-zero §9 row applied and every §10 row ticked with evidence.
- [ ] Manual: goal 1 end to end from the published package on a project that has never seen CRT — `npm run dev`, `npx claude-review-tool`, a Send, `crt review`, `crt handoff` — with `git status` empty until the hand-over.
- [ ] Manual (Simon): `git tag v0.8.0 && git push origin v0.8.0`, the release workflow green, the staged version promoted on npmjs.com.
- [ ] Manual, carried from CRT-0049 (M28): on Windows with real Chrome and with real Edge, `crt browse` on the trial app (Jack of Clubs, `C:\Projects\Claude\jack-of-clubs`, app on :3000) with its CRT integration not loaded and its policy as committed — the button appears on `:3000`, a Send reaches a real Claude session, a second tab works, closing the window and stopping CRT behave per F-128. Browser versions and screenshots in the Log. If the DevTools pipe does not work on Windows, PRD-zero §12 rule 2 applies: stop and report, never a debug port.
- [ ] Manual (carried from CRT-0050): `crt proxy` as a guest in a fresh clone of a real project with a real Claude session — an accepted proposal lands as `R-01` under the home with its screenshots readable, and `git status` in the project is empty; the same with Codex when it is installed, recording what it needed in `docs/providers.md` (PRD-zero §12 rule 5).
- [ ] Manual (carried from CRT-0051): a review of five or more real items on the trial app, dropped, prioritised and reordered on the review page by keyboard and by pointer; a screenshot in the Log.

## Notes
Read `docs/PRD-zero.md` §5.6, §6.5, §9 and §10 first. Depends on M28–M31 (CRT-0049…0052) being `done`; if a Should from M30 or M31 was left out, say so in §10 and the release notes without holding the release. Decision already taken (§13): plain `crt` prefers the integration when the app has one. Keep every string `docs.test.ts` pins unless a §9 row changes it (§12 rule 8). Features have shipped as patch releases under the `@0.7` pin since 0.7.0; this is a minor release because the default behaviour of plain `crt` in a project that is not set up changes.

## Log
- 2026-11-16T13:20+08:00 — created from docs/PRD-zero.md milestone M32 by the planning session that wrote it (Claude Code cloud session 01KVgoZd7cmxUJP97XZgyRn9), on Simon's go-ahead of 2026-11-16.
- 2026-11-16T16:40+08:00 — Definition of Done gained the Manual Windows row of CRT-0049 (M28): that task was built in a Linux cloud session that cannot run it; see CRT-0049's Log.
- 2026-11-16T15:05+08:00 — Definition of Done gained the Manual row carried from CRT-0050 (a real Claude and Codex session as a guest), for the one manual pass before the tag.
- 2026-11-16T15:40+08:00 — the Manual row of CRT-0051 (the review page on real items) was added to the Definition of Done here, for the one manual pass before the tag.
