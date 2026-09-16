---
id: CRT-0011
title: M8 — Neutral tool surface (crt mcp, capability matrix) and overlay provider UX
status: in_progress
priority: normal
created: 2026-09-15T17:30:00+08:00
updated: 2026-09-16T08:11:52+08:00
url: null
route: null
session: null
tags: [m8, f-46, f-47, f-49, f-50, f-51, f-55, f-56, f-57, f-61, n-8, prd-providers]
files: [packages/server/src/mcp-stdio.ts, packages/server/src/sessions.ts, packages/server/src/intake-message.ts, packages/server/src/session-events.ts, packages/overlay/src/ui.ts, packages/overlay/src/chat.ts, plugin/skills/intake/SKILL.md, packages/server/e2e/chat.spec.ts]
---

## Summary
Give every non-Claude agent a way to call `write_task` (the `crt mcp` stdio server with a per-session bearer token), make the first message and images provider-neutral, and teach the overlay to show the provider: split Send button, provider list, capability-driven footer and cards, all read from each session's own `init` event.

## Context
`docs/PRD-providers.md` §5.3, §8 (M8), F-46, F-47 (overlay half), F-49, F-50, F-51, F-55, F-56, F-57, F-61 (stub axis), N-8. Depends on CRT-0010 (profiles, `init` shape, config layers). Today the overlay hard-codes "Claude" in `ui.ts`/`chat.ts` and the footer prints `claude --resume`; `write_task` exists only in-process in the Claude driver; `intake-message.ts` always base64-encodes images.

## Evidence
No page capture: created from PRD-providers milestone M8.

## Ask
1. `crt mcp` (`packages/server/src/mcp-stdio.ts`): hand-rolled newline-delimited JSON-RPC 2.0 stdio MCP server per F-49 (initialize, notifications/initialized, ping, tools/list, tools/call, -32601 otherwise); reads `CRT_MCP_TOKEN`/`CRT_MCP_PORT` from env; forwards `write_task` to `POST /__crt/internal/write-task`. Server side: mint the token per session, the internal route with bearer check, 404 empty body + one local log line on a bad token, 403 on any `Origin` header. Contract test with the official MCP TypeScript client as a devDependency, on both runners.
2. F-50 `UserImage.path`; `data` only for `images: inline`. F-51 `first-message` channel with the fixed heading; unit test that the quick-note sentinel stays last in both channels.
3. F-55 rewrite of `plugin/skills/intake/SKILL.md` (neutral tool wording, `session: null`, sandbox sentence), keeping the sentinel sentence verbatim; test greps `dist/intake.md` for it. Make the stub run the conformance scenario with `first-message` and `sandboxed` as well as its default.
4. F-57 routes: `GET /__crt/providers[?refresh=1]`, `PUT /__crt/config` (two allowlisted keys, validated, writes `.crt/config.local.json`, replaces the active provider), `GET /__crt/health` adds `provider`, `POST /__crt/sessions` accepts `provider`. Negative tests: object `provider`, non-built-in id, model with a space, `stub` without `CRT_SESSION_STUB`.
5. F-56 overlay: display name from the session's replayed `init` everywhere the agent is named; footer `provider · model · agent version · resume command` or the read-only badge; hide Allow/Deny, Stop and the resume hint per capabilities; split Send button with a per-send provider list (sessionStorage per tab), the same list from the toolbar, "Remember for this project on this machine" checkbox, refresh-on-open with per-row spinner, disabled rows with the problem as tooltip. Quick note uses the active provider. Session list rows show the provider; "New session" uses the active provider.
6. F-61 stub axis in `e2e/chat.spec.ts`: reload reattaches with the same footer; split button changes the provider for one send.

## Definition of Done
- [ ] F-49 contract test passes on `ubuntu-latest` and `windows-latest`; the token never appears in any URL, argv, page response or log line (e2e greps the server log).
- [ ] The quick-note sentinel test passes for both instruction channels; `dist/intake.md` contains the sentinel sentence verbatim.
- [ ] `PUT /__crt/config` rejects an object `provider`, a non-built-in id, and a model with a space, and a successful PUT changes `GET /__crt/health`'s `provider` without a restart.
- [ ] e2e `stub` axis: footer text comes from the replayed `init` after a page reload; the split button's per-send choice is honoured for that send only; Allow/Deny cards are absent when the stub runs `sandboxed`.
- [ ] Every "Claude" string in `packages/overlay/src` that names the agent is gone (grep), chrome still says "CRT" (F-64).
- [ ] `npm run check` and `npm run e2e` pass.
- [ ] Manual (Simon): the CRT-0003 trial-app intake check repeated on Claude with the rewritten SKILL.md — reads the source, ≤ 3 questions, DoD proposed, valid task written.

## Notes
The Claude driver keeps its in-process `write_task`; the stdio path is for every other provider. Both call the same `writeTask`; add a unit test that the same request yields the same file through either.

## Log
- 2026-09-15T17:30+08:00 — created from PRD-providers milestone M8 by the planning session that wrote docs/PRD-providers.md.
- 2026-09-16T08:11:52+08:00 — claimed by worker session 8de516ee-6ff7-4597-bd71-f7efacb5e4b6
