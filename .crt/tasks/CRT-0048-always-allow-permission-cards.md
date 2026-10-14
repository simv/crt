---
id: CRT-0048
title: Always allow on permission cards, for every agent
status: done
priority: normal
created: 2026-10-14T10:27:00+08:00
updated: 2026-10-14T11:18:00+08:00
url: null
route: null
session: null
tags: [permissions, chat, providers, f-26, f-124]
files: [packages/server/src/permissions.ts, packages/server/src/providers/driver-core.ts, packages/server/src/providers/acp.ts, packages/server/src/config.ts, packages/overlay/src/chat.ts]
---

## Summary
Permission cards only offer Allow / Deny, so the same command (`npm test`) prompts every time it runs, in every session. Add **Always allow**: it allows the call and saves a rule so matching calls stop prompting in this project, whichever interactive agent makes them (Claude, Gemini, ad-hoc ACP agents).

## Context
- Simon, 2026-10-14: "we need to add an always allow option to the permission requests that claude makes … or any agent for that matter."
- Every interactive driver asks through `createPermissionBroker` (`providers/driver-core.ts`); Codex and Antigravity are sandboxed and show no cards.
- Claude Code scopes "don't ask again" rules to `.claude/settings.local.json` with rules like `Bash(npm test:*)`; the CRT server may write only under `.crt/`, so the analogue is `.crt/config.local.json`.

## Evidence
None: a feature request, nothing failing. Today `decidePermission` (F-26) returns `ask` for `npm test`, and the stub, the fake Gemini and a real Claude session show a card for it on every round.

## Ask
1. PRD first: PRD-chat F-124 (§6.5) names the behaviour; §9 row for PRD F-26, README and `docs/providers.md`.
2. Normalise a call to one subject (command / file writes / tool) for Claude and ACP, so one rule covers both.
3. Suggest and match rules in Claude Code's syntax (`Bash(<prefix>:*)`, exact `Bash(<cmd>)`, `Edit(<dir>/**)`, a tool name); never match a command with shell operators by prefix; never offer a rule for writes outside the project.
4. The broker skips the card for a covered call, offers the rule on the card, saves it on `always`, and settles other open cards the rule covers.
5. The route takes `behavior: "always"`; the panel shows Always allow with the rule named in words, and "Always allowed" once answered.

## Definition of Done
- [x] PRD-chat F-124 and its §9 row; the README, `docs/providers.md` and PRD F-26 say the same.
- [x] Unit rows: subjects, suggestions, matching, the config file (`permissions.test.ts`); the broker (`driver-core.test.ts`); the route and the stub's second round (`sessions.test.ts`); Gemini saves the same rule (`acp.test.ts`).
- [x] e2e: the ACP row shows the rule line, Always allow reads "Always allowed", writes `.crt/config.local.json`, and the next `npm test` runs with no card.
- [x] `npm run check` and `npm run e2e` green in CI (b15d5f9, both OSes). Locally (Linux cloud container) everything passes except two rows this change does not touch: `exec.test.ts`'s process-group kill (fails on `main` there too) and `embedded.spec.ts`'s reuse line.

## Notes
Removing a rule is a hand edit of `.crt/config.local.json` (`permissions.allow`). ACP agents are still answered `allow_once` (F-54): the rule is CRT's, not the agent's.

## Log
- 2026-10-14T10:27+08:00 — filed and claimed by hand from Simon's request (in_progress), branch `crt/CRT-0048-always-allow`.
- 2026-10-14T10:45+08:00 — built: F-124 in PRD-chat §6.5; rules in `permissions.ts`, the broker in `driver-core.ts`, `acpSubject` in `acp.ts`, `permissions.allow` in `config.ts`, the card in `chat.ts`; unit and e2e rows added. Set to review.
- 2026-10-14T10:51+08:00 — PR https://github.com/simv/crt/pull/110; main merged in after CRT-0047 (#109) landed; CI green on b15d5f9. Waiting on Simon's review.
- 2026-10-14T11:18+08:00 — Simon: "merge it". — done; closed in https://github.com/simv/crt/pull/110 (CI green on c411471)
