---
id: CRT-0014
title: M11 — Providers docs, v0.2 definition of done, release 0.2.0
status: backlog
priority: normal
created: 2026-09-15T17:30:00+08:00
updated: 2026-09-15T17:30:00+08:00
url: null
route: null
session: null
tags: [m11, f-62, f-64, n-12, release, docs, prd-providers]
files: [README.md, docs/PRD.md, docs/PRD-providers.md, packages/server/package.json, plugin/.claude-plugin/plugin.json, .claude-plugin/marketplace.json]
---

## Summary
Close out v0.2: the README "Providers" section, the interim naming line, the telemetry and compatibility statements, the v1.0 PRD annotations from PRD-providers §9, the §10 definition-of-done table filled with evidence, and the `0.2.0` release.

## Context
`docs/PRD-providers.md` §8 (M11), §9, §10, F-62, F-64, N-12, F-48 compatibility note, N-13 note. Depends on CRT-0010, CRT-0011, CRT-0012 (and CRT-0013 if it shipped). Release procedure is in CLAUDE.md: bump `version` in `packages/server/package.json` and both plugin manifests, merge, `git tag v0.2.0 && git push origin v0.2.0`; `release.yml` fails if the tag differs from the package version.

## Evidence
No page capture: created from PRD-providers milestone M11.

## Ask
1. README: "Providers" section with the F-43 order as one list, `crt providers` sample output verbatim, per-provider install/login/troubleshooting with every N-7 line verbatim, the F-64 first-paragraph line, the N-12 telemetry statement per provider, the F-48 minimum-version note, the N-13 per-turn resume note. Keep the existing Troubleshooting section; add a doc test that greps the README for each profile's problem strings.
2. `docs/PRD.md`: apply the §9 annotations (Goal 6, Non-goal 5, F-13, F-24, F-26, F-28, F-30, F-32, F-35, N-2, N-4, N-5, N-6, §11 rows, §12 row, §14 glossary) as inline "v0.2:" notes, not rewrites.
3. `docs/PRD-providers.md` §10: tick every row with evidence (test name, e2e spec, task Log entry or run URL); leave the M10 row unticked if CRT-0013 did not ship and say so.
4. Version `0.2.0` in the three files; after merge, tag and confirm the release workflow publishes `claude-review-tool@0.2.0` and creates the GitHub Release.

## Definition of Done
- [ ] Every PRD-providers §10 row is ticked with evidence, or explicitly marked not shipped (M10 only).
- [ ] The doc test finds every N-7 string in the README.
- [ ] `docs/PRD.md` carries the §9 annotations and still says v1.0 is the base document.
- [ ] All three version fields equal `0.2.0`; `npm run check` passes.
- [ ] Manual (Simon): `v0.2.0` tagged, release workflow green, `npm view claude-review-tool version` → 0.2.0, GitHub Release exists.

## Notes
—

## Log
- 2026-09-15T17:30+08:00 — created from PRD-providers milestone M11 by the planning session that wrote docs/PRD-providers.md.
- 2026-09-16T23:05+08:00 — folded into CRT-0018 (PRD-setup F-89): `0.2.0` was never released, so M14 carries this task's Asks — README Providers section (F-43 order list, `crt providers` sample, every N-7 line, F-64 first-paragraph line, N-12 telemetry, F-48 minimum-version note, N-13 resume note; doc test `test/readme.test.ts`), `docs/PRD.md` §9 "v0.2:" annotations, `docs/PRD-providers.md` §10 ticked with evidence (M10 row marked not shipped), and one release `0.3.0` (no `v0.2.0` tag). Written by session 21c8bea3-fd0d-49d4-97aa-734d23658916 per the CRT-0018 Ask; status left for Simon to close alongside CRT-0018.
