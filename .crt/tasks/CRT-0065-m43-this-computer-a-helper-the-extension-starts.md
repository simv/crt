---
id: CRT-0065
title: M43 — This computer: a helper so the extension starts CRT itself
status: backlog
priority: normal
created: 2026-11-18T08:28:00+08:00
updated: 2026-11-18T08:50:00+08:00
url: null
route: null
session: null
tags: [extension, native-messaging, m43, f-173, prd-connect]
files: [docs/PRD-connect.md]
---

## Summary
For projects that are not on GitHub, and for the chat in the page: one `npx claude-review-tool connect` registers a native-messaging helper with Chrome and Edge; the extension then starts a guest CRT server on demand for a folder picked from the ones Claude Code was used in.

## Context
- PRD-connect §6.3 and §8. Planned on 2026-11-18, not started. Simon's order: Claude in the cloud (M40, M41), then GitHub, then this computer.

## Evidence
No page capture. Simon, 2026-11-18: "what i actually want is the user to just install the extension, connect the extension to claude and then choose where to send feedback to … the user shouldn't have to run commands to edit the folder of the project they are reviewing." He chose "Claude in the cloud first" from the proposal (https://claude.ai/artifact/JiA81f15bwmChPF9CzyTW2) and said "build on the branch".

## Ask
1. `crt connect`: the host manifest and the registry key (Windows first).
2. The helper: start, find and stop guest servers; list Claude Code's folders.
3. The Options page: the folder list as a per-site choice.

## Definition of Done
- [ ] The requirement is written out in PRD-connect §6 with its test rows before the build starts.
- [ ] `npm run check` green; `npm run e2e` green.

## Notes
- Written as a plan; the Ask and the Definition of Done are to be detailed when the task is claimed.

## Log
- 2026-11-18T08:28+08:00 — created (backlog) with PRD-connect.
