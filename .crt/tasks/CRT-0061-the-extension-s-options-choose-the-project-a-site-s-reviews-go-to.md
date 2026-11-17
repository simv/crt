---
id: CRT-0061
title: The extension's Options choose the project a site's reviews go to
status: review
priority: normal
created: 2026-11-18T07:52:00+08:00
updated: 2026-11-18T08:05:00+08:00
url: null
route: null
session: null
tags: [extension, options, f-164, n-43, prd-extension]
files: [docs/PRD-extension.md, docs/extension.md, packages/overlay/src/extension/wire.ts, packages/overlay/src/extension/worker.ts, packages/overlay/src/extension/options.ts, packages/overlay/src/extension/options.html, packages/server/test/extension.test.ts, packages/server/e2e/extension.spec.ts]
---

## Summary
With the extension, one browser can review sites of several projects, but the extension knew one CRT server: a single port on its Options page. Let the Options page show the CRT servers that are running, by project, and choose for each site which one its reviews go to.

## Context
- One CRT server is one project: the folder `crt` was run in. A project that is not set up is reviewed as a guest and nothing is written into it (PRD-zero F-129), so routing reviews to a project needs no change in that project.
- A second `crt` takes the next free port, 4401…4409 (`start.ts` `PORT_STEPS`).
- The worker is the only client of the CRT server and must stay loopback-only (PRD-extension N-43).
- PRD-extension §13 Open question 2 asked exactly this.

## Evidence
No page capture. Simon, 2026-11-18, after loading the extension on his local I Saw A Sign: "how do i setup the tool to route reviews to my i saw a sign project … allow the route for reviews to be selected in the options for the extension".

## Ask
1. **The rule (F-164)** — `wire.ts`: `routeFor(origin, routes, default)`, the scan list, a health answer as a list entry; `worker.ts` asks for the server per site and forgets a site's route when it is turned off.
2. **The Options page** — the running servers by project folder and port, a choice per site that is on, the default port as before.
3. **Docs** — `docs/extension.md` says how to send a site's reviews to a project; the PRD gains F-164.

## Definition of Done
- [x] A site with a choice talks to the chosen server; one without talks to the default; a choice that is not a loopback origin is ignored (F-164, N-43; unit rows).
- [x] The Options page lists two running servers by their project's folder, moves a site from one to the other, and a capture then goes through the second (F-164; e2e).
- [x] Turning a site off removes its route (e2e).
- [x] `docs/extension.md` has the section; PRD-extension has F-164 and the answered open question.
- [ ] `npm run check` green; `npm run e2e` green.

## Notes
- The Options page makes requests of its own: health reads of loopback ports. The N-43 grep row in `test/extension.test.ts` now names both files and pins what each may fetch.

## Log
- 2026-11-18T07:52+08:00 — created and claimed (in_progress) on Simon's request of 2026-11-18, in the pull request that carries the extension (https://github.com/simv/crt/pull/134).
- 2026-11-18T08:05+08:00 — built: `routeFor`, `scanTargets`, `foundServer`, `projectName`, `serverLabel` in `wire.ts`; `server(origin)` and `forgetRoute` in `worker.ts`; the Options page rewritten (`options.ts`, `options.html`). Verified: `test/extension.test.ts` (13 rows, three new) and `e2e/extension.spec.ts` "the options page lists the running servers by project and sends a site's reviews to the one chosen for it" (nine tests green locally; the spec's port range widened to 4420–4439). Status review; the check row waits for CI.
