# CRT v0.2 — Provider-agnostic intake sessions — PRD

| | |
|---|---|
| **Status** | v0.2.0 — approved for build (adversarially reviewed 2026-09-15, findings incorporated) |
| **Owner** | Simon (simv) |
| **Repo** | https://github.com/simv/crt |
| **Baseline** | tag `stable-pre-providers` (c4e37b3) = v0.1.0 + CRT-0007, CRT-0008 |
| **Amends** | `docs/PRD.md` v1.0 — every amended statement is listed in §9 |

This document extends `docs/PRD.md`. Everything in the v1.0 PRD stays in force unless §9 amends it. Requirement IDs continue the v1.0 numbering (F-42…F-64, N-7…N-13). A build session reads `docs/PRD.md`, this file, `CLAUDE.md`, and its task file, and nothing else, to know what "correct" means. §12 tells the builder what to do when the real tools differ from what this document assumes.

---

## 1. Problem and scope

CRT v0.1 hard-wires the intake conversation to Claude Code through the Agent SDK. The proxy, overlay, capture bundle and task-file format are already agent-neutral: a task file is Markdown any coding agent can read, and a capture is JSON plus PNGs on disk. One module (`session.ts`) knows what a "session" is.

Developers do not all use Claude Code. A project whose maintainer works with OpenAI Codex (the coding agent behind a ChatGPT account), Gemini CLI, or another agent gets nothing from CRT today, and Simon wants to pick whichever agent does the best intake on a given project.

**What v0.2 delivers, in plain language.** The agent behind the in-page chat becomes a **provider**: detected from the machine and the project, overridable by the developer, defaulting to Claude Code. A task written through Codex has the same format as one written through Claude. The skills that read and work tasks (`/crt:next`, `/crt:tasks`, `/crt:task`, `/crt:done`, `/crt:intake`) ship in the portable Agent Skills format so they can be installed into Codex, Gemini and other agents that read `SKILL.md` files.

**What v0.2 does not deliver.** The no-questions worker (`/crt:next`) is tested and guaranteed only on Claude Code. Other agents receive the same skill text and can be asked to work a task, but CRT does not certify their behaviour. Provider parity for the worker is v0.3.

**Interpretation of the brief.** "If the project is using ChatGPT, detect this and open sessions with the appropriate chatbot" is read as: *the coding agent the developer already uses on this repository and this machine* (Codex CLI for ChatGPT accounts, Claude Code, Gemini CLI, …) is the one CRT opens intake sessions with. It does **not** mean detecting which LLM API the target web app calls at runtime. CRT never talks to a model API itself (v1.0 Non-goal 5 stands): it drives an installed, logged-in agent CLI, as it drives Claude Code today.

## 2. Goals

1. **Provider choice without a fork.** One `crt` binary, one overlay, one task format. The provider is a runtime choice: `--provider`, config, an in-page selector, or auto-detection.
2. **Claude Code stays the default and stays exactly as good.** With no configuration and no other agent usable on the machine, v0.2 behaves like v0.1: same sessions, same permission cards, same task files except for one `provider:` line and a provider suffix on the first Log bullet.
3. **Auto-detection is right or it is Claude, and it always says why.** CRT switches away from Claude only when another agent is installed and logged in *and* the project points at it more clearly than at Claude. Every decision is printed with its reason.
4. **Same task file from any provider.** Only `provider:` and `session:` differ. `/crt:next` on Claude Code works a task Codex wrote; a Codex session given the `next` skill (F-58) can be asked to work a task Claude wrote.
5. **Adding a provider is one module.** A driver file plus a profile, passing a shared conformance scenario, with no changes to the registry, routes, overlay or task store.
6. **An escape hatch for agents CRT has never heard of.** Any agent that speaks the Agent Client Protocol (ACP) can be configured by command line in the config file.

## 3. Non-goals (v0.2)

- **No model calls from CRT.** No API keys, no direct OpenAI/Google/Anthropic HTTP calls. Only installed agent CLIs that carry their own login.
- **No renaming.** The product stays "Claude Review Tool", npm `claude-review-tool`, bin `crt`, plugin `crt`. The interim display rule is F-64; the rename itself is Open question 1.
- **Not a multi-agent chat.** One provider per session. No fan-out, no comparison mode, no switching mid-session.
- **No certified worker on other agents.** See §1.
- **No provider-only features.** Nothing in the overlay or task format exists for one provider. Degradation UI (F-46) is driven by declared capabilities and applies to any provider with that capability profile.
- **No hosted or remote agents.** Everything runs on `127.0.0.1` against a local checkout.
- **No hardening of routes that v0.1 already exposes to page scripts** (`/__crt/sessions`, `/__crt/captures`). Open question 2 tracks it; v0.2 only ensures that its *new* routes cannot execute code or leak secrets (N-8).

## 4. Scenario changes

Same solo developer, same loop (v1.0 §4). Three new moments:

- **First `crt serve` on a project.** The status line ends with the provider and its reason: `… 3 tasks, provider: codex — AGENTS.md, no Claude markers; codex 0.5x logged in)`. If it picked Claude by default: `provider: claude (default)`. If the project pointed at an agent CRT cannot use: `provider: claude — project looks like codex (.codex/) but codex is not on PATH`.
- **Changing their mind at Send time.** **Send** is a split button: the main half reads **Send to Codex**; the caret opens the provider list for *this send*. The same list is reachable from the toolbar. A checkbox at the bottom, "Remember for this project on this machine", persists the choice.
- **A Codex-only collaborator.** They run `crt skills install --provider codex` once, then ask Codex to "run the crt next skill on CRT-0012". They get the same skill text Claude Code has, with no promise of the no-questions guarantee.

## 5. Architecture

```
overlay ── POST /__crt/sessions { captureId, quick, provider? } ──▶ SessionRegistry
                                                                       │ resolveProvider()  (F-43, F-44)
                                                                       ▼
                                          ┌──────────── ProviderProfile[] ─────────────┐
                                          │  claude    codex    gemini(acp)   acp   stub │
                                          │  detect · preflight · capabilities · start   │
                                          └──────────────────────────────────────────────┘
                                                                       │ SessionDriver (v1.0 contract, F-42)
                         ┌─────────────────────────────────────────────┼───────────────────────────────┐
                         ▼                                             ▼                               ▼
              Agent SDK query()                         spawn codex exec --json                ACP JSON-RPC over stdio
              in-process write_task MCP                 (one process per turn, exec resume)    (gemini --experimental-acp,
                         │                                             │                        any configured command)
                         │                                 stdio MCP server  ◀────────────────────────────┘
                         │                                 `node <cli.js> mcp`  (spawned by the agent, F-49)
                         │                                             │ POST /__crt/internal/write-task
                         │                                             │ Authorization: Bearer <session token>
                         └───────────────── writeTask() ───────────────┘
                                             tasks.ts createTask → .crt/tasks/CRT-NNNN-*.md + assets + index
```

