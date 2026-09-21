# Spike: Antigravity CLI (`agy`) feasibility on Windows (CRT-0023)

**Tested version: `agy 1.2.7`** (`%LOCALAPPDATA%\agy\bin\agy.exe`, a single Go binary, 203 MB, no npm shim; 2026-09-21), Windows 11 Pro 10.0.22000, Node 24.18.0, logged in with a personal Google account (`agy models` lists Gemini 3.x, Claude and GPT-OSS models).

This document records what the Antigravity CLI *does* in its first-party non-interactive JSON mode, against what PRD-providers §11 item 4 hoped for. Every command below was run on Simon's machine by the CRT-0023 worker session from a scratch repo (`C:\Projects\Claude\crt-agy-spike-repo`, a sibling of this repo — not under `%TEMP%`, per the Codex spike); verbatim output is quoted. **Every question has an observed verdict.** Scripts: [`antigravity-2026-09/probe/`](antigravity-2026-09/probe/) (`run.mjs` one-shot runs, `loop.mjs` the stdin turn loop with kill, `plugin.mjs` the `.crt/agy` plugin, `mcp-probe.mjs` + `listener.mjs` from the Codex spike, `summarize.mjs`, `fixtures.mjs`). Recordings: [`packages/server/test/providers/fixtures/antigravity/`](../../packages/server/test/providers/fixtures/antigravity/) (headers name the command, stdin, exit code and stderr).

## Verdicts at a glance

