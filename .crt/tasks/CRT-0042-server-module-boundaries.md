---
id: CRT-0042
title: Server module boundaries and single sources — routes.ts, split init.ts, typed errors, one write_task shape, one skill list
status: backlog
priority: normal
created: 2026-09-24T12:15:00+08:00
updated: 2026-09-24T12:15:00+08:00
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
- [ ] New test: importing `dist/setup.js` and `dist/probes.js` in a child process doesn't load `@anthropic-ai/claude-agent-sdk` or `proxy.js` (check via `--experimental-loader` or `process.moduleLoadList` equivalent, or a static import-graph test over `src/`).
- [ ] New test: a generic error whose message contains "not found" on the sessions route answers 500; a missing capture answers 404; a stale token answers as before.
- [ ] New test: `SKILL_NAMES` equals the sorted folders of `plugin/skills`.
- [ ] A compile-time check that the zod schema and `WriteTaskRequest` agree; `npm run typecheck` fails if a field is added to one only (shown once in the Log).
- [ ] `init.ts` is ≤ 250 lines; no import cycle between `start.ts` and `init.ts`; CLAUDE.md's browser-entry exception names the new module; `production-guard.test.ts` and `integrations-build.test.ts` green.
- [ ] `isCaptureBundle`, `ScreenshotsInfo` and the other listed dead exports are gone (grep shows no uses).
- [ ] All existing tests pass with expected strings unchanged: `project-init`, `instructions-block`, `mode`, `vite-plugin`, `setup`, `doctor`, `doctor-route`, `start`, `proxy`, `landing`, `tasks`, `sessions`, `mcp-stdio`, `skills`, `captures`, `intake-message`.
- [ ] `npm run check` green; `npm run e2e` green.

## Notes
Considered and deferred, with reasons:
- **Turning `handleCrtRoute` into a route table**, with `refuseOrigin` / `onlyGetHead` / `serveFile` helpers in `http.ts`. Worth doing, but the order of checks is part of the security contract (internal and doctor routes before CORS), and the file carries N-21's constraint. Revisit when a new route next needs adding; that change can introduce the helpers with a test pinning the order.
- **Async capture writes** (`captures.ts:62-73`, synchronous on the request path). Real but small: captures are rare and local. Take it if the capture route is touched.
- **`capture-schema.ts` DSL → zod.** A direction, not a task: the DSL carries F-id docs the tests rely on.
- **Pruning ended sessions' event logs** (`sessions.ts:219`). Replay-from-0 is documented intent (F-66). Revisit if memory is ever observed to grow.
- **Provider names hard-coded outside `providers/`** (`skills.ts:79,89`, `init.ts:209`, `landing.ts:250,345`). Fold in here if cheap, via profile fields (`instructionsFile`, `commandName`); otherwise leave for the next provider.

## Log
- 2026-09-24T12:15+08:00 — filed by hand from the code review in session e145e7ac (Simon's request).
