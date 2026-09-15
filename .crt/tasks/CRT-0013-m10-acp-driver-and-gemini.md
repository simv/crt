---
id: CRT-0013
title: M10 — Generic Agent Client Protocol driver and Gemini profile (Should)
status: backlog
priority: low
created: 2026-09-15T17:30:00+08:00
updated: 2026-09-15T17:30:00+08:00
url: null
route: null
session: null
tags: [m10, f-54, f-59, f-61, n-11, prd-providers]
files: [packages/server/src/providers/acp.ts, packages/server/src/providers/gemini.ts, packages/server/test/providers/acp.test.ts, packages/server/e2e/chat.spec.ts, README.md]
---

## Summary
Add one generic driver that speaks the Agent Client Protocol (ACP) over stdio, ship Gemini CLI as its first profile (`gemini --experimental-acp`), and let any other ACP agent be configured by command in `.crt/config.json`.

## Context
`docs/PRD-providers.md` §5.2, §8 (M10), F-54, F-59/F-61 `acp` axis, N-11 (hand-rolled JSON-RPC unless it exceeds 400 lines), the F-26 amendment (policy over ACP tool kinds), §12. Depends on CRT-0011 (stdio `write_task`, capability-driven UI) and CRT-0010 (profiles). This is a Should milestone: v0.2 may ship without it (PRD-providers §6 preamble); if it does, `gemini`/`acp` stay out of the id enum, the menu and the README.

## Evidence
No page capture: created from PRD-providers milestone M10.

## Ask
1. `providers/acp.ts`: JSON-RPC 2.0 client over stdio; `initialize` with the F-54 client capabilities; `session/new` with cwd and the stdio `crt mcp` server (token in `env`); `session/prompt` with text and, when advertised, image blocks; `session/update` mapping per F-54; `session/request_permission` → permission card with the tool-kind policy and the `optionId` mapping (never `allow_always`); `session/cancel` on interrupt; close = end stdin, 2 s, kill; protocol-version mismatch → N-7 line.
2. `providers/gemini.ts`: ACP profile with command `gemini --experimental-acp`, markers `.gemini/`, `GEMINI.md`, `AGENTS.md`, preflight `gemini --version`, `resumeCommand` per the tested version or `resume: false`, `launchEnv` per the tested version or empty, skills directory for F-58 if one exists.
3. Ad-hoc profile from `.crt/config.json` `provider: { kind: "acp", command, args, name }` (file-only, id `acp`, no markers, no resume).
4. Add `gemini` and `acp` to the id enum, F-46 matrix (negotiated), F-56 menu, README Providers section.
5. Fake ACP agent script for the conformance test and the e2e `acp` axis, including a `session/request_permission` round-trip answered Allow then Deny.

## Definition of Done
- [ ] Conformance test against the fake ACP agent passes, including the permission round-trip and `write_task` through `crt mcp`.
- [ ] e2e `acp` axis green on both runners; footer shows the negotiated capabilities correctly (no resume hint when `resume: false`).
- [ ] An ad-hoc `{ kind: "acp" }` config runs the conformance scenario; `PUT /__crt/config` still rejects the object form.
- [ ] `npm run check` passes; `acp.ts` line count noted in the PR description against the N-11 budget.
- [ ] Manual (Simon): Gemini intake on the trial app writes a valid task; `crt providers` shows Gemini's state correctly when logged out and logged in.

## Notes
Do not use `session/load`. If Gemini's tested version does not advertise image support in `promptCapabilities`, ship `images: none` and let the first message say so (F-50).

## Log
- 2026-09-15T17:30+08:00 — created from PRD-providers milestone M10 by the planning session that wrote docs/PRD-providers.md.
