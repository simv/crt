---
id: CRT-0003
title: M3 — In-page intake session on the Agent SDK and task writer
status: in_progress
priority: high
created: 2026-09-14T20:50:00+08:00
updated: 2026-09-15T08:15:00+08:00
url: null
route: null
session: null
tags: [m3, server, sdk, overlay, tasks]
files: [plugin/skills/intake/SKILL.md, packages/server/src/cli.ts]
---

## Summary
Turn a capture into a conversation and a task: the server starts a Claude Code session via `@anthropic-ai/claude-agent-sdk` with `cwd` = project root, streams it to a chat panel in the overlay, routes permissions to the panel, and the session writes a task file in the F-32 format. Add `crt tasks` / `crt task` and the generated index.

## Context
PRD §5.3, §6.4 (F-24…F-30), §6.5 (F-31…F-35), milestone M3. Depends on CRT-0002. Pin the SDK to an exact version (currently 0.3.270; bundles the Claude Code binary as optional deps so no separate install is needed). All SDK use goes in `packages/server/src/session.ts` behind an interface (`startSession`, `send`, `interrupt`, `onEvent`), per CLAUDE.md. The intake instructions are the single file `plugin/skills/intake/SKILL.md`; the server reads its body (below the frontmatter) and passes it as `systemPrompt.append`, so terminal and in-page intake behave identically.

## Evidence
None — greenfield task from the PRD.

## Ask
1. `session.ts` (F-24): `query()` with `cwd`, `sessionId` (new UUID), `settingSources: ['user','project','local']`, `systemPrompt: { type:'preset', preset:'claude_code', append }`, `includePartialMessages: true`, `permissionMode: 'default'`, streaming input via an async iterable fed by the panel. First message = capture summary + notes + capture path + screenshots as image content blocks.
2. Transport: `GET /__crt/sessions/<id>/events` (SSE) streaming assistant deltas, tool-use lines, permission requests, and result; `POST /__crt/sessions/<id>/messages`, `/interrupt`, `/permission` (F-25, F-29).
3. `canUseTool` (F-26, N-5): auto-allow Read/Glob/Grep/WebFetch(off)/Bash for read-only git; auto-allow Write/Edit when the path resolves under `<root>/.crt/`; everything else → panel prompt with Allow/Deny and a 5-minute timeout defaulting to Deny.
4. Chat panel in the overlay: markdown-ish rendering of streamed text, collapsed tool lines, permission cards, input box, session ID with `claude --resume <id>` hint (F-28), interrupt and new-session buttons.
5. Task store: `tasks.ts` with ID allocation by directory scan (F-31), frontmatter parse/serialise, F-32 template rendering, `README.md` index regeneration on every change (F-34), `crt tasks [--json]`, `crt task <ID>` (F-33). Assets move from `.crt/captures/<cid>/` to `.crt/tasks/assets/<ID>/` (F-23). Expose `POST /__crt/tasks` for the session to call via a tiny CRT MCP tool **or** let the session write the file itself with `Write` and have the server watch `.crt/tasks/` and regenerate the index — pick the simpler; record the choice in the Log.
6. Failure messages (N-6): not logged in to Claude Code, SDK binary missing.
7. Tests: unit tests for tasks.ts (ID allocation, round-trip parse/serialise, index), a session smoke test that runs only when `CLAUDE_CODE_OAUTH_TOKEN` or a logged-in CLI is present (skipped in CI otherwise), an e2e that stubs the session layer and verifies the panel renders streamed events and permission cards.

## Definition of Done
- [ ] Full loop on the trial Next.js app: annotate → Send → chat streams within 5 s (N-2) → Claude locates the component and source → proposes DoD → writes `.crt/tasks/CRT-NNNN-*.md` with assets → panel shows the ID.
- [ ] The written task validates against the F-32 format (add `crt task <ID> --validate`).
- [ ] A non-pre-allowed tool call (e.g. `Bash(npm test)`) prompts in the panel; Deny works; Allow works.
- [ ] `claude --resume <id>` in a terminal continues the same conversation.
- [ ] `crt tasks`, `crt tasks --json`, `crt task <ID>` work; `.crt/tasks/README.md` regenerates.
- [ ] `npm run check` and `npm run e2e` pass locally and in CI.

## Notes
Keep the SDK surface tiny; the API is pre-1.0 and tracks Claude Code releases (PRD §12).

## Log
- 2026-09-14T20:50+08:00 — created from PRD milestone M3 during project setup.
- 2026-09-15T08:15+08:00 — claimed by build session fe8bbb8a-cd99-405e-9e5d-1f501de4b34e on branch `crt/CRT-0003-m3-intake-session-and-task-writer`. SDK pinned to `@anthropic-ai/claude-agent-sdk@0.3.270` (bundles Claude Code 2.1.270).
