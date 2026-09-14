---
name: done
description: Mark a CRT task done after its PR has merged, recording the PR URL in the task log.
argument-hint: "<CRT-ID> [pr-url]"
disable-model-invocation: true
---

Close task `$ARGUMENTS` (PRD F-40).

1. Read `.crt/tasks/<ID>-*.md`. Confirm status is `review`; if not, say so and stop.
2. Find the PR: the second argument, or `gh pr list --search "<ID>" --state merged`. If no merged PR is found, say so and stop.
3. Set `status: done`, update `updated`, append `- <ISO timestamp> — done; merged in <PR URL>` to **## Log**.
4. Commit on the default branch: `chore(crt): close <ID>`. Report the result in one line.
