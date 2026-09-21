---
id: CRT-0013
title: M10 — Generic Agent Client Protocol driver and Gemini profile (Should)
status: in_progress
priority: low
created: 2026-09-15T17:30:00+08:00
updated: 2026-09-21T10:50:00+08:00
url: null
route: null
session: null
tags: [m10, f-54, f-59, f-61, n-11, prd-providers]
files: [packages/server/src/providers/acp.ts, packages/server/src/providers/gemini.ts, packages/server/test/providers/acp.test.ts, packages/server/e2e/chat.spec.ts, README.md]
---

## Summary
Add one generic driver that speaks the Agent Client Protocol (ACP) over stdio, ship Gemini CLI as its first profile (`gemini --experimental-acp`), and let any other ACP agent be configured by command in `.crt/config.json`.

## Context
`docs/PRD-providers.md` §5.2, §8 (M10), F-54, F-59/F-61 `acp` axis, N-11 (hand-rolled JSON-RPC unless it exceeds 400 lines), the F-26 amendment (policy over ACP tool kinds), §12. Depends on CRT-0011 (stdio `write_task`, capability-driven UI) and CRT-0010 (profiles). This is a Should milestone: v0.2 may ship without it (PRD-providers §6 preamble); if it does, `gemini`/`acp` stay out of the id enum, the menu and the README.

## Evidence
No page capture: created from PRD-providers milestone M10.

## Ask
1. `providers/acp.ts`: JSON-RPC 2.0 client over stdio; `initialize` with the F-54 client capabilities; `session/new` with cwd and the stdio `crt mcp` server (token in `env`); `session/prompt` with text and, when advertised, image blocks; `session/update` mapping per F-54; `session/request_permission` → permission card with the tool-kind policy and the `optionId` mapping (never `allow_always`); `session/cancel` on interrupt; close = end stdin, 2 s, kill; protocol-version mismatch → N-7 line.
2. `providers/gemini.ts`: ACP profile with command `gemini --experimental-acp`, markers `.gemini/`, `GEMINI.md`, `AGENTS.md`, preflight `gemini --version`, `resumeCommand` per the tested version or `resume: false`, `launchEnv` per the tested version or empty, skills directory for F-58 if one exists.
3. Ad-hoc profile from `.crt/config.json` `provider: { kind: "acp", command, args, name }` (file-only, id `acp`, no markers, no resume).
4. Add `gemini` and `acp` to the id enum, F-46 matrix (negotiated), F-56 menu, README Providers section.
5. Fake ACP agent script for the conformance test and the e2e `acp` axis, including a `session/request_permission` round-trip answered Allow then Deny.

## Definition of Done
- [x] Conformance test against the fake ACP agent passes, including the permission round-trip and `write_task` through `crt mcp`.
- [ ] e2e `acp` axis green on both runners; footer shows the negotiated capabilities correctly (no resume hint when `resume: false`).
- [x] An ad-hoc `{ kind: "acp" }` config runs the conformance scenario; `PUT /__crt/config` still rejects the object form.
- [x] `npm run check` passes; `acp.ts` line count noted in the PR description against the N-11 budget.
- [ ] Manual (Simon): Gemini intake on the trial app writes a valid task; `crt providers` shows Gemini's state correctly when logged out and logged in.

## Notes
Do not use `session/load`. If Gemini's tested version does not advertise image support in `promptCapabilities`, ship `images: none` and let the first message say so (F-50).

