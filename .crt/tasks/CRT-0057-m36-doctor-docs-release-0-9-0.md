---
id: CRT-0057
title: M36 — The handoff row in crt doctor, the destinations reference page with a worked example, release 0.9.0
status: review
priority: normal
created: 2026-11-16T19:20:00+08:00
updated: 2026-11-16T19:44:00+08:00
url: null
route: null
session: null
tags: [m36, docs, doctor, release, destinations, f-149, f-150, prd-destinations]
files: [docs/PRD-destinations.md, docs/destinations.md, docs/cli.md, docs/review.md, docs/how-it-works.md, docs/troubleshooting.md, README.md, CLAUDE.md, .claude/agents/prd-reviewer.md, .github/workflows/ci.yml, packages/server/src/doctor.ts, packages/server/src/review-page.ts, packages/server/test/docs.test.ts, packages/server/package.json]
---

## Summary
Close v0.9: `crt doctor` says where a hand-over will go and whether that can work, the review page names the destination, and a tenth reference page, `docs/destinations.md`, documents the built-in destinations and how to write one — with a worked example the tests run, so the page cannot drift from the contract. Then release `0.9.0`.

## Context
- M33–M35 (CRT-0054…0056) provide the seam, the exports and GitHub Issues.
- `test/docs.test.ts` and the CI `changes` filter pin the list of reference pages (nine today); they change together with the page (PRD-destinations §12 rule 7).
- The release steps are in `CLAUDE.md` Commands; the tag push and the npm promotion are Simon's.

## Evidence
No page capture: created from `docs/PRD-destinations.md` milestone M36.

## Ask
1. **The `handoff` row (F-149)** in `crt doctor` and `GET /__crt/doctor`: the default destination and whether its tool or file is there, importing no external module and making no network call.
2. **The review page's sentence (F-149)**: `crt handoff` stays the command; the sentence names the destination.
3. **`docs/destinations.md` (F-150)**: what a destination is; the built-in ones and their options; writing one — the contract, a complete worked example of about sixty lines that posts each item to an HTTP endpoint, testing it against `--to json` output, the trust rule; what is recorded. The example is a file under `docs/` or `test/fixtures/` that the page shows and a test loads and runs.
4. **The other docs**: `docs/cli.md`, `docs/review.md`, `docs/how-it-works.md`, `docs/troubleshooting.md`; one line and one example in the README (still ≤ 200 lines).
5. **§9 and §10**: every remaining §9 row applied with its `*v0.9: …*` note; §10 ticked with evidence; the PRD's Status line.
6. **Release**: `0.9.0` in `packages/server/package.json`, both plugin manifests, the lockfile and the seven skills' pin (`@0.9`); `npm run screenshots` only if the review page's look changed.

## Definition of Done
- [ ] `crt doctor` prints the `handoff` row for a default, a configured built-in and an external destination whose file is missing, importing nothing (F-149, N-39).
- [x] `docs/destinations.md` is the tenth reference page; `test/docs.test.ts` and the CI filter name ten (F-150).
- [ ] The worked example in the page is loaded and run by a test against a local listener (F-150).
- [x] Every §9 row is applied and every §10 row ticked with evidence (F-150).
- [x] Versions and pins are `0.9.0` / `@0.9`; `test/skill-pin.test.ts` green.
- [ ] `npm run check` green; `npm run e2e` green.
- [ ] Manual (Simon): `git tag v0.9.0 && git push origin v0.9.0`, the release workflow green, the staged version promoted on npmjs.com.

## Notes
Read `docs/PRD-destinations.md` §6.4, §9, §10 and §12 rule 7 first. Needs M33, M34 and M35. Carry any Manual row of CRT-0055 and CRT-0056 that is still open into this task's Definition of Done, as CRT-0053 did for v0.8.

## Log
- 2026-11-16T19:20+08:00 — created from docs/PRD-destinations.md by the planning session that wrote it (Claude Code cloud session 01KVgoZdv6kTpuPsfwiirKoq), on Simon's go-ahead of 2026-11-16 ("stop at GitHub issues for now, with the system built so we can add more later, or others can").
- 2026-11-16T19:44+08:00 — claimed (in_progress) and built in the same pull request as CRT-0054 (https://github.com/simv/crt/pull/131): the `handoff` row in `doctor.ts`, ` — to <title>` on the review page, `docs/destinations.md`, the other pages, `CLAUDE.md`, the reviewer agent, the `*v0.9: …*` notes in PRD.md and PRD-zero.md, PRD-destinations §14 "As built", versions `0.9.0` and pins `@0.9`.
- 2026-11-16T19:44+08:00 — Simon, 2026-11-16: "create a 'send to for own command' plugin as a proof of concept and example for how others can build a plugin". Built as the worked example of F-150 instead of the HTTP poster this task's Ask named: `packages/server/examples/destination-command.mjs`, shipped as `claude-review-tool/destination-command` (`files` gains `examples`). It runs the developer's command once per item, the item as JSON on its standard input.
- 2026-11-16T19:44+08:00 — verified: DoD 2 — `test/docs.test.ts` with ten pages, `destinations.test.ts` "lists every built-in destination as `crt handoff --list` prints it"; the CI filter comment names ten. DoD 4 — every §9 row applied; §10 has nine rows ticked with evidence, the other two wait on the Manual rows and say so. DoD 5 — `0.9.0` in `packages/server/package.json`, both manifests and the lockfile, `@0.9` in the seven skills, `test/skill-pin.test.ts` green.
- 2026-11-16T19:44+08:00 — DoD 1 left open as written: the row is printed for a configured built-in and for an outside destination whose file is missing (`doctor.test.ts` "adds the handoff row only when the config chose a destination, and warns when its module is missing"), importing nothing — but there is no row for the default, on purpose (PRD-destinations §14.6: a project that configures nothing sees the `crt doctor` of 0.8). DoD 3 left open as written: the example is run by the tests against a command of the fixture's, not a local listener ("runs the command once per kept item with the item as JSON on its standard input, and records what it answers", "stops at the item the command fails on, and sends only the rest next time"). Simon to say whether the two rows may be read that way.
- 2026-11-16T19:44+08:00 — DoD 6: as CRT-0054's last Log line — left unticked until CI says so. No `npm run screenshots`: the overlay is unchanged and the review page differs only when a destination is configured.
- 2026-11-16T19:44+08:00 — DoD 7 (Manual, Simon) open: the tag and the promotion follow the merge.
