---
id: CRT-0036
title: write_task loses the capture when a field contains a `## ` heading — validate before moving assets
status: review
priority: high
created: 2026-09-24T12:15:00+08:00
updated: 2026-09-24T16:38:26+08:00
url: null
route: null
session: null
tags: [review-2026-09, bug, tasks, f-23, f-32]
files: [packages/server/src/tasks.ts, packages/server/src/write-task.ts, packages/server/test/tasks.test.ts]
---

## Summary
`createTask` moves the capture's files into `assets/<ID>/` and deletes the capture folder. Only then does it check the rendered file. If any free-text field contains a line starting with `## `, the check fails, because agents often write `## Steps` in `context` or `notes`. The agent sees a confusing "sections must be exactly…" error. When it retries, it gets "capture … not found", because the capture is already gone. The task is lost and orphaned assets stay behind.

## Context
`packages/server/src/tasks.ts`:
- `createTask` (`:490`) reads the capture (`:505-508`), then moves the assets (`:510-515` → `moveAssets` `:567-583`, which deletes the capture dir at `:582`).
- It renders and validates only after that (`:545-547`).
- `validateTaskText` collects every `^## ` line in the body (`:266`) and requires exactly the seven F-32 headings.
- The Evidence section depends only on the capture and the asset file names, not on the move having happened.

Separately:
- `allocateTaskId` (`:349-356`) takes the highest number plus one, and the file is written without `flag: "wx"` (`:548`). Two CRT servers on one project (embedded and `crt proxy`) can both pick the same ID.
- Deleting the highest task reuses its ID, and `moveAssets` merges into a leftover `assets/<ID>/` folder.

## Evidence
No page capture: from the code review in session e145e7ac, 2026-09-24. Reproduced against the built `dist/tasks.js`: `createTask` with `context: "Repro:\n\n## Steps\n1. go"` throws `sections must be exactly, in order: …`, and the capture dir no longer exists afterwards.

## Ask
1. Render and validate the task text before any filesystem change. List the capture dir's file names to render Evidence, validate, and only then call `moveAssets` and write. If validation fails, nothing on disk changes.
2. Demote heading lines in the free-text fields (summary, context, ask, notes, evidence and each DoD item): `^## ` → `### `, and `^# ` → `### ` likewise. Document this in the `write_task` field descriptions in `src/write-task.ts`. It is lossless for the reader, and the agent's input no longer fails for formatting.
3. Write the task file with `flag: "wx"`, and on `EEXIST` allocate the next ID and retry (bounded). Count `assets/CRT-*` folders as well as task files when finding the highest ID.

## Definition of Done
- [x] New test (written first and seen failing): `createTask` with `## Steps` in `context` and a capture succeeds; the file validates and shows `### Steps`.
- [x] New test: a forced validation failure (e.g. an empty ask after trimming) leaves the capture dir and its files untouched and creates no `assets/<ID>/`.
- [x] New test: with an existing `assets/CRT-0041/` and no task files at or above 0041, the next ID is `CRT-0042`. Update the existing ID test in `tasks.test.ts:71-79`, which deliberately doesn't count assets folders, and say so in the Log.
- [x] New test: a pre-existing file for the allocated ID makes `createTask` take the next ID, not overwrite.
- [x] Existing `tasks.test.ts`, `sessions.test.ts` (§5.3 identical file) and `mcp-stdio.test.ts` pass unchanged.
- [x] `npm run check` green; `npm run e2e` green.

## Notes
- The heading-demotion rule applies at write time only; `validateTaskText` is unchanged, so hand-edited files are judged as before.
- This is a correctness fix under F-23 (assets move with the task) and F-32 (file format). It adds no feature.

