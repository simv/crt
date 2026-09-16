---
id: CRT-0016
title: M12 — Guided start (crt [target]), busy-port diagnosis, login preflight, crt doctor
status: in_progress
priority: high
created: 2026-09-16T14:50:00+08:00
updated: 2026-09-16T16:11:00+08:00
url: null
route: null
session: null
tags: [m12, setup, cli, f-69, f-70, f-71, f-72, f-73, f-74, f-75, f-76, f-77, f-78, f-79, n-14, n-15, n-16, n-17, prd-setup]
files: [packages/server/src/cli.ts, packages/server/src/args.ts, packages/server/src/serve.ts, packages/server/src/start.ts, packages/server/src/prompt.ts, packages/server/src/doctor.ts, packages/server/src/init.ts, packages/server/src/target.ts, packages/server/src/providers/claude.ts, packages/server/src/proxy.ts, packages/server/src/provider-routes.ts, packages/server/src/session.ts, packages/server/src/providers/detect.ts, packages/server/test, packages/server/e2e, plugin/skills/serve/SKILL.md, README.md, CLAUDE.md]
---

## Summary
`crt` with no flags should get the site into the browser with CRT on it: find the dev server or ask for its URL once and remember it per machine, recognise a stale CRT on the port and reuse or step around it, know whether Claude Code is logged in before the browser opens, and print a `crt doctor` checklist that names every failing thing with its fix. `docs/PRD-setup.md` §5, §6.1, §6.2, §7 (F-69…F-79, N-14…N-17).

## Context
Today `crt` prints usage, `--target` is a flag that is never remembered, port 3100 is not probed, `EADDRINUSE` names no process, and `claudePreflight` hard-codes `loggedIn: "unknown"` (`packages/server/src/providers/claude.ts`). The owner runs CRT from a memorised absolute-path command and hits a stale server on 4400 daily (PRD-setup §1, Appendix A.1/A.2). The bundled Claude binary answers `auth status --json` with `loggedIn` in ~300 ms (verified on 2.1.270, PRD-setup §5.4). The guided start must be a pure state machine over injected probes so every transcript is a unit-test row (PRD-setup §5.1); interactive only on a real terminal (§5.2); answers remembered in `.crt/config.local.json` (§5.3). Milestone M12 in PRD-setup §8; no PRD change is needed beyond the §9 rows already written.

## Evidence
No page capture: created from `docs/PRD-setup.md` milestone M12 by the planning session that wrote it.

## Ask
1. CLI grammar (F-69): bare `crt` and `crt <target>` start; `crt serve [target]` stays; `--target` kept as an alias; `crt help`/`--help`/`-h`; `crt --version` printing package + bundled Claude version; unknown-command line with exit 2. `crt doctor` command (F-76). New flags `--yes`, `--no-open`, `--replace`.
2. `start.ts`: the guided state machine (F-70…F-73) over injected `isReachable`, `probeAll`, `health`, `preflight`, `prompt`, `listen`; `serve.ts` calls it non-interactively; `prompt.ts` on `node:readline/promises` with validation, the 2 s re-probe wait loop and Ctrl+C semantics (F-77). Interactive iff TTY on stdin+stdout, `CI` unset, no `--yes`.
3. Target (F-71/F-72): `target.ts` probe collects every responder with a `<title>`/`X-Powered-By` label; one/several/none/explicit-down paths with the exact copy in PRD-setup F-71; `package.json` `scripts.dev` hint; an empty answer re-prompts; targets typed, picked or given as the positional are written to `.crt/config.local.json` once they respond (`writeLocalConfig` gains `target`) — never the `--target` flag, a probe hit, a `Y` to "Use 3000?", a port fallback or `--port`; `readConfig` layers `target` and `port` local-over-project.
4. Busy port (F-73, F-79): on `EADDRINUSE` GET health (1 s, retried once); reuse same project+target (exit 0, opens browser when asked, non-interactive too); other CRT / non-CRT → interactive choice or automatic 4401…4409 with the `crt:` lines; explicit `--port` never stepped around; `--replace` via `POST /__crt/internal/shutdown` (Origin-less only, N-8) with the failure line.
5. Login preflight (F-74): `claudePreflight` spawns the bundled binary `auth status --json` (shell:false, 5 s), reads only `loggedIn`; false → existing N-6 line plus the install hint when `claude` is not on PATH; `?refresh=1` re-runs it; `crt providers` and `/__crt/providers` show `logged in` / `not logged in` / `login unknown`. Because `preflightPasses` already fails on `loggedIn: false`, a logged-out Claude is demoted by F-44 when another provider is usable and otherwise resolves as the default with the reason `claude not logged in`; add those rows to the F-60 detection table and record the bundled binary version and the observed JSON shape in the `claude.ts` header.
6. Output (F-75, F-78): ready line with `in <tasksDir>` and `login: ok|missing|unchecked`; interactive next-action line; first-init line ending `— commit .crt/`; `crt: overlay loaded in the browser (GET /)` on the first overlay fetch; health payload `{ ok, version, startedAt, target, projectRoot, tasksDir, tasks, provider, login, sessions, overlay }` (the `overlay` object may be `{ injected: 0, fetched: 0 }` until M13 fills it).
7. `doctor.ts` (F-76): rows node / project / .crt / target / port / one per provider / plugin, words not glyphs, `FAIL` (exit 1) only for node, target, port and the resolved provider, `warn` for other providers and the plugin row, the wordings in PRD-setup F-76; the guided start prints only FAIL/warn rows before its first prompt; the plugin row spawns `claude plugin list --json` only inside `crt doctor` (never in the start path).
8. Tests (F-90 server half): every §6.1 transcript as a table row (interactive and `--yes`); `normalizeTarget` positional detection; config layering; `writeLocalConfig` target; `claudePreflight` fixtures (true/false/garbage/non-zero/timeout); doctor rows + exit code; health shape; e2e busy-port spec with its own scratch project and its own servers (spawn `dist/cli.js serve --yes` with `CRT_SESSION_STUB=1` and stdout captured — not a second `crt.mjs` on a shared root, which would truncate its log): a second start on the same target+project exits 0 with the reuse line while the first keeps serving; a non-CRT listener makes the next start take 4401 with its line.
9. Update the CLAUDE.md entry-points line (PRD-setup §9) and the README flags table minimally so `npm run check`'s doc tests still pass; the full README rewrite is M14.

