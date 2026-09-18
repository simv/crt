---
id: CRT-0022
title: M18 — README for embedded mode, e2e axis flip, PRD amendments, v0.4 DoD, release 0.4.0
status: in_progress
priority: normal
created: 2026-09-17T08:54:00+08:00
updated: 2026-09-18T18:49:00+08:00
url: null
route: null
session: null
tags: [m18, embedded, docs, e2e, release, f-107, f-108, f-109, f-110, prd-embedded]
files: [README.md, packages/server/README.md, docs/PRD.md, docs/PRD-providers.md, docs/PRD-setup.md, docs/PRD-embedded.md, CLAUDE.md, .claude/agents/prd-reviewer.md, packages/server/package.json, plugin/.claude-plugin/plugin.json, .claude-plugin/marketplace.json, package-lock.json, plugin/skills, packages/server/e2e, packages/server/playwright.config.ts, packages/server/test/readme.test.ts]
---

## Summary
Finish v0.4: rewrite the README around embedded mode (install, the four snippets, Production, What lands in your repo, Proxy mode, the redrawn diagram, troubleshooting with every new `crt:` line), flip the e2e primary servers to embedded mode, apply the PRD-embedded §9 amendments inline to the three earlier PRDs and to `CLAUDE.md` and the prd-reviewer, tick the §10 definition of done with evidence, bump to `0.4.0` (manifests, lockfile, seven skill pins), tag and release. `docs/PRD-embedded.md` §6.6, §6.7 (F-107, F-108, F-109, the M18 half of F-110), §9, §10.

## Context
After CRT-0019…0021 the code is embedded-by-default but the README still describes the proxy (`Script-tag fallback`, `How it works` with the proxy diagram), the e2e primary servers still run `crt proxy` with `baseURL` on the CRT port (PRD-embedded §13 decision 10), `docs/PRD.md` §5.2 still says "Why a proxy", and the skills pin `@0.3`. `test/readme.test.ts` is the doc test that greps for every `crt:` line and the Install block; `test/skill-pin.test.ts` enforces one version everywhere; `release.yml` publishes on a `v*` tag and Simon promotes the staged version on npm (CLAUDE.md Release line; his PowerShell 5.1 has no `&&`, so give him commands on separate lines). Depends on CRT-0019, CRT-0020, CRT-0021.

## Evidence
No page capture: created from `docs/PRD-embedded.md` milestone M18 by the planning session that wrote it.

