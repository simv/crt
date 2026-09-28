---
id: CRT-0041
title: A driver kit for sessions — one emitter, turn queue, permission broker and init event; task_written recorded by the registry
status: blocked
priority: normal
created: 2026-09-24T12:15:00+08:00
updated: 2026-09-28T17:18:00+08:00
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
- [x] New test (first, seen failing): a listener that throws during a Codex turn doesn't end the turn or the process. The same case is added to `conformance.ts` for every CLI driver.
- [x] New unit tests for `createTurnQueue` and `createPermissionBroker` (timeout, respond, denyAll), written before the move.
- [x] Each of `claude.ts`, `codex.ts`, `antigravity.ts`, `acp.ts` and `stub.ts` uses the kit's emitter, and the permission broker where it asks. None defines its own listener set or pending-permission map.
- [x] `task_written` is emitted exactly once per task for every provider: add an assertion to `conformance.ts` and to the stub e2e chat spec. The event order on the SSE stream is recorded before and after in the Log; any change is named and justified.
- [x] Conformance, `sessions.test.ts`, `permissions.test.ts`, `mcp-stdio.test.ts`, `provider-routes.test.ts` and all provider tests pass. Any test whose expected event order changed is named in the Log with the reason.
- [ ] `npm run check` green; `npm run e2e` green (`--workers=2` on Windows); a manual Claude intake in the trial app writes a task, and the panel shows it (the Claude driver has no conformance run).

## Notes
- Depends on CRT-0040 (process helpers) and CRT-0035 (typechecked tests).
- The Claude driver guards on `state`, not `closed`. Choose one semantic in the kit and justify it in the Log.

