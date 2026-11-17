---
id: CRT-0060
title: M39 — crt extension, the version check, the doctor row, docs, release 0.10.0
status: backlog
priority: normal
created: 2026-11-17T13:40:00+08:00
updated: 2026-11-17T13:40:00+08:00
url: null
route: null
session: null
tags: [m39, extension, f-161, f-162, f-163, n-45, prd-extension, release]
files: [docs/PRD-extension.md, packages/server/src/cli.ts, packages/server/src/args.ts, packages/server/src/home.ts, packages/server/src/doctor.ts, packages/server/src/start.ts, packages/server/src/proxy.ts, README.md, docs/integration.md, docs/how-it-works.md, docs/troubleshooting.md, docs/cli.md, CLAUDE.md, .github/workflows/ci.yml]
---

## Summary
Make the extension installable and at home in CRT: `crt extension` puts it in a stable folder and says how to load it, the extension refuses a server of another version with the command that fixes it, `crt doctor` and plain `crt` know about it, the docs explain it, and 0.10.0 ships.

## Context
- `home.ts` owns the CRT home; `doctor.ts` the rows; `start.ts` `openDecision` what plain `crt` opens (PRD-zero F-132).
- Health's `overlay` object already counts `injected`, `fetched` and `loader` (`proxy.ts`).
- The release steps are in `CLAUDE.md` Commands; the tag push and the npm promotion are Simon's.
- `test/docs.test.ts`, the CI `changes` filter and `CLAUDE.md` name "the ten reference pages".

## Evidence
No page capture: created from `docs/PRD-extension.md` milestone M39.

## Ask
1. **`crt extension` (F-161)** — `packages/server/src/extension.ts`: copy `dist/extension/` to `<home>/extension/`, print the folder and the three steps for Chrome and Edge, refresh on a later version and say to reload; `--path`.
2. **The version check (N-45)** — the extension compares its version with health's and shows the §5.5 line on a mismatch.
3. **The server knows (F-162)** — `overlay.extension` in health, the first-mount log line, the `extension` doctor row, the `openDecision` step.
4. **Docs (F-163)** — the README block, `docs/extension.md`, the rows in `how-it-works.md`, `troubleshooting.md`, `cli.md`, the four ways in compared in `integration.md`; the pins that count the reference pages.
5. **Amendments** — every §9 row not yet applied, with its `*v0.10: …*` note; §10 ticked with evidence.
6. **Release** — versions and pins `0.10.0` / `@0.10`; `npm run screenshots` when the overlay's UI changed.

## Definition of Done
- [ ] `crt extension` writes only under `<home>/extension/`, and a second run on a newer version replaces the copy and says to reload (F-161; unit rows against a temp `CRT_HOME`).
- [ ] An extension and a server of different major.minor show the one line and mount nothing (N-45; e2e or a unit row on the comparison).
- [ ] Health counts the extension, `crt doctor` has the row, and plain `crt` opens the default browser once the extension has been seen for the project (F-162).
- [ ] `docs/extension.md` exists and is listed wherever the reference pages are counted; `test/docs.test.ts` green (F-163).
- [ ] Every row of PRD-extension §9 is applied and §10 is ticked with evidence.
- [ ] `npm run check` green; `npm run e2e` green; `claude plugin validate` green.
- [ ] **Manual** — from the published package on a machine that has never had it: `npx claude-review-tool extension`, Load unpacked, turn it on, a first Send.
- [ ] **Manual (Simon)** — `v0.10.0` tagged and pushed; the staged version promoted on npmjs.com.

## Notes
Read `docs/PRD-extension.md` §5.4, §5.5, §6.3, §8, §9 and §10. The Chrome Web Store listing is not part of this task (§13 decision 3). Needs M38.

## Log
- 2026-11-17T13:40+08:00 — created from docs/PRD-extension.md by the planning session that wrote it (Claude Code cloud session 01KVgoZguPBAwZVMCJYTTptL), after Simon's request of 2026-11-17 to review any site on its real URL without a proxy or an edit to the app. Not to be started until Simon says "build it".
