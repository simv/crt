# CRT v0.7 — Compact chat: what you sent, what the agent proposes — PRD

| | |
|---|---|
| **Status** | Built — M25–M27 landed (CRT-0030 as #84 and CRT-0031 as #85, both 2026-09-23; F-122 applied by CRT-0033 as #83 the same day); §10 ticked with evidence by M27; `0.7.0` released and promoted 2026-09-23; F-123 applied by CRT-0044 on 2026-09-24, after the release |
| **Owner** | Simon (simv) |
| **Repo** | https://github.com/simv/crt |
| **Baseline** | `main` at 5fdcbd8 = v0.6.0 (PRD-polish M20–M24, CRT-0029) |
| **Amends** | `docs/PRD.md` (F-24, F-25, F-27, F-28, F-37, F-40, §4), `docs/PRD-providers.md` (§5 the event contract), `README.md`, `docs/how-it-works.md`, `plugin/skills/intake/SKILL.md` step 4, `plugin/skills/done/SKILL.md`, `plugin/skills/next/SKILL.md`, `plugin/skills/task/SKILL.md`, `CLAUDE.md` — every amended statement is listed in §9 |
| **Design inputs** | Simon's request of 2026-09-23 (§1); the chat panel as built (`packages/overlay/src/chat.ts`), the first message as built (`packages/server/src/intake-message.ts`), the intake skill's step 4 |

This document extends `docs/PRD.md`, `docs/PRD-providers.md`, `docs/PRD-setup.md`, `docs/PRD-embedded.md` and `docs/PRD-polish.md`. Everything in the five stays in force unless §9 amends it. Requirement IDs continue the numbering (F-119…F-123, N-28…N-30, after PRD-polish F-118 / N-27); milestones are M25–M27 (after PRD-polish M24), one task file each. A build session reads the five earlier PRDs, this file, `CLAUDE.md` and its task file, and nothing else, to know what "correct" means. §12 tells the builder what to do when an agent's message does not have the shape this document assumes.

---

## 1. Problem and scope

Simon, 2026-09-23, after v0.6: *"When you first click on an element, type your note and click Send to Claude, the user currently sees the full transcript including all the context information. Convert that to a pill or badge the user can view if they want, but otherwise only see what they sent in the chat. The same with the plan back from the chat bot: summarised, with a pill the user can click on to see the full proposed plan."*

What the popover shows today, in order, after **Send**:

1. **The developer's own message is buried.** The first `user` bubble is the whole F-24 first message as the agent receives it — `CRT intake for capture …`, the bundle path, the page line, the framework line, console and network counts, then every annotation with its element, selector, text, component chain, source hint and box, then `Attached images: …` — twenty-odd lines of black bubble in a popover 360 px wide, and the note the developer typed ten seconds ago is one quoted fragment in the middle of it. For a provider that takes its instructions in the first message (PRD-providers F-51: Codex, Gemini, ACP, Antigravity) the same bubble also carries the entire intake skill above a rule. For a quick note (F-14) the bubble ends with the F-14 paragraph.
2. **The proposal is the longest thing in the thread.** The F-27 step-5 message — the restatement, `Proposed definition of done:`, the checklist, the fixed closing line — is what the developer has to read before pressing **Accept**, and it arrives as one grey bubble the size of the panel, with the closing line repeated by the Accept bar right under it.

Nothing about the *content* is wrong: the agent needs every line of the first message (F-24) and the proposal is exactly what F-27 asks for. The transcript just shows the developer the agent's view instead of their own. **Scope of v0.7.** (1) The first `user` bubble shows what the developer wrote — the note, or the notes of the annotations they sent, or the page-level message — with the rest of the message folded behind a pill. (2) A proposal shows its restatement and a `Definition of done · N items` pill, and unfolds to the full plan on click. (3) Release 0.7.0.

## 2. Goals

1. **The transcript reads as a conversation.** After Send, the developer sees their own words in the black bubble, then the agent's reply. Nothing the agent received is hidden from them: it is one click away, in the same bubble, on every reconnect and reload.
2. **The proposal is reviewable at a glance.** The restatement and the item count are visible; the checklist unfolds in place; the Accept bar is unchanged.
3. **Nothing the agent receives changes.** The first message, the intake instructions, the images and the `write_task` contract are byte-for-byte what v0.6 sends (N-28). This is a display change.
4. **No model in the loop.** Every summary is a deterministic parse of text the panel already has, unit-tested without a DOM (N-29); when the parse finds nothing to fold, the bubble is verbatim, as today.
5. **No driver changes.** The five provider drivers and the stub emit the same events; the registry adds the one field the panel needs (PRD-providers §5 layering stays: drivers know nothing about the overlay).

## 3. Non-goals (v0.7)

- **Changing the first message, the intake skill's steps, or the `write_task` contract.** F-24, F-27 steps 1–3 and 5–6, F-31 unchanged. Step 4's wording is tightened so its shape is deterministic (F-120); what it asks for is the same.
- **Summarising with a model**, or asking the agent to write a summary. The lead of the proposal *is* the agent's restatement (F-27 step 5 already asks for one paragraph); the count is counted.
- **Folding anything else**: tool lines are already collapsed (F-25); permission cards, questions (step 3), the final confirmation (step 6), typed replies and system lines stay verbatim.
- **Persisting fold state** across reloads, or per-thread preferences. Folded is the default every time the bubble is built.
- **Redesigning the popover** (size, placement, colours). The pills use the bubble's own ink at reduced alpha — no new colour tokens (PRD-polish F-112; `tokens.ts` unchanged).

## 4. Scenario changes

PRD §4 step 3 gains: *The popover becomes the chat. The black bubble at the top is Simon's note — "this total doesn't include the discount" — with a small `Capture · 2 images` pill under it; the twenty lines of page, selector and console detail Claude was given are behind the pill, not in his face. When Claude proposes the definition of done, the bubble shows the one-paragraph restatement and a `Definition of done · 3 items` pill; Simon opens it, reads the three items, and presses **Accept**.*

## 5. Design

### 5.1 The capture message, folded (F-119)

**Where the developer's words come from.** Not from the overlay's annotation store — a thread opened from the session list (F-30) or re-attached after a reload (F-66) may have no local annotations, and the notes could have been edited between capture and send. The server holds the capture bundle when it builds the first message (`sessions.ts` `firstMessage()`), so it is the server that says what the developer wrote. The `user` event gains one optional field:

```ts
| { type: "user"; text: string; images: string[]; intake?: IntakeSummary }

interface IntakeSummary {
  captureId: string;
  /** Page-level chat (F-68): the developer's message. Null when annotations were sent. */
  note: string | null;
  /** The annotations in the capture, in order; `label` is the F-8 label the popover header shows (component + selector). */
  annotations: Array<{ n: number; kind: "select" | "box" | "pin"; note: string; label: string }>;
  /** F-14: the message ended with the quick-note paragraph. */
  quick: boolean;
  /** F-51: the intake instructions were prepended to this message. */
  instructions: boolean;
}
```

`summarizeIntake(bundle, opts)` in `intake-message.ts` builds it next to `summarizeCapture` (the F-30 one-liner), pure and unit-tested. The registry attaches it in `record()` to **the first `user` event of a session** — by construction the intake message: a warm start sends nothing before `attachCapture`, and `firstMessage()` runs exactly once per session. No driver emits it, none knows it exists (PRD-providers §5). The SSE replay carries it because events are stored as recorded, so a reconnecting or reloaded panel gets the same bubble.

**What the bubble shows.** When `intake` is present, `userBubble` renders:

- the developer's words as the bubble body — `note` for a page-level chat; else one line per annotation: the note verbatim, or, for an annotation without a note, its `#n · label` line (`#2 · CartSummary span.cart-total`); when several annotations went in one send (F-65's checkbox), every line is prefixed `#n`;
- a **pill row** under the words, in the bubble's own ink at reduced alpha: `▸ Capture · 2 images` (the word `Capture`, the image count when images were attached, `· quick note` when `quick`, `· with instructions` when `instructions`); the pill is a `<button aria-expanded>` and toggles a **fold body** under it: the full `text` as sent, `white-space: pre-wrap`, monospace at 11 px, `max-height: 40vh`, scrollable, with the `📎 …` image list above it. Folded by default. Toggling never scrolls the log.

