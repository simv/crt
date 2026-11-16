---
id: CRT-0057
title: M36 — The handoff row in crt doctor, the destinations reference page with a worked example, release 0.9.0
status: backlog
priority: normal
created: 2026-11-16T19:20:00+08:00
updated: 2026-11-16T19:20:00+08:00
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
- [ ] `docs/destinations.md` is the tenth reference page; `test/docs.test.ts` and the CI filter name ten (F-150).
- [ ] The worked example in the page is loaded and run by a test against a local listener (F-150).
- [ ] Every §9 row is applied and every §10 row ticked with evidence (F-150).
- [ ] Versions and pins are `0.9.0` / `@0.9`; `test/skill-pin.test.ts` green.
- [ ] `npm run check` green; `npm run e2e` green.
- [ ] Manual (Simon): `git tag v0.9.0 && git push origin v0.9.0`, the release workflow green, the staged version promoted on npmjs.com.

## Notes
Read `docs/PRD-destinations.md` §6.4, §9, §10 and §12 rule 7 first. Needs M33, M34 and M35. Carry any Manual row of CRT-0055 and CRT-0056 that is still open into this task's Definition of Done, as CRT-0053 did for v0.8.

## Log
- 2026-11-16T19:20+08:00 — created from docs/PRD-destinations.md by the planning session that wrote it (Claude Code cloud session 01KVgoZdv6kTpuPsfwiirKoq), on Simon's go-ahead of 2026-11-16 ("stop at GitHub issues for now, with the system built so we can add more later, or others can").
