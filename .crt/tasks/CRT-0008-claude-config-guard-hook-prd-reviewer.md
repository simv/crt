---
id: CRT-0008
title: Claude Code config — convention guard hook and prd-reviewer subagent
status: review
priority: normal
created: 2026-09-15T14:45:00+08:00
updated: 2026-09-15T15:05:00+08:00
url: null
route: null
session: null
tags: [tooling, f-34, n-1, prd-12]
files: [.claude/settings.json, .claude/hooks/guard.mjs, .claude/agents/prd-reviewer.md, packages/server/test/guard-hook.test.ts]
---

## Summary
Add project-level Claude Code configuration that enforces the CLAUDE.md invariants mechanically: a PreToolUse hook that refuses edits which would break a repo rule, and a `prd-reviewer` subagent that checks a branch against PRD requirement IDs and the CLAUDE.md invariants before a PR is opened.

## Context
Requested by Simon after running `/claude-code-setup:claude-automation-recommender` on the repo. Three rules in CLAUDE.md are checkable at edit time and had each been broken or nearly broken in earlier sessions: the generated task index (F-34, "never hand-edited"), the Agent-SDK-only-in-`session.ts` boundary (PRD §12), and LF-only files (N-1; a Bash-tool CRLF incident is recorded in session memory). The PR gate for this repo is traceability to a requirement ID plus the invariants — nothing existing checks that.

## Evidence
No page capture: this is developer tooling, not a product change. Verified by a headless `claude -p` run in which a Write to `packages/server/dist/__probe.txt` appears in `permission_denials` with the guard's message, and a second headless run in which `subagent_stats.by_type` shows `{"prd-reviewer": 1}` and the relayed report ends `PR-READY WITH NOTES`.

## Ask
1. `.claude/settings.json` with a `PreToolUse` hook on `Edit|Write` running `.claude/hooks/guard.mjs` in exec form (`command` + `args`, no shell — same on Windows and CI).
2. `.claude/hooks/guard.mjs`: exit 2 with a one-line reason when the edit targets `.crt/tasks/README.md`, `package-lock.json` or `packages/server/dist/**`; when a product script other than `packages/server/src/session.ts` imports `@anthropic-ai/claude-agent-sdk`; or when the new content contains CRLF. Exit 0 on anything else, including unreadable input, so the hook can never block real work by accident.
3. `.claude/agents/prd-reviewer.md`: read-only reviewer (Read, Grep, Glob, Bash; sonnet) that scopes the diff, traces every product hunk to an F-/N- ID, checks test titles cite their ID, greps the diff for each CLAUDE.md invariant, measures the overlay gzip size against N-3 when the overlay changed, checks task-file hygiene, and ends with `PR-READY` / `PR-READY WITH NOTES` / `NOT PR-READY`.
4. A Vitest test for the hook in the style of `test/session-start-hook.test.ts`.

## Definition of Done
- [x] The hook blocks a Write to `packages/server/dist/**` in a fresh Claude Code session and the block reason reaches the model.
- [x] Mentioning the SDK package in a doc, comment or test does not trigger the hook; an import in `packages/*/src` or `plugin/` other than `session.ts` does.
- [x] `prd-reviewer` is discoverable and runs as a subagent in a fresh session, producing a report in the specified shape.
- [x] `npm run check` passes with the new test included.

## Notes
The guard's SDK rule is scoped to product scripts (`packages/*/src/**`, `plugin/**`) — the first draft matched any `.ts` file and blocked its own test file, whose fixtures quote an SDK import. `${CLAUDE_PROJECT_DIR}` is substituted inside exec-form `args`, confirmed by the headless run. Hooks added to `.claude/settings.json` mid-session are picked up by the settings watcher after a short delay; a session that started before the file existed may need `/hooks` or a restart. The reviewer notes that five of the seven new test titles carry no F-/N- ID because PRD §12 is a risk-mitigation entry, not an enumerated requirement; left as is.

## Log
- 2026-09-15T14:45+08:00 — claimed on branch feat/claude-config (interactive session, not /crt:next); wrote guard.mjs and pipe-tested 10 stdin cases (all correct).
- 2026-09-15T14:52+08:00 — headless `claude -p` probe: Write to packages/server/dist/__probe.txt refused by the hook, reason quoted verbatim in the result, no file created (DoD 1).
- 2026-09-15T14:55+08:00 — hook went live in the working session and blocked the prd-reviewer.md Write for merely naming the SDK package; tightened the rule to actual import/require statements, then to product scripts only after it blocked its own test fixture. 16 pipe cases correct (DoD 2).
- 2026-09-15T14:57+08:00 — verified: `npm run check` exits 0 — typecheck, 129 unit tests (7 new in guard-hook.test.ts), overlay + server build (DoD 4).
- 2026-09-15T15:03+08:00 — verified: headless run delegating to prd-reviewer — `subagent_stats.by_type` `{"prd-reviewer":1}`, report covered sections 2–6 and ended `PR-READY WITH NOTES` (DoD 3).
- 2026-09-15T15:05+08:00 — ready for review: changed .claude/settings.json, .claude/hooks/guard.mjs, .claude/agents/prd-reviewer.md, packages/server/test/guard-hook.test.ts; reviewer's only notes are test-title IDs (no ID exists for PRD §12) and this task file, now added.