When `intake` is absent — a typed reply, or any later turn — the bubble is what it is today. The F-14 paragraph and the F-51 instructions are inside the fold body, never in the visible words.

**The marker and the popover header** (F-66, F-67) are unchanged; the header already names the thread.

### 5.2 The proposal, folded (F-120)

**Shape.** F-27 step 5 asks for "a one-paragraph restatement of the ask and a checklist of concrete, checkable DoD items" ending on the fixed line. The skill's step 4 now says the shape exactly, in this order, so it can be parsed: **(a)** one paragraph restating the ask — no heading, no list; **(b)** the line `Proposed definition of done:`; **(c)** the checklist, one `- [ ] ` item per line; **(d)** the fixed closing line, alone. The stub's script has this shape today. `accept-line.test.ts` grows a row pinning `Proposed definition of done:` in the skill and the stub, the way it pins the closing line.

**Parse.** `summarizeProposal(text)` in `packages/overlay/src/proposal.ts`, pure, unit-tested from `packages/server/test`:

```ts
interface ProposalSummary {
  /** (a): the first paragraph that is not a heading, a list item or a fence; the first line when there is none. */
  lead: string;
  /** (c): the `- [ ]` / `- [x]` items in order (any other list item counts too). */
  items: string[];
  /** The message with the closing line removed (F-27's sentinel is chrome the Accept bar renders). */
  body: string;
}
```

