---
id: CRT-0006
title: README troubleshooting section for the N-6 failure cases
status: in_progress
priority: normal
created: 2026-09-15T10:55:00+08:00
updated: 2026-09-15T10:43+08:00
url: null
route: null
session: null
tags: [docs, n-6]
files: [README.md, packages/server/src/serve.ts, packages/server/src/target.ts, packages/server/src/cli.ts, packages/server/src/session.ts]
---

## Summary
The README says `crt serve` "prints a single `crt: …` line telling you what to do" on failure, but never lists the failures. A developer hitting one of the PRD N-6 cases (target unreachable, no dev server found, port in use, no Claude login, no `.git`) has to read the source to know what the message means. Add a Troubleshooting section that quotes each message as the CLI actually prints it and says what to do.

## Context
PRD N-6: "Fails loudly and clearly: unreachable target, no Claude login, no `.git`, port in use — each has a one-line actionable message." The messages are `CrtError`s thrown in `packages/server/src/target.ts` (target validation, unreachable target, no dev server found), `packages/server/src/serve.ts` (port in use, cannot listen, intake instructions missing) and `packages/server/src/cli.ts` (bad flags, unknown task); the "no Claude login" text comes from `loginProblem()` in `packages/server/src/session.ts` and is shown in the in-page chat rather than on the CLI. `findProjectRoot()` in `packages/server/src/project.ts` does not error without `.git` — it falls back to the start directory — so that case is "what happens" rather than "what fails". Every CLI failure is one `crt: <message>` line on stderr plus a non-zero exit (see the header comment in `cli.ts`).

## Evidence
`grep -n "new CrtError(" packages/server/src/*.ts` lists every message. README.md currently ends its `crt serve` flags section with "If the target is down, no dev server can be found, or the port is taken, it prints a single `crt: …` line telling you what to do and exits non-zero." and has no Troubleshooting section.

## Ask
Add a `## Troubleshooting` section to `README.md`, after the `crt serve` flags section and before `## Repository`. One entry per case, in this order: no dev server found, target unreachable, target not a valid URL, port in use, no Claude login (in-page), no `.git` in the project. Each entry: the message as printed (quote the literal text from the source, with `<placeholders>` for interpolated values), one sentence on the cause, one sentence on the fix. Replace the sentence quoted under Evidence with a pointer to the new section. Do not change any source file.

## Definition of Done
- [ ] README.md has a `## Troubleshooting` section between the `crt serve` flags section and `## Repository`, with the six entries in the order listed in the Ask.
- [ ] Every quoted message matches the string in the source it comes from (compare against `grep -n "new CrtError(" packages/server/src/*.ts` and `loginProblem` in `session.ts`).
- [ ] No file outside README.md and `.crt/tasks/` changed.
- [ ] `npm run check` passes.

## Notes
This is a slice of CRT-0005 Ask item 2 pulled forward so M4 can verify the worker on a real task in this repo. The remaining README items (task format, script-tag fallback, how it works) stay in CRT-0005.

## Log
- 2026-09-15T10:55+08:00 — created during CRT-0004 as the worker dry-run task.
- 2026-09-15T10:43+08:00 — claimed by /crt:next, session c64c07d1-7374-4220-9ef8-a75895f1f945, branch crt/CRT-0006-readme-troubleshooting-for-n-6-failures
