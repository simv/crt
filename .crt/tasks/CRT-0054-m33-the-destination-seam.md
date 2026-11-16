---
id: CRT-0054
title: M33 — The destination seam: hand-over destinations are modules behind one contract, and a module named in the config is one
status: review
priority: high
created: 2026-11-16T19:20:00+08:00
updated: 2026-11-16T19:44:00+08:00
url: null
route: null
session: null
tags: [m33, handoff, destinations, f-140, f-141, f-142, f-143, n-37, n-38, n-39, prd-destinations]
files: [docs/PRD-destinations.md, packages/server/src/handoff.ts, packages/server/src/home.ts, packages/server/src/config.ts, packages/server/src/args.ts, packages/server/src/cli.ts, packages/server/package.json, packages/server/scripts/integrations.mjs, packages/server/test/handoff.test.ts, CLAUDE.md, .claude/agents/prd-reviewer.md]
---

## Summary
`crt handoff` delivers a review to one of four places, all written inline in `runHandoff`. Turn a destination into a module behind one published contract: move `pr`, `branch`, `here` and `bundle` behind it with no change in behaviour, record each item as it lands so a stopped publish can be continued, and let a module named in the config be a destination, so a tracker CRT does not ship can be added by anyone without touching CRT.

## Context
- `packages/server/src/handoff.ts` (461 lines) holds the four destinations as branches of `runHandoff`; `home.ts` has `Handover`, `HandoverDestination` (a union of four) and `recordHandover`, which sets the review `handed`.
- `test/handoff.test.ts` runs real `git` against a bare remote and answers `gh` through the `ToolRunner` seam. It is the gate for N-37: its assertions do not change.
- The provider seam (`packages/server/src/providers/`, `types.ts`, the registry in `session.ts`) is the pattern to follow for layout and naming.
- `packages/server/package.json` `exports` and `scripts/integrations.mjs` are how the existing public entries (`./loader`, `./react`, `./vite`) are built and typed.

## Evidence
No page capture: created from `docs/PRD-destinations.md` milestone M33, after Simon's request of 2026-11-16 to let users choose what happens to the feedback.

## Ask
1. **The contract** — `packages/server/src/destinations/types.ts` exactly per PRD-destinations §5.2 (`Destination`, `PublishInput`, `FeedbackItem`, `DestinationPlan`, `PublishedItem`, `DestinationContext`, `apiVersion: 1`).
2. **`FeedbackItem` (F-141)** — `destinations/item.ts`: `readFeedbackItem` and the shared `renderItemMarkdown`; `capture.json` never in `images`.
3. **The registry (F-140)** — `destinations/index.ts`: `resolveDestination`, `listDestinations`; the unknown-name line, exit 2.
4. **Move the four (N-37)** — `destinations/project.ts` (`pr`, `branch`, `here`, with the worktree helper exported for M35) and `destinations/bundle.ts`. As its own commit, before any new behaviour. `runHandoff` keeps the review, the plan printing, the question, the record and the failure lines, and no destination-specific branch.
5. **The record (F-142)** — `Handover.to: string`, `urls`, `state`; `recordPublished` after each yielded item; continue a `partial` entry without `--again`; `handed` only after a `complete` hand-over to a `final` destination; `--again` means the same destination again.
6. **External destinations (F-143)** — `destinations.<name>.use` in the config, resolved and loaded per §5.3 and §12 rules 4 and 5, checked, refused in one line each; the naming line before the load; the `./destination` package entry with `defineDestination` and `API_VERSION`.
7. **The order (N-38, N-39)** — `plan` before the question, `publish` only after the yes, for every destination; an external module imported only by `crt handoff` when it is that run's destination.
8. **Tests** — `test/handoff.test.ts` green with assertions untouched except where §5.4 adds `state` (name each in the Log, §12 rule 6); `test/destinations.test.ts`: the registry, `FeedbackItem` fixtures, a fake destination that throws after two items and is continued, an export that leaves the review open, a second destination without `--again`; a fixture module under `test/fixtures/destinations/` loaded by relative path from a scratch project's config, its refusals, and the call-order row.
9. **Docs and guards** — `docs/cli.md` (`--to <destination>`), `CLAUDE.md` entry points and Don'ts and the reviewer agent's rows per PRD-destinations §9.

