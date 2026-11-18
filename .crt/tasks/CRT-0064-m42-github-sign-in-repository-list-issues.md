---
id: CRT-0064
title: M42 — GitHub from the extension: sign in, pick a repository, issues with screenshots
status: backlog
priority: normal
created: 2026-11-18T08:28:00+08:00
updated: 2026-11-18T08:50:00+08:00
url: null
route: null
session: null
tags: [extension, github, m42, f-172, prd-connect]
files: [docs/PRD-connect.md]
---

## Summary
Give the extension a real picker: sign in to GitHub with the device flow, list the developer's repositories, and publish a review's kept items as issues with their screenshots on an assets branch; pass the issue links to a Claude destination of the same repository so the cloud session can open the pictures.

## Context
- PRD-connect §6.3 and §8. Planned on 2026-11-18, not started. Simon's order: Claude in the cloud (M40, M41), then GitHub, then this computer.

## Evidence
No page capture. Simon, 2026-11-18: "what i actually want is the user to just install the extension, connect the extension to claude and then choose where to send feedback to … the user shouldn't have to run commands to edit the folder of the project they are reviewing." He chose "Claude in the cloud first" from the proposal (https://claude.ai/artifact/JiA81f15bwmChPF9CzyTW2) and said "build on the branch".

## Ask
1. A GitHub OAuth app (Simon registers it; the device flow needs no secret).
2. Sign-in, the repository list, the per-site choice.
3. Issues and the assets branch, recorded per item so a publish continues where it stopped.
4. The issue links in the text sent to Claude.

## Definition of Done
- [ ] The requirement is written out in PRD-connect §6 with its test rows before the build starts.
- [ ] `npm run check` green; `npm run e2e` green.

## Notes
- Written as a plan; the Ask and the Definition of Done are to be detailed when the task is claimed.

## Log
- 2026-11-18T08:28+08:00 — created (backlog) with PRD-connect.