### 5.1 What changes where

| Area | v0.1 | v0.2 |
|---|---|---|
| `packages/server/src/session.ts` | the Claude driver | moves to `providers/claude.ts`; `session.ts` becomes the registry of profiles plus `resolveProvider`/`listProviders` (F-42–F-44) |
| `session-events.ts` | driver contract | `SessionDriver`/`SessionStarter` unchanged; `init` event reshaped (F-47); `UserImage` gains `path` (F-50) |
| `sessions.ts` | registry + routes | `POST /__crt/sessions` accepts `provider`; `SessionInfo` gains `provider`, `nativeSessionId`; mints the per-session MCP token and the `/__crt/internal/write-task` route (F-49) |
| new `providers/` | — | `types.ts`, `claude.ts`, `codex.ts`, `acp.ts`, `stub.ts`, `detect.ts`, `exec.ts` (PATH/PATHEXT resolution, npm-shim parsing, process-tree kill) |
| new `mcp-stdio.ts` | — | the `crt mcp` subcommand: a one-tool stdio MCP server that forwards `write_task` to the running server (F-49) |
| `tasks.ts` | `session:` | `provider:` frontmatter after `session:`; validator tolerant of unknown keys (F-48) |
| `init.ts` | `tasksDir`, `target`, `port` | `provider`, `models`, `providers.<id>.command`; `.crt/config.local.json` (gitignored) layered over `.crt/config.json` (F-43) |
| `cli.ts` | — | `crt serve --provider <id> [--model <m>]`, `crt providers [--json] [--refresh]`, `crt mcp`, `crt skills install` |
| overlay `ui.ts`, `chat.ts` | "Send to Claude", `claude --resume`, "Claude Code <version>" | display name and resume command from the session's own `init` event; split Send button; provider menu; capability-driven UI (F-56) |
| `plugin/skills/intake/SKILL.md` | Claude-flavoured wording | provider-neutral wording, quick-note sentinel preserved verbatim (F-55) |
| `.claude/hooks/guard.mjs`, `.claude/agents/prd-reviewer.md`, `CLAUDE.md`, tests asserting `claude --resume` | Claude-specific | updated in the same PR as the module move (F-63) |

### 5.2 Why drive CLIs, not SDKs or APIs

The v1.0 reason for the Agent SDK (§5.3) was: reuse the machine's login, load the project's own instructions and tools, be resumable in the terminal. Those hold for every provider. Every mainstream agent exposes a non-interactive, machine-readable mode that runs the *developer's installed, logged-in* binary. Driving that binary keeps N-4 true, needs no API keys, and picks up `AGENTS.md`/`GEMINI.md` exactly as Claude Code picks up `CLAUDE.md`.

Claude keeps the Agent SDK because it is built, tested, and gives in-process permission callbacks. Codex gets a native driver over `codex exec --json` because it is the provider the brief names, its JSONL contract is first-party and documented, and no third-party adapter is needed. Everything else goes through one generic ACP client, because ACP is the only cross-vendor protocol with the four things CRT needs from a session (streamed text, tool-call events, permission requests, a way to hand the agent an MCP server), and Gemini CLI implements it natively. No Codex SDK: it wraps the same `codex exec --json` and would pin a second copy of the binary (N-11).

### 5.3 `write_task` reaches every agent over **stdio** MCP

Today `write_task` is an in-process SDK MCP server reachable only through the Agent SDK. Every other agent reaches custom tools through MCP, and **stdio is the one MCP transport every MCP client and every ACP agent must support**; streamable-HTTP is optional in ACP and, in Codex, behind a feature flag that makes an unsupported `url` server silently absent. So CRT ships `crt mcp`: a stdio MCP server in the same binary with exactly one tool, `write_task`, using the existing schema. The agent spawns it as `node <path to dist/cli.js> mcp` (spawning `node` directly sidesteps the Windows `.cmd`-shim problem, N-10). The shim forwards each call to the running server at `POST /__crt/internal/write-task` on `127.0.0.1` with a per-session bearer token it receives through its **environment** (`CRT_MCP_TOKEN`, `CRT_MCP_PORT`), never on a command line and never in a URL. The server performs the write exactly as today (`createTask`), emits `task_written`, and regenerates the index.

The Claude driver keeps its in-process SDK server: it is proven, and Goal 2 forbids regressions on the default path. Both paths call the same `writeTask` function; a test asserts the same request produces the same file through either.

### 5.4 Two session ids

CRT mints a UUID per session and uses it as the registry key in every `/__crt/sessions/<id>/…` route. Claude Code accepts that UUID as its own session id, which is why `claude --resume <uuid>` works today. Codex and ACP agents mint their **own** id (`thread_id` at `thread.started`; `sessionId` from `session/new`). v0.2 therefore carries two fields: `id` (CRT's, unchanged) and `nativeSessionId` (the provider's, equal to `id` for Claude and the stub). The `init` event is emitted once the native id is known and carries both plus `resumeCommand`. Task frontmatter `session:` holds the **native** id, because that is what the developer can resume.

### 5.5 Detection is "what is usable here, disambiguated by the project"

