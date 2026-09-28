---
id: CRT-0042
title: Server module boundaries and single sources — routes.ts, split init.ts, typed errors, one write_task shape, one skill list
status: done
priority: normal
created: 2026-09-24T12:15:00+08:00
updated: 2026-09-28T12:36:00+08:00
url: null
route: null
session: null
tags: [review-2026-09, refactor, server, n-18]
files: [packages/server/src/proxy.ts, packages/server/src/probes.ts, packages/server/src/setup.ts, packages/server/src/doctor.ts, packages/server/src/doctor-route.ts, packages/server/src/init.ts, packages/server/src/start.ts, packages/server/src/sessions.ts, packages/server/src/tasks.ts, packages/server/src/intake-message.ts, packages/server/src/captures.ts, packages/server/src/write-task.ts, packages/server/src/session-events.ts, packages/server/src/skills.ts, packages/server/src/capture-schema.ts, packages/server/src/landing.ts, packages/server/src/serve.ts, CLAUDE.md]
---

## Summary
Several imports in the server point the wrong way:
- `crt setup` loads the Agent SDK through `doctor.ts`.
- The small `probes.ts` pulls in the whole HTTP server for one path constant.
- `init.ts` mixes five concerns, and `start.ts` and `init.ts` import types from each other.

Several facts are also written in more than one place, and some copies have already diverged:
- the `write_task` input shape (3×), the capture reader (2×), the skill list (2× plus the plugin folder), the task frontmatter keys (3×);
- small helpers such as "open sessions", `safeOrigin` and "yes".

Some errors are classified by matching message text. This task fixes the boundaries and leaves one source per fact. Behaviour stays the same.

## Context
- **Import direction:**
  - `setup.ts:20` imports `installedPluginVersion` from `doctor.ts` → `session.ts:22` → `providers/claude.ts:35-47`, the static SDK import. That contradicts `cli.ts:19-21`.
  - `probes.ts:12` imports `SHUTDOWN_PATH` from `proxy.ts`, which drags in sessions, tasks, provider-routes and landing.
- **`init.ts` (686 lines)** mixes:
  - config types, read/write and mode (`:22-113`, `:583-686`);
  - the README template;
  - the agent-instructions section (`:147-250`);
  - framework detection and snippets (`:252-346`);
  - plan/apply.

  `init.ts:20` imports `Prompter` from `start.ts`, and `start.ts:23` imports `CrtMode` from `init.ts`. CLAUDE.md exempts `init.ts` / `project.ts` from the browser-entry import rule, because `integrations/vite.ts` needs config.
- **Error classification by text:**
  - `sessions.ts:397` and `:439` choose 404 or 500 with `/not found/.test(message)`, although `CaptureNotFoundError` exists (`intake-message.ts:22`).
  - `sessions.ts:519` compares `message === STALE_TOKEN_LINE`.
- **`write_task` shape:**
  - declared as the zod schema (`write-task.ts:21-32`), `WriteTaskRequest` (`session-events.ts:177-188`) and `NewTaskInput` (`tasks.ts:459-477`);
  - the priorities are listed twice outside `TASK_PRIORITIES` (`tasks.ts:19`);
  - `parseWriteTaskRequest` casts with `as` (`write-task.ts:44`).
- **Capture reader:** `readCapture` (`tasks.ts:554-564`) and `readCaptureBundle` (`intake-message.ts:29-39`); `captures.ts` owns the folder layout.
- **Skill list:**
  - `SKILL_NAMES` in both `setup.ts:28` and `skills.ts:25`, in different shapes;
  - the build copies every folder in `plugin/skills` (`scripts/copy-intake.mjs:24`), so a new skill is built but not installed, and no test compares the lists.
  - The `skills.ts:3,15-16` comments are stale (six skills; "the one deliberate write outside `.crt/`").
- **Frontmatter keys:** `FRONTMATTER_KEYS` (`tasks.ts:23-36`) is unused. The keys are hand-listed in `validateTaskText`, `parseTask` and `serializeTask`. The `listTasks` comment (`tasks.ts:393`) overstates what it skips.
- **Small duplicates:**
  - `ignoreEntriesPresent` (`init.ts:552-560`) is `missingIgnoreLines(root).length === 0`;
  - the yes-answer regex at `init.ts:474` duplicates `isYes` (`start.ts:390`);
  - "open sessions" ×3 (`proxy.ts:180,671`, `serve.ts:270`);
  - `safeOrigin` ×3 (`serve.ts:276-283`, `doctor.ts:233-238`, `doctor-route.ts:161-171`);
  - stderr first line ×2 (`setup.ts:83-90`, `doctor.ts:285`).
