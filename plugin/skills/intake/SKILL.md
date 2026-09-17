---
name: intake
description: Turn a CRT capture (annotated page + notes) into a self-contained task file with a definition of done. Used automatically by the CRT in-page chat; invoke manually with a capture path to run intake from the terminal.
argument-hint: "<path-to-capture-dir>"
---

You are running CRT intake (PRD §6.4). Your job is to understand exactly what the developer is pointing at, gather the context a future session will need, agree a definition of done, and write one task file. You do **not** fix the problem now.

The capture lives at `$ARGUMENTS` (a directory containing `capture.json` and PNG screenshots). If invoked from the in-page chat, the first message already contains the capture summary and, when your agent accepts them, the images.

## Steps

1. **Read the capture.** Open `capture.json`. Look at every screenshot (attached to the first message, or the PNG files next to `capture.json`). Note the URL, route, viewport, each annotation's note, selector, component chain, source file hints, outer HTML, and any console errors. A capture with **no annotations** and a `Developer's message:` line is a page-level chat (PRD F-68): the developer is asking about the page as a whole, so start from the route, the screenshot and the message instead of an element.

2. **Locate the code.** Using the component names, source hints, selectors, class names and visible text, find the file(s) that render each annotated element and the code that produces the observed state. Read enough surrounding code to explain *why* the page shows what it shows. Prefer your file search and read tools over running code; do not modify source.

3. **Clarify only if necessary.** If the developer's ask or the definition of done cannot be pinned down from the notes plus the code, ask at most three short questions in one message and wait. Otherwise do not ask.

4. **Propose the definition of done.** Reply with a one-paragraph restatement of the ask and a checklist of concrete, checkable DoD items (behavioural outcome, tests, no regressions). End that message with exactly this line and nothing after it: `Accept as-is, or tell me what to change, and I'll write the task.` (the in-page chat turns it into an **Accept** button). Wait for the developer: a reply of `Accept` means go to step 5 with the proposal unchanged; anything else is an edit — apply it, propose again, and end with the same line.

   **Quick-note mode (PRD F-14).** When the first message ends with a paragraph starting `Quick note (F-14)`, the developer sent their notes without opening the chat and is not watching. Skip the wait in step 4 and go straight to step 5 with the DoD you decided. Only fall back to step 3 if the notes plus the code genuinely do not say what is wanted; a question opens the panel for the developer, and the task is written once they answer.

5. **Write the task.**
   - **In-page intake** (a `write_task` tool from the `crt` MCP server is available): call it exactly once with `title`, `summary`, `context` (reproduction, component, file:line), `ask`, `definitionOfDone` (one checkable item per entry), `notes`, `priority`, `tags`, and `files` (every project-relative source file you identified). The CRT server allocates the `CRT-NNNN` id, renders the F-32 file, moves the capture's screenshots to `.crt/tasks/assets/CRT-NNNN/`, fills **Evidence** from the capture, sets `session:` and `provider:` to this session, and regenerates the index. Do not write the file yourself.
   - **Terminal intake** (no `write_task` tool): allocate the next ID by scanning `.crt/tasks/` for the highest `CRT-NNNN` and adding one. Create `.crt/tasks/CRT-NNNN-<slug>.md` in exactly the PRD F-32 format (frontmatter, then Summary, Context, Evidence, Ask, Definition of Done, Notes, Log). Move the capture's files to `.crt/tasks/assets/CRT-NNNN/` and reference the images from **Evidence**. List every source file you identified in `files:`. Set `session:` to your session id if your agent exposes one, else `session: null`. Add the first Log entry. Then run `crt task CRT-NNNN --validate` and fix anything it reports, and `crt tasks` to regenerate the index — where `crt` is `npx --no crt` if the project has it installed, else `npx -y claude-review-tool@0.3`. If your agent runs in a read-only sandbox, stop after step 4 and tell the developer to write the file with `crt` from a terminal.

6. **Confirm.** Reply with the task ID, the file path, and the DoD. Nothing else.

## Permissions during in-page intake

When your agent asks CRT before running a tool, reads, searches and read-only `git` commands run without prompting; every other command prompts the developer in the page with Allow / Deny and defaults to Deny after five minutes. When your agent runs in its own read-only sandbox instead, nothing prompts and nothing outside the sandbox can be changed; `write_task` is performed by the CRT server, so it still works. Either way, prefer reading code over running it: do not run builds, tests or the dev server unless the definition of done cannot be written without the result.

## Quality bar

The task must be workable by a session that has never seen this page, this conversation, or you. If you would need to ask the developer something to start work, that question must be answered in the file. Concrete beats complete: exact selectors, exact file paths with line numbers, exact expected values.
