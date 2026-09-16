---
id: CRT-0018
title: M14 — Install: plugin bundled in the package, crt setup, one version rule, README, release 0.3.0
status: in_progress
priority: normal
created: 2026-09-16T14:50:00+08:00
updated: 2026-09-16T22:41:00+08:00
url: null
route: null
session: null
tags: [m14, setup, install, release, docs, f-85, f-86, f-87, f-88, f-89, prd-setup]
files: [packages/server/scripts/copy-intake.mjs, packages/server/src/setup.ts, packages/server/src/cli.ts, packages/server/package.json, plugin/.claude-plugin/plugin.json, .claude-plugin/marketplace.json, plugin/skills/serve/SKILL.md, plugin/skills/next/SKILL.md, plugin/skills/tasks/SKILL.md, plugin/skills/task/SKILL.md, plugin/skills/done/SKILL.md, plugin/skills/intake/SKILL.md, packages/server/test, packages/server/e2e/fixture, README.md, docs/PRD.md, docs/PRD-providers.md, docs/PRD-setup.md, CLAUDE.md, .github/workflows/ci.yml]
---

## Summary
Make the machine install two commands that work from npm alone: `npm i -g claude-review-tool` then `crt setup`, which registers the plugin shipped inside the package with Claude Code, so a private or moved GitHub repository cannot block anyone and the plugin version always equals the server version. Pin the skills to the plugin's own version instead of `@latest`, rewrite the README around `crt`, tick the v0.3 definition of done, and release `0.3.0`. `docs/PRD-setup.md` §5.5, §6.5 (F-85…F-89), §10.

## Context
npm has only `claude-review-tool@0.1.0` while `main` carries v0.2 and anchored threads; `simv/crt` is private, so `claude plugin marketplace add simv/crt` fails without repository credentials; the owner's own plugin install reports 0.0.1; the six skills call `npx -y claude-review-tool@latest`, which re-resolves the tag on every skill run and would hand a v0.3 plugin a v0.1 server on any other machine (PRD-setup §1, Appendix A.1/A.3). `claude plugin` offers `marketplace add|list|remove|update`, `install`, `update`, `list --json`, `validate`; adding a marketplace with an existing name replaces it. Depends on CRT-0016 (`crt --version`, health `version`, `doctor`'s plugin row) and CRT-0017. If CRT-0014 has not shipped `0.2.0` by then, this task also carries CRT-0014's Asks and ticks its rows here (PRD-setup F-89). Milestone M14 in PRD-setup §8.

## Evidence
No page capture: created from `docs/PRD-setup.md` milestone M14. Registry state at planning time: `npm view claude-review-tool versions` → `["0.1.0"]`; `gh repo view simv/crt` → `PRIVATE`; `claude plugin list` on the owner's machine → `crt@crt` Version 0.0.1.

## Ask
1. Build (F-85): `copy-intake.mjs` (or a sibling script) copies `plugin/` and a generated `.claude-plugin/marketplace.json` (name `crt`, `source: ./plugin`, version = package version) into `dist/plugin-marketplace/`; CI validates `dist/plugin-marketplace` and `dist/plugin-marketplace/plugin` with `claude plugin validate` in addition to the source paths.
2. `setup.ts` + `crt setup` (F-86): resolve `claude` like `codex` (config override, PATH, npm shim parsing via `providers/exec.ts`); `claude plugin list --json` → already installed at this version → say so, exit 0; else `marketplace add <dist/plugin-marketplace>` then `install crt@crt` (or `update crt@crt` when an older version is present); the exact success, missing-`claude` and failed-subcommand lines from PRD-setup F-86; `shell: false` throughout; `crt setup` writes nothing itself.
3. One version rule (F-87): the six skills resolve `crt` as `npx --no crt` then `npx -y claude-review-tool@<major.minor>`; a unit test asserts each skill's pinned string equals the manifest version's major.minor and that `@latest` appears in no skill; `CLAUDE.md` Release line gains the skill pin.
4. README (F-88): Install = the PRD-setup §4 block; `-D` for teams, `npx` zero-install with the ~220 MB first-run note and the Windows `crt.ps1`/execution-policy note; "The loop" starts with `crt`; flags table gains the positional target, `--yes`, `--no-open`, `--replace`, `crt doctor`, `crt setup`, `crt --version`; Troubleshooting opens with `crt doctor` and quotes every new `crt:` line from F-71, F-73, F-76, F-80, F-86 verbatim (doc test greps for each); note the F-79 shutdown route's local exposure; "How it works" unchanged.
5. Docs: apply the remaining PRD-setup §9 rows to `docs/PRD.md` as inline "v0.3:" notes (§4 step 1, §8, F-1, F-5, F-35, F-36, F-41, N-5, N-6, §11 rows) and to `docs/PRD-providers.md` (F-45, F-52, F-57, N-7); tick every PRD-setup §10 row with evidence; `CLAUDE.md` build line mentions `dist/plugin-marketplace/`.
6. Release (F-89): version `0.3.0` in the three manifests and the skill pins; after merge, tag `v0.3.0`, confirm the release workflow published and created the GitHub Release. If `0.2.0` was never released, fold CRT-0014's Asks in, skip the `v0.2.0` tag entirely (one release, `0.3.0`), and note it in both Logs. `crt setup` resolves `claude` from PATH or `--claude <path>` only — no config key (PRD-setup F-86).

## Definition of Done
- [ ] `npm run build` produces `dist/plugin-marketplace/` and `claude plugin validate` accepts both the marketplace and the plugin inside it (CI step).
- [ ] `crt setup` unit tests against a fake `claude` (installed like `fake-codex`, both runners): already-installed → exit 0 with the "already installed" line; older-installed → `update`; missing `claude` → the manual two-command line, exit 1; failing subcommand → its first stderr line in one `crt:` line.
- [ ] The skill pin test passes; `grep -r "@latest" plugin/skills` is empty.
- [ ] README Install is the §4 block; the doc test finds every new `crt:` line; Troubleshooting starts with `crt doctor`.
- [ ] Every PRD-setup §10 row is ticked with evidence, or explicitly marked not shipped with the reason.
- [ ] All version fields equal `0.3.0`; `npm run check` passes.
- [ ] Manual (Simon): `npm i -g claude-review-tool@0.3.0 && crt setup` in a fresh `CLAUDE_CONFIG_DIR` profile without the repo yields the six skills; `claude plugin list` shows `crt@crt 0.3.0`; `crt setup` again prints "already installed"; `v0.3.0` tagged, release workflow green, `npm view claude-review-tool version` → 0.3.0, GitHub Release exists.

## Notes
Lead install is global (PRD-setup §13 decision 3); keep the GitHub marketplace path in the README as an alternative and note the open question about making the repo public. The marketplace registered by `crt setup` uses the same name `crt` as the GitHub one so it replaces rather than duplicates (§12 rule 3 if Claude Code behaves differently). Never add an update check or registry lookup (N-16).

## Log
- 2026-09-16T14:50+08:00 — created from docs/PRD-setup.md milestone M14 by the planning session that wrote it.
- 2026-09-16T22:41+08:00 — claimed by /crt:next, session 21c8bea3-fd0d-49d4-97aa-734d23658916, branch crt/CRT-0018-m14-install-crt-setup-bundled-plugin-readme-release-0-3-0