| # | Question (task Ask 1) | Verdict | Status |
|---|---|---|---|
| 1 | `agy --version` | `1.2.7` (the bare number), exit 0, ~100 ms. | observed |
| 1 | Login-state probe | **No status command, no file.** Tokens live in the Windows keyring (`cli.log`: `ChainedAuth: authenticated via keyring`); a run with `USERPROFILE`/`HOME` pointing at an empty directory still answered, so `~/.gemini/oauth_creds.json` proves nothing. `agy --output-format json --print /usage` answers without a model turn (~6 s, network) and would be the on-demand check. Logged out, print mode says `Print mode: not logged in and no controlling terminal; cannot complete interactive login` and the log says `You are not logged into Antigravity` (binary strings; not reproducible here without logging Simon out). **Verdict: preflight = `--version` only, `loggedIn: "unknown"` (§12 rule 3); the not-logged-in line is mapped from those two strings at turn time.** | observed (strings for the logged-out text) |
| 1 | Print mode flags | `--print` is a **string** flag: `agy --print --output-format stream-json "x"` takes `--output-format` as the prompt (exit 2 with a clear error). In stream-json input mode the prompt must be an empty string: `--output-format stream-json --input-format stream-json --print ""`. `--model <id>` accepted (`init.model` then names it); `--effort` **conflicts** with the effort-suffixed model ids `agy models` lists (`--model gemini-3.8-flash-high conflicts with --effort=low`, exit 1) — the driver never passes `--effort`. `--sandbox`, `--mode plan`, `--add-dir`, `--conversation`, `--dangerously-skip-permissions` accepted. | observed |
| 1 | stream-json **input** shape | `{"event":"user","message":{"role":"user","content":"…"}}` per line, or `content: [{"type":"text","text":"…"}]`. A line without `event` → `error: stream input message is missing the "event" field`, `result` with `status: "ERROR"`, exit 1; an unknown event → `warning: ignoring unsupported stream input message event "x"` and the process waits for the next line; `content` blocks of any type but `text` → `stream input content block type "image" is not supported (only "text")`, `result` ERROR, exit 1 (= `fixtures/antigravity/input-error-image-block.jsonl`). | observed |
| 1 | stream-json **output** shapes | Three events, one JSON object per line on stdout: `{"event":"init","conversation_id","init":{"cwd","tools":[…57 names…],"permission_mode","model"?}}` at startup (before the first turn; `model` only when `--model` was given); `{"event":"step_update","step_update":{"conversation_id","step_index","state":"ACTIVE"|"DONE"|"ERROR","step_type","text_delta"?,"tool_name"?,"tool_info"?,"duration_seconds"?,"usage"?}}` with `step_type` ∈ `user_input`, `agent_response` (**text as `text_delta` chunks**, ACTIVE per chunk, DONE with `usage`), `tool` (`tool_name`, `tool_info.{name,parameters}` on ACTIVE; `tool_info.output` or `tool_info.error.{type,message}` on DONE/ERROR), `system_message` (seen on resume); `{"event":"result","result":{"conversation_id","status":"SUCCESS"|"ERROR","response","error"?,"duration_seconds","num_turns","usage","denied_actions"?}}` per turn. `usage` = `{input_tokens, output_tokens, thinking_tokens, cache_read_tokens, total_tokens}`. stderr carries `warning:`/`error:`/`jetski:` lines and, per the changelog, `AGY_ERROR: {…}` JSON on model-API failures. | observed |
| 1 | One process, several turns | **Yes.** `--input-format stream-json` runs one turn per stdin line in one conversation: same `conversation_id`, `step_index` continues, `result.num_turns` counts up; stdin end → `Print mode: stream input closed after N turn(s)`, exit 0 (= `fixtures/antigravity/loop.jsonl`). Turn 2 remembered turn 1 (`Teal`). Startup to `init` ≈ 5–6 s. | observed |
| 1 | Conversation id and resume | `init.conversation_id` (UUID) is the id; `--conversation <id>` re-emits `init` with the **same** id and the model remembers earlier turns (= `resume.jsonl`). An unknown or non-UUID id prints `warning: conversation "…" not found` on stderr and **silently starts a new conversation** (= `resume-unknown-id.jsonl`) — the F-53-style resume assertion is required. `agy --conversation <id>` is the interactive counterpart (`resumeCommand`). | observed |
| 1 | Handing the turn an MCP server | `agy mcp add` writes the **user-level** `~/.gemini/config/mcp_config.json` (verified: add → `{"mcpServers":{"crt-spike-probe":{…}}}` → remove; restored to its original empty file). **Per invocation, without touching the user's config: a plugin under a directory passed with `--add-dir`.** `--add-dir <dir>` makes `<dir>` a workspace root, and Antigravity discovers `<dir>/.agents/plugins/<name>/{plugin.json,mcp_config.json,hooks.json}` there (built-in `agy-customizations` skill docs, and observed). CRT writes `.crt/captures/antigravity/<session>/.agents/plugins/crt/` — inside `.crt/`, gitignored — and passes `--add-dir .crt/captures/antigravity/<session>`. The server is spawned at startup with **cwd = the plugin directory** (changelog: "plugin MCP servers resolve against the plugin's own directory"), `server/discover` (answered `-32601`, harmless), `initialize` (`protocolVersion: "2025-11-25"`, client `antigravity-client v1.0.0`), `notifications/initialized`, `tools/list` — before the first turn. Plugin servers are namespaced **`<plugin>_<server>`**, so the tool is `crt_crt/write_task` and the model calls it through the generic `call_mcp_tool` tool (`ServerName: "crt_crt", ToolName: "write_task", Arguments: {…}`). | observed |
| 1 | Token reaches the MCP server via environment, never argv (F-49/N-8) | **Yes.** The MCP server inherits the `agy` process environment in full (93 keys = parent + `env` map): `CRT_MCP_TOKEN=tok-123` set on `agy` reached `mcp-probe.mjs` without appearing in `mcp_config.json` or on any command line. `mcp_config.json` `env` is left empty. | observed |
| 1 | `crt mcp` spawned, `write_task` listed, called | The probe server was spawned, listed and called by the model (`call_mcp_tool` → `output: "listener replied 200: pong #9"`, listener log shows the POST) — under `--dangerously-skip-permissions` (next row). The real `crt mcp` shim runs the same path in the conformance test and the Manual row. | observed |
| 1 | Permissions in print mode | Headless mode **cannot prompt: every tool that needs a permission is auto-denied** (`jetski: no output produced — a tool required the "mcp" permission that headless mode cannot prompt for, so it was auto-denied. Add an allow-rule under permissions.allow in settings.json (e.g. mcp(<target>)). Alternatively, re-run with --dangerously-skip-permissions`), the step is `state: "ERROR"` with `user denied permission for mcp(crt_crt/crt_ping)`, and `result.denied_actions` lists it (= `mcp-denied-headless.jsonl`). **Even a workspace file read (`view_file` on `AGENTS.md`) is denied** in headless `request-review` mode, with the workspace trusted (`trustedWorkspaces`) and with `--sandbox`; the model then stops the turn. Allow rules live only in the user's `~/.gemini/antigravity-cli/settings.json` (`permissions.allow`, e.g. `mcp(crt_crt/write_task)`, `read_file(*)`) — an intake would need `read_file(*)` **and** the MCP rule there, per machine. A `PreToolUse` hook returning `decision: "allow"` or `permissionOverrides: ["mcp(crt_crt/crt_ping)"]` does **not** bypass the permission check (tried both). `--mode plan` is **ignored** under `--dangerously-skip-permissions` (`init.permission_mode: "always-proceed"`; the model wrote `probe-wrote.txt` and ran commands). **Verdict → F-46 `permissions: "sandboxed"`, the sandbox being CRT's own:** `--dangerously-skip-permissions` plus a `PreToolUse` hook (`matcher: "*"`) in the same `.crt/…/plugins/crt/hooks.json` that allows `view_file`, `list_dir`, `grep_search`, `find_by_name`, `read_resource`, `list_resources`, `finish` and `call_mcp_tool` on `crt_crt`, and **denies everything else** (`run_command`, `write_to_file`, `replace_file_content`, browser tools, `read_url_content`, …). Observed (= `first-turn.jsonl`): `view_file` DONE, `call_mcp_tool` DONE, `run_command` → `tool call denied by pre-tool hook: CRT intake session: run_command is not allowed here…` (ERROR step), `write_to_file` → same; nothing was written. A hook that fails to run is itself a tool error (`JSON hook "…" failed: command failed: exit status 1`), i.e. **fail closed**. | observed |
| 1 | Hook mechanics | `hooks.json` in the plugin; the command runs through `cmd /c` on Windows with **cwd = the plugin directory**; a bare `hook.cmd` is *not* found and `"C:\Program Files\nodejs\node.exe" …` is mangled (`'\"C:\Program Files\nodejs\node.exe\"' is not recognized`), so the command is the **absolute path of a `.cmd`** wrapper (`@"<node>" "%~dp0hook.mjs"`), which works. The hook gets the tool call as JSON on stdin (`{"toolCall":{"name","args":{"ServerName","ToolName","Arguments",…}},"stepIdx","conversationId","modelName","workspacePaths",…}`) and answers `{"decision":"allow"|"deny","reason"}` on stdout. `PreInvocation` hooks fire **before every model call**, 67 ms after the `user_input` step and ≈2 s before the model's first tool call — the driver's proof that the hooks loaded: the hook writes a marker file per process; if it is missing when the first `agent_response`/`tool` step of a turn arrives, the driver kills the process (N-7 line) before that tool runs. | observed |
| 1 | Images | Inline: **no** (`only "text"` content blocks; see input shape). By path: **yes** — a PNG path in the message text made the model call `view_file` on it (allowed by the hook) and answer `Red` (= `image-by-path.jsonl`). **Verdict: `images: "path"`** with the paths in the message text (F-50 already names them there). | observed |
| 1 | `launchEnv` | A model-run `Get-ChildItem Env:` (under `--dangerously-skip-permissions`, before the hook existed) printed `ANTIGRAVITY_AGENT=1`, `ANTIGRAVITY_AGENTAPI_EXE`, `ANTIGRAVITY_APP_DATA_DIR`, `ANTIGRAVITY_CONVERSATION_ID=<conversation id>`, `ANTIGRAVITY_CSRF_TOKEN`, `ANTIGRAVITY_LS_ADDRESS`, `ANTIGRAVITY_LS_VERSION=cli-1.2.7`, `ANTIGRAVITY_PROJECT_ID`, `ANTIGRAVITY_SOURCE_METADATA`, `ANTIGRAVITY_TRAJECTORY_ID`. **Verdict: `launchEnv: ["ANTIGRAVITY_CONVERSATION_ID", "ANTIGRAVITY_AGENT"]`.** | observed |
| 1 | Skills / instructions (F-58) | Rules: `GEMINI.md`, `AGENTS.md`, `.agents/rules/*.md`, walked up from the cwd to the repo root. Skills: `.agents/skills/<name>/SKILL.md` in the project (also `.agent/`, `_agents/`, `_agent/`), `~/.gemini/config/skills/` for the user (Agent Skills format: `SKILL.md` with `name`/`description` frontmatter). Markers: `.agents/` (private — but shared with Codex's `.agents/skills`, so weighted as shared), `GEMINI.md` (shared with Gemini), `AGENTS.md` (shared). Source: the built-in `agy-customizations` skill under `~/.gemini/antigravity-cli/builtin/skills/`, shipped in the binary. | observed (shipped docs) |
| 1 | Telemetry opt-out (N-12) | **No per-invocation flag**: `--disable_telemetry` (a string in the binary) is `flags provided but not defined`, exit 2. The setting is `enableTelemetry` in `~/.gemini/antigravity-cli/settings.json`. **Verdict: `telemetryOptOut: []`**; the README says Antigravity's own setting applies. | observed |
| 1 | Ctrl+C / kill mid-turn, then resume | `taskkill /T /F` on the `agy` pid took two children with it (the MCP server and the language-server sidecar); exit code 1, only `init` + the `user_input` step printed (= `killed.jsonl`). `--conversation <id>` in a new process: `init` with the same id, a `system_message` step, and the answer `Otter` — the killed turn's message was persisted (= `resume.jsonl`). **Verdict: interrupt = kill the tree; the next message spawns a new process with `--conversation <id>` and asserts the id.** | observed |
| — | Executable resolution (N-10) | `agy.exe` on PATH (`%LOCALAPPDATA%\agy\bin`), no shim: `resolveExecutable("agy")` finds the `.exe`; `providers.antigravity.command` overrides. | observed |
| — | Exit codes | Turn errors (denials, tool failures) keep exit 0 (changelog: "headless exit codes reflect only cascade-level failures"); stdin-shape errors exit 1 after a `result` with `status: "ERROR"` and `error`; flag errors exit 2 with the Go usage text. | observed |

## Setup

```powershell
& "$env:LOCALAPPDATA\agy\bin\agy.exe" --version        # 1.2.7 (exit 0)
& "$env:LOCALAPPDATA\agy\bin\agy.exe" models           # Fetching available models... gemini-3.8-flash-high … claude-opus-4-6-thinking … gpt-oss-120b-medium
& "$env:LOCALAPPDATA\agy\bin\agy.exe" mcp list         # No MCP servers configured.
```

Scratch repo: `C:\Projects\Claude\crt-agy-spike-repo` (git-initialised, `AGENTS.md`, `index.js`; **not** in `trustedWorkspaces`). Listener: `node probe/listener.mjs 47124 out/listener.log`. Plugin: `node probe/plugin.mjs` writes `<repo>/.crt/agy/.agents/plugins/crt/` (see the file for the hook scripts). Runs: `node probe/run.mjs <name> -- <agy args>` (one shot) and `node probe/loop.mjs <name> [--kill-after ms] -- <agy args> -- <ndjson line>…` (the turn loop; writes `out/<name>.{jsonl,stderr.txt,times.txt,meta.json}`); `node probe/summarize.mjs out/<name>.jsonl` collapses deltas. `node probe/fixtures.mjs` copies the runs listed in it into the test fixtures with headers.

## 1. Print mode and the stream-json shapes

```
> agy.exe --print --output-format stream-json "Reply with exactly the three words: hello from agy"
Error: --print took "--output-format" as its prompt, so the intended prompt was left as an argument and ignored.
Attach the prompt to the flag (--print='your prompt') and move --output-format elsewhere on the command line.
< exit code=2
```

Text mode (`--print "…"`) printed `hello from agy`, exit 0 after 11 s. stream-json out, one shot (`--output-format stream-json --print "…"`):

```
{"event":"init","conversation_id":"cf36dd87-7481-4f37-ab4f-6b84a61d3fca","init":{"cwd":"C:\\Projects\\Claude\\crt-agy-spike-repo","tools":["ask_custom_permission","ask_permission","ask_question","browser_click_element",…,"call_mcp_tool",…,"run_command",…,"view_file","wait","wait_5_seconds","write_to_file"],"permission_mode":"request-review"}}
{"event":"step_update","step_update":{"conversation_id":"cf36dd87-…","step_index":0,"state":"DONE","step_type":"user_input"}}
{"event":"step_update","step_update":{"conversation_id":"cf36dd87-…","step_index":1,"state":"ACTIVE","step_type":"agent_response","text_delta":"hello from agy"}}
{"event":"step_update","step_update":{"conversation_id":"cf36dd87-…","step_index":1,"state":"DONE","step_type":"agent_response","text_delta":"\n","duration_seconds":3.0739656,"usage":{"input_tokens":11743,"output_tokens":88,"thinking_tokens":84,"cache_read_tokens":0,"total_tokens":11831}}}
{"event":"result","result":{"conversation_id":"cf36dd87-…","status":"SUCCESS","response":"hello from agy\n","duration_seconds":3.1408475,"num_turns":1,"usage":{…}}}
< exit code=0 after 10811ms
```

The input loop (`--input-format stream-json --print ""`), probing the message shape:

```
stdin: {"bogus":true}                       → stderr: error: stream input message is missing the "event" field
                                              stdout: {"event":"result","result":{…,"status":"ERROR","response":"","error":"stream input message is missing the \"event\" field",…}}   exit 1
stdin: {"event":"bogus"}                    → stderr: warning: ignoring unsupported stream input message event "bogus"   (waits for the next line; exit 0 at stdin end)
stdin: {"event":"user","content":"…"}       → error: stream input "user" message is missing the "message" field   exit 1
stdin: {"event":"user","message":{"role":"user","content":"Reply with exactly the three words: hello from stdin"}}   → the turn runs; exit 0 at stdin end
```

Two turns in one process (`fixtures/antigravity/loop.jsonl`): step indexes 0–1 then 2–3, the same `conversation_id`, `num_turns` 1 then 2; the second message used the `[{"type":"text",…}]` block form. The binary's stream-input code (`printmode.streamInputUserMessage`, `streamInputContentBlock`) accepts `text` blocks only.

## 2. The plugin under `--add-dir`, the MCP server and permissions

`node probe/plugin.mjs` writes:

```
<repo>/.crt/agy/.agents/plugins/crt/plugin.json        { "name": "crt" }
<repo>/.crt/agy/.agents/plugins/crt/mcp_config.json    { "mcpServers": { "crt": { "command": "<node>", "args": ["<mcp-probe.mjs>"], "env": { "PROBE_LOG": "…", "PROBE_PORT": "47124" } } } }
<repo>/.crt/agy/.agents/plugins/crt/hooks.json         { "crt-permissions": { "PreToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "<abs>\\hook.cmd", "timeout": 10 }] }], "PreInvocation": [{ "type": "command", "command": "<abs>\\preinvoke.cmd", "timeout": 10 }] } }
<repo>/.crt/agy/.agents/plugins/crt/hook.cmd           @"<node>" "%~dp0hook.mjs"
<repo>/.crt/agy/.agents/plugins/crt/hook.mjs           the allowlist (read-only tools + call_mcp_tool on crt_crt → allow; else deny)
```

First run — headless, no permission flag (`fixtures/antigravity/mcp-denied-headless.jsonl`; `CRT_MCP_TOKEN=tok-123` set on the `agy` process):

```
agy.exe --output-format stream-json --input-format stream-json --print "" --add-dir C:\Projects\Claude\crt-agy-spike-repo\.crt\agy
stdin: {"event":"user","message":{"role":"user","content":"Call the crt_ping MCP tool once with message \"turn one\" and report its result verbatim, in one line."}}

{"event":"step_update","step_update":{…,"step_index":2,"state":"ACTIVE","step_type":"tool","tool_name":"view_file","tool_info":{"name":"view_file","parameters":{"AbsolutePath":"C:\\Users\\Simon VanderHeyden\\.gemini\\antigravity-cli\\mcp\\crt_crt\\crt_ping.json"}}}}
{"event":"step_update","step_update":{…,"step_index":4,"state":"ACTIVE","step_type":"tool","tool_name":"call_mcp_tool","tool_info":{"name":"call_mcp_tool","parameters":{"Arguments":{"message":"turn one"},"ServerName":"crt_crt","ToolName":"crt_ping"}}}}
[stderr] jetski: no output produced — a tool required the "mcp" permission that headless mode cannot prompt for, so it was auto-denied. Add an allow-rule under permissions.allow in settings.json (e.g. mcp(<target>)). Alternatively, re-run with --dangerously-skip-permissions to auto-approve all tools.
{"event":"step_update","step_update":{…,"step_index":4,"state":"ERROR","step_type":"tool","tool_name":"call_mcp_tool","tool_info":{…,"error":{"type":"TOOL_ERROR","message":"permission check failed for mcp \"crt_crt/crt_ping\": user denied permission for mcp(crt_crt/crt_ping)\nDo not attempt to circumvent this denial …"}}}}
{"event":"result","result":{…,"status":"SUCCESS","response":"",…,"denied_actions":[{"action":"mcp","display_name":"CallMcpTool"}]}}
< exit code=0
```

The probe log for the same run shows the server was spawned before the turn with cwd = the plugin directory and 93 environment keys including `CRT_MCP_TOKEN=tok-123` (inherited — it is in no file and on no command line):

```
{"kind":"spawned","data":{"argv":["C:\\Program Files\\nodejs\\node.exe","…\\mcp-probe.mjs"],"cwd":"C:\\Projects\\Claude\\crt-agy-spike-repo\\.crt\\agy\\.agents\\plugins\\crt",…}}
{"kind":"in","data":{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/clientCapabilities":{"elicitation":{"form":{},"url":{}},"roots":{"listChanged":true}},"io.modelcontextprotocol/clientInfo":{"name":"antigravity-client","version":"v1.0.0"},"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}}
{"kind":"out","data":{"jsonrpc":"2.0","id":1,"error":{"code":-32601,"message":"unknown method server/discover"}}}
{"kind":"in","data":{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"clientInfo":{"name":"antigravity-client","version":"v1.0.0"},"protocolVersion":"2025-11-25","capabilities":{"elicitation":{"form":{},"url":{}},"roots":{"listChanged":true}}}}}
{"kind":"in","data":{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}}
{"kind":"in","data":{"jsonrpc":"2.0","id":3,"method":"tools/list","params":{}}}
{"kind":"spawn-ping","data":{"ok":true,"status":200,"text":"pong #1"}}
```

Ways to grant the permission that were tried and **failed**: `PreToolUse` hook answering `{"decision":"allow"}` (the permission check still denied); the same with `"permissionOverrides":["mcp(crt_crt/crt_ping)"]` (same); `permissions.allow: ["mcp(crt_crt/crt_ping)"]` in `~/.gemini/antigravity-cli/settings.json` **did** allow the MCP call but the same headless run then denied `view_file` on the workspace's own `AGENTS.md` (`user denied permission for read_file(C:\Projects\Claude\crt-agy-spike-repo\AGENTS.md)`; `denied_actions: [{"action":"read_file"}]`), with the repo added to `trustedWorkspaces` and again with `--sandbox` — so an intake in plain headless mode needs `read_file(*)` plus the MCP rule in the user's settings, per machine. (Simon's `settings.json` was restored to its original content afterwards.) `--mode plan --dangerously-skip-permissions`: `permission_mode: "always-proceed"`, the model read files outside the workspace, ran `git` commands and wrote `probe-wrote.txt` — plan mode does not restrict anything in print mode.

What works (`fixtures/antigravity/first-turn.jsonl`): `--dangerously-skip-permissions` **and** the `PreToolUse` allowlist hook:

```
agy.exe --output-format stream-json --input-format stream-json --print "" --dangerously-skip-permissions --add-dir C:\Projects\Claude\crt-agy-spike-repo\.crt\agy
stdin: {"event":"user","message":{"role":"user","content":"Do these three things in order, each at most once, and then report each outcome in one line each: (1) call the crt_ping MCP tool with message \"turn one\"; (2) run the PowerShell command `Get-Date`; (3) write a file named probe-wrote2.txt containing the word hello in the workspace root. If a step is denied, say so and move on."}}

init conversation=85a317c0-5ddc-432a-a1e1-2c9be63cdc37 tools=57 permission_mode=always-proceed
2 ACTIVE tool view_file      params={"AbsolutePath":"C:\\Users\\Simon VanderHeyden\\.gemini\\antigravity-cli\\mcp\\crt_crt\\crt_ping.json"}
2 DONE   tool view_file      output=1 lines, 262 bytes
4 ACTIVE tool call_mcp_tool  params={"Arguments":{"message":"turn one"},"ServerName":"crt_crt","ToolName":"crt_ping"}
4 DONE   tool call_mcp_tool  output=listener replied 200: pong #9
6 ACTIVE tool run_command    params={"CommandLine":"Get-Date"}
6 ERROR  tool run_command    error={"type":"TOOL_ERROR","message":"tool call denied by pre-tool hook: CRT intake session: run_command is not allowed here; only reading files and the crt MCP server are."}
8 ACTIVE tool write_to_file  params={"TargetFile":"C:\\Projects\\Claude\\crt-agy-spike-repo\\.crt\\agy\\probe-wrote2.txt"}
8 ERROR  tool write_to_file  error={…"tool call denied by pre-tool hook: CRT intake session: write_to_file is not allowed here; …"}
9 TEXT 1. crt_ping: listener replied 200: pong #9 / 2. Get-Date: Denied (run_command is not allowed by pre-tool hook). / 3. probe-wrote2.txt: Denied (write_to_file is not allowed by pre-tool hook).
RESULT status=SUCCESS num_turns=1 usage={"input_tokens":69182,"output_tokens":1842,"thinking_tokens":1486,"cache_read_tokens":0,"total_tokens":71024}
< exit code=0 after 26160ms
```

Nothing was written to the repo. A hook whose command cannot start is a tool error, not a pass-through (from the earlier attempts: `JSON hook "jsonhook__crt-permissions_PreToolUse_0_0" failed: command failed: exit status 1, stderr: 'hook.cmd' is not recognized as an internal or external command`).

**Hook timing** (`out/t17-order.times.txt` against the hook log): `init` 04.265 → `user_input` DONE 04.449 → PreInvocation hook 04.516 → `agent_response` DONE + `tool` ACTIVE 06.700 → PreToolUse hook 06.762 → `tool` ERROR 06.776. The PreInvocation marker therefore exists ≈2 s before the first tool of a turn could run; the driver checks it when the first non-`user_input` step of every turn arrives and kills the process if it is missing.

## 3. Resume, unknown ids, kill

```
agy.exe … --conversation 709fcf79-97fe-4cdd-ab64-1debfaf5a32e      (the loop.jsonl conversation)
{"event":"init","conversation_id":"709fcf79-97fe-4cdd-ab64-1debfaf5a32e",…}        ← same id
{"event":"step_update","step_update":{…,"step_index":4,"state":"DONE","step_type":"user_input"}}
{"event":"step_update","step_update":{…,"step_index":5,"state":"DONE","step_type":"system_message","duration_seconds":0}}
{"event":"step_update","step_update":{…,"step_index":6,"state":"ACTIVE","step_type":"agent_response","text_delta":"Teal"}}
…
agy.exe … --conversation 00000000-0000-4000-8000-000000000000
[stderr] warning: conversation "00000000-0000-4000-8000-000000000000" not found
{"event":"init","conversation_id":"6df6342c-b2eb-4740-a447-bc7e5c6d4f81",…}        ← NEW id, silently (exit 0)
agy.exe … --conversation not-a-conversation
[stderr] warning: conversation "not-a-conversation" not found
{"event":"init","conversation_id":"5d8e9e81-df4f-4a14-a456-27da50dbd239",…}        ← NEW id
```

`probe/loop.mjs t12-killed --kill-after 9000 -- … --model gemini-3.8-flash-high …` (`fixtures/antigravity/killed.jsonl`):

```
{"event":"init","conversation_id":"2e4133c8-449b-4de2-982b-a6d6252ed327","init":{"model":"gemini-3.8-flash-high","cwd":…}}
{"event":"step_update","step_update":{…,"step_index":0,"state":"DONE","step_type":"user_input"}}
[kill:after 9000ms] taskkill /T /F /PID 25672 → exit 0
SUCCESS: The process with PID 4900 (child process of PID 25672) has been terminated.
SUCCESS: The process with PID 15276 (child process of PID 25672) has been terminated.
SUCCESS: The process with PID 25672 (child process of PID 30436) has been terminated.
< exit code=1 signal=null after 9211ms
```

Resume of that conversation (`resume.jsonl`): `init` with `2e4133c8-…`, `user_input`, `system_message`, then `Otter` — the killed turn's user message ("My favourite animal is the otter…") had been persisted. `--effort low` with that model id: `error: invalid model selection (--model "gemini-3.8-flash-high" --effort "low"): --model gemini-3.8-flash-high conflicts with --effort=low`, `result` ERROR, exit 1.

## 4. Images, environment, login, telemetry

**Images.** An `image` content block ends the process (`fixtures/antigravity/input-error-image-block.jsonl`). A path in the text works (`image-by-path.jsonl`): `view_file` on `probe/red.png` (the Codex spike's 8×8 PNG), then `Red`; a `run_command` with Python/PIL the model also tried was refused by the hook.

**Environment in model-run commands** (from the `--mode plan --dangerously-skip-permissions` run, `Get-ChildItem Env: | Where-Object Name -match "AGY|ANTIGRAV|GEMINI|JETSKI|CASCADE|GOOGLE"`):

```
ANTIGRAVITY_AGENT           1
ANTIGRAVITY_AGENTAPI_EXE    C:\Users\Simon VanderHeyden\AppData\Local\agy\bin\agy.exe
ANTIGRAVITY_APP_DATA_DIR    C:/Users/Simon VanderHeyden/.gemini/antigravity-cli
ANTIGRAVITY_CONVERSATION_ID d6174bf7-ee9e-4b8b-a96b-d1576482598a
ANTIGRAVITY_CSRF_TOKEN      …
ANTIGRAVITY_LS_ADDRESS      localhost:60906
ANTIGRAVITY_LS_VERSION      cli-1.2.7
ANTIGRAVITY_PROJECT_ID      default-cli-project
ANTIGRAVITY_SOURCE_METADATA {"tool":{"conversationId":"…","stepIndex":48,…
ANTIGRAVITY_TRAJECTORY_ID   af6fb7a5-27e7-480c-8e2b-d92752a18e69
```

**Login.** `cli.log` of a normal run: `keyringAuth: loaded token, expiry=… expired=false` / `ChainedAuth: authenticated via keyring (effective: keyring)`. With `USERPROFILE`/`HOME` → an empty directory the run still succeeded (the keyring is per Windows user, not per home) while the sidecar logged `You are not logged into Antigravity` until the keyring answered. `agy --output-format json --print /usage` → `{"conversation_id":"","status":"SUCCESS","response":"Gemini Models\tWeekly Limit Remaining\t99%…","command":{"name":"usage","data":{…"groups":[…]}}}` in 6.7 s, no agent turn. Binary strings for the logged-out case: `Print mode: not logged in and no controlling terminal; cannot complete interactive login`, `Print mode: auth error: %v`, `Print mode: auth timed out`, `You are not logged into Antigravity`.

**Telemetry.** `agy --disable_telemetry …` → `flags provided but not defined: -disable_telemetry`, exit 2. `/config` (`--output-format json --print /config`) lists `enableTelemetry` among the settings keys (docs) and shows `toolPermission: request-review`, `enableTerminalSandbox: false`, `permissions: null`, `trustedWorkspaces: […]`.

**`agy mcp add`.** `agy mcp add crt-spike-probe node C:\nonexistent\probe.mjs` → `Added MCP server "crt-spike-probe" (stdio)`, `~/.gemini/config/mcp_config.json` = `{"mcpServers":{"crt-spike-probe":{"args":["C:\\nonexistent\\probe.mjs"],"command":"node","disabled":false}}}`; `agy mcp remove` → `{"mcpServers": {}}`; the file (empty before) was restored.

## Consequences for the driver (PRD-providers F-111)

1. **One process per session** (the first-party loop), spawned as `agy --output-format stream-json --input-format stream-json --print "" --dangerously-skip-permissions --add-dir <sessionDir> [--model <id>] [--conversation <id>]` with `cwd: projectRoot` and `CRT_MCP_TOKEN`/`CRT_MCP_PORT` in its environment; each developer message is one `{"event":"user","message":{"role":"user","content":"<text>"}}` line on stdin; the turn ends at `result`.
2. **`<sessionDir>` = `.crt/captures/antigravity/<crt session id>/`**, written before the spawn and removed on close: `.agents/plugins/crt/plugin.json`, `mcp_config.json` (`crt` → `<node> <cli.js> mcp`, empty `env`), `hooks.json` (PreToolUse `*` → `hook.cmd`/`hook.sh`; PreInvocation → `preinvoke.cmd`/`.sh`), `hook.mjs` (the allowlist), `preinvoke.mjs` (writes `hooks.loaded`). Nothing outside `.crt/` is touched (N-19); `agy mcp add` is not used.
3. **`permissions: "sandboxed"`**, the sandbox being the hook: reads and `crt_crt/*` pass, everything else is refused with a one-line reason the model sees; a hook failure is a tool error (fail closed); the missing-marker check kills a process whose hooks did not load and ends the session with an N-7 line.
4. **Events:** `init.conversation_id` → `init` (turn 1) / resume assertion (later processes); `agent_response` `text_delta` → streamed text (`streaming: true`); `tool` ACTIVE → `tool_use` (`call_mcp_tool` on `crt_crt/write_task` → `Write task: <title>`, `mcp__crt__write_task`), DONE/ERROR → `tool_result` (`tool_info.output` / `error.message`); `result` → `result` (`ok` = `status === "SUCCESS"`, usage in `detail`, `denied_actions` appended); `system_message`/`user_input` ignored. stderr `error:` lines and `AGY_ERROR:` → `error` events; the not-logged-in strings → the N-7 line.
5. **Resume/interrupt:** interrupt kills the tree (result `interrupted`, idle); the next message spawns a new process with `--conversation <id>` and the driver fails the session if the new `init` id differs (`Antigravity could not resume conversation <id> — start a new session`). `resumeCommand: agy --conversation <id>`. Close kills the tree.
6. `images: "path"` (paths are in the message text; the model reads them with `view_file`), `instructions: "first-message"`, `launchEnv: ["ANTIGRAVITY_CONVERSATION_ID", "ANTIGRAVITY_AGENT"]`, `telemetryOptOut: []`, skills `.agents/skills` (project) / `~/.gemini/config/skills` (user), markers `.agents/` (private), `AGENTS.md` + `GEMINI.md` (shared), preflight `--version` ≥ 1.2.7, `loggedIn: "unknown"`, no `--effort`.
7. **Turn 1 latency** is the 5–6 s startup plus the model; N-13 applies. The `.cmd` hook wrapper and the absolute hook path are Windows facts the fake `agy` enforces (it runs the hooks through `cmd /c` / `sh -c` exactly as recorded).