## Definition of Done
- [ ] `npm run check` green; every PRD-setup §6.1 transcript is a passing unit row, interactive and `--yes`.
- [ ] Doctor unit rows: `FAIL` and exit 1 only for node too old, target down/unset, port held, resolved provider unusable; `warn` and exit 0 for another provider's problem and for the plugin row; the F-76 wordings verbatim.
- [ ] `crt 3999` against the e2e fixture starts with no prompt and writes `target: "http://localhost:3999"` into the scratch project's `.crt/config.local.json`; a second run prints no `Remembered` line and its ready line still names 3999.
- [ ] Busy-port e2e: reuse (same target/project → exit 0, reuse line, first server still serving) and non-CRT listener (→ 4401 with its line) pass in the PR run (e2e runs on ubuntu only; the Windows unit job covers the shim path).
- [ ] Manual (Simon): `crt doctor` on this repo exits 0, prints `ok` for node, project, `.crt` and claude (logged in), `warn` for codex if it is logged out, and ends with `→ claude — …`.
- [ ] `claudePreflight` fixtures: `loggedIn` true/false/garbage/non-zero exit/timeout map to `true`/`false`/`"unknown"`/`"unknown"`/`"unknown"`; the false case carries the N-6 line; the payload's other fields never reach a log (test greps the fake log).
- [ ] Ready line carries `login:`; `/__crt/health` matches the F-78 shape; existing health assertions still pass.
- [ ] Manual (Simon): in the trial app folder with nothing running, `crt` asks for the URL, waits while `npx next dev -p 3100` starts, opens the browser; the second `crt` asks nothing and is ready in under 3 s; with a stale CRT on 4400 from another session, `crt` says it reused it (same target) or took 4401 (different target).

## Notes
No unit test calls `serve()` directly and the e2e fixture drives `dist/cli.js` with argv, so `ServeOptions` only has to stay compatible with `cli.ts`; the reuse path needs a return shape that lets `cli.ts` exit 0 without a server handle. The existing `chat.spec.ts` assertion that `config.local.json` equals `{ provider: "claude" }` must keep passing — that server is started with the `--target` flag, which F-72 never remembers. The default when another CRT holds the port for a different target is "start on 4401", not "replace" — a parallel Claude session's server is often the occupant in this repo (PRD-setup A.2). Do not spawn `claude` in the start path (PRD-setup §13 decision 5). `--run` is out of scope (§3). Record the bundled binary version and the observed `auth status --json` shape in the `providers/claude.ts` header (§12 rule 1).

## Log
- 2026-09-16T14:50+08:00 — created from docs/PRD-setup.md milestone M12 by the planning session that wrote it.
- 2026-09-16T16:11+08:00 — claimed by /crt:next, session cc0e6376-b64f-423c-8926-f474af05ea03, branch crt/CRT-0016-m12-guided-start-crt-doctor-login-preflight