## Ask
1. README (F-107): Install = machine block (unchanged) + the PRD-embedded §4 project block; "Add CRT to your app" with the four snippets verbatim and where each starts capturing (Vite/loader: before the app's first module; React/Next: after hydration; script tag: from the tag onward); "The loop" starts `npm run dev` → `crt` → browse your app; "Production" (the four F-98 layers, `grep -r "__crt" dist/` after a production build, the CRT port is never requested, bundlers that were verified and their versions); "What lands in your repo" (`.crt/README.md`, `.crt/tasks/`, `.crt/config.json`, the two `.gitignore` lines, the CRT section with its markers, the server writes only under `.crt/` at runtime — N-19); "Proxy mode" replaces "Script-tag fallback" (when, `crt proxy`, `mode` in `.crt/config.json`, what still applies: injection, HMR passthrough, CSP relaxing, the F-80 lines, the `Proxying …` welcome copy); "How it works" redrawn (embedded: app on its own origin → loader → overlay → cross-origin `/__crt/*` → CRT server → agent session; proxy mode as the alternative in one paragraph); the flags table gains `crt proxy`, `--mode`, `crt init --yes/--no-instructions/--snippet [--json]`; Privacy paragraph states N-22; Troubleshooting gains "The CRT button does not appear (embedded)" (the loader pill, `crt doctor`'s `integration` row, CSP `script-src` + `connect-src` for `http://localhost:4400`, the script-tag form's silent failure when the server is down, port stepping and the F-93 line) and "CRT is not set up" (F-99), and quotes every new `crt:` line from F-91, F-93, F-94, F-99, F-100, F-103 verbatim; `test/readme.test.ts` gains a row per line and per section; `packages/server/README.md` gets the same Install and snippet blocks.
2. e2e flip (F-110, M18 half): `playwright.config.ts` primary servers run embedded (`crt.mjs` without `--proxy`), `baseURL` = the fixture origin (`http://localhost:3999`), every fixture page in `server.mjs` includes the loader tag for the CRT port it is told (`FIXTURE_CRT_ORIGIN` env or the existing `?crt=` query), and `capture.spec.ts`, `chat.spec.ts`, `arrival.spec.ts`, `focus.spec.ts` run on the app origin with their URL/origin assertions updated mechanically; a dedicated proxy server (own scratch root, `--proxy`) stays for `proxy.spec.ts` and for any spec the flip cannot take mechanically — name each such spec and the reason in the Log (§12 rule 6); `embedded.spec.ts` and `script-tag.spec.ts` are reconciled (one of them may go).
3. PRD amendments (F-108): every PRD-embedded §9 row applied as an inline "v0.4:" note to `docs/PRD.md` (§2 Goal 5, §3 Non-goal 3, §4, §5/§5.1/§5.2, §8, F-1, F-2, F-3, F-5, F-6, F-20, F-23, F-35, F-36, F-41, N-5, N-6, §11 rows, §12), `docs/PRD-providers.md` (N-8) and `docs/PRD-setup.md` (§3, F-71, F-73, F-75, F-76, F-78, F-80, F-82, F-83, F-86, F-87, N-16); the `docs/PRD.md` header table's "Amended by" cell already names this document — extend it with the ID ranges if the planning PR did not; `CLAUDE.md` per F-108 (What this is, entry points, the entries convention line, build line, Don'ts, Release line with seven skills — whichever earlier milestones did not already apply); `.claude/agents/prd-reviewer.md` reads `docs/PRD-setup.md` and `docs/PRD-embedded.md`, its N-5 row lists `CLAUDE.md`/`AGENTS.md` via `init.ts`, and the new N-18 row (no server imports in the entries; every browser-facing body behind the `NODE_ENV` guard).
4. v0.4 DoD (PRD-embedded §10): tick every row with its evidence (test name, e2e spec, task Log entry, run URL); rows that depend on Simon's Manual items cite the CRT-0019/0020/0021 Log lines where he confirmed them, or say they are pending.
5. Release (F-109): `0.4.0` in `packages/server/package.json`, `plugin/.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` (both fields), `package-lock.json`'s workspace entry, and the seven skills' `npx -y claude-review-tool@0.4` pins (`test/skill-pin.test.ts` enforces); PRD-setup F-86's skill list in `setup.ts` and the README names seven skills; after merge: `git tag v0.4.0` and `git push origin v0.4.0` on separate lines for Simon, the `release` workflow, the GitHub Release, promotion on npm.

## Definition of Done
- [ ] `test/readme.test.ts` finds every new section and every F-91/F-93/F-94/F-99/F-100/F-103 line verbatim; "How it works" describes embedded mode first; no README section still presents the proxy as the default.
- [ ] e2e primary servers run embedded with `baseURL` on the fixture origin; `capture`, `chat`, `arrival`, `focus` specs green on the app origin in the PR run, or each exception is named in the Log with its reason and still runs on the proxy server; `proxy.spec.ts` green on the proxy server.
- [ ] Every PRD-embedded §9 row is applied inline in the three earlier PRDs, `CLAUDE.md` and the prd-reviewer (grep for "v0.4" per amended statement in the Log).
- [ ] Every PRD-embedded §10 row is ticked with evidence, or explicitly marked pending on a named Manual item.
- [ ] All version fields and the seven skill pins equal `0.4.0` / `@0.4`; `npm run check` green; `claude plugin validate` passes on `./plugin`, `.`, and the two `dist/plugin-marketplace` paths.
- [ ] Manual (Simon): the F-109 rows on the trial app (`/crt:init`, `crt` on `:3100` with the button and welcome card, a `console.error` in a capture, a full Send, a clean `next build`) and on a scratch Vite app (button, clean `vite build`); `v0.4.0` tagged, `release` workflow green, GitHub Release exists, `npm view claude-review-tool version` → `0.4.0` after promotion.

## Notes
Keep "How it works" as a fenced diagram plus bullets like today (the doc test checks sections, not bytes). When flipping a spec, change URLs and origin assertions only; a spec that needs new fixture behaviour to pass on the app origin stays on the proxy server (§12 rule 6). The bump is the last commit on the branch so the Manual rows can be run against the release artefacts; do not tag before merge. Never add an update check or registry lookup (PRD-setup N-16). Give Simon the tag/push and the `npm i -g claude-review-tool@0.4.0` / `crt setup` commands on separate lines.

## Log
- 2026-09-17T08:54+08:00 — created from docs/PRD-embedded.md milestone M18 by the planning session that wrote it.
- 2026-09-18T18:49+08:00 — claimed by /crt:next, session fa6b7fa6-18bf-4ca2-ab4e-a94d900cd258, branch crt/CRT-0022-m18-docs-e2e-flip-prd-amendments-release-0-4-0. Picked over CRT-0013 (priority low, Should milestone): normal outranks low.