- **Embedded landing:** `proxy.ts:161-162` runs `countTaskFiles` and `listTasks` (reading and parsing every task synchronously) for every non-`/__crt` request in embedded mode, including `/favicon.ico` and source maps.
- **Dead code:** `isCaptureBundle` and `ScreenshotsInfo` (`capture-schema.ts:334,305`). `healthPayload` and `unrelaxableCsp` are exported but used only inside `proxy.ts`.
- **Stale comments:** `session-events.ts:3-4` and `sessions.ts:18-19` list only Claude, stub and Codex; `types.ts:45` omits `antigravity`.

## Evidence
No page capture: from the code review in session e145e7ac, 2026-09-24. The `/not found/` matching was confirmed at `sessions.ts:397,439`.

## Ask
1. Add `src/routes.ts` with no imports, holding every `/__crt/*` path constant (`CRT_PREFIX`, `SHUTDOWN_PATH`, `LOADER_PATH`, `CAPTURES_PATH`, `DOCTOR_PATH`, `SESSIONS_PATH`, `INTERNAL_PREFIX`, `OVERLAY_PATH`, `EARLY_PATH`, …) and `isCrtPath`. `proxy.ts` and `probes.ts` import from it; `proxy.ts` re-exports for compatibility where tests import from it.
2. Move `installedPluginVersion` into `setup.ts` (or a small `plugin.ts`); `doctor.ts` imports it.
3. Split `init.ts` into `config.ts` (types, read/write, mode), `instructions.ts`, `integration.ts` (framework detection, snippets) and `init.ts` (plan, apply). Re-export the moved names from `init.ts`. Move `Prompter` beside `prompt.ts`. Update the CLAUDE.md exception to `config.ts` / `project.ts`, and keep `production-guard.test.ts` green.
4. Replace the text matching with `instanceof CaptureNotFoundError` and a `StaleSessionError` class.
5. One `write_task` shape:
   - `z.enum(TASK_PRIORITIES)`;
   - `NewTaskInput = WriteTaskRequest & { session; provider?; captureId? }`;
   - a compile-time assertion that `z.infer<typeof writeTaskSchema>` equals `WriteTaskRequest`, with the interface kept in `session-events.ts` because the overlay imports it;
   - `createTask`'s required-field checks made to agree with zod (`title` ≥ 3, `context` ≥ 1): record the chosen rule.
6. One `readCapture(dir)` in `captures.ts`, throwing `CaptureNotFoundError`. `createTask` wraps it in `TaskFormatError`, keeping the 400.
7. One skill list in `skills.ts`; `setup.ts` maps it to `/crt:<name>`. A test pins it to `readdirSync(plugin/skills)`. Fix the stale comments.
8. Make `FRONTMATTER_KEYS` the ordered source for `serializeTask` (or delete it). Fix the `listTasks` comment.
9. Remove the small duplicates and dead code listed above; add a `SessionRegistry.openCount()`. The embedded landing reads the tasks folder in one pass, returning `{ files, backlog }`.

## Definition of Done
- [x] New test: importing `dist/setup.js` and `dist/probes.js` in a child process doesn't load `@anthropic-ai/claude-agent-sdk` or `proxy.js` (check via `--experimental-loader` or `process.moduleLoadList` equivalent, or a static import-graph test over `src/`).
- [x] New test: a generic error whose message contains "not found" on the sessions route answers 500; a missing capture answers 404; a stale token answers as before.
- [x] New test: `SKILL_NAMES` equals the sorted folders of `plugin/skills`.
- [x] A compile-time check that the zod schema and `WriteTaskRequest` agree; `npm run typecheck` fails if a field is added to one only (shown once in the Log).
- [x] `init.ts` is ≤ 250 lines; no import cycle between `start.ts` and `init.ts`; CLAUDE.md's browser-entry exception names the new module; `production-guard.test.ts` and `integrations-build.test.ts` green.
- [x] `isCaptureBundle`, `ScreenshotsInfo` and the other listed dead exports are gone (grep shows no uses).
- [x] All existing tests pass with expected strings unchanged: `project-init`, `instructions-block`, `mode`, `vite-plugin`, `setup`, `doctor`, `doctor-route`, `start`, `proxy`, `landing`, `tasks`, `sessions`, `mcp-stdio`, `skills`, `captures`, `intake-message`.
- [x] `npm run check` green; `npm run e2e` green.