**When.** A bubble is a proposal when its turn has ended — `assistant_end` for the message (or the `result` that closes the turn, whichever comes first) — and `endsWithAcceptLine(text)` is true. While the text streams the bubble is verbatim, as today; at the end it folds. On replay the events arrive in order, so a re-attached panel shows it folded at once. A question (step 3), a confirmation (step 6) or any message not ending on the line never folds.

**What the bubble shows.** The `lead`, rendered through `renderMarkdown`'s inline rules and clamped to three lines while folded (`-webkit-line-clamp`); a pill `▸ Definition of done · N items` (N = `items.length`; `▸ Full proposal` when N is 0, §12 rule 1); unfolded: the whole `body` rendered by `renderMarkdown`, exactly as an unfolded v0.6 bubble minus the closing line, and the lead unclamped. The Accept bar (F-27) is untouched: it still appears when the state is `idle`, no task is written and the last message ends on the line. After **Accept** or an edit, the proposal stays folded as history; a second proposal folds on its own.

### 5.3 The pill

One component, used by both bubbles: `fold(label, body)` in `chat.ts` — a `<button class="fold-pill" aria-expanded="false">` with `▸` / `▾` and the label, then a `<div class="fold-body" hidden>`. Keyboard-operable, focus ring in the accent (`tokens.ts` `ACCENT`, already imported by `chat.ts`), no animation. `.msg.user .fold-pill` is white at 15 % alpha on the black bubble; `.msg.assistant .fold-pill` is ink at 6 % on the grey one — the same alphas the tool lines and inline code use today.

### 5.4 What changes where

| Area | File(s) | Change |
|---|---|---|
| Event contract | `packages/server/src/session-events.ts` | `IntakeSummary`, the optional `intake` on the `user` event |
| First message | `packages/server/src/intake-message.ts` | `summarizeIntake()`; `buildIntakeMessage` and `renderIntakeText` unchanged (N-28) |
| Registry | `packages/server/src/sessions.ts` | `firstMessage()` keeps the summary on the entry; `record()` attaches it to the first `user` event |
| Panel | `packages/overlay/src/chat.ts` | `userBubble` with the fold; the proposal fold at `assistant_end` / `result`; `fold()`; `CHAT_CSS` rows |
| Parse | `packages/overlay/src/proposal.ts` (new) | `summarizeProposal()` |
| Skill | `plugin/skills/intake/SKILL.md` step 4 | the four-part shape; `dist/intake.md` follows from the build |
| Tests | `test/intake-message.test.ts`, `test/sessions.test.ts`, `test/accept-line.test.ts`, `test/proposal.test.ts` (new), `e2e/chat.spec.ts`, `e2e/screenshots.spec.ts` | §6 lists the rows |
| Docs | `README.md` › The loop step 3, `docs/how-it-works.md` › Intake session, `docs/images/chat.png` | the sentence per §9; the screenshot regenerated |

## 6. Functional requirements

### 6.1 The capture message