Project markers alone are a poor signal: `AGENTS.md` is read by nearly every agent, and any repo ever opened in Claude Code has `.claude/`. v0.2 first narrows to providers that are installed and logged in on this machine (preflight), then uses the launch context (was `crt serve` started from inside an agent's own session?), then project markers among those candidates, then Claude. The rule is fully specified in F-44 and always prints its reason.

## 6. Functional requirements

**Must** = v0.2 DoD. **Should** = v0.2 if time allows, else v0.3. A v0.2 release without any Should item is coherent by construction: the Must layer enumerates `claude | codex` (plus `stub` for tests) only; M10 adds `gemini | acp`.

### 6.1 Provider model

- **F-42 (Must) Provider profile.** A provider is a `ProviderProfile` in `packages/server/src/providers/`: `id`, `displayName`, `markers` (F-44), `launchEnv` (environment variable names that mean "CRT was started from inside this agent", may be empty), `preflight() → { installed: boolean, loggedIn: true | false | "unknown", version: string | null, problem: string | null }`, `capabilities` (F-46), `resumeCommand(nativeSessionId) → string | null`, `telemetryOptOut` (per-invocation flags, may be empty; N-12), and `start(opts): SessionDriver`. The `SessionDriver`/`SessionStarter` contract from v1.0 is unchanged. Built-in ids at the Must layer: `claude`, `codex`, `stub`. `stub` is a real profile so tests share the code path, but it is **excluded** from `listProviders()`, `GET /__crt/providers`, `PUT /__crt/config`, and `POST /__crt/sessions` unless `CRT_SESSION_STUB=1` is set.
- **F-43 (Must) Resolution order.** The provider for a session is the first defined of:
  0. `CRT_SESSION_STUB=1` → `stub` (tests only; keeps the CLAUDE.md convention);
  1. `provider` in the `POST /__crt/sessions` body (built-in string id only);
  2. the running server's *active* provider, which is set at start from `--provider`, else `CRT_PROVIDER`, and is **replaced** by a successful `PUT /__crt/config { provider }` for the life of the process (so "Remember" is never silently outranked by a flag);
  3. `provider` in `.crt/config.local.json` (gitignored, per machine);
  4. `provider` in `.crt/config.json` (committed, per project);
  5. auto-detection (F-44);
  6. `claude`.
  An **explicitly** chosen provider (steps 1–4) that fails preflight is not replaced: the session fails immediately with the profile's one-line problem (N-7), and the overlay shows it. Only step 5 falls back. `loggedIn: "unknown"` counts as passing for both F-43 and F-44.
- **F-44 (Must) Auto-detection.** Run at server start and on `--refresh`; the result and its reason are printed on the `CRT ready` line, returned by `GET /__crt/providers`, and shown by `crt providers`.
  1. **Launch context.** If any variable in a profile's `launchEnv` is set in CRT's own environment, that profile is chosen if its preflight passes. Claude declares `CLAUDECODE`. Other profiles declare what their tested version sets (F-53/F-54); an empty list means "no launch signal".
  2. **Candidates** = built-in profiles whose preflight passes (`installed` and `loggedIn ≠ false`). If only `claude` passes → `claude (default)`, no marker scan.
  3. **Project markers**, scanned in the project root **only** (no recursion, names only, contents never read). Each profile lists private markers (a directory such as `.claude/`, `.codex/`, `.gemini/`, or an instruction file such as `CLAUDE.md`, `GEMINI.md`) worth 2 each. The shared `AGENTS.md` is worth 2 for every **non-Claude candidate** when the root has **no** Claude marker, else 1 for every candidate that reads it. Scores are computed for candidates only; the highest score wins if it is strictly higher than every other candidate's; ties and all-zero → `claude`.
  4. **Not usable, but pointed at.** If a non-candidate profile has a private marker in the root, the reason line says so: `project looks like codex (.codex/) but codex is not on PATH — using claude`.
  Worked examples (all with Claude and Codex installed and logged in unless stated): `AGENTS.md` only → codex; `CLAUDE.md` + `AGENTS.md` → claude; `.codex/` + `CLAUDE.md` → tie → claude; `.codex/` only with Codex not on PATH → claude with the "looks like codex" reason; nothing → claude (default); started from inside Claude Code → claude regardless of markers.
- **F-45 (Must) `crt providers [--json] [--refresh]`.** Human output is one line per built-in profile plus a final decision line, exactly:
  ```
  claude   ready        Claude Code (Agent SDK)    login: unknown until a session starts    markers: .claude/, CLAUDE.md
  codex    not on PATH  Codex CLI                  install: npm i -g @openai/codex          markers: AGENTS.md
  → claude — .claude/, CLAUDE.md; codex not on PATH
  ```
  Columns: id, state (`ready` | `not on PATH` | `not logged in` | `too old` | `unknown`), display name and version when known, the problem or install hint, markers found. `--json` returns the F-57 payload. `--refresh` re-runs preflight instead of using the cache. Exit 0 always.
- **F-46 (Must) Capability matrix.** Each profile declares: `streaming` (partial text), `toolEvents`, `permissions` (`interactive` | `sandboxed` | `none`), `images` (`inline` | `path` | `none`), `resume` (bool), `interrupt` (bool), `instructions` (`system` | `first-message`). The matrix travels in the `init` event. The overlay: hides Allow/Deny when `permissions ≠ interactive`; shows a "read-only sandbox" badge in the footer when `sandboxed`; hides Stop when `interrupt` is false; hides the resume hint when `resume` is false or `resumeCommand` is null. Reference values: claude = streaming, toolEvents, interactive, inline, resume, interrupt, system. codex = streaming (if the tested CLI emits deltas, else false), toolEvents, sandboxed, path, resume, interrupt, first-message. stub = as claude, but the stub also runs the conformance scenario with `first-message` and `sandboxed` so both branches are unit-tested.
- **F-47 (Must) Session identity and the `init` event.** `SessionInfo` gains `provider: string` and `nativeSessionId: string | null` (null until `init`). The `init` event becomes `{ type: "init", sessionId, nativeSessionId, provider, displayName, model: string | null, agentVersion: string | null, resumeCommand: string | null, capabilities }` — `claudeCodeVersion` is removed. The footer is rendered from **the session's own replayed `init` event**, never from the active provider, so a reattached or reopened Codex session never reads "Claude". The server log line names the provider. The session list (F-30) shows the provider per row; rows stay reopenable (read-only replay) even if their provider is no longer usable; "New session" uses the active provider. Files touched: `session-events.ts`, `session-stub.ts`, `sessions.ts`, `chat.ts`, `test/sessions.test.ts`, `e2e/chat.spec.ts`.
- **F-48 (Must) Task file `provider:`.** F-32 frontmatter gains `provider: <id>` immediately after `session:`. `write_task` sets it from the session. `validateTaskText` accepts its absence (v0.1 files) and, from v0.2 on, **ignores unknown frontmatter keys** instead of rejecting them, so this incompatibility does not recur. Known ids are the built-in ids plus `acp`; an ad-hoc ACP profile always writes `provider: acp`. `session:` holds the native id (§5.4) or `null`. The first Log bullet reads `created by intake session <native-id> (<provider>)`. `crt tasks --json` includes `provider`; `/crt:tasks` and `/crt:task` print it as one word after the status. The README index columns are unchanged. **Known break:** a project that pins `claude-review-tool@0.1.x` will fail `crt task --validate` on v0.2 files (v0.1 rejects unknown keys); accepted, and stated in the README with the minimum version.

### 6.2 Neutral tool surface

- **F-49 (Must) `crt mcp` — stdio `write_task` server.** A hand-rolled newline-delimited JSON-RPC 2.0 server over stdin/stdout implementing MCP `initialize` (echo the client's protocol version when it is in CRT's supported list, else the newest supported; capabilities `{ tools: {} }`), `notifications/initialized` (no reply), `ping`, `tools/list` (one tool, the v0.1 `write_task` schema), `tools/call` (forwards to the server), and `-32601` for anything else. It reads `CRT_MCP_TOKEN` and `CRT_MCP_PORT` from its environment and exits non-zero with one stderr line if either is missing. The server route `POST /__crt/internal/write-task` requires `Authorization: Bearer <token>`; the token is 32 random bytes base64url, minted per session, valid until the session ends, never logged, never in any response the page can read, never on a command line. Wrong or expired token → 404 with an empty body, and one local log line so N-7 can explain it. Requests carrying an `Origin` header are refused with 403 (the shim is Node; browsers always send `Origin` on POST). A transport contract test drives `crt mcp` with the official MCP TypeScript client as a **devDependency** on both CI runners (N-9).
- **F-50 (Must) Images by path.** `UserImage` gains `path` (absolute, under `.crt/captures/`). `intake-message.ts` fills `path` always and `data` only for drivers with `images: inline` (saves base64 work for the rest). Drivers with `path` pass file paths (Codex `--image`); `none` drops images and the first message says so. The 3.5 MB / 6-image limits stay.
- **F-51 (Must) Instructions channel.** `instructions: system` appends the intake text to the agent's system prompt as today. `first-message` prepends it to the first user message as `# CRT intake instructions\n\n<text>\n\n---\n\n<capture message>`. `$ARGUMENTS` substitution is unchanged. The F-14 quick-note sentinel (`Quick note (F-14)` as the **last** paragraph of the first message) must remain last in both channels; a unit test asserts it for each.

### 6.3 Drivers

- **F-52 (Must) Claude driver = v0.1 behaviour.** `providers/claude.ts` is `session.ts` moved, plus the profile fields. Markers: `.claude/`, `CLAUDE.md` (private), `AGENTS.md` (shared). `launchEnv: ["CLAUDECODE"]`. Preflight: the Agent SDK's bundled binary resolves → `installed: true`; `loggedIn: "unknown"` (login is detected lazily by v0.1 `loginProblem`); `version` from the SDK package. Every v0.1 session/permission/e2e test passes against it with only the `init`-shape and resume-string assertions updated (F-63).
- **F-53 (Must) Codex driver.** `providers/codex.ts` runs the developer's own Codex CLI, never a bundled copy.
  - **Executable resolution (N-10)**, in order: `providers.codex.command` from config (array: command + args); `codex.exe` / `codex` found on PATH directly (Windows: PATHEXT, prefer `.exe`); an npm `.cmd`/sh shim on PATH whose body matches the npm shim shape, from which the JS entry is extracted and run as `process.execPath <entry>`; otherwise `installed: false` with problem `codex not found on PATH — npm i -g @openai/codex, or set providers.codex.command in .crt/config.json`. (Codex installed only through the desktop app or an IDE extension is *this* case: Simon's machine has `~/.codex/config.toml` and no `codex` on PATH.) `shell: false` everywhere; no `.cmd` is ever passed to `spawn` directly.
  - **Turn 1:** `codex exec --json --sandbox read-only --ask-for-approval never -C <projectRoot> [--image <png>]… -c mcp_servers.crt.command=<node> -c mcp_servers.crt.args=[<cli.js>,"mcp"] -c mcp_servers.crt.env={CRT_MCP_TOKEN=…,CRT_MCP_PORT=…} [-m <model>] [telemetryOptOut…] -` with the first message on stdin. **Turn n:** `codex exec resume <threadId> …` with the same flags. `threadId` is the `thread_id` of the `thread.started` event. On resume the driver **asserts** the resumed `thread_id` equals the stored one; a mismatch (Codex silently started a new thread) ends the session with `Codex could not resume thread <id> — start a new session` (N-7).
  - **Events:** `item.*` with `agent_message` → `assistant_start`/`text`/`assistant_end` (streamed if deltas are emitted, whole otherwise); `command_execution`, `file_change`, `mcp_tool_call`, `web_search` → `tool_use`/`tool_result` with F-25-style labels; `turn.completed` → `result` (`costUsd: 0`, token usage in `detail`); `turn.failed`/`error` → `error`. Unknown event types are ignored, never fatal — **but** if a turn ends with no `agent_message` and no `mcp_tool_call`, the driver emits a warning event so a silently missing MCP server is visible in the panel.
  - **Permissions:** `sandboxed`. Intake needs reads plus `write_task`, which the server performs. No Allow/Deny cards.
  - **Interrupt:** kill the current process tree (Windows `taskkill /T /F` by pid; POSIX negative-pid group kill); the thread is resumed on the next message; the resume assertion above catches a corrupted thread.
  - **Preflight:** `codex --version` parsed against the minimum version in the module header; `codex login status` exit code → `loggedIn` (`true` on 0, `false` on the documented "not logged in" exit, `"unknown"` otherwise — never block on it). Markers: `.codex/` (private), `AGENTS.md` (shared). `launchEnv`: whatever the tested version exports into shells it spawns, else empty.
  - **Resume:** `codex resume <threadId>`.
  - **Telemetry:** `telemetryOptOut` holds the per-invocation `-c` override for the tested version if one exists, else is empty and the README says Codex's own analytics setting applies (N-12).
  - **Verification protocol:** every flag, event name and exit code above was written from documentation, not from a run. **M6 (the spike) records the truth** for the version installed on Simon's machine: the module header lists the tested version, the exact command lines, and the observed event names; `test/providers/fixtures/codex/*.jsonl` are recorded from those runs. If reality differs, the builder follows §12, not this text.
  - **M6 verdicts (codex-cli 0.154.0, Windows, 2026-09-15 — `docs/spikes/codex-2026-09.md`):** MCP under `--sandbox read-only` is **reachable** (no fallback). Flag deltas M9 must apply (§12 rule 1): `exec` rejects `--ask-for-approval` → use `-c approval_policy="never"`; **`-c mcp_servers.crt.default_tools_approval_mode="approve"` is mandatory** on every turn — without it `approval_policy="never"` fails each MCP call with `MCP tool call requires approval, but approval policy is never`; `exec resume` rejects `--sandbox` and `-C` → `-c sandbox_mode="read-only"` and spawn with `cwd: projectRoot`; paths in `-c` values as TOML literal strings (`'…'`); a non-UUID resume id silently starts a new thread (the assertion above stands). Agent text is never streamed: one `item.completed` `agent_message` per message (`item.started` only precedes `mcp_tool_call`/`command_execution`). `login status` exits 0/1 but does not validate the token — a stale login surfaces as `error` + `turn.failed` (`…log out and sign in again`), which must map to the N-7 not-logged-in line. `launchEnv: ["CODEX_THREAD_ID","CODEX_SESSION_ID"]`, `telemetryOptOut: ["-c","analytics.enabled=false"]`, skills dir `.agents/skills` (project) / `~/.codex/skills` (user). Model commands cannot read a workspace under the `%TEMP%` short path, so the fake-`codex` e2e scratch project needs a long path outside `%TEMP%`.
  - **M9 amendment (CRT-0012, codex-cli 0.154.0, 2026-09-16 — spike doc §6):** the MCP variables are passed as `-c mcp_servers.crt.env_vars=['CRT_MCP_TOKEN','CRT_MCP_PORT']` with the values set in the `codex` process's own environment, instead of the `env={…}` map: `env_vars` names parent variables Codex forwards to the stdio MCP server (verified under `--strict-config`), so the token never appears on a command line, as F-49/N-8 require. Everything else in the M6 verdicts stands; the driver namespaces Codex's per-turn `item_N` ids per turn so the panel can tell turns apart.
- **F-54 (Should) Generic ACP driver + Gemini profile.** `providers/acp.ts` is a hand-rolled JSON-RPC 2.0 client over stdio (N-11) to any command:
  - `initialize` with client capabilities `fs.readTextFile: false`, `fs.writeTextFile: false`, `terminal: false`; record the agent's `agentCapabilities`.
  - `session/new { cwd, mcpServers: [{ name: "crt", command: <node>, args: [<cli.js>, "mcp"], env: [{ name: "CRT_MCP_TOKEN", value }, { name: "CRT_MCP_PORT", value }] }] }` (stdio form, the ACP baseline). `nativeSessionId` = the returned `sessionId`.
  - `session/prompt` with text blocks and, when `agentCapabilities.promptCapabilities.image` is true, image blocks (base64); otherwise `images: none`.
  - `session/update` variants mapped: `agent_message_chunk` → text; `agent_thought_chunk` → ignored; `tool_call` → `tool_use`; `tool_call_update` → `tool_result` when status is `completed`/`failed`; `plan` → ignored. `session/load` is **not** used (resume is terminal-side only).
  - `session/request_permission` → a v0.1 permission card. Policy over ACP tool **kinds**: `read`, `search`, `think`, `other`-with-no-locations → allow; `edit`, `delete`, `move` → allow when every location is under `.crt/`, else ask; `execute` → allow when the title/raw command is a read-only git command per `isReadOnlyGit`, else ask; `fetch` → deny. Mapping: allow → the option with kind `allow_once` (never `allow_always`); deny → `reject_once`; if the offered options lack a matching kind, pick the first option whose kind starts with `allow`/`reject` respectively; if none, respond `cancelled`. F-26 is amended accordingly (§9).
  - `session/cancel` → interrupt. Close → end stdin, wait 2 s, kill.
  - The `gemini` profile is `acp` with command `gemini --experimental-acp`, markers `.gemini/`, `GEMINI.md` (private), `AGENTS.md` (shared), preflight `gemini --version`, `resumeCommand` = the command Gemini documents for the tested version, else `resume: false`. `launchEnv` per the tested version, else empty.
  - Ad-hoc: `.crt/config.json` `provider: { kind: "acp", command: "<exe>", args: [], name: "<display>" }` registers a profile with id `acp`, no markers, no resume, capabilities negotiated at `initialize`. The object form is **config-file only**: it is never accepted by `PUT /__crt/config` or `POST /__crt/sessions` (N-8).
  - If the agent's `initialize` reports an unsupported protocol version, the session fails with `…speaks ACP <v>; CRT supports <list>` (N-7).
- **F-55 (Must) Provider-neutral intake instructions.** `plugin/skills/intake/SKILL.md` stops naming Claude-only tools and variables: "Prefer `Grep`/`Glob`/`Read`" → "prefer your file search and read tools over running code"; `${CLAUDE_SESSION_ID}` → "your session id if your agent exposes one, else `session: null`"; "a `write_task` tool from the `crt` MCP server" stays (it is what every agent sees). The **quick-note sentinel sentence** (`When the first message ends with a paragraph starting \`Quick note (F-14)\``) is load-bearing for `intake-message.ts` and the stub and must survive verbatim; a unit test greps the built `dist/intake.md` for it. The terminal-intake steps gain one sentence: "If your agent runs in a read-only sandbox, stop after step 4 and tell the developer to write the file with `crt` from a terminal." The frontmatter remains valid Claude plugin frontmatter and valid Agent Skills frontmatter.

### 6.4 Selection UX

- **F-56 (Must) Overlay provider awareness.** Every "Claude" in overlay copy that refers to the agent becomes the session's `displayName` from its `init` event (`Send to Codex`, `Codex has a question`, `Reply to Codex…`); chrome (launcher, panel title "CRT", toolbar) stays "CRT" (F-64). Footer: `provider · model · agent version · resume command` (or "read-only sandbox" badge, F-46). **Send** becomes a split button: main half `Send to <active>`, caret opens the provider list for this send only; **Quick note** uses the same active provider. The list is also reachable from the toolbar. Rows come from `GET /__crt/providers`: state dot (`ready` / `not on PATH` / `not logged in` / `too old` / `unknown`, with the problem as tooltip), the active one ticked; unusable rows are disabled. A per-send choice persists in `sessionStorage` for the tab. A checkbox "Remember for this project on this machine" writes `.crt/config.local.json` via `PUT /__crt/config`. Opening the list calls `GET /__crt/providers?refresh=1` with a per-row spinner so a fresh `codex login` is noticed without restarting the server.
- **F-57 (Must) Server routes.** `GET /__crt/providers[?refresh=1]` → `{ ok, active, decision: { provider, reason }, providers: [{ id, displayName, installed, loggedIn, version, problem, markers, capabilities }] }` (never includes `stub` unless `CRT_SESSION_STUB=1`). `PUT /__crt/config` accepts a JSON object with only `provider` (a built-in string id whose preflight passes) and/or `models` (an object mapping built-in ids to strings matching `^[A-Za-z0-9._:-]{1,64}$`); anything else → 400; writes `.crt/config.local.json` only and replaces the running server's active provider (F-43 step 2). `GET /__crt/health` adds `provider` (existing assertions are extended, not replaced). `POST /__crt/sessions` accepts an optional `provider` string id (validated as above). The `.crt/config.json` `provider` object form and `providers.<id>.command` are never page-writable. `GET /__crt/providers` does expose which agent CLIs are installed and logged in to any script on the page; this is accepted for a localhost dev tool and stated under N-8.

### 6.5 Portable skills

- **F-58 (Must) `crt skills install [--provider <id>] [--global] [--dir <path>]`.** Writes `next`, `tasks`, `task`, `done`, `intake`, `serve` as Agent Skills (`<dir>/<name>/SKILL.md`) into the provider's project-level skills directory recorded in its profile for the tested version, `--global` for the user-level one, or an explicit `--dir`. The text is the plugin's, after rewriting: `${CLAUDE_PROJECT_DIR}` → "the project root (your working directory)"; `${CLAUDE_SESSION_ID}` → "your session id"; `AskUserQuestion` → "asking the user"; `disable-model-invocation`, `allowed-tools` frontmatter lines dropped; a first paragraph added: "Installed by `crt skills install`; the no-questions guarantee of `/crt:next` is tested on Claude Code only." Idempotent; prints every path it wrote; never writes anywhere but the chosen directory (N-5 exception, listed in §9). If the profile records no skills directory for the tested version, `--dir` is required and the error says so. The Claude Code plugin remains the distribution for Claude; `crt skills install --provider claude` is refused with a pointer to `claude plugin install crt@crt`.

### 6.6 Tests

- **F-59 (Must) Driver conformance scenario.** `test/providers/conformance.ts` **exports** a scenario helper (it is not itself a collected test; Vitest collects `test/**/*.test.ts`) that each `test/providers/<id>.test.ts` runs against its driver behind a fake transport: init (asserting `nativeSessionId`, `resumeCommand`, `capabilities`) → streamed text → a tool event → if `permissions: interactive`, a permission card answered Allow, then another answered Deny → `write_task` through the driver's real tool path (in-process for Claude, the stdio shim plus internal route for others) into a temp `.crt/` → `task_written` → result → interrupt mid-turn → close. It asserts the `SessionEvent` sequence shape and that the file passes `validateTaskText` with the right `provider:` and `session:`. Codex fixtures are recorded from a real CLI run (M6) and carry the command and version in a header comment.
- **F-60 (Must) Resolution and detection tests.** Fixture roots (`AGENTS.md` only; `CLAUDE.md`+`AGENTS.md`; `.codex/`+`CLAUDE.md`; `.codex/` with Codex preflight failing; nothing; nested `packages/web/.codex/` which must be ignored) × preflight stubs × launch-env stubs × config layers (`--provider`, `CRT_PROVIDER`, local file, committed file, request body, `PUT` replacing the flag), asserting the F-43 order, the F-44 table and the exact reason strings.
- **F-61 (Must) e2e per driver.** `e2e/chat.spec.ts` gains a `provider` axis: `stub` (as today) and `codex` against a fake `codex` in a scratch `bin/` prepended to PATH. On `ubuntu` the fake is an executable Node script; on `windows` it is an npm-shaped `codex.cmd` shim pointing at the same script, so the shim parser is exercised. The fake answers `--version`, `login status`, consumes stdin, accepts `exec` and `exec resume <id>`, tolerates `--image`/`-c`/`-m`, replays the F-59 fixtures, and **spawns the configured MCP server and calls `write_task` through it** (so the shim, the token and the internal route run for real). Each axis proves: Send → text streams → task file exists with the right `provider:` → footer shows the right resume command → a reload reattaches with the same footer. The `acp` axis is added by M10.

### 6.7 Release, docs and repo meta

- **F-62 (Must) Release and docs surface.** README gains a "Providers" section: the resolution order in one list, `crt providers` sample output verbatim, per-provider install/login/troubleshooting (N-7 lines verbatim, in the style of the existing Troubleshooting section, which stays), the interim-name line (F-64), the telemetry statement (N-12), and the 0.1.x compatibility note (F-48). Version `0.2.0` in `packages/server/package.json`, `plugin/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`; `release.yml` is unchanged (tag must equal the package version). `docs/PRD.md` §11 items that say "Claude Code session" are annotated per §9 and §10 of this document is linked from the v1.0 header table.
- **F-63 (Must) Repo meta updated with the module move.** In the same PR that creates `providers/claude.ts`: `.claude/hooks/guard.mjs` `SDK_HOME` → `packages/server/src/providers/claude.ts`; `test/guard-hook.test.ts` updated; `.claude/agents/prd-reviewer.md` §4 row "Agent SDK only in session.ts" → the new home, plus a new row "provider CLIs are spawned only from `providers/<id>.ts` and `exec.ts`" (checked by grepping added lines for `spawn(` outside those files), and its F-32 key-order check acknowledges `provider:`; `CLAUDE.md` conventions line updated (§9); `test/sessions.test.ts:113` and `e2e/chat.spec.ts:70` `claude --resume` assertions read the expected string from the profile.
- **F-64 (Must) Interim naming rule.** Product chrome (launcher pill, panel title, CLI banner, plugin `displayName`) stays "CRT" / "Claude Review Tool". Only agent-facing verbs and nouns take the provider's display name. README's first paragraph gains: "CRT started as Claude-only; v0.2 works with Codex and any Agent Client Protocol agent, and Claude Code remains the default. The name is historical."

## 7. Non-functional requirements

- **N-7 One-line provider failures.** Every provider failure is one actionable line in the panel, on the `CRT ready` line, and in `crt providers`. Wording lives in the profile. Minimum set: not on PATH (with the install command and the config override), not logged in (with the login command), too old (with the tested minimum), could not resume (F-53), unsupported protocol (F-54), MCP server never called (F-53 warning), token rejected (`write_task was called with a stale token — the session had ended`).
- **N-8 Same-origin hardening of the new surface.** Page scripts in the proxied app run on CRT's origin. Therefore: `PUT /__crt/config` writes only the local file and only two allowlisted keys with validated values; provider objects and commands are never page-writable; the MCP token travels only via the shim's environment and a bearer header; `/__crt/internal/*` refuses any request with an `Origin` header; `stub` is unreachable without `CRT_SESSION_STUB=1`. Accepted exposure, stated in the README: a page script can list installed agents and flip the active provider between usable built-in ones.
- **N-9 No login, no network in CI.** Every driver is testable without credentials (F-59, F-61 fakes). The stdio shim is tested with a real third-party MCP client (F-49). Real-agent runs are Manual items in milestone DoDs, ticked by Simon.
- **N-10 Windows first.** PATH/PATHEXT resolution, npm-shim parsing, `process.execPath` for our own shim, process-tree kill, LF everywhere, `spawn(..., { shell: false })` everywhere; nothing ever passes a `.cmd` to `spawn`. Unit and build jobs on `windows-latest` stay; the fake-`codex` e2e runs on both runners.
- **N-11 Dependency budget.** No new **runtime** dependencies: the stdio MCP server and the ACP client are hand-rolled newline-delimited JSON-RPC (each is expected to fit in ~200 lines; if the ACP client exceeds 400 lines the official ACP TypeScript SDK may be added, pinned exactly). The official MCP TypeScript SDK is allowed as a **devDependency** for the F-49 contract test only. No Codex SDK.
- **N-12 Privacy statement.** N-4 becomes: nothing leaves the machine except the model calls the *chosen agent* already makes, **and that agent's own telemetry if it has any**. CRT passes the provider's documented per-invocation telemetry opt-out where one exists (`telemetryOptOut`, F-42); otherwise the README says plainly, per provider, that the agent's own telemetry setting applies. CRT itself still has none.
- **N-13 Latency.** N-2 (≤ 5 s to first token) applies to the **first** turn of any provider on a warm machine. For providers that start one process per turn (Codex `exec resume`), later turns are as fast as the provider's resume; the panel shows the running state immediately so the wait is visible. The re-billing of prior context on each resumed turn is the provider's behaviour and is noted in the README.

## 8. Milestones

Each milestone is one task file (`.crt/tasks/CRT-0009…0014`). DoD items are **worker-checkable** unless marked **Manual (Simon)**; the worker ticks what it verified, leaves Manual items unticked, sets `review`, and names the unticked items in its reply (v1.0 CRT-0001 precedent).

**M6 — Spike: Codex feasibility on this machine.** Install the Codex CLI (`npm i -g @openai/codex`), then record, on Windows, the real behaviour that F-53 assumes: `codex exec --json` with stdin prompt, `--image`, `-c mcp_servers.*` (command/args/env forms) under `--sandbox read-only` — does the MCP server get spawned and can it reach `127.0.0.1`?; `exec resume` with the same flags; kill mid-turn then resume; `login status` exit codes; `--version` format; event names and whether text is streamed in deltas; environment variables Codex exports into spawned shells (for `launchEnv`); the skills directory Codex reads (for F-58). Output: `docs/spikes/codex-2026-09.md` (commands run, verbatim events, verdicts) and `test/providers/fixtures/codex/*.jsonl`. DoD: **Manual (Simon)** every question above has a verdict in the spike doc; a worker-checkable item is that the fixtures parse and contain `thread.started`, `item.completed`, `turn.completed`. If the MCP-under-sandbox verdict is "unreachable", the spike doc names the fallback (`--sandbox workspace-write`, or `-c sandbox_workspace_write.network_access=true`, or an approval mode) and F-53 is amended before M9 starts (§12).

**M7 — Provider abstraction, server side.** F-42, F-43, F-44, F-45, F-47 (server half), F-48, F-52, F-60, F-63, stub as a provider, `CRT_SESSION_STUB` in the order. DoD: `npm run check` green; a golden test renders a task from a fixed `WriteTaskRequest` with clock, session id and capture id stubbed and asserts the output equals the checked-in v0.1 golden file plus `provider: claude` and the Log suffix; `crt providers` on this repo prints `→ claude — .claude/, CLAUDE.md`, and on an empty fixture root `→ claude (default)`; F-60 covers every worked example in F-44; guard hook blocks an SDK import in `providers/codex.ts` and allows it in `providers/claude.ts`.

**M8 — Neutral tool surface and overlay.** F-46, F-47 (overlay half), F-49, F-50, F-51, F-55, F-56, F-57, F-61 stub axis. DoD: F-49 contract test passes on both runners; e2e `stub` axis proves footer-from-replayed-init after reload; the quick-note sentinel test passes on both instruction channels; `PUT /__crt/config` rejects an object `provider`, a non-built-in id, and a model with a space; a v0.1-recorded stub session transcript still renders identically apart from the footer.

**M9 — Codex driver and portable skills.** F-53 (as amended by M6), F-58, F-61 codex axis, N-7 Codex lines, N-13 README note. DoD: fake-`codex` e2e green on both runners, including the fake calling `write_task` through the shim; conformance test replays the M6 fixtures; `crt skills install --provider codex --dir <tmp>` writes six files with no `${CLAUDE_*}` left; **Manual (Simon)**: on the trial Next.js app, `crt serve --provider codex` → annotate → Send to Codex → streamed text, tool lines, a task passing `crt task --validate`, `codex resume <id>` continues the conversation; on a scratch copy of the trial app with `AGENTS.md` and no Claude markers, auto-detection prints `→ codex`.

**M10 — ACP driver and Gemini (Should).** F-54, F-59/F-61 `acp` axis with a fake ACP agent, `gemini`/`acp` added to the id enum, matrix, menu and README. DoD: fake-ACP conformance and e2e green, including a permission card round-trip; an ad-hoc `{ kind: "acp" }` config runs the scenario; **Manual (Simon)**: Gemini intake writes a valid task on the trial app.

**M11 — Docs, v0.2 DoD, release 0.2.0.** F-62, F-64, §10 table filled with evidence, version bumps, tag `v0.2.0`, npm publish, GitHub release. DoD: every §10 row ticked with its evidence; CI green on `main`; `claude-review-tool@0.2.0` on npm.

## 9. Amendments to `docs/PRD.md` v1.0 and `CLAUDE.md`

| v1.0 statement | v0.2 |
|---|---|
| §2 Goal 6 "Every Claude session CRT starts has `cwd` set to the target project's root and inherits that project's `CLAUDE.md`, settings, plugins, and MCP servers" | "Every agent session CRT starts has `cwd` = project root and inherits whatever that agent loads from the project (`CLAUDE.md` for Claude Code, `AGENTS.md` for Codex, `GEMINI.md` for Gemini) plus the agent's own settings." |
| §3 Non-goal 5 "CRT orchestrates Claude Code via the Agent SDK" | "CRT orchestrates an installed coding agent (Claude Code by default) through its machine interface; it never calls a model API itself." |
| §5.3 Why the Agent SDK | Applies to the Claude driver; §5.2 here covers the rest. |
| F-13 "Send to Claude" | "Send to <provider>" (F-56). Tests keep the F-13 tag. |
| F-24 "`query()` with cwd…" | "a session on the resolved provider with cwd = project root, the intake instructions delivered per F-51, and the first message per F-24's content list". |
| F-26 permissions | Applies when `permissions: interactive`. For ACP the policy is over tool kinds (F-54). For `sandboxed` providers there is no `canUseTool`; the sandbox is the boundary (see N-5 below). |
| F-28 "`claude --resume <id>`" | "the provider's resume command, or no hint when it has none" (F-46, F-47). |
| F-30 session list | gains a provider column (F-47). |
| F-32 frontmatter | `provider:` after `session:`; `session:` holds the native id (F-48, §5.4). |
| F-35 `.crt/config.json` | gains `provider`, `models`, `providers.<id>.command`; `crt init` also gitignores `.crt/config.local.json` (F-43). |
| N-2 | superseded by N-13. |
| N-4 | superseded by N-12. |
| N-5 "the intake session's write permission is scoped to `.crt/**` by `canUseTool`" | "…by `canUseTool` for interactive providers, and by the provider's read-only sandbox for sandboxed ones, in which case `write_task` on the server is the only write path". `crt skills install` (F-58) is a second explicit exception to "never writes outside `.crt/`", alongside the `.gitignore` line. |
| N-6 | extended by N-7. |
| §11 rows "backed by a Claude Code session", "resumable with `claude --resume`" | read "backed by a session on the resolved provider (Claude Code by default)" and "resumable with the provider's resume command"; evidence unchanged for Claude. |
| §12 risk "Agent SDK API drift" | mitigation: "isolate all SDK use in `providers/claude.ts`; every other provider's CLI or protocol contract is isolated in `providers/<id>.ts` with the tested version in the header and recorded fixtures in `test/providers/fixtures/`". |
| §14 Glossary "Intake session — the Claude Code session…" | "…the agent session (Claude Code by default)…"; add **Provider**, **Native session id**, **Profile**. |
| CLAUDE.md "All Agent SDK usage lives in `packages/server/src/session.ts` behind a small interface (PRD §12)" | "All Agent SDK usage lives in `packages/server/src/providers/claude.ts`; every other agent's CLI or protocol is driven only from `providers/<id>.ts` and `providers/exec.ts`, all behind `SessionDriver` (PRD §12, PRD-providers §5)." |
| CLAUDE.md "`CRT_SESSION_STUB=1` swaps the SDK driver for `session-stub.ts`" | "…selects the `stub` provider (`providers/stub.ts`) ahead of every other resolution step". |
| CLAUDE.md "Read `docs/PRD.md` before doing anything non-trivial" | "Read `docs/PRD.md` and `docs/PRD-providers.md`…". |

## 10. Definition of done (v0.2)

CRT v0.2 is done when every row is true and demonstrated. Each tick names its evidence (test name, e2e spec, task Log entry, or run URL), as in v1.0 §11.

- [ ] With no config and no other usable agent, `crt serve` prints `provider: claude (default)` and sessions, permissions cards and task files match v0.1 apart from `provider:` and the Log suffix. — golden test (M7), e2e `stub` axis.
- [ ] `crt providers` reports every built-in provider's state and the decision with its reason, in the F-45 layout. — unit test on the layout; README sample.
- [ ] Auto-detection follows F-44 for every worked example, including "pointed at but not usable". — F-60 tests; **Manual**: `→ codex` on the AGENTS.md-only trial copy.
- [ ] The provider can be chosen per send, per tab, per machine, per project and per server start, in the F-43 order, and `PUT /__crt/config` replaces a `--provider` flag. — F-60 tests; e2e split button.
- [ ] A Codex session streams text, shows tool lines, shows the read-only badge and no Allow/Deny, and writes a valid task with `provider: codex` and a resumable native id. — fake-codex e2e; **Manual (Simon)** on the trial app with `codex resume`.
- [ ] `write_task` reaches non-Claude agents through `crt mcp` over stdio with a bearer token that never appears in a URL, a command line, a page response or a log. — F-49 contract test; grep of logs in e2e.
- [ ] Page scripts cannot make CRT run a command or select a non-built-in provider. — F-57 negative tests.
- [ ] Task files from any provider validate, list with their provider, and are worked by `/crt:next` on Claude Code. — `test/tasks.test.ts`; **Manual**: `/crt:next` on a Codex-written task.
- [ ] `crt skills install --provider codex` yields six Agent Skills with no Claude-only tokens. — unit test; **Manual**: Codex lists the skills and runs `tasks`.
- [ ] Every N-7 message appears verbatim in the README's Providers section. — doc test greps the README for each profile's problem strings.
- [ ] CI green on `main` for both runners; `v0.2.0` tagged and published; all three version fields equal `0.2.0`. — run URLs.
- [ ] (If M10 shipped) Gemini intake writes a valid task; an ad-hoc ACP command passes conformance. — fake-ACP tests; **Manual (Simon)** on the trial app.

## 11. Risks

| Risk | Mitigation |
|---|---|
| Codex `exec` cannot reach the MCP server from a read-only sandbox, or `-c mcp_servers.*` does not apply to `exec` | M6 spike decides before M9 exists; fallbacks named in M6's DoD; §12 governs the amendment. |
| Codex JSONL schema or flags change between releases | Minimum version in preflight; tested version and observed names in the module header; fixtures re-recorded when bumping; unknown events ignored; missing-MCP warning (F-53) keeps silent failure visible. |
| `codex exec resume` silently starts a new thread | Thread-id assertion on every resume; explicit N-7 line. |
| Windows `.cmd` shims cannot be spawned without a shell | Resolution order in F-53; our own shim is always `process.execPath`; e2e uses an npm-shaped `.cmd` on `windows-latest`. |
| Page scripts abusing new routes | N-8: allowlisted ids and validated model strings only; object provider forms are file-only; tokens never reach the page. |
| Detection still wrong for some repo shapes | Every decision prints its reason; the split Send button is one click away; the local config file makes a fix permanent per machine. |
| Provider-neutral wording weakens Claude intake | F-27 substance unchanged; the CRT-0003 manual trial-app check is repeated as a Manual item in M8. |
| Multi-turn Codex is slow or expensive | N-13 makes the trade-off explicit and visible; Open question 3 tracks moving to a persistent Codex process when a first-party, non-experimental one exists. |
| Scope creep into a worker for every agent | §1 says what is and is not certified; F-58 ships text only. |

## 12. Verification protocol for the builder

This document was written from tool documentation, not from runs. When the installed tool differs:

1. **A flag or event name differs but the capability exists** (e.g. Codex emits `item.delta` instead of streamed deltas inside `item.updated`): use the real one, record the observed name and the tested version in the module header, re-record the fixtures, and proceed. Do not block.
2. **A capability the design depends on is missing** (e.g. MCP servers are not spawned under `--sandbox read-only`): pick the first fallback named in the M6 spike doc; if none applies, set the task `blocked` with the exact observation in the Log (v1.0 F-37 behaviour).
3. **Login state cannot be determined** (`login status` absent, odd exit code): `loggedIn: "unknown"`, which counts as passing. Never block a session on it.
4. **A documented resume command or skills directory does not exist for the tested version**: `resume: false` / `--dir` required, and the README says so. Do not invent one.
5. **A dependency question** (N-11 line budgets): the budget is the rule; note the line count in the PR description.

## 13. Decisions taken and open questions

**Decided here** (the builder does not revisit these):

- Keep the product name for v0.2; interim display rule F-64.
- `models` is a per-provider map; `--model` applies to the provider resolved for that run.
- `write_task` is stdio MCP for every non-Claude provider; Claude keeps in-process.
- Detection prefers the launch context, then usable agents, then project markers; `AGENTS.md` decides only in the absence of Claude markers; root only.
- "Remember" writes the machine-local, gitignored file; the committed file is edited by hand.
- The worker is certified on Claude Code only in v0.2; skills ship as text for others (Must).
- ACP `session/load` is not used; resume is terminal-side.
- `--skip-git-repo-check` is not passed (the project root is the git root).

**Open:**

1. **Rename** before v1.0 (npm alias, marketplace move, plugin reinstall). Decide after v0.2 has users on two providers.
2. **Same-origin exposure that predates v0.2** (`/__crt/sessions`, `/__crt/captures` writable by page scripts). Proposed: a separate hardening task after v0.2; note that a token injected into the page is readable by page scripts, so a real fix needs a different mechanism (e.g. a browser-extension-free "unlock" click in the overlay that the server verifies out of band). Tracked as a new CRT task, not folded in here.
3. **Persistent Codex process.** When Codex ships a first-party, non-experimental long-lived session interface with approvals, move the Codex driver to it and `permissions: interactive`. Not while `codex app-server` is marked experimental.
4. **Copilot CLI, Cursor, OpenCode profiles.** Add when an ACP endpoint or a first-party non-interactive JSON mode exists for the tested version; each is one profile under F-42.
