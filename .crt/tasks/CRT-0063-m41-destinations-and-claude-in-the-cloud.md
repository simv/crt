---
id: CRT-0063
title: M41 — Destinations per site, and a review sent to Claude Code in the cloud
status: review
priority: normal
created: 2026-11-18T08:28:00+08:00
updated: 2026-11-18T08:50:00+08:00
url: null
route: null
session: null
tags: [extension, destinations, claude, m41, f-168, f-169, f-170, f-171, n-46, n-47, n-49, prd-connect]
files: [docs/PRD-connect.md, docs/extension.md, packages/overlay/src/extension/destinations.ts, packages/overlay/src/extension/options.ts, packages/overlay/src/extension/options.html, packages/overlay/src/extension/review.ts, packages/server/test/extension-standalone.test.ts, packages/server/e2e/extension.spec.ts]
---

## Summary
A review kept in the browser needs somewhere to go. Let the developer connect a repository to Claude once — a scheduled task's address and token, pasted on the Options page — choose it for a site, and send that site's kept items with one click that ends in a link to the Claude Code session it started.

## Context
- PRD-connect §5.3, §5.4, F-168…F-171, N-46, N-47, N-49. Needs M40 (CRT-0062).
- Claude offers no sign-in for other products and no list of projects or tasks; the pasted address and token are the floor (the spike, rows 1 and 4).
- The trigger takes text only: screenshots stay in the browser until M42.

## Evidence
No page capture. Simon, 2026-11-18: "what i actually want is the user to just install the extension, connect the extension to claude and then choose where to send feedback to … the user shouldn't have to run commands to edit the folder of the project they are reviewing." He chose "Claude in the cloud first" from the proposal (https://claude.ai/artifact/JiA81f15bwmChPF9CzyTW2) and said "build on the branch".

## Ask
1. **The destination** — name, fire address, token; only `api.anthropic.com` fire addresses and task tokens are accepted, from separate fields or the whole example command.
2. **Options** — the steps, the link to Claude's page, two prompts to copy, the list with Remove, the per-site and default choices.
3. **The send** — one request with the kept, unsent items of the site as text; compact past the limit; marked sent with the session link on a 2xx; one line for every other answer.

## Definition of Done
- [x] `fireUrl`, `fireToken`, `newDestination`, `readDestinations` accept and refuse as F-169 says (unit rows).
- [x] `fireRequest` is the whole request and the token is in the `Authorization` header only; the compact form and the refusal past the limit (F-170, N-46, N-47; unit rows).
- [x] `fireAnswer` for 2xx with and without a claude.ai link, 401, 403, 404, 429, 5xx (F-171; unit rows).
- [x] A destination saved from the pasted command shows without its token, is chosen for a site, and the review page offers "Send 1 to Claude · shop" (F-168, F-169; e2e).
- [x] Addresses off the machine are in `destinations.ts` only, and the review page's one `fetch` takes `fireRequest`'s output (N-46; grep rows).
- [x] `docs/extension.md` has "With no CRT server" and "Sending a review to Claude".
- [ ] `npm run check` green; `npm run e2e` green in CI.
- [ ] **Manual (Simon)**: a real scheduled task on a test repository — the four steps, a send from his own Chrome, the session link opens, Claude opens its pull request; after regenerating the token the send says so (401).

## Notes
- No test presses Send: it would leave the machine. The request is asserted byte for byte in the unit rows instead.
- The headers sent are the pair the address answered a bad token with (spike row 3); the two docs pages disagree.

## Log
- 2026-11-18T08:28+08:00 — created and claimed (in_progress).
- 2026-11-18T08:50+08:00 — built as described; unit and e2e rows green locally. The Manual row waits for a token only Simon can generate. Status → review.