- **F-119 (Must) The capture message, folded.** The `user` event carries `intake` per §5.1 on the first `user` event of every session that received a capture — for every provider, every stub variant, quick notes (`quick: true`) and first-message providers (`instructions: true`) — and on no later `user` event; `buildIntakeMessage` and `prependInstructions` produce byte-identical text and images to v0.6 (N-28). The panel renders a `user` event with `intake` as §5.1: the developer's words visible, `Capture …` pill, the fold body with the full text and the image list; a `user` event without `intake` renders as today. Tested: unit rows for `summarizeIntake` (page-level note, one annotation with a note, three annotations of the three kinds with one note missing, the quick flag, the instructions flag, the label format); registry rows that the first `user` event of a stub session has `intake` with the capture's id and notes, that the `first-message` variant sets `instructions: true`, that a quick note sets `quick: true`, that the second `user` event has none, and that the events replayed to a second subscriber carry it; e2e rows in `chat.spec.ts`: after Send the first `.msg.user` shows the note and not `CRT intake for capture`, the pill reads `Capture · 2 images`, clicking it reveals the full text with `CRT intake for capture <id>` and `Attached images: viewport (annotated), annotation 1`, clicking again hides it; a page-level chat shows the developer's message; a grouped send shows both notes with `#1` / `#2`; an annotation without a note shows its label; a reload re-attaches the thread with the same folded bubble (F-66). The existing assertions on `.msg.user` that read the full text now read the fold body.

### 6.2 The proposal

