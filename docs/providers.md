# Providers

The agent behind the in-page chat — Claude Code, Codex, Gemini CLI, Antigravity CLI or any Agent Client Protocol agent — how one is chosen, and per provider what to install, how login is checked and what each problem line means. The front page has the table: [README › Providers](../README.md#providers).

The agent behind the in-page chat is a *provider*. Claude Code is the default and needs nothing; `crt --provider codex`, `crt --provider gemini` or `crt --provider antigravity` (or `provider: "codex"` / `"gemini"` / `"antigravity"` in `.crt/config.json`, or the caret next to **Send**) runs the intake on the developer's own Codex CLI, Gemini CLI or Antigravity CLI instead, and `provider: { "kind": "acp", … }` in `.crt/config.json` names any other agent that speaks the [Agent Client Protocol](https://agentclientprotocol.com) (below). The provider for a session is the first of these that is set:

1. `provider` in the `POST /__crt/sessions` body — the caret next to **Send**, for that one send;
2. the running server's active provider — `--provider` or `CRT_PROVIDER` at start, replaced by **Remember** in the Agent menu for the life of the process;
3. `provider` in `.crt/config.local.json` (per machine, gitignored — what **Remember** writes);
4. `provider` in `.crt/config.json` (per project, committed);
5. auto-detection: what is installed and logged in here, disambiguated by the project's markers (`.claude/`, `CLAUDE.md`, `.codex/`, `.gemini/`, `GEMINI.md`, `.agents/`, `AGENTS.md`);
6. `claude`.

A provider chosen explicitly (1–4) that is not usable is never swapped for another: the session fails with the provider's one-line problem. Only auto-detection falls back — a logged-out Claude is stepped over when Codex is usable, and the ready line says why (`provider: codex — claude not logged in`). `crt providers` prints every provider's state and which one a new session would use, with the reason:

```
claude       ready        Claude Code (Agent SDK) 0.3.270   logged in                                markers: .claude/, CLAUDE.md
codex        not on PATH  Codex CLI                         install: npm i -g @openai/codex          markers: none
gemini       ready        Gemini CLI 0.60.0 (experimental)  login unknown                            markers: none
antigravity  ready        Antigravity CLI 1.2.7             login unknown                            markers: none
→ claude — .claude/, CLAUDE.md; codex not on PATH
```

The full rules are in [docs/PRD-providers.md](PRD-providers.md) F-43/F-44; this section covers what you need per provider. CRT itself has no telemetry; nothing leaves the machine except the model calls the chosen agent already makes, and that agent's own telemetry where it has any (below, per provider).

## Claude Code

Nothing to install beyond Claude Code itself: CRT runs sessions through the Agent SDK, which bundles its own Claude Code binary, and reuses the machine's login (`claude` → `/login`, or `CLAUDE_CODE_OAUTH_TOKEN`). Login is checked at start with the bundled binary's `auth status`; only its yes/no is read. Telemetry is Claude Code's own setting.

```
not logged in to Claude Code — run `claude` in a terminal and complete /login (or set CLAUDE_CODE_OAUTH_TOKEN), then send again
```

Log in, then send again — no restart needed; the page re-checks. When `claude` is not on your PATH the line ends with `(install Claude Code first: npm i -g @anthropic-ai/claude-code)`.

```
Claude Code binary not found — reinstall claude-review-tool (`npm install`) so @anthropic-ai/claude-agent-sdk-<platform>-<arch> is present
```

The SDK's platform package for this OS did not install (an `--omit=optional` install, or a package manager that skipped it). Reinstall `claude-review-tool`.

## Codex

Tested with `codex-cli 0.154.0` (`npm i -g @openai/codex`, then `codex login` — a ChatGPT account). CRT never bundles Codex: it runs the `codex` on your PATH (Windows: the npm `codex.cmd` shim is parsed and its JS entry run with CRT's own Node, so no shell is involved), or the executable you name in `.crt/config.json`:

```json
{ "providers": { "codex": { "command": ["C:\\tools\\codex\\codex.exe"] } } }
```

What a Codex session looks like: **Send to Codex** starts `codex exec --json` in your project root under Codex's **read-only sandbox** — no Allow/Deny cards; the footer shows a `read-only sandbox` badge — with the intake instructions at the top of the first message and the screenshots passed as files. `write_task` reaches Codex through `crt mcp`, a tiny stdio MCP server in the same package that the session's Codex process spawns and that hands the call to the running `crt serve`; the file is written by the server exactly as it is for Claude, with `provider: codex` and Codex's thread id in `session:`. The footer's `codex resume <thread id>` continues the same conversation in a terminal.

**Every later message is a new `codex exec resume` process.** Codex re-reads the whole thread on each resume, so a second or third turn costs about as much as the first and takes a few seconds before the first token; the panel shows the running state while it waits. This is Codex's behaviour, not something CRT can shorten (PRD-providers N-13).

**Telemetry.** Codex has its own analytics; CRT passes `-c analytics.enabled=false` on every invocation it starts, so nothing beyond the model calls Codex itself makes leaves the machine (PRD-providers N-12). CRT has no telemetry of its own.

**Skills for Codex.** `crt skills install --provider codex` writes the seven CRT skills (`next`, `tasks`, `task`, `done`, `intake`, `serve`, `init`) as Agent Skills into `.agents/skills/` in the project (`--global` puts them in `~/.codex/skills`, or `$CODEX_HOME/skills`; `--dir <path>` anywhere else). The text is the plugin's with the Claude-only tokens rewritten; the no-questions guarantee of `/crt:next` is tested on Claude Code only. Running it again changes nothing. `--provider claude` is refused — Claude Code gets the skills from the plugin.

**Codex problems** show up as one line in the panel (or on the `CRT ready` line and in `crt providers`):

```
codex not found on PATH — npm i -g @openai/codex, or set providers.codex.command in .crt/config.json
```

Codex is not installed where CRT can see it — the desktop app and IDE extensions do not put `codex` on PATH. Install the CLI, or point `providers.codex.command` at the executable.

```
not logged in to Codex — run `codex login` in a terminal, then send again
```

`codex login status` said so, **or** a turn failed with Codex's "log out and sign in again" (a stale login that `login status` still reports as logged in). Run `codex login`, then send again; no need to restart `crt serve`.

```
codex <version> is too old — CRT needs 0.154.0 or newer (npm i -g @openai/codex@latest)
```

The `codex exec --json` event names and flags CRT relies on were recorded on 0.154.0; older releases differ. Update the CLI.

```
Codex could not resume thread <id> — start a new session
```

`codex exec resume <id>` came back with a different thread id, which means Codex silently started a new conversation instead of continuing yours (it does that for an unknown non-UUID id, or when its session store lost the thread). Press **New session**; the task file, if one was written, is already on disk.

```
Codex finished the turn without replying or calling write_task — check that Codex lists the crt MCP server (node <cli.js> mcp) and that nothing on stderr says it failed to start
```

The turn completed with no text and no tool call, which almost always means Codex could not start `crt mcp` (a missing `node`, a broken install) and so never saw the `write_task` tool. Run `crt serve` from a terminal and look at what Codex prints, or run `codex mcp list` inside the project.

```
write_task was called with a stale token — the session had ended
```

The agent called `write_task` after the session it belonged to was discarded or the server restarted (every session gets its own token for the life of that session). Start a new session and send again.

## Gemini CLI

**Experimental.** The Gemini profile has never run against a real Gemini: CLI 0.60.0 refuses the free personal Google login (below), and no other credential was available when it was built, so it was tested against a fake ACP agent that follows Gemini's own protocol code and recordings. The provider menu and the session footer wear an `experimental` badge (the reason is the tooltip) and `crt providers` prints `(experimental)` after the name. If you have a Gemini API key, try it and report what you see — the driver is complete; what is unverified is Gemini's live behaviour.

Built against Gemini CLI `0.60.0` (`npm i -g @google/gemini-cli`). CRT never bundles Gemini: it runs the `gemini` on your PATH (Windows: the npm `gemini.cmd` shim is parsed and its JS entry run with CRT's own Node), or the executable you name in `.crt/config.json` under `providers.gemini.command`, in its Agent Client Protocol mode (`gemini --acp`) — one process for the whole session, JSON-RPC over stdio, nothing else in between.

What a Gemini session looks like: **Send to Gemini** starts `gemini --acp` in your project root with the intake instructions at the top of the first message and the screenshots inline (Gemini 0.60.0 accepts image prompts; an agent that does not gets the message without them and the first message says so). Text streams; tool calls show as collapsed lines; a tool call Gemini itself would ask about becomes an **Allow / Deny** card, decided by the same policy as for Claude but over ACP's tool *kinds*: reads, searches and thinking are allowed silently, edits/deletes/moves are allowed only under `.crt/`, a command is allowed only when it is a read-only `git` command, fetching from the network is denied, everything else asks you. CRT answers with the agent's `allow_once` / `reject_once` option and never "always". `write_task` reaches Gemini through `crt mcp`, the same stdio MCP server Codex uses; the file is written by the server with `provider: gemini` and Gemini's session id in `session:`. The footer's `gemini --resume <id>` continues the same conversation in a terminal, from the same project directory (Gemini stores sessions per project). **Stop** sends `session/cancel`.

**Login.** Gemini CLI has no login-status command, so CRT reads what the CLI itself reads: `GEMINI_API_KEY` / `GOOGLE_API_KEY` in the environment or in `~/.gemini/.env` count as logged in; cached Google credentials (`~/.gemini/oauth_creds.json`) show as `login unknown`, because 0.60.0 accepts the login but may refuse the account's tier when the session starts (below). `GEMINI_CLI_HOME` moves `~/.gemini`. Telemetry is Gemini's own `usageStatisticsEnabled` setting; CRT passes no flag for it (PRD-providers N-12).

**Skills for Gemini.** `crt skills install --provider gemini` writes the seven CRT skills into `.gemini/skills/` in the project (`--global`: `~/.gemini/skills`). Same rewriting and caveats as for Codex.

**Gemini problems** show up as one line in the panel (or on the `CRT ready` line and in `crt providers`):

```
gemini not found on PATH — npm i -g @google/gemini-cli, or set providers.gemini.command in .crt/config.json
```

Install the CLI, or point `providers.gemini.command` at the executable.

```
not logged in to Gemini — run `gemini` in a terminal and pick an auth method (or set GEMINI_API_KEY), then send again
```

No API key and no cached Google login, **or** the session start came back with Gemini's "API key is missing or not configured" / "Authentication required". Log in (or set the key), then send again; no need to restart `crt serve`.

```
Gemini refused the Google login for this CLI ("no longer supported for Gemini Code Assist for individuals") — use a Gemini API key: put GEMINI_API_KEY=… in ~/.gemini/.env and set security.auth.selectedType to gemini-api-key in ~/.gemini/settings.json
```

Gemini CLI 0.60.0 rejects the free personal tier of "Log in with Google" (it points at the Antigravity products instead). A Gemini Developer API key from AI Studio works; put it in `~/.gemini/.env` and switch `selectedType`, then send again.

```
gemini <version> is too old — CRT needs 0.60.0 or newer (npm i -g @google/gemini-cli@latest)
```

The ACP behaviour CRT relies on (`--acp`, the `session/new` shape, the permission options) was recorded on 0.60.0; older releases differ. Update the CLI.

## Antigravity CLI

Not experimental: the driver was built from real runs of the CLI on Windows ([docs/spikes/antigravity-2026-09.md](spikes/antigravity-2026-09.md)) and a real intake on the trial app has been recorded (2026-09-21): capture read, source files read, a task written through `write_task`, the conversation continued in a terminal.

Built against Antigravity CLI `agy` `1.2.7` (a single binary installed by [antigravity.google/docs/cli](https://antigravity.google/docs/cli)). CRT never bundles it: it runs the `agy` on your PATH (`agy.exe` on Windows), or the executable you name in `.crt/config.json` under `providers.antigravity.command`, in its non-interactive JSON mode: one `agy --output-format stream-json --input-format stream-json --print "" …` process for the whole session, one turn per developer message on its stdin, nothing else in between.

What an Antigravity session looks like: **Send to Antigravity** starts `agy` in your project root with the intake instructions at the top of the first message and the screenshot *paths* in the text (the CLI takes no image blocks on stdin; the model reads the PNGs with its `view_file` tool). Text streams; tool calls show as collapsed lines; there are no Allow/Deny cards — the footer shows a **read-only sandbox** badge, and the sandbox is CRT's own: Antigravity's headless mode cannot prompt, so it auto-denies every tool that needs a permission (even reading a file in your project), and its allow rules live only in `~/.gemini/antigravity-cli/settings.json`. CRT therefore runs `agy` with `--dangerously-skip-permissions` **and** a `PreToolUse` hook of its own that lets through file reads (`view_file`, `list_dir`, `grep_search`, `find_by_name`, `read_resource`, `list_resources`) and the `crt` MCP server, and refuses everything else — commands, edits, browser and web tools — with a one-line reason the model sees. The hook, the MCP server and a second hook that proves the hooks are loaded before the model is called live in a per-session plugin under `.crt/captures/antigravity/<session>/` (gitignored, removed when the session ends), which CRT hands to `agy --add-dir`; nothing outside `.crt/` is written and `agy mcp add` (which edits your user-level `mcp_config.json`) is never run. `write_task` reaches Antigravity through `crt mcp` as the plugin server `crt_crt`; the file is written by the server with `provider: antigravity` and the conversation id in `session:`. The footer's `agy --conversation <id>` continues the same conversation in a terminal. **Stop** kills the process; the next message resumes the conversation in a new one (Antigravity keeps it), and CRT checks it is the same conversation.

**Login.** Antigravity has no login-status command and keeps its token in the OS keyring, so `crt providers` shows `login unknown`; a logged-out CLI is reported when the session starts. Telemetry is Antigravity's own `enableTelemetry` setting; CRT passes no flag for it (PRD-providers N-12). The model is `models.antigravity` in `.crt/config.json` (one of `agy models`'s ids); CRT never passes `--effort`.

**Skills for Antigravity.** `crt skills install --provider antigravity` writes the seven CRT skills into `.agents/skills/` in the project (`--global`: `~/.gemini/config/skills`). Same rewriting and caveats as for Codex.

**Antigravity problems** show up as one line in the panel (or on the `CRT ready` line and in `crt providers`):

```
agy not found on PATH — install the Antigravity CLI (https://antigravity.google/docs/cli), or set providers.antigravity.command in .crt/config.json
```

Install the CLI (it puts `agy` on your PATH), or point `providers.antigravity.command` at the executable.

```
not logged in to Antigravity — run `agy` in a terminal and sign in, then send again
```

Print mode cannot open the browser login. Run `agy` once and sign in, then send again; no need to restart `crt serve`.

```
agy <version> is too old — CRT needs 1.2.7 or newer (run `agy update`)
```

The stream-json loop, the plugin discovery and the hook contract CRT relies on were recorded on 1.2.7; older releases differ.

```
Antigravity could not resume conversation <id> — start a new session
```

After **Stop** the next message resumes the conversation by id; Antigravity silently starts a new one when the id is unknown, and CRT refuses to continue on it.

```
Antigravity did not load the CRT hooks from <sessionDir> — the turn was stopped before any tool ran; update agy (tested 1.2.7) or start a new session
```

The hook that proves CRT's permission policy is in force did not run before the model was called, so CRT killed the process rather than let it act with `--dangerously-skip-permissions` alone. A newer CLI may have moved plugin discovery; report it.

```
Antigravity finished the turn without replying or calling write_task — check that agy lists the crt_crt MCP server from the session plugin (node <cli.js> mcp) and that nothing on stderr says it failed to start
```

The MCP server was not spawned or did not list `write_task`; `crt serve --verbose` shows what `agy` printed on stderr.

## Any other ACP agent

**Experimental**, for the same reason: an agent CRT has never met was tested against the fake agent only, and its menu row and footer say so.

Any agent that speaks the Agent Client Protocol over stdio can run an intake session without CRT knowing it by name. Put the command in `.crt/config.json` (this form is accepted from the config files only — never from the page or `PUT /__crt/config`):

```json
{ "provider": { "kind": "acp", "command": "my-agent", "args": ["--acp"], "name": "My Agent" } }
```

It registers as the provider id `acp`, with the display name you gave (`Send to My Agent`), no project markers, no launch signal and no resume hint (CRT does not know the agent's resume command; the session id is still in the task file), and the same session shape as Gemini: instructions in the first message, images when the agent advertises them at `initialize`, cards from the tool-kind policy, `write_task` through `crt mcp`, `session/cancel` on **Stop**, stdin closed on **Discard** (the agent gets two seconds to leave, then its process tree is killed). `crt providers` lists it as ready whenever the command resolves (login is `unknown`: CRT cannot ask an unknown agent), and what the agent says when it cannot start a session — an API-key or login message — is shown as `not logged in to <name> — <what it said>`.

```
<command> not found on PATH — install it, or fix provider.command in .crt/config.json
```

The command in `provider.command` does not resolve (PATH and, on Windows, PATHEXT and npm shims are searched; an absolute path is used as is).

```
<agent> speaks ACP <v>; CRT supports 1 — update CRT or the agent
```

The agent's `initialize` reply named a protocol version this CRT does not implement. Note that Gemini 0.60.0 answers `1` whatever the client asks for; the reply is what counts.
