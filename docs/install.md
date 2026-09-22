# Install

What `crt setup` puts in Claude Code, the other ways to install `crt`, the Windows shim note and a note on task files written by older versions. The install itself is the one block on the front page: [README › Install](../README.md#install).

## What `crt setup` installs

`crt setup` gives every Claude Code session `/crt:init`, `/crt:serve`, `/crt:next`, `/crt:tasks`, `/crt:task`, `/crt:done` and `/crt:intake`, plus a SessionStart hook that says `CRT: N of M tasks in backlog …` whenever the project has backlog tasks (and stays silent otherwise). The plugin ships inside the npm package — `crt setup` runs `claude plugin marketplace add <the package's dist/plugin-marketplace>` and `claude plugin install crt@crt` for you, so nothing is fetched from GitHub and the plugin version always equals the `crt` version. Restart Claude Code after installing. After `npm update -g claude-review-tool`, run `crt setup` again (it says `already installed` when there is nothing to do). Node ≥ 20 on Windows, macOS or Linux; Claude Code installed and logged in (`claude` → `/login`). No API key: CRT reuses the machine's Claude Code login.

## Other ways to install

- **Teams that want the version in the lockfile:** `npm i -D claude-review-tool` in the project, then `npx crt` (or `crt` from an npm script). The skills always prefer a project install (`npx --no crt`) over anything global.
- **Zero-install:** `npx claude-review-tool` in the project folder does what `crt` does, and `npx claude-review-tool tasks` / `task <ID>` list what `/crt:tasks` / `/crt:task` show. The first run downloads the package and the Claude Code binary it bundles (~220 MB); npm caches it after that. The skills fall back to `npx -y claude-review-tool@0.6` the same way when no local install exists — the one lookup outside CRT's control.
- **From GitHub, without the npm package:** `claude plugin marketplace add simv/crt && claude plugin install crt@crt`. The repository is public, so this works for anyone; the plugin then tracks `main` (`claude plugin update crt@crt` picks up new skills) and the skills run `crt` through `npx` as above.

## Notes

**Windows:** `npm i -g` puts `crt.cmd`, `crt.ps1` and a `crt` shell script on PATH. PowerShell prefers `crt.ps1`, which its execution policy may refuse (`running scripts is disabled on this system`) — run `crt.cmd` instead, or `npx.cmd claude-review-tool`, both of which work regardless of the policy; CMD and Git Bash are unaffected. The skills use `npx --no crt`, which resolves the bin without the shell shim.

**Older task files:** v0.2 added `provider:` to the task frontmatter and made the validator ignore unknown keys. A project pinned to `claude-review-tool@0.1.x` fails `crt task --validate` on files written by 0.2 or later — update to `0.2.0` or newer.