## Log
- 2026-09-24T12:15+08:00 — filed by hand from the code review in session e145e7ac (Simon's request).
- 2026-09-28T10:54+08:00 — claimed by /crt:next, session 4c449e4b-1c6a-4bae-b93a-0f8702a05461, branch crt/CRT-0041-driver-session-kit (worked in the worktree .claude/worktrees/CRT-0041, branched from origin/main 2d21af7; the main checkout stays on main).
- 2026-09-28T11:25+08:00 — verified (DoD 1): test/providers/codex.test.ts "a listener that throws during a turn neither ends the turn nor the process; the failure is logged (F-53, F-59, CRT-0041)" was written first and failed on the old driver: the listener's exception escaped from the `user` echo inside `enqueue` as an uncaught exception, the turn never started (`timed out; events: []`). It passes on the kit, with one log line per event. conformance.ts now attaches a listener that throws on every event before the one that records: on the old drivers Codex and all three stub variants died of it, ACP and Antigravity survived but logged nothing (0 of 91 and 0 of 36 failures); now all six conformance runs pass and every failure is logged (`crt: a session listener failed on <type>: …`).
- 2026-09-28T11:25+08:00 — verified (DoD 2): test/providers/driver-core.test.ts (14 tests: emitter, turn queue, permission broker with respond, timeout, denyAll, abort and the timeout text, `initEvent`) was written before driver-core.ts itself and ran 14/14 against it before any driver moved (Codex moved first, after that run).
- 2026-09-28T11:25+08:00 — verified (DoD 3): grep over the five drivers finds no listener `Set`, no pending-permission `Map` and no hand-built `init` event (the only `Map` left is `JsonRpcStdio`'s request table). `claude.ts`, `acp.ts` and `stub.ts` ask through `createPermissionBroker`; `codex.ts` and `antigravity.ts` are sandboxed and ask nothing. `startAcpSession(opts, profile, spec)`: `AcpAgentSpec` keeps `resolve`, `acpArgs`, `modelArgs`, `notFound`, `loginProblem`.
- 2026-09-28T11:25+08:00 — kit semantic (Notes): the session is over when its state is `ended` or `error`, and `isClosed()` is derived from that — Claude's guard. In Codex, Antigravity, ACP and the stub, `closed` was always set in the same synchronous step as the final state (fail: `error` then `closed = true`; close: `closed = true` then `ended`), so one fact derived from the state replaces a second flag that could only agree with it. Claude's own `closed` meant something else, "close() released the input and the query", which must still happen after a failure; it stays in claude.ts as `released`.
- 2026-09-28T11:25+08:00 — verified (DoD 4): exactly-once assertions in conformance.ts (Codex, Gemini over ACP, Antigravity, stub ×3), in e2e/chat.spec.ts (the stub Allow → write spec and the quick-note spec; the Codex, ACP and Antigravity specs already had one) and in sessions.test.ts (one event, one log line, before the tool's answer). SSE order recorded before and after through the real SessionRegistry (a scratch test, not committed). Stub write turn — before: `user → state:running → tool_use(mcp__crt__write_task) → tool_result → task_written → assistant_start → text×4 → assistant_end → result → state:idle`; after: `… tool_use(mcp__crt__write_task) → task_written → tool_result → assistant_start …` (the same move in the quick-note run). Codex (fake CLI, crt mcp + internal route) before = after: `user → state:running → tool_use(mcp__crt__write_task) → task_written → tool_result → assistant_start → text → assistant_end → result → state:idle`. `crt: task … written to …` log lines per task: stub 0 → 1, Codex 1 → 1. Claude could not be recorded live (Claude Code is logged out here, see below); by construction it is unchanged: the driver emitted `task_written` right after `await opts.writeTask`, the registry now records it inside that call, and the SDK sends nothing in between (it is waiting for the tool's answer).
- 2026-09-28T11:25+08:00 — changes named and justified: (a) the stub's `task_written` now precedes its write_task `tool_result` — the registry records it when the file is written, which is before the tool answers; that is the order Codex, ACP and Antigravity already had and Claude's too, so every provider now shows one order. (b) The stub logs the task once, like every other provider. (c) A card settled by teardown (`denyAll`: Claude close with an open card, ACP interrupt with an open card) no longer emits a passing `state: running` before `ended` / the interrupted result and `idle`; the driver sets the next state itself. A card settled on its own (the developer, the timeout, the SDK's abort signal) still returns to `running`. (d) The stub's variant-mismatch `error` events now follow the first `user` echo, because the turn queue echoes before the turn runs; they appear only when the registry sent the wrong channel. (e) Claude's denial text for a timeout names the configured timeout (`describeTimeout`); the stub no longer hard-codes 5 minutes.
- 2026-09-28T11:25+08:00 — verified (DoD 5): conformance (via codex, acp, antigravity and stub tests), sessions.test.ts, permissions.test.ts, mcp-stdio.test.ts, provider-routes.test.ts, session.test.ts and every test/providers suite pass (17 files, 208 tests). No existing test's expected event order changed. Tests whose expectations changed: test/session.test.ts SDK smoke (opt-in, `CRT_SESSION_SMOKE=1`) no longer expects `task_written` from the driver but the tool's `Task CRT-9999 written to …` answer — the event moved to the registry; e2e/chat.spec.ts "the internal write_task route refuses browsers and stale tokens…" now uses the bounded 43-character token pattern the Codex/ACP/Antigravity specs already use — the stub's new `task … written to .crt/tasks/CRT-0001-cart-total-excludes-applied-discount.md` log line has a 45-character slug that the unbounded pattern took for a token (log content, not order).
- 2026-09-28T11:25+08:00 — verified (DoD 6, partly): `npm run check` green (58 files, 766 passed, 2 skipped); `npx playwright test --workers=2` 74/74 (the first run was 73/74, the token-pattern false positive above). The prd-reviewer agent found no invariant breach, no untraceable hunk and no unintended behaviour change; its one note (requirement ids in the new test titles) is fixed.
- 2026-09-28T11:25+08:00 — not verified: the manual Claude intake in the trial app. Claude Code is logged out on this machine: `claude auth status --json` → `loggedIn: false`, no `CLAUDE_CODE_OAUTH_TOKEN`, and a real Agent SDK session (and the opt-in SDK smoke test) answers "Failed to authenticate: OAuth session expired and could not be refreshed". That wording was not recognised as the N-6 login problem; filed and fixed as CRT-0045 (https://github.com/simv/crt/pull/97).
- 2026-09-28T11:25+08:00 — changed so far: packages/server/src/providers/driver-core.ts (new), claude.ts, codex.ts, antigravity.ts, acp.ts, gemini.ts, stub.ts, detect.ts, types.ts, packages/server/src/session.ts, sessions.ts, session-events.ts, write-task.ts, mcp-stdio.ts; tests driver-core.test.ts (new), conformance.ts, codex.test.ts, session.test.ts, sessions.test.ts, e2e/chat.spec.ts; CLAUDE.md (driver-core.ts in the entry points).
- 2026-09-28T11:25+08:00 — blocked: Claude Code is logged out on this machine, so the last DoD row's manual Claude intake cannot run. Please run `claude` in a terminal and complete /login (check with `claude auth status`), then say so in ## Notes. Answer in ## Notes and re-run /crt:next CRT-0041.
- 2026-09-28T17:14+08:00 — claimed by /crt:next, session 7f3d86f7-7da2-449b-bcf3-1cd4cabe70ca, branch crt/CRT-0041-driver-session-kit (a retry: `main` still lists the task as backlog because the blocked commit lives only on this branch; worked in the worktree .claude/worktrees/CRT-0041-retry, the main checkout stays on main). `claude auth status --json` → `loggedIn: false` again, so this run brings the branch up to date with `main` (#98, #99) and re-verifies it; the manual Claude intake still waits for a login.
- 2026-09-28T17:18+08:00 — merged origin/main (23e6dc8: #98 server module boundaries, #99 overlay structure) into the branch. Two conflicts, the same one twice: `SessionRegistry.writeTaskFor` in sessions.ts and the registry duck in test/providers/conformance.ts. Kept #98's `StaleSessionError` and this task's delegation to `Entry.writeTask`, which records and logs `task_written`; #98's `writeTaskFor` had kept the old record and log lines, which would have made two owners again. After the merge, grep over packages/server/src finds `task_written` recorded only in `Entry.writeTask` (sessions.ts).
- 2026-09-28T17:18+08:00 — re-verified after the merge (DoD 1–5 stay ticked): `npm run check` green (64 files, 817 passed, 2 skipped), including conformance for Codex, ACP, Antigravity and the stub, sessions.test.ts, permissions.test.ts, mcp-stdio.test.ts, provider-routes.test.ts and driver-core.test.ts; `npm run e2e -- --workers=2` 74/74. DoD 6 stays unticked: the manual Claude intake still cannot run.
- 2026-09-28T17:18+08:00 — blocked: Claude Code is still logged out on this machine (`claude auth status --json` → `loggedIn: false` at 17:14 and 17:18), so the manual Claude intake in the trial app, the only unverified item, cannot run. Please run `claude` in a terminal and complete /login (check with `claude auth status`), then say so in ## Notes. Answer in ## Notes and re-run /crt:next CRT-0041.
