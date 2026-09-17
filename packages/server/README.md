# claude-review-tool

The `crt` CLI for the **Claude Review Tool**: a local proxy that injects an annotation overlay into your running dev site, lets you talk to Claude (or Codex) in the page, and writes self-contained task files to `.crt/tasks/` that any later Claude Code session can complete with `/crt:next`.

```bash
# one-time, per machine
npm i -g claude-review-tool
crt setup                         # registers the bundled Claude Code plugin: /crt:serve, /crt:next, /crt:tasks, /crt:task, /crt:done, /crt:intake

# per project
cd my-app && npm run dev          # your normal dev server
crt                               # finds it (or asks for its URL once) → http://localhost:4400 opens; browse, annotate, send
```

The plugin ships inside this package (`dist/plugin-marketplace/`), so `crt setup` needs no GitHub access and the plugin version always equals the `crt` version. `npx claude-review-tool` works with no install at all (the first run downloads ~220 MB). `crt doctor` checks node, project, target, port, agents and plugin when something is off.

Full documentation — install options, the loop, providers, the task format, script-tag mode, troubleshooting — is in the repository README: https://github.com/simv/crt#readme. Node ≥ 20; Windows, macOS and Linux. MIT.
