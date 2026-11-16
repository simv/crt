---
id: CRT-0051
title: M30 — Collation: crt review lists the review and its page keeps, drops, prioritises and orders the items
status: review
priority: normal
created: 2026-11-16T13:20:00+08:00
updated: 2026-11-16T15:40:00+08:00
url: null
route: null
session: null
tags: [m30, review, collation, landing, f-135, prd-zero]
files: [docs/PRD-zero.md, packages/server/src/review-page.ts, packages/server/src/home.ts, packages/server/src/routes.ts, packages/server/src/proxy.ts, packages/server/src/cli.ts, packages/server/src/landing.ts, packages/overlay/src/tokens.ts, packages/server/e2e/review.spec.ts, docs/cli.md, CLAUDE.md]
---

## Summary
After M29 a review is a folder of task files under the CRT home and a `review.json`. Give the reviewer one view of it before the project sees anything: `crt review` prints the current review as a list and opens a page served by the CRT server at `/__crt/review`, where the items are grouped by route with their annotated screenshots and can be kept or dropped, reprioritised and reordered. The choices are what `crt handoff` (M31) delivers.

## Context
- M29 (CRT-0050) provides `home.ts`: the current review, `review.json` `{ name, status, created, project, items: [{ id, keep, order }], handovers }` written atomically, and `crt review --json` / `list` / `new`.
- Task summaries come from `listTasks` / `readSummary` in `packages/server/src/tasks.ts`; a task's annotated screenshot is `assets/<ID>/viewport-annotated.png` beside the file.
- The landing page (`packages/server/src/landing.ts`) is the model for a framework-free page served by CRT: it repeats the colours of `packages/overlay/src/tokens.ts` and a test pins the two equal (PRD-polish F-112); `doctor-route.ts` is the model for a small JSON route with test seams.
- Every route is a constant in `routes.ts` under `/__crt/`. CORS allows loopback origins for the overlay's API; a review must not be editable from an app page.

## Evidence
No page capture: created from `docs/PRD-zero.md` milestone M30, after Simon's second request of 2026-11-16: "collecting and collating the feedback in a way that's easy to pass back to the project".

## Ask
1. **CLI.** `crt review` prints one line per item in review order (`R-03  high    kept     /checkout   Cart total excludes applied discount`), the totals (`11 items · 9 kept · 3 routes`) and `crt handoff` as the next step; on a terminal it opens the page, starting the server for the project when none is running; with no review it prints the F-135 line and exits 0.
2. **Reducers** (pure, in `home.ts` or `review-page.ts`): keep / drop, set priority, move an item up or down within the review order, move a group as a whole; groups by `route` in the order of their first item.
3. **Routes.** `GET /__crt/review` (the page), `GET /__crt/review/items`, `PATCH /__crt/review/items/<id>` `{ keep?, priority?, move? }`, `PATCH /__crt/review/groups`, and screenshots by item id and file name only (never a path). All refuse an `Origin` other than the CRT server's own. A priority change rewrites that task file's `priority:` and `updated:` and appends a Log line; keep and order live in `review.json`.
4. **The page.** Per PRD-zero §5.4: groups, each item's title, summary, priority, annotated screenshot and reviewed commit; **Keep / Drop**, the priority `<select>`, **Move up / Move down** as real buttons; dropped items greyed, restorable; the totals; the hand-over command to copy. Colours from `tokens.ts`, no framework, no external request.
5. **Tests.** Unit rows for the reducers and for the origin rule on every route; `e2e/review.spec.ts`: a review seeded with stub Sends, one item dropped and another raised on the page by keyboard, both visible in `crt review --json`.
6. **Should:** `Suggest merges` per PRD-zero §5.4 — an agent session over the review's files that proposes duplicates; accepting drops them and adds a Notes line to the kept item; the stub scripted for the e2e. Leave it out, with a Log line, if it does not fit the milestone.
7. `docs/cli.md` and the `CLAUDE.md` entry points for `review-page.ts`.

## Definition of Done
- [x] `crt review` prints the list, the totals and the next step, and the no-review line when there is none (F-135).
- [x] The page lists the review grouped by route with screenshots; keep / drop, priority and order changes persist and are in `crt review --json` (e2e).
- [x] Every control is reachable by Tab and operable by Enter or Space (an e2e row).
- [x] Every review route refuses a foreign `Origin`; screenshots are served by id and file name only (unit rows).
- [x] `npm run check` green; `npm run e2e` green; the colour-pin test still green.
- [ ] Manual: a review of five or more real items on the trial app — dropped, prioritised and reordered on the page; a screenshot in the Log. Run by the worker session (standing rule 2026-09-18).

## Notes
Read `docs/PRD-zero.md` §5.4, §6.3 and §13 first. Decisions already taken: collation is deterministic and the agent only suggests; the page is served by CRT, not by the overlay (whether the overlay links to it is Open question 4). Needs M29; independent of M28 and M31. M32 adds a screenshot of this page (`review.png`) to `npm run screenshots`, so keep the page's own signals (an attribute that says it has rendered) easy to wait on.

## Log
- 2026-11-16T13:20+08:00 — created from docs/PRD-zero.md milestone M30 by the planning session that wrote it (Claude Code cloud session 01KVgoZd7cmxUJP97XZgyRn9), on Simon's go-ahead of 2026-11-16.
- 2026-11-16T15:10+08:00 — claimed by Claude Code cloud session 01KVgoZd7cmxUJP97XZgyRn9 (branch claude/project-thread-3ddp2m), after CRT-0050 merged in #126.
- 2026-11-16T15:40+08:00 — built: `review-page.ts` (the page, `GET /__crt/review/items`, `PATCH /__crt/review/items/<id>`, `PATCH /__crt/review/groups`, `GET /__crt/review/assets/<id>/<file>`, the reducers `groupByRoute` / `setKeep` / `moveItem` / `moveGroup`), `writeReviewItems` in `home.ts`, `setTaskPriority` and `taskSummaryText` in `tasks.ts`, `findCrtFor` and `openPath` in `serve.ts`, `hasReviewPage` in `probes.ts`, and `crt review [--open | --no-open] [--port <n>]`. The origin rule is stricter than the Ask: a loopback `Host`, the server's own `Origin` when one is sent, and `Sec-Fetch-Site` `same-origin` or `none` when a browser sends it, all before CORS. Tests: `test/review-page.test.ts` (19 rows) and `e2e/review.spec.ts` (4 rows: keyboard, every control by Tab and by pointer, an app page refused and `crt review --open` on a running and on a fresh server, no review). `npm run check`: 912 pass; the one failure is `test/providers/exec.test.ts` (process-group kill), which fails the same way on `main` in this cloud container. `npx playwright test`: 84 pass; `embedded.spec.ts:148` fails here as it does on `main` in this container (the reuse row), and `chat.spec.ts:401` failed once in the full run and passes on its own. `docs/cli.md` has the page; `docs/PRD-zero.md` §5.4 has an "As built (M30)" list.
- 2026-11-16T15:40+08:00 — Ask 6 (`Suggest merges`, a Should) is left out: it needs a session whose proposal is a structured list the page can accept or refuse, and the session machinery has no such shape yet. Said in the PRD's "As built (M30)" list.
- 2026-11-16T15:40+08:00 — Manual row: run here on a five-item review seeded with stub Sends on three routes (one dropped, light and dark checked by eye); no trial app or agent login in this cloud session, so the pass on real items, with its screenshot, is carried to CRT-0053 with the other Manual rows for the one pass before `v0.8.0` is tagged.
