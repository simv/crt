---
name: done
description: Mark a CRT task done after its PR has merged, recording the PR URL in the task log.
argument-hint: "<CRT-ID> [pr-url]"
disable-model-invocation: true
---

Close task `$0` (PRD F-40), from the project root `${CLAUDE_PROJECT_DIR}`. `crt` means `npx --no crt` if the project has it installed, else `npx -y claude-review-tool@0.5`.

1. `crt task $0` (or read `.crt/tasks/$0-*.md`). The status must be `review`; otherwise say what it is and stop. Note the file name; `<slug>` is the file name without `CRT-NNNN-` and `.md`.
2. Find the merged PR: `$1` if given, else `gh pr list --state merged --head crt/$0-<slug> --json url,mergedAt -q '.[0]'`, else `gh pr list --state merged --search "$0" --json url,mergedAt -q '.[0]'`. None found → say the PR has not merged yet (or `gh` is unavailable) and stop; do not close the task.
3. Get on the default branch with the merge in it: `git switch <default>` and `git pull --ff-only`. If the working tree has other changes, leave them alone; only the task file and the index are touched below.
4. In the task file set `status: done`, `updated: <now, ISO-8601 with offset>`, and append `- <YYYY-MM-DDTHH:MM+HH:MM> — done; merged in <PR URL>` to **## Log**. `crt task $0 --validate`, then `crt tasks` to regenerate `.crt/tasks/README.md`.
5. `git add .crt/tasks/$0-*.md .crt/tasks/README.md` and `git commit -m "chore(crt): close $0"`. Try `git push`. If the push is rejected because the branch is protected, push the commit on a branch instead — `git switch -c crt/$0-done`, `git push -u origin crt/$0-done`, `gh pr create --base <default> --title "chore(crt): close $0" --body "Marks $0 done; merged in <PR URL>."` — and return to the default branch.
6. Report one line: the task ID, `done`, and either "pushed to <default>" or the URL of the close PR to merge. Never merge the task's PR or the close PR yourself.
