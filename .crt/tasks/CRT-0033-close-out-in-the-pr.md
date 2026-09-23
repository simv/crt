---
id: CRT-0033
title: Close a task as the last commit on its PR branch, then merge — no second PR (/crt:done, F-122)
status: review
priority: high
created: 2026-09-23T08:31:00+08:00
updated: 2026-09-23T08:40:00+08:00
url: null
route: null
session: null
tags: [workflow, plugin, skills, f-122, f-40, prd-chat]
files: [plugin/skills/done/SKILL.md, plugin/skills/task/SKILL.md, README.md, CLAUDE.md, docs/PRD.md, docs/PRD-chat.md]
---

## Summary
Closing a task today happens after its PR merges: `/crt:done` flips `review → done` on `main`, and because `main` is protected that needs a second PR (`crt/<ID>-done`) and a second merge for a one-line change — every task since CRT-0024 has one (#47, #69, #71, #73, #78, #79, #81). Simon, 2026-09-23: "the action of setting the done should be the last commit of the PR before we merge … open pr > build > commit > review > mark done > commit > merge and close pr". Move the done commit onto the PR branch: `/crt:done <ID>` finds the task's reviewed, open PR, sets `done` with the PR URL in the Log as the branch's last commit, pushes, merges the PR and returns to `main`. The post-merge path stays only as the fallback for a PR that merged first. `docs/PRD-chat.md` F-122; PRD F-40 amended.

## Context
`plugin/skills/done/SKILL.md` (v0.6) requires a *merged* PR (step 2), switches to the default branch, commits the status change there and, when the push is rejected by protection, opens `crt/$0-done` (step 5) — "Never merge the task's PR or the close PR yourself" (step 6). `plugin/skills/task/SKILL.md` line 16 tells a `review` task's owner to run `/crt:done` "once merged"; README line 107 says "after the PR merges"; `CLAUDE.md` › Work tracking says "`/crt:done <ID> <pr-url>` closes it after merge" and "A task is finished only when it is `done`, its branch is merged to `main`, and no PR is open" (that invariant stays true under the new flow: `done` lands on `main` with the merge). `/crt:next` (F-37) opens the PR and never merges — unchanged. The repo's ruleset requires the `check (<os>)` contexts and blocks direct pushes to `main`; `gh pr merge <n> --squash --delete-branch` works for Simon and for a session as a bare command. Tests that read the skills: `test/skill-pin.test.ts` (the `claude-review-tool@0.6` pin in all seven), `test/skills.test.ts`, `test/plugin-marketplace.test.ts` (frontmatter); `claude plugin validate ./plugin` in CI. Nothing in `packages/server/src` implements the flow — it is skill text and docs.

## Evidence
No page capture: Simon's request in this session (516e0741-5065-4f83-92e2-a6c83cf9dbd1), 2026-09-23, after PR #82 merged. The seven close-out PRs listed in the Summary are the evidence of the cost.

## Ask
1. Rewrite `plugin/skills/done/SKILL.md` to the F-122 flow: status must be `review`; find the **open** PR by branch (`crt/$0-<slug>`) or title; refuse when `reviewDecision` is `CHANGES_REQUESTED`, a check fails or is running, or the PR is conflicting; switch to the PR branch (worktree if hooks refuse); set `done` + `— done; closed in <PR URL>`; validate, `crt tasks`; commit `chore(crt): close $0`, push; `gh pr merge <n> --squash --delete-branch` as a bare command; on a refused merge stop with the done commit on the branch and report the command; back to the default branch after the merge. Keep the post-merge path as a labelled fallback (a PR merged before the task was closed). Keep the `claude-review-tool@0.6` pin.
2. `plugin/skills/task/SKILL.md`'s `review` line, README › The loop's `/crt:done` comment, `CLAUDE.md` › Work tracking (the `/crt:done` sentence and the by-hand sentence) say the new flow.
3. `docs/PRD-chat.md`: F-122 under a new §6.3 Workflow (Release becomes §6.4), the §8 note that it is applied directly, §9 rows for PRD F-40 and the four texts, a §10 row; `docs/PRD.md` F-40 gains the `*v0.7 …*` inline note.
4. Close this task the new way: `done` as the last commit on this branch, then merge — the first use of the flow.

## Definition of Done
- [x] `plugin/skills/done/SKILL.md` implements the F-122 flow (open reviewed PR → done commit on the branch → push → merge → default branch; refused merge and post-merge fallback described); `claude plugin validate ./plugin` green.
- [x] `/crt:task`, README, `CLAUDE.md`, PRD F-40 and PRD-chat (F-122, §8, §9, §10) agree on the flow; `npm run check` green (`skill-pin`, `skills`, `plugin-marketplace`, `docs` tests included); README ≤ 200 lines.
- [ ] This task is closed by the new flow: the `chore(crt): close CRT-0033` commit is the last commit on `crt/CRT-0033-close-out-in-the-pr` before the squash-merge, and no `crt/CRT-0033-done` PR exists.

## Notes
The invariant "finished = `done` + merged + no open PR" is unchanged; what moves is where the `done` commit is made. `done` on an unmerged branch is transient by design — `main` says `review` until the merge lands. `/crt:done` stays `disable-model-invocation: true` (the developer triggers the merge). Existing tasks are all `done`, so the fallback path has no live user in this repo; it is kept for projects that reviewed tasks under v0.6. Skill pins move to `@0.7` only in M27 (CRT-0032).

## Log
- 2026-09-23T08:31+08:00 — filed and claimed by hand by session 516e0741-5065-4f83-92e2-a6c83cf9dbd1 on Simon's request, branch crt/CRT-0033-close-out-in-the-pr; the skill, docs and PRD edits made in the same session.
- 2026-09-23T08:40+08:00 — verified: the done skill — steps 1–8 as the Ask lists them (open PR by branch or title, readiness via `gh pr view --json reviewDecision,statusCheckRollup,mergeable`, done commit on the branch, `gh pr merge --squash --delete-branch` as a bare command, refused merge leaves the commit on the branch, step 7 the old-flow fallback); `claude plugin validate ./plugin` → Validation passed; the `@0.6` pin kept.
- 2026-09-23T08:40+08:00 — verified: the four texts and the PRDs agree (README line 107, `/crt:task` review line, CLAUDE.md › Work tracking, PRD F-40 `*v0.7*` note, PRD-chat §6.3 F-122 / §8 / §9 / §10); `npx vitest run test/skill-pin.test.ts test/skills.test.ts test/plugin-marketplace.test.ts test/docs.test.ts test/init-skill.test.ts test/instructions-block.test.ts` 146/146; README 198 lines. `npm run check` locally: typecheck and build green, 681 unit tests passed, 2 failed — both outside this branch (`git diff main -- packages/server/src packages/server/test` is empty): `test/providers/antigravity.test.ts › after an interrupt …` fails in `afterEach` with `EPERM` removing `%TEMP%\crt-agy-root-*` (the known Windows temp-dir flake, fails alone too), and `test/session.test.ts › starts a session …` (the live Agent SDK smoke test, `describe.skipIf(!loggedIn)`, never run in CI) saw the real model end the turn without calling `write_task` (`writes` length 0). CI is the evidence for the `npm run check` row: PR #83 `check (ubuntu-latest)` green, Windows pending at this entry.
- 2026-09-23T08:40+08:00 — ready for review: PR https://github.com/simv/crt/pull/83; changed plugin/skills/{done,task}/SKILL.md, README.md, CLAUDE.md, docs/PRD.md (F-40 note), docs/PRD-chat.md (F-122, §6.3, §8, §9, §10). DoD row 3 is ticked by the close commit itself.