- **F-120 (Must) The proposal, folded.** `plugin/skills/intake/SKILL.md` step 4 states the four-part shape of §5.2 (`accept-line.test.ts` pins `Proposed definition of done:` in the skill and the stub; `intake-skill.test.ts`'s existing rows still pass). `summarizeProposal` per §5.2, exported from `packages/overlay/src/proposal.ts`, with unit rows: the stub's two proposals (lead, 2 and 1 items, the body without the closing line); a proposal with a heading and a fenced block before the checklist; a checklist of `- ` items without boxes; a message with no list (items `[]`, lead = first paragraph); the closing line with markdown emphasis and curly quotes (the `endsWithAcceptLine` tolerances); a question (not a proposal — the caller checks `endsWithAcceptLine` first). The panel folds a message per §5.2 when its turn ends and it ends on the line, never earlier and never otherwise; the Accept bar's rule (F-27) is unchanged. e2e rows: the stub's proposal streams verbatim then folds into the lead and `Definition of done · 2 items`; the closing line is not visible in the bubble; the Accept bar is visible; clicking the pill shows the two checkbox items; **Accept** sends `Accept` and writes the task; the proposal stays folded afterwards; a typed edit (`no tests`) yields a second proposal that folds on its own with `1 item`; a question from the quick-note `ask me` script is not folded; after a reload the proposal is folded on re-attach.

### 6.3 Workflow

- **F-122 (Must) Close-out in the PR.** Simon, 2026-09-23: closing a task after its merge meant a second PR (`crt/<ID>-done`) just to flip `review → done` on a protected `main`. `/crt:done <ID>` now closes a task from its **reviewed, open** pull request: precondition `status: review` and a PR on `crt/<ID>-<slug>` whose `reviewDecision` is not `CHANGES_REQUESTED`, whose checks pass and which is not conflicting; it sets `status: done` with `— done; closed in <PR URL>` in the Log as the **last commit on the PR branch**, pushes, merges the PR (`gh pr merge --squash --delete-branch`, or the project's method) and returns to the default branch. A refused merge leaves the done commit on the branch and reports the merge command; nothing opens a second PR. The post-merge path stays only as the fallback for a task whose PR merged before it was closed. The flow reads claim → build → commit → review → done → commit → merge; `/crt:next` still never merges (F-37), and a task is finished only when it is `done`, merged and without an open PR (`CLAUDE.md` › Work tracking). Applied directly by CRT-0033 (no milestone): the `done` skill, `/crt:task`'s review line, the README's loop block, `CLAUDE.md` › Work tracking and the `*v0.7*` note on PRD F-40 say the same; `test/skill-pin.test.ts` and `claude plugin validate ./plugin` stay green. CRT-0033 is the first task closed this way.
- **F-123 (Must) The worker sees its CI through, and merges when the project says so.** Simon, 2026-09-24: `/crt:next` stopped at the open PR, so nobody watched its CI. CRT-0035's PR #90 sat green until he asked why the task was not finished; the fix should go into the skill "so other users of the tool will benefit from the improvement". After `gh pr create`, `/crt:next` waits for the PR's checks **in the same turn** with `gh pr checks <n> --watch`, re-running it while the run has not registered. No checks two minutes after the push means the PR has no CI, which counts as green. A failing check its change caused is fixed, logged and pushed, at most two rounds; an unrelated failure is re-run once. A check still red, or still running after 30 minutes, is named in the Log and the reply, and the task stays `review`. When `.crt/config.local.json` or `.crt/config.json` (the local file first) has `"worker": { "merge": true }`, the worker then runs the F-122 close-out itself: `done` with `— done; closed in <PR URL> (CI green on <sha>)` as the branch's last commit, and that commit's checks waited for. Then comes a bare `gh pr merge <n> --squash --delete-branch`, or the method `CLAUDE.md` names; a `BEHIND` branch gets the base merged in, never rebased. When the local half fails in a worktree, `gh pr view --json state` says whether the merge happened, and a refused merge leaves the done commit with the merge command in the reply. Without the key the worker stops at `review` with CI green and never merges, because merging someone's project without their review is not the worker's default. Auto-merge is never enabled. Only the skill reads the key: the server ignores it and `crt init` does not write it. The reply's status line says `review — CI green`, `review — CI red: <check>` or `done — merged`. Applied directly by CRT-0044 (no milestone), after the 0.7.0 release, to the `next` skill (new steps 7 Wait for CI and 8 Finish; Blocked becomes step 9), README › The loop, `CLAUDE.md` › Work tracking and this repo's `.crt/config.json` (`worker.merge: true`). `test/next-skill.test.ts` pins the skill text and the README key; `claude plugin validate ./plugin` and `test/skill-pin.test.ts` stay green. It ships with the next release: an installed 0.7.0 plugin still stops at the PR.

### 6.4 Release

- **F-121 (Must) Release 0.7.0.** Version `0.7.0` in `packages/server/package.json`, both plugin manifests and the seven skills' pin (`claude-review-tool@0.7`; `test/skill-pin.test.ts` green); `npm run screenshots` re-run and `docs/images/chat.png` committed with the folded bubble (PRD-polish F-116 — the overlay's UI changed); §9 rows applied and §10 ticked with evidence; the release notes name M25–M26; `v0.7.0` tagged, the release workflow green, the staged version promoted on npm (Simon); `crt setup` from the published package installs `crt@crt 0.7.0`.

## 7. Non-functional requirements

- **N-28 Nothing the agent receives changes.** For the same capture and options, `buildIntakeMessage` and `prependInstructions` return the same `text` and `images` at the v0.7 release as at 5fdcbd8; the intake skill's steps, its `write_task` call and the Quick-note paragraph are unchanged in meaning. `test/intake-message.test.ts`'s existing rows are the evidence; the M25 Log records the SHA-256 of `renderIntakeText`'s output for the test fixture before and after.
- **N-29 Deterministic summaries.** `summarizeIntake` and `summarizeProposal` are pure functions of their input, call nothing, and are unit-tested from `packages/server/test` without a DOM (the `owner-stack.test.ts` pattern). No summary is produced by a model or by the agent beyond what F-27 step 5 already asks it to write.
- **N-30 Nothing lost, nothing slower.** The full first message and the full proposal are in the DOM of their bubble (hidden, one click away) and in every SSE replay; a fold pill is a real `<button>` with `aria-expanded`, reachable by Tab, toggled by Enter and Space; no animation, no timer; the overlay bundle grows by ≤ 2 KB gzipped (`dist/overlay.js` at 5fdcbd8: 36.7 KB gzipped; N-3 holds); folding a bubble never scrolls the log and never steals focus from the reply box.

## 8. Milestones

Each milestone is one task file. DoD items are **worker-checkable** unless marked **Manual**; by the standing rule of 2026-09-18 the worker session runs the Manual rows itself (trial app, browser) and involves Simon only on a failure or when a step is user-only. Order: M25 and M26 are independent and may run in either order or in parallel (they touch different functions of `chat.ts`; `fold()` in §5.3 is built by whichever lands first and reused by the other). M27 needs both.

**M25 — The capture message, folded (`.crt/tasks/CRT-0030`).** F-119, N-28, N-30. The `intake` field, `summarizeIntake`, the registry decoration, the folded user bubble, `fold()`, the unit and e2e rows of F-119, the README / how-it-works sentence (§9), `chat.png` regenerated. DoD: `npm run check` and `npm run e2e` green; the N-28 hash in the Log; the bundle size in the Log; **Manual**: on the trial app with a real Claude session — one annotation with a note, two annotations in one send, a page-level Chat, a quick note that asks a question — the bubble shows the words and the pill opens the full text; screenshots in the Log.

**M26 — The proposal, folded (`.crt/tasks/CRT-0031`).** F-120, N-29, N-30. The skill's step 4 shape, `proposal.ts`, the fold at turn end, the unit and e2e rows of F-120. DoD: `npm run check` and `npm run e2e` green; `claude plugin validate ./plugin` green; **Manual**: on the trial app with a real Claude session, a proposal folds to its restatement and item count, unfolds to the checklist, Accept writes the task; an edit yields a second folded proposal; a step-3 question is not folded; screenshots in the Log.

F-122 is not a milestone: CRT-0033 applies it directly (2026-09-23), before M25 starts, so M25–M27 are closed the new way.

F-123 is not a milestone either: CRT-0044 applies it directly (2026-09-24), after M27; the next release ships it.

**M27 — Release 0.7.0 (`.crt/tasks/CRT-0032`).** F-121, the §9 rows not yet applied, §10 evidence. Depends on M25–M26. DoD: versions and pins `0.7.0` / `@0.7`; `npm run screenshots` re-run on the release commit and the PNGs unchanged or committed; `v0.7.0` tagged; the release workflow green; promoted on npm (**Manual (Simon)** — the one user-only step); `crt setup` from a clean `npm i -g claude-review-tool@0.7.0` installs the plugin; every §10 row ticked with evidence.

## 9. Amendments to the earlier PRDs, the docs and `CLAUDE.md`

Each row names the milestone that applies it; "noted by M27" means the `*v0.7: …*` note inline in the earlier PRD was written by M27 (CRT-0032), the way M24 wrote the `*v0.6: …*` notes; M27 also added PRD-chat to PRD.md's Amended-by row, the README's version line and `docs/develop.md`'s list of PRDs.

| Statement | v0.7 |
|---|---|
| PRD F-24 "the first user message containing the capture summary, the developer's notes, the path to the capture bundle, and the screenshot images" | unchanged for the agent (N-28); the panel shows the developer's notes and folds the rest (F-119) (M25); noted by M27. |
| PRD F-25 "streams assistant text as it arrives" | still; a message that ends on the F-27 closing line folds into its restatement and item count when its turn ends (F-120) (M26); noted by M27. |
| PRD F-27 step 5 "propose a definition of done as a checklist … the proposal ends with the fixed line" | the proposal's shape is the four parts of §5.2, stated in the skill; the panel renders it folded; the Accept button's rule is unchanged (M26); noted by M27. |
| PRD F-28 / `session-events.ts` "Echo of a developer message, so a reconnecting panel can rebuild the transcript" | the first echo of a session carries `intake` (§5.1), set by the registry, so the rebuilt transcript is the folded one (M25); noted by M27. |
| PRD-providers §5 "every provider driver … produces these events" | drivers produce the `user` event as before; `intake` is added by the registry, never by a driver (M25); noted by M27. |
| `plugin/skills/intake/SKILL.md` step 4 "Reply with a one-paragraph restatement of the ask and a checklist of concrete, checkable DoD items" | "Reply with, in this order: one paragraph restating the ask (no heading, no list); the line `Proposed definition of done:`; the checklist, one `- [ ]` item per line; then exactly this line and nothing after it: …" (M26). |
| README › The loop step 3 "the same popover becomes the chat" | gains: "Your note is the first bubble; the page, selector and console detail Claude was given sits behind a `Capture` pill. Claude's proposal shows its restatement and a `Definition of done · N items` pill — open it, then **Accept**." (M25 the first sentence, M26 the second); `docs/how-it-works.md` › Intake session gains the same in its own words; `docs/images/chat.png` regenerated (M25, again by M27 if the overlay changed since). *M27: the overlay changed in M26, so `npm run screenshots` ran again; at 800 × 600 the log cannot show the folded bubble and the Allow / Deny buttons together, so `chat.png` now lands the log at its start (the bubble, the text, the tool line, the permission card's title and command) instead of its end, and the README alt text and `docs/images/README.md` say so.* |
| CLAUDE.md "Read `docs/PRD.md`, … and `docs/PRD-polish.md`" | "… `docs/PRD-polish.md` and `docs/PRD-chat.md`" with the sixth's one-line description (applied in the PR that adds this document). `.claude/agents/prd-reviewer.md` reads this document's §6, §7 and §9 too and knows F-119…F-121 / N-28…N-30 live here (same PR). |
| PRD F-40 "`/crt:done <ID>` — marks review → done after the PR merges, appending the PR URL" | marks review → done as the last commit on the reviewed PR branch, then merges the PR; no second PR (F-122, CRT-0033); noted inline by CRT-0033. |
| `plugin/skills/done/SKILL.md`, `plugin/skills/task/SKILL.md` review line, README › The loop `/crt:done` comment, CLAUDE.md › Work tracking "`/crt:done <ID> <pr-url>` closes it after merge" | the F-122 flow, in each one's words (CRT-0033). |
| CLAUDE.md "What this is" | the chat sentence gains "; the panel shows the developer's words and the agent's proposal folded, the full text one click away (PRD-chat F-119, F-120)" (M27, applied). |
| PRD F-37 "`/crt:next` — the worker … opens a PR whose body is …" | after opening the PR the worker waits for its checks in the same turn and fixes what its change broke; with `"worker": { "merge": true }` it closes the task (F-122) and merges; without the key it stops at `review` with CI green (F-123); noted inline by CRT-0044. |
| F-122 "`/crt:next` still never merges (F-37)" | … unless the project sets `"worker": { "merge": true }` (F-123, CRT-0044). |
| `plugin/skills/next/SKILL.md` step 6 "Do not merge it and do not enable auto-merge", its three-line reply and its Rules "never force-push, rebase, merge or auto-merge" | step 6 goes straight on to step 7 Wait for CI; step 8 Finish only with `worker.merge`; Blocked becomes step 9; the reply's status line names the CI result; the Rules allow a merge only in step 8 and never auto-merge (CRT-0044). |
| README › The loop "take it to a PR" and "Merging is yours.", `CLAUDE.md` › Work tracking "`/crt:next [ID]` takes one to an open PR" | the worker waits for CI and fixes its own breakage, and `worker.merge` in `.crt/config.json` or `.crt/config.local.json` lets it close and merge; this repo sets it, and a task worked by hand waits for its checks too (CRT-0044). |

## 10. Definition of done (v0.7)

Ticked by M27 with evidence (test name, e2e spec, task Log entry or run URL).

- [x] After Send, the first bubble shows the developer's words and a `Capture` pill; the pill opens the full first message; the same after a reload and from the session list (M25, e2e + Manual). — `e2e/chat.spec.ts` › "the first bubble shows the developer's words and folds the capture message… (F-119, N-30)" (words, `▸ Capture · 2 images`, the fold body with `CRT intake for capture <id>` and `Attached images: viewport (annotated), annotation 1`, folded again after `page.reload()`) and "a grouped send shows one line per annotation… (F-65, F-119)"; `test/sessions.test.ts` (the replay to a second subscriber carries `intake`); Manual: CRT-0030 Log 2026-09-23T09:11 DoD 7 (trial app, one annotation, two in one send, a page Chat, a quick note; screenshots in `.crt/captures/`).
- [x] The first message the agent receives is byte-identical to v0.6 for the same capture (N-28, M25 Log hash). — CRT-0030 Log 2026-09-23T09:11: SHA-256 `7281e834…` (plain) and `16263037…` (quick) at 5fdcbd8 and after, pinned in `test/intake-message.test.ts`.
- [x] A proposal folds to its restatement and `Definition of done · N items`, unfolds to the checklist, and Accept still writes the task; a question never folds (M26, e2e + Manual). — `e2e/chat.spec.ts` › "the proposal streams verbatim, then folds…", "a typed edit yields a second proposal … `1 item`…" and the quick-note `ask me` row (no `.proposal`); Manual: CRT-0031 Log 2026-09-23T11:48 DoD 7 (three real Claude sessions on the trial app, `▸ Definition of done · 7 items`, Accept wrote the task; one first proposal led with its findings — the §11 risk, recorded there).
- [x] `summarizeIntake` and `summarizeProposal` are unit-tested pure functions (N-29, test names). — `test/intake-message.test.ts` › "the developer's words for the first bubble (PRD-chat F-119, N-28)" (five rows); `test/proposal.test.ts` (eight rows); `proposal.ts` imports nothing.
- [x] The pills are keyboard-operable with `aria-expanded`; the overlay bundle grew ≤ 2 KB gzipped (N-30, M25/M26 Logs). — both e2e rows reach the pill with Shift+Tab from the reply box and toggle it with Enter and Space (`aria-expanded` `true`/`false`); `dist/overlay.js` gzipped 36,715 B at 5fdcbd8 → 37,252 B (M25) → 37,781 B (M26): +1,066 B.
- [x] `/crt:done` closes a task as the last commit on its PR branch and merges it; CRT-0033 and every later task in this PRD closed without a second PR (F-122; the tasks' Logs). — CRT-0033 (#83), CRT-0030 (#84) and CRT-0031 (#85) each end on `— done; closed in <PR URL>` inside their own squash-merged PR; CRT-0032 closes the same way.
- [x] CI green on `main`; `v0.7.0` tagged, published and promoted; the GitHub Release names M25–M26 and F-122; `docs/images/chat.png` shows the folded bubble (M27). — `chat.png` regenerated on the release branch with the log at its start (CRT-0032 Log); CI on `main` green at ee26727 (https://github.com/simv/crt/actions/runs/35819140428); tag `v0.7.0` on ee26727, release run https://github.com/simv/crt/actions/runs/35819153249 staged 0.7.0; the GitHub Release https://github.com/simv/crt/releases/tag/v0.7.0 names M25 (#84), M26 (#85), M27 (#86) and F-122 (#83); promoted by Simon 2026-09-23, `npm view claude-review-tool version` → `0.7.0`; a clean `npm i -g claude-review-tool@0.7.0` + `crt setup` installs `crt@crt 0.7.0` with the seven skills (CRT-0032 Log 2026-09-23T15:43).

## 11. Risks

- **An agent's proposal does not have the shape.** Codex, Gemini or a future Claude may put a heading first, number the items, or skip the `Proposed definition of done:` line. Mitigation: `summarizeProposal` needs only the closing line to fold (the trigger is `endsWithAcceptLine`, unchanged); a missing lead falls back to the first line and a missing list to `▸ Full proposal` (§12 rule 1); the skill states the shape for every provider (F-51 carries it in the first message).
- **The developer misses context they used to see.** Mitigation: the pill is under their own words, the fold body is the full text, and the label says what is there (`Capture · 2 images · with instructions`).
- **Hidden text and Playwright.** `toContainText` reads `textContent`, which includes hidden text, so an e2e row could pass against a folded bubble it meant to fail. Mitigation: the F-119/F-120 rows assert on `.fold-body` visibility and on `toBeVisible()`, never on the bubble's whole text.
- **Skew between overlay and server.** None: the overlay is bundled into the server package and served by it; a session never outlives the server process. A `user` event without `intake` (a typed reply) renders verbatim, so the panel needs no version check.
- **The screenshot goes stale.** `chat.png` shows the first bubble; M25 regenerates it and M27 checks it (PRD-polish F-116, the Release rule in `CLAUDE.md`).

## 12. Verification protocol for the builder

1. **A proposal with no checklist** (the parse finds no list items): fold anyway — the lead clamped, the pill `▸ Full proposal` — and log the message shape in the task Log; do not widen the parse to guess items from prose.
2. **`assistant_end` never arrives for a provider** (a driver that emits `text` and then `result` only): fold on the `result` that closes the turn; the row "folds when its turn ends" covers both orders with the stub.
3. **A capture with no annotations and no note** (should not happen: F-68 requires a message; F-14 requires notes): the visible words are the capture's page path, `(no note)` beside it; never an empty bubble.
4. **The e2e fixture's stub lacks a state a row wants** (a second proposal, a no-note annotation): extend the stub's script minimally under `providers/stub.ts` as PRD-polish §12 rule 4 did; keep `CRT_SESSION_STUB=1`'s existing e2e behaviour.
5. **The bundle grows past 2 KB gzipped**: drop the line-clamp CSS before dropping a test; report the size either way in the Log.
6. **`docs.test.ts` pins a README sentence you need to change**: change the sentence and the test together in the same commit, keeping every other pinned string (PRD-polish N-26 spirit).

## 13. Decisions taken and open questions

**Decisions** (the builder does not revisit these):

1. **The developer's words come from the server**, on the `user` event, not from the overlay's annotation store (§5.1: reload, session list, edited notes). The registry sets the field; drivers stay ignorant of it.
2. **The proposal's summary is the agent's own restatement plus a count**; no model, no second call, no extra tool (§5.2, N-29). The trigger is the existing closing line; the skill states the shape so the count is right.
3. **Folded by default, every time**; no persistence, no per-thread memory (§3).
4. **The closing line is not rendered inside a folded proposal** — the Accept bar is that line's UI (F-27); the full text remains in `events` and in the SSE replay.
5. **One fold component for both bubbles** (§5.3); the pills use existing alphas, no new tokens.

**Open questions** (not blocking; answer in a task's Notes when they come up):

1. Should a folded proposal's checklist be editable in place (tick to keep, untick to drop, then Accept)? Out of scope; F-27's typed edit is the way today.
2. Should tool lines under a folded proposal (the reads that led to it) collapse into one `read 4 files` line? Not in v0.7; F-25's collapsed lines are already one line each.
