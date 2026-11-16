---
id: CRT-0056
title: M35 — GitHub Issues: crt handoff --to github creates one issue per kept item, with its screenshots
status: backlog
priority: high
created: 2026-11-16T19:20:00+08:00
updated: 2026-11-16T19:20:00+08:00
url: null
route: null
session: null
tags: [m35, handoff, destinations, github, f-147, f-148, n-40, prd-destinations]
files: [docs/PRD-destinations.md, packages/server/src/destinations/github.ts, packages/server/src/destinations/project.ts, packages/server/src/destinations/index.ts, packages/server/test/helpers/fake-cli.ts, docs/cli.md, docs/troubleshooting.md, docs/how-it-works.md, CLAUDE.md, .claude/agents/prd-reviewer.md]
---

## Summary
A team that tracks its work in GitHub Issues cannot get a CRT review there. Add the `github` destination: `crt handoff --to github` creates one issue per kept item in the project's repository through `gh`, each a self-contained brief with its screenshots, using the `gh` login the developer already has. CRT handles no token and opens no network connection of its own.

## Context
- M33 (CRT-0054) provides the contract, `ctx.run`, `renderItemMarkdown`, the per-item record and the worktree helper `--to pr` uses.
- GitHub has no API for attaching an image to an issue, so the images go to a branch of the project made for them and the bodies link them at that commit (PRD-destinations §5.6, decision 5). PRD-zero N-35 holds: the developer's checkout is never touched.
- `gh` is answered in tests by the run seam with real `git` against a bare remote (the F-136 pattern in `test/handoff.test.ts`).

## Evidence
No page capture: created from `docs/PRD-destinations.md` milestone M35. Simon, 2026-11-16: "publish to issue tracking software that the user can hook up to the tool", and "let's stop at GitHub issues for now".

## Ask
1. **`destinations/github.ts` (F-147)** per PRD-destinations §5.6: the repository from the remote or the `repo` option; the plan with its `sends` line; the label check in `plan`; one `gh issue create --repo … --title … --body-file …` per item in review order; the number and URL yielded; the refusals; the half-way line.
2. **The body**: Summary, Context, Evidence, Ask, Notes when not empty, Definition of Done as a task list, the footer naming the review, the `R-NN`, the reviewed commit and the route. A pure function of the `FeedbackItem`.
3. **Screenshots (F-148)**: the assets branch `crt/review-<review>-assets` through the shared worktree helper, holding `.crt/tasks/assets/review-<review>/<R-NN>/<image>` only; links pinned to the pushed commit; `--no-screenshots` and `"screenshots": "none"`; the refused-push line with no issue created; the branch reused on a continued run.
4. **Should**: the index issue with `"index": true`.
5. **Tests**: the `gh` argument lists (never `--web`, never an editor), bodies, order, labels, the missing-label refusal with nothing created, a failure on the third issue then a second run creating only the rest; the assets branch's tree is exactly the kept items' images; the N-35 before/after row with a dirty checkout; a grep row that `packages/server/src` has no `fetch(` (N-40).
6. **Docs and guards**: `docs/cli.md`, `docs/how-it-works.md` (what leaves the machine), `docs/troubleshooting.md`; the `CLAUDE.md` Don'ts line and the reviewer agent's row per PRD-destinations §9.

## Definition of Done
- [ ] `--to github` creates one issue per kept item, in review order, with the configured labels, each recorded with its number and URL as it is created (F-147).
- [ ] A label the repository lacks, a missing remote and a missing `gh` are each refused in one line before anything is created (F-147).
- [ ] A failure after some issues says how many exist; the next run creates only the rest and reuses the assets branch (F-142, F-148).
- [ ] The assets branch holds exactly the kept items' images, is made without touching the checkout, and `capture.json` is never on it (F-148, N-40; the N-35 row).
- [ ] `--no-screenshots` creates text-only issues and pushes nothing (F-148).
- [ ] No `fetch(` and no new dependency in `packages/server` (N-40).
- [ ] `npm run check` green.
- [ ] Manual: a real review published as issues on a private repository — the issues readable, the screenshots showing for a signed-in reader with access, the checkout untouched; one issue URL and the `gh` version in the Log. Creating issues on a repository is outward-facing: ask Simon which repository before that step.

## Notes
Read `docs/PRD-destinations.md` §5.6, §6.3, §7 (N-40), §11 and §12 rules 1–3 first. Decisions already taken (§13): through `gh`, no token; screenshots on a branch of the project; publishing issues does not also write task files. If the image links do not render, follow §12 rule 2 and never host the images anywhere else. Needs M33; independent of M34.

## Log
- 2026-11-16T19:20+08:00 — created from docs/PRD-destinations.md by the planning session that wrote it (Claude Code cloud session 01KVgoZdv6kTpuPsfwiirKoq), on Simon's go-ahead of 2026-11-16 ("stop at GitHub issues for now, with the system built so we can add more later, or others can").
