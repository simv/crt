---
id: CRT-0005
title: M5 — Hardening, Should-items, docs and v0.1.0 release
status: backlog
priority: normal
created: 2026-09-14T20:50:00+08:00
updated: 2026-09-14T20:50:00+08:00
url: null
route: null
session: null
tags: [m5, release, docs]
files: [README.md, .github/workflows/release.yml, packages/server/package.json]
---

## Summary
Close out the PRD definition of done: pick the highest-value Should items, write the user docs and troubleshooting, and publish `claude-review-tool@0.1.0` through the release workflow.

## Context
PRD §11 (project DoD), §6 Should items (F-5, F-6, F-12 sessionStorage, F-14 quick note, F-21, F-22, F-29, F-30, F-40, F-41), milestone M5. Depends on CRT-0004. `release.yml` needs the `NPM_TOKEN` repo secret, which Simon adds manually.

## Evidence
None — greenfield task from the PRD.

## Ask
1. Implement, in value order and within budget: F-14 quick note, F-6 script-tag mode with localhost-only CORS, F-21 failed network requests, F-30 session list. Record what was deferred and why in the Log.
2. README: install, the loop, task format, script-tag fallback, troubleshooting for every N-6 case, and a short "how it works" section.
3. Walk PRD §11 and tick each item with evidence (test name, or manual note in this Log).
4. Bump `packages/server` to 0.1.0, tag `v0.1.0`, confirm the release workflow publishes and creates a GitHub Release.

## Definition of Done
- [ ] Every PRD §11 checkbox is ticked with a pointer to evidence.
- [ ] `claude-review-tool@0.1.0` is on npm; `npx claude-review-tool@0.1.0 serve --open` works in the trial project.
- [ ] GitHub Release v0.1.0 exists with generated notes.
- [ ] README covers everything listed in the Ask.

## Notes
—

## Log
- 2026-09-14T20:50+08:00 — created from PRD milestone M5 during project setup.
