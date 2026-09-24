---
id: CRT-0036
title: write_task loses the capture when a field contains a `## ` heading — validate before moving assets
status: backlog
priority: high
created: 2026-09-24T12:15:00+08:00
updated: 2026-09-24T12:15:00+08:00
url: null
route: null
session: null
tags: [review-2026-09, bug, tasks, f-23, f-32]
files: [packages/server/src/tasks.ts, packages/server/test/tasks.test.ts]
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
- [ ] New test (written first and seen failing): `createTask` with `## Steps` in `context` and a capture succeeds; the file validates and shows `### Steps`.
- [ ] New test: a forced validation failure (e.g. an empty ask after trimming) leaves the capture dir and its files untouched and creates no `assets/<ID>/`.
- [ ] New test: with an existing `assets/CRT-0041/` and no task files at or above 0041, the next ID is `CRT-0042`. Update the existing ID test in `tasks.test.ts:71-79`, which deliberately doesn't count assets folders, and say so in the Log.
- [ ] New test: a pre-existing file for the allocated ID makes `createTask` take the next ID, not overwrite.
- [ ] Existing `tasks.test.ts`, `sessions.test.ts` (§5.3 identical file) and `mcp-stdio.test.ts` pass unchanged.
- [ ] `npm run check` green; `npm run e2e` green.

## Notes
- The heading-demotion rule applies at write time only; `validateTaskText` is unchanged, so hand-edited files are judged as before.
- This is a correctness fix under F-23 (assets move with the task) and F-32 (file format). It adds no feature.

## Log
- 2026-09-24T12:15+08:00 — filed by hand from the code review in session e145e7ac (Simon's request); bug reproduced against dist.
