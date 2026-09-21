# Spike: Gemini CLI over the Agent Client Protocol (M10, CRT-0013)

**Tested version: Gemini CLI `0.60.0`** (`npm i -g @google/gemini-cli`, 2026-09-21), Windows 11 Pro 10.0.22000, Node 24.18.0, `~/.gemini/settings.json` with `security.auth.selectedType: "oauth-personal"` (Simon's "Log in with Google" from the same morning).

This document records what PRD-providers F-54 *assumed* against what the installed CLI *does*, the way `codex-2026-09.md` did for M6. Everything below was run on Simon's machine by the CRT-0013 worker session; verbatim output is quoted. Scripts: [`gemini-acp-2026-09/probe/`](gemini-acp-2026-09/probe/) (`acp-probe.mjs` is a throwaway ACP client, `mcp-probe.mjs` a stand-in `crt mcp` with the real `write_task` schema, `driver-run.mjs` drives the real `providers/acp.ts` from `dist/`). Recordings: [`packages/server/test/providers/fixtures/acp/`](../../packages/server/test/providers/fixtures/acp/) (`test/providers/acp.test.ts` replays them). Bundle facts were read from `node_modules/@google/gemini-cli/bundle/*.js` (marked *strings*).

**The one blocker:** 0.60.0 refuses the free personal tier of the Google login (below, §2). Nothing that needs a model turn — `session/prompt`, the `session/update` stream, a real `session/request_permission`, `write_task` through `crt mcp`, resume, the Manual DoD row — could be recorded without a Gemini API key. Those rows are covered by the fake agent (`e2e/fixture/fake-acp.mjs`), written from the ACP schema Gemini bundles and the bundle's own ACP code, and stay to be confirmed live once a key is configured.

## Verdicts at a glance

| # | Question (task Ask / F-54) | Verdict | Status |
|---|---|---|---|
| — | ACP flag | `--acp`. `--experimental-acp` (the name F-54 quotes) still starts ACP mode but is listed as *deprecated, use --acp instead* in `gemini --help`. | observed |
| — | `gemini --version` | `0.60.0` (bare number), exit 0. | observed |
| 1 | `initialize` reply | `{ protocolVersion: 1, authMethods: [oauth-personal, gemini-api-key, vertex-ai, gateway], agentInfo: { name: "gemini-cli", title: "Gemini CLI", version: "0.60.0" }, agentCapabilities: { loadSession: true, promptCapabilities: { image: true, audio: true, embeddedContext: true }, mcpCapabilities: { http: true, sse: true } } }`. ~6 s cold. | observed |
| 1 | Protocol-version mismatch | Asked for `protocolVersion: 999`, the agent **still answers `1`** (it echoes its own constant). The N-7 check therefore compares the *reply* against `ACP_PROTOCOL_VERSIONS = [1]`. | observed |
| 1 | Where auth fails | **Not at `initialize`** — at `session/new`, as a JSON-RPC error `-32000`. Logged out (empty home): `Gemini API key is missing or not configured.` Personal Google login: `This client is no longer supported for Gemini Code Assist for individuals. To continue using Gemini, please migrate to the Antigravity suite of products: https://antigravity.google` (stderr: `IneligibleTierError`, `tierId: 'free-tier'`). | observed |
| 1 | `session/new` shape | Takes `{ cwd, mcpServers: [{ name, command, args, env: [{ name, value }] }] }` (stdio form) and merges each server into the CLI's own `mcpServers` config with `cwd` as the server's cwd; returns `{ sessionId: <UUID>, modes: { availableModes, currentModeId }, models: { availableModels, currentModelId } }`. `currentModelId` is what CRT shows as the model when the developer set none. | strings (`AcpSessionManager.newSession`); the error path observed |
| 1 | `session/update` variants | `agent_message_chunk`, `agent_thought_chunk`, `tool_call` (`toolCallId, title, kind, status, content, locations`), `tool_call_update` (status `completed` / `failed`, content), `plan`, `user_message_chunk`, `available_commands_update`, `current_mode_update` — the ACP schema the bundle carries; mapped as F-54 says. | strings |
| 1 | `session/request_permission` | `{ sessionId, toolCall: { toolCallId, title, kind, status: "pending", content, locations }, options }` with options `proceed_once` (`allow_once`, "Allow"), `cancel` (`reject_once`, "Reject") and, unless `disableAlwaysAllow`, `proceed_always` (`allow_always`, "Allow for this session"; edits and shell commands). `cancelled` → the tool call fails with `Tool "<name>" was canceled by the user.`; a rejected option → `…rejected…`. CRT never picks `proceed_always`. | strings (`toPermissionOptions`, `basicPermissionOptions`) |
| 1 | Tool kinds | `read, edit, execute, search, delete, move, think, fetch, switch_mode, other` (`agent` → `think`; `plan`, `communicate` → `other`). `switch_mode` is not in F-54's table → CRT asks. | strings (`toAcpToolKind`) |
| 1 | `session/cancel` | `session.cancelPendingPrompt()`; the pending `session/prompt` resolves with `stopReason: "cancelled"`. | strings |
| 1 | Close | End stdin → the process exits on its own in ~1 s (`agent exited on stdin end after 1062 ms`), well inside F-54's 2 s grace. | observed |
| 2 | Images | `promptCapabilities.image: true` → `images: inline` (base64 `{ type: "image", mimeType, data }` blocks). | observed |
| 2 | Resume | `gemini --resume <arg>` accepts `latest`, a 1-based index **or a full session UUID** (`SessionSelector.findSession`); sessions are stored per project under `~/.gemini/tmp/<project>/chats`, so the command must run from the same project directory. `resumeCommand = gemini --resume <sessionId>`, `resume: true` — to be confirmed live. `session/load` exists (`loadSession: true`) and is not used (§12). | strings |
| 2 | `launchEnv` | Shell commands Gemini runs get `GEMINI_CLI=1` (`GEMINI_CLI_IDENTIFICATION_ENV_VAR`). `launchEnv: ["GEMINI_CLI"]`. | strings |
| 2 | Login preflight | There is no status command. The CLI reads `GEMINI_API_KEY` / `GOOGLE_API_KEY` from the environment and `~/.gemini/.env`, and the Google login from `~/.gemini/oauth_creds.json`; `GEMINI_CLI_HOME` overrides the home. CRT: key → `true`; `oauth_creds.json` → `"unknown"` (the tier check happens at `session/new`); nothing → `false`. | observed (files) / strings (`GEMINI_CLI_HOME`) |
| 2 | Skills directory (F-58) | Project: `.gemini/skills` (`getProjectSkillsDir`) and `.agents/skills` (`getProjectAgentSkillsDir`); user: `~/.gemini/skills` and `~/.agents/skills`. CRT writes `.gemini/skills` / `~/.gemini/skills`. | strings |
| 2 | Telemetry (N-12) | No per-invocation flag in 0.60.0 (`gemini --help` lists none); `usageStatisticsEnabled` in settings applies. `telemetryOptOut: []`. | observed (`--help`) |
| — | Untrusted folder | stderr on every start from a folder not in `~/.gemini/trustedFolders.json`: `Skipping project agents due to untrusted folder…`, `Project hooks disabled because the folder is not trusted.` — informational; `initialize` and `session/new` are unaffected. `Ripgrep is not available. Falling back to GrepTool.` likewise. | observed |
| — | Executable resolution (N-10) | npm installs `gemini`, `gemini.cmd`, `gemini.ps1` shims in `%APPDATA%\npm`; `gemini.cmd` runs `node "%dp0%\node_modules\@google\gemini-cli\bundle\gemini.js"`. `exec.ts` resolves it `via: shim` and runs that entry with CRT's Node. | observed |

## 1. `initialize` (`probe/out/init.log`, fixture `initialize.jsonl`)

```
[    11ms] resolved gemini via shim: C:\Users\…\AppData\Roaming\npm\gemini.cmd
[    13ms] spawn: C:\Program Files\nodejs\node.exe …\@google\gemini-cli\bundle\gemini.js --acp  (cwd c:\Projects\Claude\crt-gemini-spike-repo)
[    31ms] → {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{"fs":{"readTextFile":false,"writeTextFile":false},"terminal":false},"clientInfo":{"name":"crt-probe","version":"0.0.0"}}}
[  6234ms] ← {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"authMethods":[{"id":"oauth-personal","name":"Log in with Google",…},{"id":"gemini-api-key","name":"Gemini API key",…,"_meta":{"api-key":{"provider":"google"}}},{"id":"vertex-ai",…},{"id":"gateway",…}],"agentInfo":{"name":"gemini-cli","title":"Gemini CLI","version":"0.60.0"},"agentCapabilities":{"loadSession":true,"promptCapabilities":{"image":true,"audio":true,"embeddedContext":true},"mcpCapabilities":{"http":true,"sse":true}}}}
[  6235ms] closing: end stdin, wait 2 s, kill
[  6242ms] stderr: Error authenticating: IneligibleTierError: This client is no longer supported for Gemini Code Assist for individuals. To continue using Gemini, please migrate to the Antigravity suite of products: https://antigravity.google
[  7297ms] agent exited code=0 signal=null
[  7297ms] agent exited on stdin end after 1062 ms
```

The `IneligibleTierError` on stderr appears during `initialize` (the CLI tries the cached login eagerly) but the request itself succeeds; the failure only becomes a JSON-RPC error at `session/new`.

## 2. `session/new` — logged out and tier-refused (fixtures `session-new-logged-out.jsonl`, `session-new-tier-refused.jsonl`)

Empty home (`HOME`/`USERPROFILE`/`APPDATA`/`LOCALAPPDATA` pointed at an empty directory, no `GEMINI_API_KEY`):

```
[  2560ms] → {"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"C:\\Projects\\Claude\\crt-gemini-spike-repo","mcpServers":[{"name":"crt","command":"C:\\Program Files\\nodejs\\node.exe","args":["…\\probe\\mcp-probe.mjs"],"env":[{"name":"PROBE_LOG","value":"…"},{"name":"CRT_MCP_TOKEN","value":"…"},{"name":"CRT_MCP_PORT","value":"4400"}]}]}}
[  2783ms] ← {"jsonrpc":"2.0","id":2,"error":{"code":-32000,"message":"Gemini API key is missing or not configured."}}
```

Simon's home (Google login cached, `selectedType: oauth-personal`):

```
[  7548ms] ← {"jsonrpc":"2.0","id":2,"error":{"code":-32000,"message":"This client is no longer supported for Gemini Code Assist for individuals. To continue using Gemini, please migrate to the Antigravity suite of products: https://antigravity.google"}}
```

stderr alongside: `Authentication failed: IneligibleTierError: …` and an `Error handling request { … method: 'session/new' … } { code: -32000, message: '…', data: undefined }` dump. The MCP probe was **not** spawned in either case (no `spawned` line in `*.mcp.log`): the CLI authenticates before it starts MCP servers.

`AcpSessionManager.newSession` (bundle): `authType = settings.security.auth.selectedType || (baseUrl ? "gateway" : "gemini-api-key")`; `config.refreshAuth(authType, …)`; for `gemini-api-key` with no key → `"Gemini API key is missing or not configured."`; any thrown error → its message; then `throw new RequestError(-32000, authErrorMessage || "Authentication required.")`. So the three strings CRT maps (`geminiLoginProblem`) are the complete set for this version. ACP also has an `authenticate { methodId, _meta: { "api-key": … } }` request that would let a client hand over a key; CRT does not use it (the key stays in Gemini's own files, never in CRT).

## 3. The real driver against the real CLI (`probe/driver-run.mjs`)

`providers/acp.ts` from `dist/`, with `mcp-probe.mjs` as the MCP server:

```
[     0ms] {"type":"user","text":"Reply with the single word pong.","images":[]}
[  7442ms] {"type":"error","message":"Gemini refused the Google login for this CLI (\"no longer supported for Gemini Code Assist for individuals\") — use a Gemini API key: put GEMINI_API_KEY=… in ~/.gemini/.env and set security.auth.selectedType to gemini-api-key in ~/.gemini/settings.json"}
[  7442ms] {"type":"state","state":"error","detail":"Gemini refused the Google login for this CLI (…)"}
```

The N-7 line the panel shows for this machine's state. Once a key is in place the same script is the live check for `session/prompt`, the update stream, a real permission card and `write_task` (`out/driver-run.mcp.log` records the MCP side).

## 4. What the fake agent asserts on the driver's behalf

`e2e/fixture/fake-acp.mjs` implements the protocol as the bundle's `GeminiAgent` / `Session` do it (§1–2 above plus the `strings` rows of the table): `initialize` → `session/new` spawns the `crt` stdio server from `mcpServers` with the given `env` and lists its tools before answering with a UUID, `modes` and `models`; `session/prompt` streams `agent_message_chunk`s, emits a `read` `tool_call` + `tool_call_update`, then a `session/request_permission` for an `execute` tool with Gemini's three options (the fake refuses `proceed_always`), calls `write_task` through the MCP server on a "write" prompt, and honours `session/cancel` with `stopReason: "cancelled"`; it exits on stdin end. Image blocks must carry base64 data; the first block must be text. `test/providers/acp.test.ts` runs the F-59 conformance scenario against it for the `gemini` profile and for an ad-hoc `{ kind: "acp" }` profile; `e2e/chat.spec.ts` "ad-hoc ACP agent" is the `acp` axis.

## Setup

```powershell
npm i -g @google/gemini-cli     # 0.60.0
gemini --version                # 0.60.0
node docs/spikes/gemini-acp-2026-09/probe/acp-probe.mjs init      # initialize only
node docs/spikes/gemini-acp-2026-09/probe/acp-probe.mjs noauth    # empty home → "API key is missing"
node docs/spikes/gemini-acp-2026-09/probe/acp-probe.mjs prompt "Reply with the single word pong."   # full turn (needs a working credential)
node docs/spikes/gemini-acp-2026-09/probe/acp-probe.mjs cancel "…"    # prompt, session/cancel after 1.5 s, second prompt
node docs/spikes/gemini-acp-2026-09/probe/driver-run.mjs              # the real driver from dist/
```

Scratch repo: `C:\Projects\Claude\crt-gemini-spike-repo` (`git init`, `AGENTS.md`, `index.js`) — outside `%TEMP%`, per the Codex spike's short-path lesson. Outputs land in `probe/out/` (`*.jsonl` both directions, `*.log` readable, `*.mcp.log` the MCP probe's view).