**Deferred, not scheduled (Simon, 2026-09-17).** v0.2 and v0.3 shipped without M10 (PRD-providers §6 allows it; §10's M10 row says "not shipped"; the README claims Codex only). Nothing here has been started: `providers/` holds `claude`, `codex`, `stub`; the only ACP traces are the enum comment in `providers/types.ts` and the deliberate rejection of `provider: { kind: "acp" }` in `session.ts`. Before `/crt:next` can take this task it needs a spike the way M6 preceded the Codex driver: install `@google/gemini-cli`, log in, and record the real `gemini --experimental-acp` behaviour that the Ask defers to "the tested version" — `initialize` capabilities, `session/new` with a stdio MCP server, `session/update` shapes, `session/request_permission`, resume and launch-env facts, image support — as `test/providers/fixtures/acp/*.jsonl` plus `docs/spikes/gemini-acp-<date>.md`. Without that a worker blocks on the unknowns and on the Manual row (Gemini is not installed on the dev machine). Revisit when a third agent is actually wanted; until then leave `backlog`, priority `low`.

## Log
- 2026-09-15T17:30+08:00 — created from PRD-providers milestone M10 by the planning session that wrote docs/PRD-providers.md.
- 2026-09-17T01:10+08:00 — reviewed after the v0.3.0 release: nothing started, all five Ask items and five DoD rows open; deferred with the note above (spike before build). Session 21c8bea3-fd0d-49d4-97aa-734d23658916.
- 2026-09-21T10:00+08:00 — claimed by /crt:next, session f36246b7-e1ec-4291-95b0-f7a38ba6c3c3, branch crt/CRT-0013-m10-acp-driver-and-gemini
- 2026-09-21T10:05+08:00 — checked the machine: `gemini` is not on PATH, no `~/.gemini`, no `docs/spikes/gemini-acp-*.md`, no `test/providers/fixtures/acp/`; `providers/` still holds only `claude`, `codex`, `stub`. Ask items 1–2 defer `initialize` capabilities, `session/update` shapes, `resumeCommand`, `launchEnv` and image support to "the tested version", which does not exist, and the Manual DoD row needs a logged-in Gemini (Google OAuth — cannot be done by a worker session).
- 2026-09-21T10:05+08:00 — blocked: (1) Is a third agent wanted now, i.e. should M10 be built (the 2026-09-17 note says leave it until it is)? (2) If yes: install `@google/gemini-cli` and log in on this machine, then run the spike the note asks for (record `gemini --experimental-acp` initialize/session-new/session-update/request_permission/resume/launch-env/image facts as `test/providers/fixtures/acp/*.jsonl` + `docs/spikes/gemini-acp-<date>.md`), or state which version to target and paste its ACP facts into ## Notes. Answer in ## Notes and re-run /crt:next CRT-0013.
- 2026-09-21T10:10+08:00 — unblocked by Simon in the same session ("i've installed gemini cli", Gemini CLI 0.60.0, Google login done at 09:56): answer to (1) yes, (2) done. Spike run per the 2026-09-17 note: `docs/spikes/gemini-acp-2026-09.md` + `probe/` scripts, recordings in `test/providers/fixtures/acp/*.jsonl`. Verdicts: `--acp` (`--experimental-acp` deprecated); `initialize` answers protocol 1 whatever is asked, `promptCapabilities.image: true`; auth fails at `session/new` (-32000), and **0.60.0 refuses the personal Google tier** ("no longer supported for Gemini Code Assist for individuals… migrate to Antigravity") — a Gemini API key is the working credential; `gemini --resume <uuid>`; `launchEnv: GEMINI_CLI`; skills `.gemini/skills`; no telemetry flag. Recorded in PRD-providers F-54 "M10 verdicts".
- 2026-09-21T10:45+08:00 — built: `providers/acp.ts` (JSON-RPC stdio client `JsonRpcStdio` 63 lines, protocol shapes, F-54 kind policy + option mapping, `AcpTurnMapper`, `startAcpSession`, ad-hoc `adHocAcpProfile`; 775 lines in all), `providers/gemini.ts` (142), registry: `gemini` built-in, `config.acp` → ad-hoc `acp` profile, object form resolves to it; `e2e/fixture/fake-acp.mjs` (+ `installFakeGemini`); `test/providers/acp.test.ts` (22 tests) incl. F-59 conformance for `gemini` and for `{ kind: "acp" }`; e2e `acp` axis (fourth server on the object form) in `chat.spec.ts`; README Gemini + "Any other ACP agent" sections; PRD-providers F-54 verdicts, §10 row, §11 item 4; CLAUDE.md, serve skill. Decisions: `switch_mode` kind → ask; ad-hoc `ACP_CAPABILITIES` = interactive, inline images negotiated at initialize, `resume: false`; the e2e fixture puts the fake `gemini` on PATH for every server (N-9) — the real 0.60.0 `--version` is a 200 MB bundle and made the codex axis flake in parallel runs. Not done, by design: an `antigravity` profile — Simon installed `agy` 1.2.7 mid-session; it has no ACP mode (stream-json only), so it is PRD-providers §11 item 4 (own profile after a spike), noted there; needs its own task.
- 2026-09-21T10:50+08:00 — verified: DoD 1 `npx vitest run test/providers/acp.test.ts` — "gemini passes the F-59 conformance scenario…" (Allow then Deny cards from the `execute` kind, `write_task` through the real `crt mcp` shim + internal route, `session/cancel`, close) and "an ad-hoc { kind: "acp" } command passes the same scenario…"; 22/22.
- 2026-09-21T10:50+08:00 — verified: DoD 3 `test/providers/acp.test.ts` ad-hoc conformance (above); `test/providers/detect.test.ts` "3–4: …" (`config.acp` registers `acp`, resolves from either file, `setActive({ kind: "acp" })` refused) and `e2e/chat.spec.ts` "ad-hoc ACP agent…" (`PUT /__crt/config` with the object → 400).
- 2026-09-21T10:50+08:00 — verified: DoD 4 `npm run check` → 45 files, 604 passed, 1 skipped; build ok; `claude plugin validate ./plugin` and `.` pass; line counts in this Log and for the PR description.
- 2026-09-21T10:50+08:00 — DoD 2, half: `npm run e2e` on this Windows machine → 53 passed (the `acp` axis: `Fake Agent · gemini-2.5-pro · 0.60.0` footer, no resume hint, no badge, survives a reload; three parallel runs of chat.spec.ts green). The ubuntu half is the PR's CI run (ci.yml runs on pull_request only) — ticked when it is green.
- 2026-09-21T10:50+08:00 — DoD 5, half: `crt providers` with `GEMINI_CLI_HOME=<empty>` → `gemini   not logged in  Gemini CLI 0.60.0  not logged in — gemini`, with `GEMINI_API_KEY` set → `gemini   ready  Gemini CLI 0.60.0  logged in`, with Simon's cached Google login → `login unknown` (correct: the tier is refused only at session/new). The intake half needs a working credential: `probe/driver-run.mjs` (the real driver, real Gemini) ends with the N-7 `GEMINI_TIER_REFUSED` line. Waiting on Simon: a Gemini Developer API key in `~/.gemini/.env` (`GEMINI_API_KEY=…`) and `"selectedType": "gemini-api-key"` in `~/.gemini/settings.json`; then the trial-app intake runs and the row is ticked.
