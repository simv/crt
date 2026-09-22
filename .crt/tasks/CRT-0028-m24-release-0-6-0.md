---
id: CRT-0028
title: M24 — Release 0.6.0: version bump and skill pins, PRD-polish §9/§10 evidence, tag, publish, promote
status: in_progress
priority: normal
created: 2026-09-21T19:55:00+08:00
updated: 2026-09-22T14:21:00+08:00
url: null
route: null
session: null
tags: [m24, release, f-118, prd-polish]
files: [packages/server/package.json, plugin/.claude-plugin/plugin.json, .claude-plugin/marketplace.json, plugin/skills/, README.md, packages/server/README.md, docs/PRD-polish.md, docs/develop.md, CLAUDE.md, .github/workflows/release.yml]
---

## Summary
Ship v0.6.0: the brand (M20), the landing page (M21), the screenshots and illustrations (M22), the README front page and docs split (M23) and the still-unreleased Antigravity profile (PRD-providers M19, CRT-0023). Bump the version everywhere the pin test looks, apply the PRD-polish §9 rows that M20–M23 did not, tick §10 with evidence, tag, let the release workflow stage the package, and have Simon promote it on npm. `docs/PRD-polish.md` F-118.

## Context
Release recipe (`CLAUDE.md` › Commands › Release; `docs/develop.md` after M23): bump `version` in `packages/server/package.json`, `plugin/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`, and the pinned `claude-review-tool@<major.minor>` in the seven skills (`test/skill-pin.test.ts` fails when they disagree); merge; `git tag v0.6.0 && git push origin v0.6.0`. The `release` workflow fails if tag ≠ package version, runs `npm run check`, stages the version on npm via trusted publishing (no token) and creates a GitHub Release with generated notes; the version is live only after Simon promotes it on npmjs.com (package → Versions, 2FA) — that step is his. The SessionStart hook compares the plugin's major.minor with the project's `node_modules/claude-review-tool` (F-84/F-106): after promotion, `npm i -D claude-review-tool@0.6.0` in the trial app (`C:\Projects\Claude\tool-validation`) and `crt setup` must agree. The npm page renders `packages/server/README.md`; the lockup there is an absolute raw.githubusercontent URL (M23). 0.5.0 is the latest published version; `main` already carries M19.

## Evidence
No page capture: created from `docs/PRD-polish.md` milestone M24 by the planning session.

## Ask
1. Versions: `0.6.0` in the three manifests; `claude-review-tool@0.6` in the seven skills; the README's version reference; `crt --version` prints `crt 0.6.0 (agent sdk <pinned>)`.
2. PRD-polish §9: apply any row not yet applied by M20–M23 (the `CLAUDE.md` Release line: "re-run `npm run screenshots` when the overlay's UI changed since the last release"); mark each row's milestone in the table.
3. PRD-polish §10: tick every row with evidence (test names, e2e specs, task Log entries, run URLs) — the M18 pattern in `docs/PRD-embedded.md` §10.
4. PRD-polish status table → "Built — M20–M24 landed (CRT-0024…0028, dates)"; decision 1 records the direction that shipped.
5. Tag `v0.6.0` after the merge; confirm the release workflow run is green and the GitHub Release exists with notes naming M19 (Antigravity), M20 (brand), M21 (landing page), M22 (screenshots), M23 (README and docs); then ask Simon to promote (user-only: 2FA on npmjs.com).
6. After promotion: `npm view claude-review-tool version` → `0.6.0`; in a scratch profile `npm i -g claude-review-tool@0.6.0 && crt setup` installs `crt@crt 0.6.0`; the trial app updated to the published 0.6.0 and its SessionStart hook silent on drift; the npm page shows the lockup and the Install block.

## Definition of Done
- [ ] `test/skill-pin.test.ts` green at `0.6.0` / `@0.6`; `npm run check` and `npm run e2e` green on the release commit.
- [ ] Every PRD-polish §9 row applied and every §10 row ticked with evidence; the status table updated.
- [ ] `v0.6.0` tagged on `main`; release workflow green; GitHub Release notes name M19–M23.
- [ ] Manual (Simon): the staged version promoted on npmjs.com with 2FA — the one user-only step.
- [ ] After promotion (worker session): `npm view` shows `0.6.0`; a clean global install + `crt setup` reports `crt@crt 0.6.0`; the trial app on the published package shows no drift line; the npm page renders the lockup.

## Notes
Depends on CRT-0024, CRT-0025, CRT-0026 and CRT-0027 being `done` (merged). Do not tag before the merge; do not `--admin`-merge (memory: merge PRs with a bare `gh pr merge <n> --squash --delete-branch`). If the release workflow fails on the tag/version check, fix the version, re-tag on the fixed commit (`git tag -d`, `git push --delete origin v0.6.0`, re-tag) and say so in the Log.

## Log
- 2026-09-21T19:55+08:00 — created from docs/PRD-polish.md milestone M24 by the planning session that wrote it (session 78b6555f-fedb-4424-b1ab-1d8477f99af8).
- 2026-09-22T14:21+08:00 — claimed by /crt:next, session 8bfe6979-6e2d-4bd5-9690-de7e6b25ab14, branch crt/CRT-0028-m24-release-0-6-0
