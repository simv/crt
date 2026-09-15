---
id: CRT-0010
title: M7 — Provider abstraction, server side (profiles, resolution, detection, crt providers)
status: backlog
priority: normal
created: 2026-09-15T17:30:00+08:00
updated: 2026-09-15T17:30:00+08:00
url: null
route: null
session: null
tags: [m7, f-42, f-43, f-44, f-45, f-47, f-48, f-52, f-60, f-63, prd-providers]
files: [packages/server/src/session.ts, packages/server/src/providers/, packages/server/src/sessions.ts, packages/server/src/tasks.ts, packages/server/src/init.ts, packages/server/src/cli.ts, .claude/hooks/guard.mjs, .claude/agents/prd-reviewer.md, CLAUDE.md]
---

## Summary
Turn the single Claude session driver into a provider registry: profiles, the resolution order, auto-detection with printed reasons, `crt providers`, `provider:` in task files, and the stub as a real provider — with no new agent yet and no behaviour change for a Claude-only project.

## Context
`docs/PRD-providers.md` §5.1, §5.4, §5.5, §8 (M7), F-42, F-43, F-44, F-45, F-47 (server half), F-48, F-52, F-60, F-63, and the §9 amendments to CLAUDE.md. Today `packages/server/src/session.ts` is the only SDK module (guard hook `SDK_HOME`), `sessions.ts` builds driver options inline, `init.ts` reads three config keys, and `tasks.ts` writes `session:` from CRT's UUID. Independent of CRT-0009 except that the `codex` profile's markers and preflight shape are defined here (F-42) while its driver comes in CRT-0012.

## Evidence
No page capture: created from PRD-providers milestone M7.

## Ask
1. Create `packages/server/src/providers/{types,claude,codex,stub,detect,exec}.ts`. Move `session.ts` to `providers/claude.ts` unchanged in behaviour and add its profile fields (F-52). `session.ts` becomes the registry: `listProviders()`, `resolveProvider()` implementing the F-43 order (including `CRT_SESSION_STUB` as step 0 and `CRT_PROVIDER`), and the F-44 detection with reason strings exactly as worded there. `providers/codex.ts` may contain only the profile (markers, `launchEnv` placeholder, preflight via `exec.ts`, capabilities) with `start()` throwing "not implemented until CRT-0012".
2. `exec.ts`: PATH/PATHEXT resolution preferring `.exe`, npm shim parsing to a JS entry run with `process.execPath`, process-tree kill helpers; never pass a `.cmd` to `spawn`; `shell: false` (N-10).
3. `init.ts`: `provider` (string or the ACP object, object accepted from files only), `models`, `providers.<id>.command`; `.crt/config.local.json` layered over `.crt/config.json`; `crt init` gitignores the local file (F-35 amendment).
4. `sessions.ts`/`session-events.ts`: `SessionInfo.provider`, `nativeSessionId`; the new `init` event shape (F-47) with `claudeCodeVersion` replaced by `agentVersion`; the log line names the provider.
5. `tasks.ts`: `provider:` after `session:`, `session:` = native id or null, first Log bullet `created by intake session <id> (<provider>)`, validator ignores unknown frontmatter keys and accepts a missing `provider:` (F-48); `crt tasks --json` includes `provider`; `/crt:tasks` and `/crt:task` skills print it.
6. `cli.ts`: `crt serve --provider <id>`, `crt providers [--json] [--refresh]` in the exact F-45 layout; `CRT ready` line ends with the provider and reason.
7. F-63: guard hook `SDK_HOME`, `test/guard-hook.test.ts`, `prd-reviewer.md` rows, CLAUDE.md lines per PRD-providers §9, `test/sessions.test.ts` and `e2e/chat.spec.ts` resume-string assertions read from the profile.
8. Tests: F-60 fixture roots × preflight stubs × launch-env × config layers; the golden test from M7's DoD; every new `it(` cites its ID.

## Definition of Done
- [ ] `npm run check` and `npm run e2e` pass on the stub path with no behaviour change visible in the e2e specs beyond the footer string source.
- [ ] Golden test: a task rendered from a fixed `WriteTaskRequest` with clock, session id and capture id stubbed equals the checked-in v0.1 golden file plus `provider: claude` and the Log suffix.
- [ ] `crt providers` on this repo prints `→ claude — .claude/, CLAUDE.md`; on an empty fixture root `→ claude (default)`; on a root with `.codex/` and Codex preflight failing, the "looks like codex" reason.
- [ ] F-60 covers every worked example in F-44 and every layer in F-43, including `PUT`-replaces-flag (server-side function level; the route itself is CRT-0011).
- [ ] The guard hook blocks an Agent SDK import in `providers/codex.ts` and allows it in `providers/claude.ts`; `prd-reviewer` no longer flags `provider:` as a key-order violation.
- [ ] v0.1 task files in `.crt/tasks/` still validate with `crt task <ID> --validate`.

## Notes
Keep the move of `session.ts` as a pure rename in its own commit so the diff is reviewable. Do not add the codex `start()` here.

## Log
- 2026-09-15T17:30+08:00 — created from PRD-providers milestone M7 by the planning session that wrote docs/PRD-providers.md.
