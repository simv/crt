---
id: CRT-0066
title: M44 — The store package, docs, release 0.11.0
status: backlog
priority: normal
created: 2026-11-18T08:28:00+08:00
updated: 2026-11-18T08:50:00+08:00
url: null
route: null
session: null
tags: [extension, release, m44, f-174, f-175, prd-connect]
files: [docs/PRD-connect.md]
---

## Summary
Make the extension installable without Developer mode: a Chrome Web Store package with its privacy text and permission justifications, the docs for v0.11, and the release.

## Context
- PRD-connect §6.3 and §8. Planned on 2026-11-18, not started. Simon's order: Claude in the cloud (M40, M41), then GitHub, then this computer.

## Evidence
No page capture. Simon, 2026-11-18: "what i actually want is the user to just install the extension, connect the extension to claude and then choose where to send feedback to … the user shouldn't have to run commands to edit the folder of the project they are reviewing." He chose "Claude in the cloud first" from the proposal (https://claude.ai/artifact/JiA81f15bwmChPF9CzyTW2) and said "build on the branch".

## Ask
1. The listing package and texts (Simon's developer account, opened once the concept is proven).
2. README and reference pages.
3. Versions and pins 0.11.0 / @0.11; `npm run screenshots` if the overlay's UI changed.

## Definition of Done
- [ ] The requirement is written out in PRD-connect §6 with its test rows before the build starts.
- [ ] `npm run check` green; `npm run e2e` green.

## Notes
- Written as a plan; the Ask and the Definition of Done are to be detailed when the task is claimed.

## Log
- 2026-11-18T08:28+08:00 — created (backlog) with PRD-connect.
