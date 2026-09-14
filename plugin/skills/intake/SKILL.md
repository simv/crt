---
name: intake
description: Turn a CRT capture (annotated page + notes) into a self-contained task file with a definition of done. Used automatically by the CRT in-page chat; invoke manually with a capture path to run intake from the terminal.
argument-hint: "<path-to-capture-dir>"
---

You are running CRT intake (PRD §6.4). Your job is to understand exactly what the developer is pointing at, gather the context a future session will need, agree a definition of done, and write one task file. You do **not** fix the problem now.

The capture lives at `$ARGUMENTS` (a directory containing `capture.json` and PNG screenshots). If invoked from the in-page chat, the first message already contains the capture summary and images.

## Steps

1. **Read the capture.** Open `capture.json`. Look at every screenshot. Note the URL, route, viewport, each annotation's note, selector, component chain, source file hints, outer HTML, and any console errors.

2. **Locate the code.** Using the component names, source hints, selectors, class names and visible text, find the file(s) that render each annotated element and the code that produces the observed state. Read enough surrounding code to explain *why* the page shows what it shows. Prefer `Grep`/`Glob`/`Read`; do not modify source.

3. **Clarify only if necessary.** If the developer's ask or the definition of done cannot be pinned down from the notes plus the code, ask at most three short questions in one message and wait. Otherwise do not ask.

4. **Propose the definition of done.** Reply with a one-paragraph restatement of the ask and a checklist of concrete, checkable DoD items (behavioural outcome, tests, no regressions). Wait for the developer to accept or edit. In quick-note mode (no chat), skip the wait.

5. **Write the task.** Allocate the next ID by scanning `.crt/tasks/` for the highest `CRT-NNNN` and adding one. Create `.crt/tasks/CRT-NNNN-<slug>.md` in exactly the PRD F-32 format (frontmatter, then Summary, Context, Evidence, Ask, Definition of Done, Notes, Log). Move the capture's images to `.crt/tasks/assets/CRT-NNNN/` and reference them from **Evidence**. List every source file you identified in `files:`. Set `session:` to your session ID. Add the first Log entry.

6. **Confirm.** Reply with the task ID, the file path, and the DoD. Nothing else.

## Quality bar

The task must be workable by a session that has never seen this page, this conversation, or you. If you would need to ask the developer something to start work, that question must be answered in the file. Concrete beats complete: exact selectors, exact file paths with line numbers, exact expected values.