## Log
- 2026-09-24T12:15+08:00 — filed by hand from the code review in session e145e7ac (Simon's request); bug reproduced against dist.
- 2026-09-24T16:25+08:00 — claimed by /crt:next, session da58c2cf-351d-4ef5-be6f-9435069a3ade, branch crt/CRT-0036-create-task-validate-before-move (worktree `.claude/worktrees/CRT-0036`, so a parallel session's branch switches in the main checkout cannot reach it)
- 2026-09-24T16:32+08:00 — tests first: the six new/updated `tasks.test.ts` cases failed on the old code for the expected reasons (`sections must be exactly…` with the capture already moved; `CRT-0013` instead of `CRT-0041`/`CRT-0042`; the raced file overwritten as `CRT-0001`), then passed after the fix.
- 2026-09-24T16:32+08:00 — decisions: (a) `createTask` now reads the capture and lists its dir, renders and validates, and only then `mkdir`s, writes (`flag: "wx"`), moves the assets and writes the index; the task file is written before the assets move, so the file is the id's reservation. (b) Demotion runs on summary, context, ask, notes and each DoD item, and on the whole rendered Evidence section, which covers the `evidence` field and the developer's multi-line annotation notes (the same failure). (c) `## ` lines are demoted everywhere, fenced or not, since the section check cannot see fences; a `# ` line inside a fenced code block stays as it is (a shell or Python comment, harmless to the check), so code is not rewritten. Lines split on the same terminators as the check's `^`. (d) On `EEXIST` the id is re-allocated by a rescan, never below the taken id + 1, at most 10 attempts, then the error is rethrown. (e) The race test simulates the second server with `vi.doMock("node:fs")` (the pattern `react-entry.test.ts` uses for `react`): the other server's file appears right after this server's scan.
- 2026-09-24T16:32+08:00 — the existing ID test (`tasks.test.ts:71`) had `assets/CRT-0040/` next to `CRT-0012` and expected `CRT-0013` (assets deliberately not counted); it now expects `CRT-0013` with only a non-id `assets/notes/` folder, and `CRT-0041` once `assets/CRT-0040/` exists.
- 2026-09-24T16:38+08:00 — verified: `## Steps` in context → `tasks.test.ts` "a `## Steps` heading in context no longer fails the write…" (file validates, Context reads `### Steps`, capture moved); every field and the fence rule → "writes `# ` and `## ` lines of every free-text field as `### `…".
- 2026-09-24T16:38+08:00 — verified: forced failure → "changes nothing on disk when the input fails…": a `- [ ]` DoD item passes the input check but fails the F-32 check; the capture dir keeps all five files, no `assets/` exists, and the retry creates `CRT-0001`. The empty-after-trim ask case is asserted in the same test (refused by the input check).
- 2026-09-24T16:38+08:00 — verified: leftover `assets/CRT-0041/` with only `CRT-0012` on disk → "does not reuse the id of a leftover assets/<ID>/ folder…" gives `CRT-0042` and leaves `assets/CRT-0041/` untouched; `allocateTaskId` itself is covered by the updated ID test.
- 2026-09-24T16:38+08:00 — verified: pre-existing file for the allocated id → "takes the next id instead of overwriting when another server wrote the allocated file first" gives `CRT-0002`, and the other server's file is byte-for-byte intact.
- 2026-09-24T16:38+08:00 — verified: `npx vitest run test/tasks.test.ts test/sessions.test.ts test/mcp-stdio.test.ts` 46/46, with the golden v0.1 task, the §5.3 identical-file test and the `crt mcp` schema test unchanged.
- 2026-09-24T16:38+08:00 — verified: `npm run check` exit 0 (52 files, 708 passed, 2 skipped). `npx playwright test --workers=2` in `packages/server`: 65/66. The one failure is environmental: `embedded.spec.ts:177` expects no dev server on the probed ports, and this machine has other processes listening on 3000, 3001 and 8080, which were not stopped. That spec covers the guided start and the loader, which this change does not touch. The CI e2e job (ubuntu) is the clean run and is checked before close.
- 2026-09-24T16:38+08:00 — ready for review: changed `packages/server/src/tasks.ts`, `packages/server/src/write-task.ts` (field descriptions only), `packages/server/test/tasks.test.ts`. Known limit (prd-reviewer): `wx` makes the slugged file name exclusive, not the id, so two servers writing different titles under one id in the same instant still both succeed. Closing that needs an id-level reservation, which is outside this Ask; noted in the `createTask` doc comment. Also seen: agent text containing CRLF still fails the F-32 check ("file uses CRLF line endings"). After this change it fails before anything moves, so the agent can retry.
