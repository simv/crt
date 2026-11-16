---
id: CRT-0055
title: M34 — Exports and the default: the review as one Markdown file or one JSON file, and handoff.to
status: review
priority: normal
created: 2026-11-16T19:20:00+08:00
updated: 2026-11-16T19:44:00+08:00
url: null
route: null
session: null
tags: [m34, handoff, destinations, markdown, json, f-144, f-145, f-146, prd-destinations]
files: [docs/PRD-destinations.md, packages/server/src/destinations/markdown.ts, packages/server/src/destinations/json.ts, packages/server/src/destinations/index.ts, packages/server/src/config.ts, packages/server/src/args.ts, packages/server/src/cli.ts, docs/cli.md, docs/review.md]
---

## Summary
A reviewer who wants the feedback as a document gets a folder of files today (`--to bundle`). Add two exports on the destination seam: `crt handoff --to markdown` writes the whole review as one Markdown file with its images beside it, and `--to json` writes the same items as data. Add `handoff.to` so a project names its default destination, and `crt handoff --list`.

## Context
- M33 (CRT-0054) provides the contract, the registry, `FeedbackItem` and `renderItemMarkdown`, and the rule that an export (`final: false`) is recorded but leaves the review `open`.
- `renderSummary` in `handoff.ts` is the collated summary a bundle's `REVIEW.md` starts with; the Markdown export starts with the same.
- Config is read in `packages/server/src/config.ts` with local over project over the guest file under the CRT home (PRD-zero §5.3).

## Evidence
No page capture: created from `docs/PRD-destinations.md` milestone M34. Simon, 2026-11-16: "or even just exporting .MD that the user can then choose what happens to their feedback".

## Ask
1. **`--to markdown` (F-144)** per PRD-destinations §5.5: `crt-review-<project>-<review>.md` and `…-assets/`, `--out <file or dir>`, `--no-screenshots`, the refusal when the file exists.
2. **`--to json` (F-145)**: `{ schema: 1, review, project, items }`, the items being exactly what a destination's `plan` receives.
3. **`handoff.to` and `--list` (F-146)**: the precedence (command line, local, project, guest, then PRD-zero's default rule); `crt handoff --list` one line per destination with the default marked, loading no external module.
4. **Tests**: every kept item's title and sections in review order and no dropped item; every image link resolves; `--no-screenshots`; `--out` both ways; the JSON equals the plan input; the precedence rows; `--list` with an external entry whose file is missing.
5. **Docs**: `docs/cli.md`, `docs/review.md`.

## Definition of Done
- [x] `--to markdown` writes one file holding every kept item in full, in review order, with image links that resolve to files beside it (F-144).
- [x] `--to json` writes a file whose `items` equal the `FeedbackItem`s a destination is given (F-145).
- [x] Neither export makes the review `handed`, and each can be repeated with `--out` elsewhere (F-142, F-144).
- [x] `handoff.to` sets what plain `crt handoff` does; `--to` wins over it; `--list` shows every destination and imports none (F-146, N-39).
- [ ] `npm run check` green.
- [ ] Manual: `--to markdown` on a real review of five or more items, opened in a Markdown viewer with its images showing; the viewer named in the Log.

## Notes
Read `docs/PRD-destinations.md` §5.5 and §6.2 first. `--to bundle` is unchanged (N-37). No data-URI images: most viewers do not show them. Needs M33; independent of M35.

## Log
- 2026-11-16T19:20+08:00 — created from docs/PRD-destinations.md by the planning session that wrote it (Claude Code cloud session 01KVgoZdv6kTpuPsfwiirKoq), on Simon's go-ahead of 2026-11-16 ("stop at GitHub issues for now, with the system built so we can add more later, or others can").
- 2026-11-16T19:44+08:00 — claimed (in_progress) and built in the same pull request as CRT-0054 (https://github.com/simv/crt/pull/131): `destinations/markdown.ts`, `destinations/json.ts`, `handoff.to` and `destinations` in `readDestinationsConfig`, `crt handoff --list` (`listHandoff`).
- 2026-11-16T19:44+08:00 — verified: DoD 1 — "writes one file with every kept item in full, in review order, and images that resolve beside it". DoD 2 — "writes the items as data — exactly what a destination is given". DoD 3 — "leaves the review open after an export, which can be repeated", "takes --out as a file or a directory, and writes no images with --no-screenshots" (an existing file is refused, as `bundle` does: PRD-destinations §14.8). DoD 4 — "reads handoff.to and destinations from the guest file, then the local one, then the project's", "uses handoff.to for plain crt handoff, and --to over it", "lists every destination and imports none, even one whose file is missing".
- 2026-11-16T19:44+08:00 — DoD 5: typecheck, lint and build green, 976 unit tests pass; the one failing unit test is `test/providers/exec.test.ts` "kills a process and its children", which fails on `main` in this container too and is green in CI — left unticked until CI says so.
- 2026-11-16T19:44+08:00 — DoD 6 (Manual) open: it needs a real review and a Markdown viewer on Simon's machine.
