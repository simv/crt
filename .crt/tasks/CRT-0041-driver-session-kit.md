---
id: CRT-0041
title: A driver kit for sessions — one emitter, turn queue, permission broker and init event; task_written recorded by the registry
status: backlog
priority: normal
created: 2026-09-24T12:15:00+08:00
updated: 2026-09-24T12:15:00+08:00
url: null
route: null
session: null
tags: [review-2026-09, refactor, providers, sessions, prd-providers-5, f-59]
files: [packages/server/src/providers/driver-core.ts, packages/server/src/providers/claude.ts, packages/server/src/providers/codex.ts, packages/server/src/providers/antigravity.ts, packages/server/src/providers/acp.ts, packages/server/src/providers/stub.ts, packages/server/src/providers/gemini.ts, packages/server/src/sessions.ts, packages/server/src/session.ts, packages/server/test/providers/conformance.ts]
---

## Summary
Every `SessionDriver` implementation re-implements the same session core:
- the listener set, `emit`, `setState` and `onEvent` (5 copies);
- the message queue (3 copies, plus the stub's close variant);
- the permission card (3 copies);
- the `init` event built by hand from the profile (5 copies).

The copies have drifted:
- Codex and the stub don't catch listener exceptions. In Codex a throwing listener inside the stdout handler becomes an uncaught exception.
- The stub hard-codes the 5-minute permission timeout.
- Claude's text says "within 5 minutes" whatever timeout is configured.
- `task_written` has three owners.

This task extracts one kit and gives each event one owner. Behaviour stays the same, except the listener fix and the timeout text.

## Context
- **Emitter:** `claude.ts:218-241`, `codex.ts:315-333`, `antigravity.ts:526-555`, `acp.ts:448-478`, `stub.ts:95-111`. Claude guards on `state`, the others on `closed`. `codex.ts:326` and `stub.ts:104` don't try/catch listeners.
- **Turn queue** (`queue` + `busy` + `pump` + `enqueue` with the `user` echo): `codex.ts:434-453`, `antigravity.ts:701-720`, `acp.ts:659-679`, and close to it `stub.ts:292-300`.
- **Permission broker** (pending map, timer, settle, `permission` / `permission_resolved`, waiting→running): `claude.ts:253-283`, `acp.ts:517-539`, `stub.ts:142-157`. `stub.ts:145` hard-codes `5 * 60 * 1000`; `claude.ts:268` hard-codes "within 5 minutes".
- **`init` event** re-derived from the profile: `codex.ts:517-527`, `antigravity.ts:425-435`, `claude.ts:338-348`, `acp.ts:603-614`, `stub.ts:160-171`. `experimental` is passed only by ACP. The stub repeats `claude --resume` inline instead of calling `resumeCommand` (`stub.ts:169`). `AcpAgentSpec` (`acp.ts:400-420`) duplicates profile fields, which `gemini.ts:136-145` and `acp.ts:796-806` re-list.
- **`task_written`:**
  - The Claude driver emits and logs it (`claude.ts:289-290`), and the stub emits it (`stub.ts:262`).
  - For stdio providers, the registry records it (`sessions.ts:303-305`, logging the same line again).
  - `Entry.writeTask` (`sessions.ts:124-134`), the one write path for every provider, records nothing. `taskId` is set twice (`sessions.ts:132` and `:212`).
  - The result text `Task X written to Y` appears at `claude.ts:291` and `mcp-stdio.ts:186`, and the `write_task failed: ` prefix at `claude.ts:293` and `mcp-stdio.ts:178,185`.
  - `write-task.ts:5-6` says both routes validate with `parseWriteTaskRequest`; the in-process route doesn't.
- **Registry duplicates:** the stub filter and `detectProvider` call are repeated (`session.ts:150-155`, `:166`), and the "failed preflight" constant exists twice (`session.ts:96`, `detect.ts:59`).
- **Safety net:** the F-59 conformance suite (`test/providers/conformance.ts`) runs for Codex, ACP, Antigravity and the stub. The Claude driver does not run it; it is covered by e2e and `session.test.ts` only.

## Evidence
No page capture: from the code review in session e145e7ac, 2026-09-24. The Codex listener gap was confirmed by reading `codex.ts:326-328`.

## Ask
1. `providers/driver-core.ts`:
   - `createEmitter()`: a safe emit that catches and logs listener errors, plus `onEvent` and `setState` guarded by `closed`;
   - `createTurnQueue(runTurn, emit)`: the echo, pump and clear;
   - `createPermissionBroker({ emit, setState, getState, timeoutMs })` → `ask(card)`, `respond(id, behavior)`, `denyAll(by)`, with the timeout text derived from `timeoutMs`;
   - `initEvent(profile, opts, { nativeSessionId, model, agentVersion, capabilities? })`.
2. Move all five drivers onto the kit. Pass the `ProviderProfile` into `startAcpSession` so `AcpAgentSpec` keeps only ACP-specific fields.
3. Give `task_written` one owner: `Entry.writeTask` records the event, sets `taskId` and logs it once. The drivers and `writeTaskFor` stop doing so. Add `writeTaskResultText` / `writeTaskErrorText` to `write-task.ts` for both routes, and correct its header comment.
4. Collapse the duplicated stub filter / `detectProvider` call and the two "failed preflight" constants in `session.ts` / `detect.ts`.

## Definition of Done
- [ ] New test (first, seen failing): a listener that throws during a Codex turn doesn't end the turn or the process. The same case is added to `conformance.ts` for every CLI driver.
- [ ] New unit tests for `createTurnQueue` and `createPermissionBroker` (timeout, respond, denyAll), written before the move.
- [ ] Each of `claude.ts`, `codex.ts`, `antigravity.ts`, `acp.ts` and `stub.ts` uses the kit's emitter, and the permission broker where it asks. None defines its own listener set or pending-permission map.
- [ ] `task_written` is emitted exactly once per task for every provider: add an assertion to `conformance.ts` and to the stub e2e chat spec. The event order on the SSE stream is recorded before and after in the Log; any change is named and justified.
- [ ] Conformance, `sessions.test.ts`, `permissions.test.ts`, `mcp-stdio.test.ts`, `provider-routes.test.ts` and all provider tests pass. Any test whose expected event order changed is named in the Log with the reason.
- [ ] `npm run check` green; `npm run e2e` green (`--workers=2` on Windows); a manual Claude intake in the trial app writes a task, and the panel shows it (the Claude driver has no conformance run).

## Notes
- Depends on CRT-0040 (process helpers) and CRT-0035 (typechecked tests).
- The Claude driver guards on `state`, not `closed`. Choose one semantic in the kit and justify it in the Log.

## Log
- 2026-09-24T12:15+08:00 — filed by hand from the code review in session e145e7ac (Simon's request).
