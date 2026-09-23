---
id: CRT-0032
title: M27 — Release 0.7.0: version bump and skill pins, chat.png checked, PRD-chat §9/§10 evidence, tag, publish, promote
status: in_progress
priority: normal
created: 2026-09-23T08:20:00+08:00
updated: 2026-09-23T12:15:00+08:00
url: null
route: null
session: null
tags: [m27, release, f-121, prd-chat]
files: [packages/server/package.json, plugin/.claude-plugin/plugin.json, .claude-plugin/marketplace.json, plugin/skills/, packages/server/test/skill-pin.test.ts, docs/images/chat.png, docs/PRD-chat.md, docs/PRD.md, docs/PRD-providers.md, README.md, CLAUDE.md]
---

## Summary
Ship v0.7 — the compact chat of M25 (CRT-0030) and M26 (CRT-0031) — as `claude-review-tool@0.7.0`: bump the version in the package and both plugin manifests, move the seven skills' pin to `claude-review-tool@0.7`, confirm `docs/images/chat.png` matches the release commit's overlay (re-run `npm run screenshots` if anything under `packages/overlay/` changed since M25 regenerated it), write the `*v0.7: …*` notes into the earlier PRDs per PRD-chat §9, tick PRD-chat §10 with evidence, tag `v0.7.0`, let the release workflow stage the package, and have Simon promote it. `docs/PRD-chat.md` F-121, §9, §10.

## Context
The release recipe (`CLAUDE.md` › Commands › Release; `docs/develop.md` › Release): re-run `npm run screenshots` when the overlay's UI changed since the last release (PRD-polish F-116), bump `version` in `packages/server/package.json`, `plugin/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` (two `version` fields), and the pinned `claude-review-tool@<major.minor>` in the seven skills under `plugin/skills/*/SKILL.md` (`test/skill-pin.test.ts` fails when they disagree; F-87), merge, `git tag v<version> && git push origin v<version>`. The release workflow fails if tag ≠ package version; it *stages* the version on npm via trusted publishing; the release is live only after Simon promotes the staged version on npmjs.com (package → Versions, 2FA) — the one user-only step. The v0.6.0 release (CRT-0028, PR #80, tag at dbb5f41, run https://github.com/simv/crt/actions/runs/35696378582, promoted 2026-09-22 ≈15:05+08) is the model: its Log has the exact sequence — the PR, the merge, the tag, the workflow run, editing the GitHub Release notes to name the milestones above the generated PR list, the post-promotion checks (`npm view claude-review-tool version`, a clean `npm i -g claude-review-tool@0.7.0` + `crt setup` in a fresh profile installing `crt@crt 0.7.0` with the seven skills), then a `crt/CRT-0032-done` close-out PR. The `*v0.6: …*` inline notes M24 wrote into the earlier PRDs (e.g. PRD F-65) are the pattern for the `*v0.7: …*` notes PRD-chat §9 lists as "noted by M27". The README's version reference and `CLAUDE.md`'s "What this is" sentence (PRD-chat §9 last row) are part of this milestone.

## Evidence
No page capture: created from `docs/PRD-chat.md` milestone M27 by the planning session (516e0741-5065-4f83-92e2-a6c83cf9dbd1) on 2026-09-23. Baseline for the release: `main` after CRT-0030 and CRT-0031 merge.

## Ask
1. **Versions and pins**: `0.7.0` in `packages/server/package.json`, `plugin/.claude-plugin/plugin.json` and both fields of `.claude-plugin/marketplace.json`; `claude-review-tool@0.7` in the seven skills; `test/skill-pin.test.ts` green; the README's version reference (if any names `0.6`) updated.
2. **Screenshot**: `git log <CRT-0030's screenshot commit>..HEAD -- packages/overlay` — if empty, record that in the Log and keep the PNGs; else `npm run screenshots` and commit the changed PNGs (`test/docs-images.test.ts` green).
3. **§9 notes**: the `*v0.7: …*` inline notes into `docs/PRD.md` (F-24, F-25, F-27, F-28) and `docs/PRD-providers.md` (§5), each one sentence pointing at PRD-chat F-119/F-120 and the task; `CLAUDE.md` › What this is gains the sentence in PRD-chat §9's last row; every §9 row that says "noted by M27" then reads as applied.
4. **§10 evidence**: tick every PRD-chat §10 row with the test name, e2e spec, task Log entry or run URL, as PRD-polish §10 does; update the Status row of PRD-chat's header table to "Built — M25–M27 landed (…)" with the dates.
5. **Release**: PR → merge → `git tag v0.7.0 && git push origin v0.7.0` → the `release` workflow green (run URL in the Log) → edit the GitHub Release notes to name M25 (CRT-0030, its PR) and M26 (CRT-0031, its PR) above the generated list → Simon promotes → post-promotion checks (`npm view claude-review-tool version` = `0.7.0`, `dist-tags.latest` = `0.7.0`; a clean `npm i -g claude-review-tool@0.7.0` + `crt setup` in a fresh profile installs `crt@crt 0.7.0` with the seven skills) → the close-out PR that sets this task `done`.

## Definition of Done
- [ ] Versions `0.7.0` in the package and both manifests; the seven skills pin `claude-review-tool@0.7`; `test/skill-pin.test.ts` green; `npm run check` green.
- [ ] `docs/images/chat.png` is the release commit's overlay: either `git log … -- packages/overlay` empty since CRT-0030's regeneration (Log) or regenerated and committed; `test/docs-images.test.ts` green.
- [ ] The `*v0.7: …*` notes are in PRD F-24, F-25, F-27, F-28 and PRD-providers §5; `CLAUDE.md` › What this is updated; PRD-chat §9 rows all applied; PRD-chat §10 ticked with evidence and the Status row updated.
- [ ] `v0.7.0` tagged on the merged `main` commit; the release workflow run green (URL in the Log); the GitHub Release notes name M25 and M26 with their PRs.
- [ ] Manual (Simon): the staged `0.7.0` promoted on npmjs.com — `npm view claude-review-tool version` prints `0.7.0` (the one user-only step; the worker asks for it in its reply and records the time in the Log after).
- [ ] After promotion: a clean `npm i -g claude-review-tool@0.7.0` + `crt setup` in a fresh profile installs `crt@crt 0.7.0` with the seven skills (Log); the close-out PR merged and this task `done`.

## Notes
Depends on CRT-0030 and CRT-0031 being `done` (merged). Follow CRT-0028's Log step by step; the release workflow only stages — nothing is live until Simon promotes, so the post-promotion rows wait on him (memory: "npm staging needs Simon's promote"). Nothing else changes in this milestone: no overlay or server code beyond the version fields. If the M25/M26 PRs left a §9 row unapplied (the README or how-it-works sentence), apply it here and say so.

## Log
- 2026-09-23T08:20+08:00 — created from docs/PRD-chat.md milestone M27 by the planning session that wrote it (session 516e0741-5065-4f83-92e2-a6c83cf9dbd1).
- 2026-09-23T12:15+08:00 — claimed by /crt:next, session 1e97d0a3-77a3-4a57-9ac4-c18f38dbceb4, branch crt/CRT-0032-m27-release-0-7-0
