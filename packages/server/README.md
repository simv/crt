# claude-review-tool

The `crt` CLI for the **Claude Review Tool**: a local proxy that injects an annotation overlay into your running dev site, lets you talk to Claude in the page, and writes self-contained task files to `.crt/tasks/` that any later Claude Code session can complete with `/crt:next`.

```bash
cd my-app && npm run dev            # your dev server
npx claude-review-tool serve --open # proxies it at http://localhost:4400 and opens the browser
```

Most people install it through the Claude Code plugin instead, which adds `/crt:serve`, `/crt:next`, `/crt:tasks`, `/crt:task` and `/crt:done`:

```bash
claude plugin marketplace add simv/crt
claude plugin install crt@crt
```

Full documentation — the loop, the task format, script-tag mode, troubleshooting — is in the repository README: https://github.com/simv/crt#readme. Node ≥ 20; Windows, macOS and Linux. MIT.