## Definition of Done
- [x] `runHandoff` has no destination-specific branch; `pr`, `branch`, `here` and `bundle` are modules under `destinations/` (F-140).
- [x] `test/handoff.test.ts` passes with its assertions untouched apart from the `state` field, each such change named in the Log (N-37).
- [x] `readFeedbackItem` gives the sections, frontmatter and images of fixture task files, never `capture.json` and never the Log (F-141).
- [x] A destination that stops after two items leaves exactly those recorded and the review `open`; the next run is offered only the rest (F-142).
- [x] An export leaves the review `open`; a `handed` review goes to a second destination without `--again` and is refused for the same one without it (F-142).
- [x] A module named by `use` in a scratch project's config is loaded and used by `crt handoff --to <name>`; not found, a wrong `apiVersion`, a missing function and a built-in's name with `use` are each one `crt:` line (F-143).
- [x] `publish` is not called when the answer is no, and no external module is imported by any command but `crt handoff` (N-38, N-39; the call-order row and a grep row).
- [x] `import "claude-review-tool/destination"` resolves to the types and `defineDestination` from the built package (F-143).
- [x] `npm run check` green; `npm run e2e` green.

## Notes
Read `docs/PRD-destinations.md` §5.1–§5.4, §6.1, §7, §9 and §12 first, then PRD-zero §5.5 and N-35, which stay in force. Decisions already taken (§13): one extension mechanism (a module, no `command` destination); `handoff.ts` owns the question; no credential store in v0.9. Do the move and the new behaviour as separate commits so the diff of the move can be read against N-37. M34 and M35 both need this task.

## Log
- 2026-11-16T19:20+08:00 — created from docs/PRD-destinations.md by the planning session that wrote it (Claude Code cloud session 01KVgoZdv6kTpuPsfwiirKoq), on Simon's go-ahead of 2026-11-16 ("stop at GitHub issues for now, with the system built so we can add more later, or others can").
- 2026-11-16T19:44+08:00 — claimed (in_progress) by the same cloud session, on Simon's "build as planned" of 2026-11-16; built on the planning branch, so the plan and the build are one pull request (https://github.com/simv/crt/pull/131).
- 2026-11-16T19:44+08:00 — built: `destinations/{types,api,item,shared,project,bundle,index}.ts`; `handoff.ts` keeps the review, the plan printing, the question and the record; `home.ts` `handoversOf`, `noteHandover`, `recordPublished`, `completeHandover`; `./destination` in `exports`, emitted by `scripts/integrations.mjs`.
- 2026-11-16T19:44+08:00 — verified: DoD 1, 2 — `test/handoff.test.ts` passes with no line changed (an entry without `state` is complete, so no assertion needed the field; `git diff main -- packages/server/test/handoff.test.ts` is empty). DoD 3 — "gives the frontmatter, every section but the Log, and the images — never capture.json". DoD 4 — "keeps exactly what landed when a destination stops, and offers only the rest next time". DoD 5 — "leaves the review open after an export, which can be repeated", "sends a handed review to a second destination without --again, and refuses the same one without it". DoD 6 — "loads a module named by `use` …", "refuses a module that is not there, speaks another contract version, or lacks a function — one line each", "refuses a name nobody has, and a module that takes a built-in's name". DoD 7 — "never calls publish when the answer is no, or off a terminal without --yes", "imports a config-named module in one place only, and CRT opens no connection of its own". DoD 8 — `node -e "import('claude-review-tool/destination')"` from the built package prints `API_VERSION`, `defineDestination`; `test/integrations-build.test.ts` pins the entry and its `.d.ts`.
- 2026-11-16T19:44+08:00 — DoD 9 left open here: `npm run check` — typecheck, lint and build green, 976 unit tests pass, the one failing unit test is `test/providers/exec.test.ts` "kills a process and its children", which fails on `main` in this container too and is green in CI. `npx playwright test`: 84 passed, 2 failed in this container — `embedded.spec.ts` "health says embedded …" (fails on `main` here too) and `chat.spec.ts` "Stop interrupts the turn …", which passes when run alone and touches nothing this task changed. CI on the pull request is the judge.
- 2026-11-16T19:44+08:00 — differences from the text of the PRD are in its new §14 (the `use` path is taken from the project root; the config layering is guest, local, project; `state` is only ever `partial`; the context gained `has`, `record` and `recorded`).
- 2026-11-16T19:50+08:00 — verified: CI green on bf4fb6b — `check (ubuntu-latest)`, `check (windows-latest)` and `e2e (ubuntu)` (https://github.com/simv/crt/actions/runs/43860476994); the `npm run check` row ticked. The Manual rows stay open.