## Notes
Considered and deferred, with reasons:
- **Turning `handleCrtRoute` into a route table**, with `refuseOrigin` / `onlyGetHead` / `serveFile` helpers in `http.ts`. Worth doing, but the order of checks is part of the security contract (internal and doctor routes before CORS), and the file carries N-21's constraint. Revisit when a new route next needs adding; that change can introduce the helpers with a test pinning the order.
- **Async capture writes** (`captures.ts:62-73`, synchronous on the request path). Real but small: captures are rare and local. Take it if the capture route is touched.
- **`capture-schema.ts` DSL → zod.** A direction, not a task: the DSL carries F-id docs the tests rely on.
- **Pruning ended sessions' event logs** (`sessions.ts:219`). Replay-from-0 is documented intent (F-66). Revisit if memory is ever observed to grow.
- **Provider names hard-coded outside `providers/`** (`skills.ts:79,89`, `init.ts:209`, `landing.ts:250,345`). Fold in here if cheap, via profile fields (`instructionsFile`, `commandName`); otherwise leave for the next provider.

## Log
- 2026-09-24T12:15+08:00 — filed by hand from the code review in session e145e7ac (Simon's request).
- 2026-09-28T11:55+08:00 — claimed by /crt:next, session 34dee5f6-5467-4b2b-ad34-0fb31cd7442b, branch crt/CRT-0042-server-module-boundaries (worktree .claude/worktrees/CRT-0042 off origin/main). Picked over CRT-0041 (lowest backlog ID on main) because CRT-0041 is blocked on its own branch and its blocker, a logged-out Claude Code, still holds (claude auth status: loggedIn false).
- 2026-09-28T12:33+08:00 — decisions: (1) `routes.ts` holds every `/__crt/*` path plus `HEALTH_PATH`, `PROVIDERS_PATH`, `CONFIG_PATH`, `INTERNAL_WRITE_TASK_PATH`, `FAVICON_PATH` and `isCrtPath`; the owners that tests import from re-export their constant (`doctor-route`, `mcp-stdio`, `sessions`), no test imported one from `proxy.ts`, so it re-exports nothing. (2) `installedPluginVersion` went into `setup.ts` (no `plugin.ts`); `doctor.test.ts` now imports it from there. (3) `readmeTemplate`, `README_FILE` and `REPO_URL` moved with the CRT section into `instructions.ts` ("what `crt init` writes for readers"), which is what brings `init.ts` to 249 lines; `readText`/`readJson` live in `config.ts` and are shared by the three split modules. `isYes` stays in `start.ts` and `init.ts` imports it (start.ts imports only `config.ts` and `prompt.ts` types, so there is no cycle). (4) The createTask rule: `writeTaskShape`'s minimums counted after trimming — title ≥ 3 characters ("title is required" when blank, "title needs at least 3 characters" otherwise), summary/context/ask non-blank, one non-blank DoD item; blank context is now a 400 instead of "See Evidence." (zod already refused an empty one, so only whitespace-only context changes). (5) One `SKILL_NAMES` in `skills.ts`, reordered to the F-86 order (serve, next, tasks, task, done, intake, init) so the pinned `crt setup` line is unchanged; `crt skills install` writes the same seven files in that order. (6) `CaptureNotFoundError` now names the capture by folder name (`capture <id> not found: …`) instead of its full path, and the unreadable-capture `TaskFormatError` reads `capture <id> not found: <cause>` instead of `… not found or unreadable (<cause>)`; no test pinned either wording. (7) `firstLine` (stderr first line) lives in `providers/exec.ts`; `safeOrigin` in `target.ts`. (8) Also updated `.claude/agents/prd-reviewer.md` (its N-5 and N-18 rows named `init.ts`) so the reviewer does not flag `vite.ts` → `config.ts`. Deferred note "provider names outside providers/" not taken: not cheap without new profile fields.
- 2026-09-28T12:33+08:00 — compile-time check shown: adding `severity?: string` to `WriteTaskRequest` only → `npm run typecheck`: `src/write-task.ts(47,6): error TS1360: Type 'true' does not satisfy the expected type 'false'.`; adding `severity: z.string()` to the schema only → the same error at (48,6). Both reverted.
- 2026-09-28T12:33+08:00 — verified: import graph — `test/module-boundaries.test.ts` transpiles each `src/` file as tsc emits it and walks the static imports: `setup.ts` and `probes.ts` reach neither `@anthropic-ai/claude-agent-sdk`, `proxy.ts`, `session.ts` nor `providers/claude.ts`, while `serve.ts` does (the control).
- 2026-09-28T12:33+08:00 — verified: sessions errors — `sessions.test.ts` "the session routes answer 404 for a missing capture by its error type, and 500 for anything else…" (a registry throwing `Error("model claude-x not found")` → 500 on POST /__crt/sessions and …/capture; a missing capture → 404 on both) and "write_task for a session that ended after its token was checked is a bare 404…" (`StaleSessionError` → 404, empty body, one log line); the existing stale-token assertion in the §5.3 test is unchanged and green.
- 2026-09-28T12:33+08:00 — verified: `skills.test.ts` "SKILL_NAMES is the plugin's skill folders…" pins `[...SKILL_NAMES].sort()` to `readdirSync(plugin/skills).sort()` and `SLASH_COMMANDS` to the same list.
- 2026-09-28T12:33+08:00 — verified: compile-time check — `true satisfies Same<z.infer<typeof writeTaskSchema>, WriteTaskRequest>` in `write-task.ts`, failing in both directions as logged above.
- 2026-09-28T12:33+08:00 — verified: `wc -l src/init.ts` = 249 (also pinned by module-boundaries.test.ts); `start.ts` imports nothing from `init.ts` and `prompt.ts` nothing from `start.ts` (same test); CLAUDE.md's exception reads `config.ts`/`project.ts`; `production-guard.test.ts` and `integrations-build.test.ts` (now expecting `../config.js`, `../project.js`) green in `npm run check`.
- 2026-09-28T12:33+08:00 — verified: `grep -rn "isCaptureBundle|ScreenshotsInfo|ignoreEntriesPresent|readCaptureBundle|export function healthPayload|export function unrelaxableCsp"` over packages/ and plugin/ (dist excluded) finds nothing.
- 2026-09-28T12:33+08:00 — verified: every listed test file passes with its expected strings as they were; the test edits are imports only (`doctor.test.ts`, `intake-message.test.ts`, `providers/conformance.ts`), the vite import list in `integrations-build.test.ts`, and the source path of the unchanged "(docs/integration.md › Production)" string in `docs.test.ts` (now `integration.ts`).
- 2026-09-28T12:33+08:00 — verified: `npm run check` exit 0 (58 files, 762 passed, 2 skipped; one earlier run hit a Windows EPERM in antigravity.test.ts's temp-dir cleanup, green on re-run). `npx playwright test --workers=2`: 73/74 locally; the one failure is embedded.spec.ts:177 expecting "no dev server on ports 3000, 5173, 8080, …", which cannot hold here while the Apex project's servers listen on :3000 and :8080 (another project's processes, left alone); the e2e CI job on ubuntu is the clean run.
- 2026-09-28T12:33+08:00 — ready for review: changed packages/server/src/{routes,config,instructions,integration}.ts (new), init.ts, prompt.ts, start.ts, probes.ts, proxy.ts, inject.ts, sessions.ts, captures.ts, intake-message.ts, tasks.ts, write-task.ts, session-events.ts, setup.ts, doctor.ts, doctor-route.ts, skills.ts, serve.ts, target.ts, capture-schema.ts, cli.ts, session.ts, landing.ts, provider-routes.ts, mcp-stdio.ts, integrations/vite.ts, providers/exec.ts, providers/types.ts; tests module-boundaries (new), sessions, tasks, skills, doctor, intake-message, integrations-build, docs, providers/conformance; CLAUDE.md; .claude/agents/prd-reviewer.md. prd-reviewer: PR-ready with notes (test titles now cite F/N ids; the two wording changes are item 6 above). CRT-0041's branch also touches sessions.ts (task_written); whichever merges second resolves that.
- 2026-09-28T12:36+08:00 — done; closed in https://github.com/simv/crt/pull/98 (CI green on 073c7e7: check ubuntu + windows, e2e ubuntu green — the clean run of embedded.spec.ts:177, CodeQL).
