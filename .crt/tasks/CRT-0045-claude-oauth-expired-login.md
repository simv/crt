---
id: CRT-0045
title: A Claude session whose OAuth session expired fails with the N-6 login line instead of going idle
status: review
priority: normal
created: 2026-09-28T11:21:00+08:00
updated: 2026-09-28T11:23:00+08:00
url: null
route: null
session: null
tags: [bug, providers, claude, login, n-6, f-52, f-74]
files: [packages/server/src/providers/claude.ts, packages/server/test/session.test.ts]
---

## Summary
With Claude Code logged out, an intake session on the Claude provider tells the developer nothing useful. The agent's answer is "Failed to authenticate: OAuth session expired and could not be refreshed", the turn ends with a failed `result`, and the session goes to `idle` as if a reply could fix it. N-6 says a missing Claude login gets its one actionable line (`CLAUDE_NOT_LOGGED_IN`: run `claude` and complete /login). `loginProblem()` does not recognise this wording, so the line never appears. It should, without catching another tool's authentication failure.

## Context
- `loginProblem()` (`packages/server/src/providers/claude.ts:516`) matches `/not logged in|please run \/login|\/login\b|invalid api key|authentication[_ ]error|oauth token|401\b|unauthori[sz]ed/i`. "authenticate" is not "authentication", and "OAuth session" is not "oauth token", so nothing matches.
- It is applied to the `result` message's errors (`claude.ts:360`, a match fails the session with the line), to `auth_status` errors (`:366`), and to `describeSessionError`'s text: the SDK error plus the stderr tail of the `claude` process (`:530`).
- That stderr tail also carries the output of the MCP servers the session loads from the user's settings (`settingSources: user, project, local`). A pattern that matches "failed to authenticate" anywhere in a line would turn, say, a GitHub MCP server's auth failure into "not logged in to Claude Code". Claude Code's own message starts with the phrase.
- The existing unit test is "maps login problems and a missing binary to one actionable line" in `packages/server/test/session.test.ts` (N-6).

## Evidence
No page capture. Observed in session 4c449e4b while verifying CRT-0041, 2026-09-28. `claude auth status --json` answered `loggedIn: false`. A real Agent SDK intake session (quick note, scratch project) produced these events: `user → init → state:running → assistant_start → text "Failed to authenticate: OAuth session expired and could not be refreshed" → assistant_end → result { ok: false, errors: ["Failed to authenticate: OAuth session expired and could not be refreshed"] } → state:idle`. There was no `error` event and no `state: error`.

## Ask
1. Widen `loginProblem()` so that text starting a line with "Failed to authenticate", and "OAuth session expired" anywhere, map to `CLAUDE_NOT_LOGGED_IN`. The phrase in the middle of another line (another tool's stderr) stays unmatched.
2. Add the cases to the existing N-6 test: the observed message on its own, the same message as a stderr line through `describeSessionError`, and a negative case where a third party's line contains "failed to authenticate" mid-line.

## Definition of Done
- [x] `loginProblem("Failed to authenticate: OAuth session expired and could not be refreshed")` returns `CLAUDE_NOT_LOGGED_IN`, and so does `describeSessionError` with that line in the stderr tail (unit test, N-6).
- [x] A line such as `MCP server "github": failed to authenticate` is not taken for a Claude login problem (unit test).
- [x] Every existing `loginProblem` / `describeSessionError` expectation still holds.
- [x] `npm run check` green.

## Notes
- Filed and fixed directly (Simon's request, 2026-09-28): the suggestion chip from the CRT-0041 session.
- A live check of the failing session needs a logged-out Claude Code. This machine is logged out right now, so a real session can show the line after the fix.

## Log
- 2026-09-28T11:21+08:00 — filed by hand from session 4c449e4b (CRT-0041 verification) at Simon's request; claimed by the same session, branch crt/CRT-0045-claude-oauth-expired-login (worktree .claude/worktrees/CRT-0045, from origin/main 2d21af7).
- 2026-09-28T11:23+08:00 — verified: the new test "maps an expired OAuth session to the login line, but not another tool's authentication failure (N-6, CRT-0045)" in test/session.test.ts failed first (`loginProblem` returned null) and passes after the fix; it covers the observed message, `OAuth session expired` alone, and the message as a stderr line through `describeSessionError`.
- 2026-09-28T11:23+08:00 — verified: the same test's negative cases — `MCP server "github": failed to authenticate (check its token)` → null, and through `describeSessionError` the generic "Claude Code session failed: …" line, not the login line. "Failed to authenticate" counts only at the start of a line (regex `m` flag); "OAuth session expired" anywhere.
- 2026-09-28T11:23+08:00 — verified: the existing N-6 test ("maps login problems and a missing binary to one actionable line") passes unchanged; test/session.test.ts 6 passed, 1 skipped (the SDK smoke test, opt-in).
- 2026-09-28T11:23+08:00 — verified: `npm run check` green — 57 files, 752 passed, 2 skipped. Live, with Claude Code logged out (`CRT_SESSION_SMOKE=1` smoke run against the real SDK): the session now ends `result(ok: false) → error "not logged in to Claude Code — run \`claude\` …" → state: error` with that line as detail, where before the fix it went to `idle`.
- 2026-09-28T11:23+08:00 — ready for review: changed packages/server/src/providers/claude.ts (`loginProblem` pattern and its doc comment), packages/server/test/session.test.ts (one new N-6 test).
