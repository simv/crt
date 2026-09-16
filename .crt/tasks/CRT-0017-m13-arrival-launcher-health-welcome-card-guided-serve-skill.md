---
id: CRT-0017
title: M13 — Arrival: launcher health dot, welcome card, overlay-missing detection, guided /crt:serve
status: backlog
priority: high
created: 2026-09-16T14:50:00+08:00
updated: 2026-09-16T14:50:00+08:00
url: http://localhost:4400/
route: /
session: null
tags: [m13, setup, overlay, skill, f-80, f-81, f-82, f-83, f-84, prd-setup]
files: [packages/overlay/src/ui.ts, packages/overlay/src/welcome.ts, packages/overlay/src/index.ts, packages/overlay/src/base.ts, packages/server/src/proxy.ts, packages/server/src/serve.ts, plugin/skills/serve/SKILL.md, plugin/hooks/session-start.mjs, packages/server/e2e/proxy.spec.ts, packages/server/e2e/chat.spec.ts, packages/server/e2e/fixture/server.mjs, packages/server/test/session-start-hook.test.ts, packages/server/test/serve-skill.test.ts, README.md]
---

## Summary
After `crt` succeeds the developer sees a page that looks exactly like their app plus a small button, and nothing says what is proxied, where tasks go, whether the agent is ready or logged in, or — when an SPA shell or a strict CSP kept the overlay out — that anything is wrong. Give the launcher a health dot with a tooltip, show a one-time welcome card per project, have the server report an overlay that was injected but never fetched, and make `/crt:serve` reuse a running CRT, ask for the URL in chat when none is found, and reply in four lines. `docs/PRD-setup.md` §6.2 F-80, §6.3 F-81–F-82, §6.4 F-83–F-84.

## Context
The overlay's only load-time call is `GET /__crt/providers`, with failures swallowed; it never reads `/__crt/health`; the launcher has no state; the first server-side signal of trouble is a failed Send (PRD-setup Appendix A.4). Injection happens only for `text/html` responses and `relaxCsp` cannot handle `'strict-dynamic'`, nonces or `<meta>` CSP; the terminal is silent in every miss. `plugin/skills/serve/SKILL.md` waits 30 s for the ready line (a first `npx` run downloads ~220 MB), relays `crt: no dev server found` and stops. Depends on CRT-0016 (health fields `version`, `startedAt`, `tasksDir`, `tasks`, `login`, `sessions`; `--yes`; the reuse exit 0). Milestone M13 in PRD-setup §8.

## Evidence
No page capture: created from `docs/PRD-setup.md` milestone M13. The launcher today is `.launcher` in `packages/overlay/src/ui.ts`; the e2e specs click it directly, which is why the welcome card must stay suppressed under the `stub` provider.

## Ask
1. Server (F-80): per injected HTML response start a 10 s timer cleared by any `/__crt/overlay.js` request; on expiry print, once per server, the `crt: injected the overlay into GET / but the browser never fetched /__crt/overlay.js — …` line; maintain health's `overlay: { injected, fetched, lastContentType, cspWarning }`. Should: the non-HTML document line and the unrelaxable-CSP line (exact copy in PRD-setup F-80), once each.
2. Overlay (F-81): launcher dot + tooltip with states `checking` / `connected` / `login unknown` / `agent not ready` / `unreachable` and the copy in PRD-setup F-81; one health fetch at mount, on `visibilitychange`, and after any failed CRT request; no timers. Should: `different project` by comparing health `startedAt`/`projectRoot` with `sessionStorage`. Agent noun from the provider display name (F-56); chrome stays "CRT" (F-64).
3. Overlay (F-82): `welcome.ts` card above the launcher with the exact copy, live values from health and providers, `localStorage` key `crt.welcome.v1:<projectRoot>`, buttons **Got it** and (Should) **Show me**; suppressed for `stub`, script-tag mode, iframes, restored threads/annotations, and failed health; `window.__crt.welcome()` opens it on demand.
4. Skill (F-83): step 0 health check and reuse for the same `projectRoot` (AskUserQuestion when it belongs to another project: `--replace` or `--port`); run `crt serve --open --yes [--target …]` in the background; wait up to 5 min whenever the `npx -y` fallback ran (with the "npx may be downloading it" note), 30 s when `npx --no crt` resolved; poll health on the port named by the ready line; on `no dev server found` ask "Which URL or port is your dev server on?" and re-run with `--target`; 10 s after readiness check `overlay.fetched` and add the fallback sentence when 0; the four-line reply plus the "(reused …)" / "(target came from your answer …)" suffixes. The skill never starts the dev server.
5. Hook (F-84, Should): one drift line when the plugin's `plugin.json` major.minor differs from `${CLAUDE_PROJECT_DIR}/node_modules/claude-review-tool/package.json`'s; local reads only; exit 0 always; `session-start-hook.test.ts` covers match, mismatch, missing file.
6. Tests (F-90 overlay/skill half): e2e launcher dot reaches `connected` and turns `unreachable` after the server closes (a dedicated short-lived server in the spec); `window.__crt.welcome()` renders the card with health's project and target and "Got it" writes the key; F-80 line appears when the fixture serves a page whose CSP blocks the overlay script (fixture route); `claude plugin validate ./plugin` passes; skill text contains the health step, the AskUserQuestion fallback and the four reply lines (doc test).
7. README "The loop" step 1 and Troubleshooting › "Overlay does not appear" mention the dot, the card and the new terminal line (full README rewrite is M14).

## Definition of Done
- [ ] e2e: launcher dot `connected` with the tooltip naming the project and the " · login not checked yet" suffix (the stub reports login unknown); `unreachable` after its own dedicated server closes.
- [ ] e2e: `window.__crt.welcome()` shows the card with `health.target`, `health.projectRoot` and the agent line; **Got it** stores `crt.welcome.v1:<projectRoot>`; the card never appears on the stub-backed pages the other specs load.
- [ ] e2e: a fixture page with a blocking CSP produces the F-80 terminal line in `crt-serve.log` and health `overlay.fetched` stays 0 while `injected` is ≥ 1.
- [ ] `claude plugin validate ./plugin` and `.` pass; the skill doc test finds the health step, the AskUserQuestion question and the four reply lines; hook test covers the drift line.
- [ ] `npm run check` and `npm run e2e` pass; overlay gzipped size stays under the N-3 budget.
- [ ] Manual (Simon): in Claude Code on the trial app with no dev server running, `/crt:serve` asks for the port in chat, starts on the answer, replies with the four lines; the welcome card appears once on the trial app and not after **Got it**; stopping `crt serve` turns the dot red with its tooltip; with `/crt:serve` run twice, the second reply says it reused the running CRT.

## Notes
Health polling is forbidden (PRD-setup §3); the dot updates only on the three triggers. The welcome card must not overlap `.launcher` or `.status` in a way that breaks `capture.spec.ts`/`chat.spec.ts` selectors — it is suppressed under `stub` and opened explicitly in its own test. The "different project" state and the two extra F-80 lines are Should; ship them if they fit, leave them named in the Log if not.

## Log
- 2026-09-16T14:50+08:00 — created from docs/PRD-setup.md milestone M13 by the planning session that wrote it.
