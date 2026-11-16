# CRT v0.9 — Destinations: the reviewer chooses where feedback goes — PRD

| | |
|---|---|
| **Status** | Built — M33–M36 (CRT-0054…0057) in one pull request; the manual rows of §10 (real issues on a private repository, the `v0.9.0` tag and the npm promotion) are open. §14 lists where the build differs from the text above it |
| **Owner** | Simon (simv) |
| **Repo** | https://github.com/simv/crt |
| **Baseline** | `main` at 9236988 = 0.8.0 as built (PRD-zero M28–M32; the `v0.8.0` tag and the npm promotion pending) |
| **Amends** | `docs/PRD-zero.md` (§3 non-goal "Hand-over to GitHub issues, or to any other tracker", §5.5, F-133, F-136, F-137, N-35, Open question 1), `docs/PRD.md` N-4 as restated by PRD-zero §9, `README.md`, the reference pages under `docs/`, `CLAUDE.md`, `.claude/agents/prd-reviewer.md` — every amended statement is listed in §9 |
| **Design inputs** | Simon's request and scope decision of 2026-11-16 (§1); the proposal of the same day ("CRT feedback destinations proposal"); hand-over as built (`packages/server/src/handoff.ts`, `home.ts`, `review.ts`), the provider seam as built (`packages/server/src/providers/`) |

This document extends `docs/PRD.md`, `docs/PRD-providers.md`, `docs/PRD-setup.md`, `docs/PRD-embedded.md`, `docs/PRD-polish.md`, `docs/PRD-chat.md` and `docs/PRD-zero.md`. Everything in the seven stays in force unless §9 amends it. Requirement IDs continue the numbering (F-140…F-150, N-37…N-40, after PRD-zero F-139 / N-36); milestones are M33–M36 (after PRD-zero M32), one task file each (`.crt/tasks/CRT-0054…0057`). A build session reads the seven earlier PRDs, this file, `CLAUDE.md` and its task file, and nothing else, to know what "correct" means. §12 tells the builder what to do when `gh`, GitHub or Node's module loader differs from what this document assumes.

---

## 1. Problem and scope

Simon, 2026-11-16:

> I'm kinda thinking, how might we allow users to choose what happens to the feedback? Like maybe it can record it all, and then publish to issue tracking software that the user can hook up to the tool. I'm thinking of hooking to say, JIRA, or Monday, or other issue tracking tools, or even just exporting .MD that the user can then choose what happens to their feedback.

And, on the proposal that followed:

> Go ahead, but let's stop at GitHub issues for now, with the system built so we can add more later, or others can. Think about how this can be modular.

What 0.8 already does: every Send is recorded in a review before anything is delivered (PRD-zero §5.3), the review is collated (§5.4), and `crt handoff` delivers the kept items to one of four places — a pull request, a branch, the working tree, a bundle folder (§5.5). What stands between that and the request:

- **The four destinations are branches of one function.** `runHandoff` in `handoff.ts` holds all of them inline; adding a fifth means editing it, and nobody outside this repository can add one at all.
- **Every destination is the project's repository or a folder.** A team that tracks work in an issue tracker has no way to get the feedback there.
- **The Markdown a reviewer can take away is a folder of files** (`--to bundle`), not one document.
- **A hand-over is all or nothing in the record.** `review.json` gets one entry when the last step succeeded; a destination that creates nine things over a network needs to say which five exist when the sixth fails.

**Scope of v0.9.** (1) **The destination seam**: one interface, one registry, the four destinations of 0.8 moved behind it unchanged. (2) **Destinations from outside**: a module named in the config is a destination, written against a published contract, so a tracker CRT does not ship can be added by anyone. (3) **Exports**: the review as one Markdown file, and as one JSON file. (4) **GitHub Issues**: one issue per kept item through `gh`, with the screenshots. (5) Release `0.9.0`.

## 2. Goals

1. **The record and the destination are separate things.** A review is recorded once and can go to more than one place; publishing never removes or rewrites what was recorded.
2. **Adding a destination is adding one module.** Inside this repository: one file under `destinations/` and one line in the registry. Outside it: one file or package and one config entry, with no fork and no change to CRT.
3. **One Markdown file.** `crt handoff --to markdown` gives the reviewer the whole review as a document they can paste, attach or commit anywhere.
4. **GitHub Issues with no new sign-in.** `crt handoff --to github` creates one issue per kept item, each a self-contained brief with its screenshots, using the `gh` login the developer already has. CRT never sees a token.
5. **A publish that stops half-way can be continued.** Items that were created are recorded as they are created; running the command again creates the rest and no duplicates.
6. **Nothing that works in 0.8 changes** (N-37): the four destinations, their flags, their plans, their lines and their tests.

## 3. Non-goals (v0.9)

- **Jira, Monday, Linear or any other tracker shipped by CRT** — Simon, 2026-11-16: stop at GitHub Issues. The seam and F-143 are what make them possible later, here or elsewhere.
- **Credentials.** No `crt connect`, no token file under the CRT home, no OAuth. GitHub goes through `gh`; an external destination reads what it needs from the environment it is given (F-143). PRD-zero N-34's "the home holds nothing secret of CRT's own" stands. A later PRD adds a credential store when the first token-based destination is built in.
- **Reading back from a tracker.** No status sync, no closing or editing an issue after it is created, no comments.
- **Publishing a set-up project's `.crt/tasks/` directly.** Destinations publish reviews. A set-up project collects into a review with `--review` or `"store": "review"` (PRD-zero §5.2).
- **Per-item destinations.** One run sends every kept item to one destination.
- **A Publish button on the review page.** The page keeps offering the command to copy (F-149 makes it the configured one).
- **A model anywhere in the publish path** (PRD-zero decision 7): rendering and field mapping are deterministic.
- **A built-in `command` destination** that pipes items to a program. An external module (F-143) covers it, in one mechanism instead of two; a module may spawn whatever it likes. *As built (Simon, 2026-11-16: "create a 'send to for own command' plugin as a proof of concept and example for how others can build a plugin"): that module exists — it is the worked example of F-150, shipped with the package as `claude-review-tool/destination-command` and named in the config like any other outside module. It is not in the built-in list (§14).*

## 4. Scenario changes

PRD §4 gains a third scenario beside the two of PRD-zero §4:

*Simon has reviewed the trial app and collated eleven items down to nine. The team tracks work in GitHub Issues, so he runs `crt handoff --to github`. CRT prints what it will do — nine issues in `simv/jack-of-clubs`, titles listed, eighteen screenshots pushed to a new branch `crt/review-2026-11-16-assets` so the issues can show them — and asks once. He says yes. Nine lines follow, each an issue URL. He also wants the list for the client, so he runs `crt handoff --to markdown` and attaches the file it writes to an email.*

*A colleague's team uses Jira. She writes `tools/crt-jira.mjs` against the destination contract — about a hundred lines — adds `"jira": { "use": "./tools/crt-jira.mjs", "project": "WEB" }` to `.crt/config.json`, and `crt handoff --to jira` works for everyone on that project.*

## 5. Design

### 5.1 The model

Three steps; only the third changes.

1. **Record.** Every Send lands in the review (PRD-zero §5.3). The review is the source of truth.
2. **Collate.** Keep, drop, prioritise, order (PRD-zero §5.4).
3. **Publish.** `crt handoff --to <destination>` asks the registry for that destination, has it plan, prints the plan, asks once, has it publish, and records each item as it lands.

`handoff.ts` keeps what is common to every destination: picking the review and its kept items, reading them into `FeedbackItem`s, the plan lines, the one question (PRD-zero N-35), the record in `review.json`, the `--again` rule and the one-line failures. Everything particular to where the items go lives in the destination.

### 5.2 The destination contract

```ts
/** packages/server/src/destinations/types.ts — published as `claude-review-tool/destination` (types and `defineDestination` only). */
export interface Destination {
  /** The contract version this module was written against. 1 in v0.9. */
  apiVersion: 1;
  /** What follows `--to`: [a-z][a-z0-9-]*. An external module's id is its config key. */
  id: string;
  /** For people: "GitHub Issues". */
  title: string;
  /** True when publishing here is the moment the feedback is handed over (the review becomes `handed`); false for an export. */
  final: boolean;
  /** No side effects. Refuses with one reason when this cannot work here (no remote, `gh` not found, a missing option). */
  plan(input: PublishInput, ctx: DestinationContext): Promise<DestinationPlan>;
  /** Called only after the yes. Yields each item as it lands; throws to stop — what was yielded stays recorded. */
  publish(input: PublishInput, plan: DestinationPlan, ctx: DestinationContext): AsyncIterable<PublishedItem>;
}

export interface PublishInput {
  review: { name: string; created: string; totals: { items: number; kept: number; routes: number } };
  project: { root: string; name: string; remote: string | null; setUp: boolean };
  /** The kept items not yet published to this destination, in review order. */
  items: FeedbackItem[];
  /** Kept items a previous, unfinished run already published here (F-142): for a summary that names them all. */
  already: PublishedItem[];
}

export interface FeedbackItem {
  id: string;                    // "R-03"
  title: string;
  priority: "low" | "normal" | "high";
  url: string | null;
  route: string | null;
  branch: string | null;
  commit: string | null;
  tags: string[];
  files: string[];
  /** The F-32 sections by name, as written: Summary, Context, Evidence, Ask, Definition of Done, Notes. Never Log. */
  sections: Record<string, string>;
  /** The whole task file, for a destination that wants it as is. */
  markdown: string;
  /** Image files of the item, annotated viewport first. `capture.json` is never listed. */
  images: { name: string; path: string; bytes: number }[];
}

export interface DestinationPlan {
  /** What will exist afterwards, one line each, printed as given. */
  lines: string[];
  /** What leaves the machine and to which host ("9 issues and 18 screenshots to github.com"); empty for a local destination. */
  sends: string[];
  /** The destination's own state, handed back to `publish`. */
  state?: unknown;
}

export interface PublishedItem { item: string; id: string; url?: string }

export interface DestinationContext {
  /** This destination's object from the config, minus `use`. */
  options: Record<string, unknown>;
  /** Flags after `--to` that `crt handoff` does not own (`--out`, `--branch`, `--no-screenshots`, …). */
  flags: Record<string, string | boolean>;
  env: NodeJS.ProcessEnv;
  cwd: string;
  now: Date;
  log(line: string): void;
  /** Resolve and run a tool the way CRT does (PATH and PATHEXT, `shell: false`, N-10). The test seam of F-136, generalised. */
  run(tool: string, args: string[], opts?: { cwd?: string; timeoutMs?: number }): Promise<RunResult>;
  /** A fresh directory under the OS temp dir, removed when the command ends. */
  tmp(): string;
}
```

Three things the shape is chosen for:

- **`FeedbackItem` is parsed once, by CRT.** No destination reads a task file's frontmatter or splits its sections; the F-32 format can gain a key without every destination changing.
- **`plan` and `publish` are separate calls** so that the rule "say first, then ask, then act" (PRD-zero N-35) is enforced by `handoff.ts` for every destination, including one CRT has never seen (N-38).
- **`publish` yields.** Each yielded item is written to `review.json` before the next is asked for, which is what makes a stopped publish continuable (F-142).

`apiVersion` exists so the contract can grow: a module with a version CRT does not know is refused with one line naming both versions.

### 5.3 The registry, and destinations from outside

`destinations/index.ts` resolves a name in this order:

1. **Built in**: `pr`, `branch`, `here`, `bundle` (moved from `handoff.ts`, M33), `markdown`, `json` (M34), `github` (M35).
2. **The config**: `destinations.<name>` in `.crt/config.local.json`, `.crt/config.json` or the guest config (PRD-zero §5.3), local over project.

```json
{
  "handoff": { "to": "github" },
  "destinations": {
    "github": { "labels": ["crt"], "priorityLabels": { "high": "priority: high" } },
    "jira":   { "use": "./tools/crt-jira.mjs", "project": "WEB" },
    "linear": { "use": "crt-destination-linear", "team": "ENG" }
  }
}
```

An entry without `use` gives options to the built-in destination of that name. An entry with `use` is an **external destination**: `use` is a path relative to the config file that names it, or a package specifier resolved from the project root. The module is loaded with `import()` and must export `destination` (or a default export) satisfying the contract. A config key may not take a built-in's name with `use` — a built-in cannot be replaced, so `--to pr` always means CRT's own.

**Trust.** An external destination is code that runs with the developer's rights, as the project's own `npm` scripts do. It is loaded only inside `crt handoff`, only when it is the destination of that run, and only after a line that names the file (`crt: --to jira is tools/crt-jira.mjs, from .crt/config.json`) (N-39). The server never loads one, and no page can cause one to load.

**Secrets** are the external module's business in v0.9: it gets `ctx.env` and reads what it documents (`JIRA_TOKEN`). CRT stores none (§3).

### 5.4 The record

`review.json`'s `handovers` entries (PRD-zero F-133, F-136) gain one field and one rule:

```ts
interface Handover {
  to: string;                          // any destination id, no longer one of four
  at: string;
  items: Record<string, string>;       // review id → the id there (R-01 → CRT-0031, R-01 → #412)
  urls?: Record<string, string>;       // review id → its link there, when the destination has one
  state?: "partial" | "complete";      // absent in 0.8 entries, which are complete
  branch?: string; base?: string; url?: string; dir?: string;   // as in 0.8
}
```

- The entry is written `partial` when the first item lands and updated after each; it becomes `complete` when `publish` ends without throwing.
- **Continuing.** A run whose destination has a `partial` entry publishes only the kept items not in it, with no `--again`, and says so in the plan (`4 of 9 are already there; 5 to go`).
- **Final and not.** A `complete` hand-over to a `final` destination makes the review `handed`, as in 0.8. An export (`markdown`, `json`) is recorded and leaves the review `open`; it can be repeated freely.
- **More than one destination.** A `handed` review still goes to a destination it has no `complete` entry for without `--again`; `--again` is for repeating the same one.

### 5.5 The exports

**`--to markdown`** writes one file, `crt-review-<project>-<review>.md` (`--out <file or dir>`), and beside it a folder `crt-review-<project>-<review>-assets/` with the images. The file is the collated summary of PRD-zero §5.5 followed by every kept item in full, in review order under its route: title, priority, URL, the reviewed commit, then its sections with the Evidence images linked relatively. Ids stay `R-NN`. `--no-screenshots` writes the file alone.

**`--to json`** writes one file, `crt-review-<project>-<review>.json`: `{ "schema": 1, "review": …, "project": …, "items": FeedbackItem[] }`, image paths absolute into the review. It is the contract of §5.2 on disk, for a script that would rather read a file than be a module.

Neither is `final`. `--to bundle` is unchanged (N-37).

### 5.6 GitHub Issues

`crt handoff --to github` creates one issue per kept item in the repository of the project's remote (`origin`, else the first; the `repo` option, `owner/name`, overrides it), in review order.

- **Through `gh`**: `gh issue create --repo <owner/name> --title <title> --body-file <temp file>`, plus `--label` for each configured label. `gh` is resolved and run through `ctx.run`; CRT handles no token, and whatever host `gh` is logged in to for that remote is the host (GitHub Enterprise included).
- **The body** is the item's Summary, Context, Evidence, Ask and Definition of Done (as a task list), then a footer: `Filed with CRT from review 2026-11-16 (R-03) · reviewed at 4f2a91c on main · /checkout`. The Notes section follows the Ask when it is not empty. Rendering is a pure function of the `FeedbackItem`.
- **Labels** come from the config: `labels` on every issue, `priorityLabels` by priority. None by default, because `gh` refuses a label the repository does not have; the plan checks them (`gh label list`) and refuses with the missing names before anything is created.
- **Screenshots** (PRD-zero Open question 1, answered): GitHub has no API to attach an image to an issue, so the images must be somewhere the issue can link. By default CRT pushes them to a branch of the project made for the purpose — `crt/review-<review>-assets`, created in a temporary worktree from the default branch exactly as `--to pr` creates its branch (the helper is shared, M33), holding `.crt/tasks/assets/review-<review>/<R-NN>/<image>` and nothing else, never merged — and the body links each image at that commit (`https://<host>/<owner>/<name>/blob/<sha>/<path>?raw=true`). The plan says so in its own line. `--no-screenshots` (or `"screenshots": "none"`) creates text-only issues whose Evidence names the files and says they stayed on the reviewer's machine. `capture.json` is never pushed.
- **Half-way.** Each issue is recorded as it is created. A failure is one line (`crt: created 5 of 9 issues, then gh said: <line> — run \`crt handoff --to github\` again to create the other 4`).
- **Should — an index issue**: with `"index": true`, a tenth issue titled `CRT review <review>: 9 items` whose body is the collated summary as a task list of the nine.

`github` is `final`. Items published as issues are not written to `.crt/tasks/`; a team that wants both runs `--to pr` as well (§5.4).

### 5.7 What changes where

| Area | Change |
|---|---|
| `packages/server/src/destinations/types.ts` (new) | the contract (F-140, F-141) |
| `packages/server/src/destinations/index.ts` (new) | the registry, config options, external modules (F-140, F-143) |
| `packages/server/src/destinations/{project,bundle}.ts` (new) | `pr` / `branch` / `here` and `bundle`, moved (F-140, N-37); the worktree helper shared with `github` |
| `packages/server/src/destinations/item.ts` (new) | task file → `FeedbackItem`; the shared Markdown renderer (F-141) |
| `packages/server/src/destinations/{markdown,json}.ts` (new) | the exports (F-144, F-145) |
| `packages/server/src/destinations/github.ts` (new) | issues and the assets branch (F-147, F-148) |
| `packages/server/src/handoff.ts` | what is common: review, plan, question, record, continue (F-142) |
| `packages/server/src/home.ts` | the `Handover` fields, `recordPublished` (F-142) |
| `packages/server/src/config.ts`, `args.ts`, `cli.ts` | `handoff.to`, `destinations`, `--to <name>`, `--list`, destination flags (F-143, F-146) |
| `packages/server/package.json`, `scripts/integrations.mjs` | the `./destination` entry (F-143) |
| `packages/server/src/doctor.ts`, `review-page.ts` | the `handoff` row; the page's command (F-149) |
| `README.md`, `docs/*.md`, `CLAUDE.md`, `.claude/agents/prd-reviewer.md` | §9, F-150 |

## 6. Functional requirements

### 6.1 The seam

- **F-140 (Must) Destinations are modules behind one contract.** `destinations/types.ts` per §5.2; `destinations/index.ts` with `resolveDestination(name, config)` and `listDestinations(config)`. `pr`, `branch`, `here` and `bundle` are destinations; `runHandoff` contains no destination-specific branch after M33. `--to <name>` accepts any resolvable name; an unknown one is `crt: no destination "<name>" — \`crt handoff --list\` shows them`, exit 2. `git` and `gh` are spawned only through `ctx.run`, only inside `crt handoff` (PRD-zero F-136's rule, restated for the new files). Tested: `test/handoff.test.ts` passes with no edit to its assertions (N-37); registry rows for each built-in and for the unknown name.
- **F-141 (Must) `FeedbackItem`.** `destinations/item.ts`: `readFeedbackItem(tasksDir, file)` per §5.2 — frontmatter through the existing parser in `tasks.ts`, sections split on the seven F-32 headings, `Log` left out, images from `assets/<id>/` (`.png`, `.jpg`, `.jpeg`, `.webp`; `viewport-annotated` first, then `viewport`, then the rest by name), `capture.json` and every other file never listed. `renderItemMarkdown(item, { image })` is the one Markdown renderer `markdown` and `github` share, with the image link given by the caller. Tested: rows over fixture task files (a 0.7 file without `branch` / `commit`, a file with an empty section, an item with no assets), and a row that a `capture.json` beside the images is not in `images`.
- **F-142 (Must) Recorded as it lands, continued where it stopped.** Per §5.4: `recordPublished(dir, to, item)` in `home.ts` writes the `partial` entry atomically after each yielded item; completion, `final`, the continue rule, and `--again` narrowed to "the same destination again". 0.8 entries (no `state`) read as `complete`. The plan of a continuing run names what is already there. Tested: a fake destination that throws after its second item — `review.json` holds two, the review is `open`, the second run is offered only the rest and completes; an export leaves the review `open`; a `handed` review goes to a second destination without `--again` and is refused for the same one without it.
- **F-143 (Must) External destinations.** Per §5.3: `destinations.<name>.use` resolved relative to the config file that names it (a path) or from the project root (a package specifier), loaded with `import()` (a path through `pathToFileURL` — Windows), the export checked (`apiVersion`, `id`, `title`, `final`, two functions) with one `crt:` line per failure naming the file and what is missing. The naming line of §5.3 precedes the load. `packages/server/package.json` gains the export `./destination` → `dist/destinations/types.d.ts` and a runtime file exporting `defineDestination` (an identity function that gives authors the types) and `API_VERSION`; nothing else of the server is reachable through it. `handoff.ts` enforces for every destination, external or not: `plan` before the question, `publish` only after the yes, a `PublishedItem.item` that is not one of the input's ids stops the run. Tested: a fixture module under `test/fixtures/destinations/` loaded by relative path from a scratch project's config; the refusals (not found, wrong `apiVersion`, missing `publish`, a built-in's name with `use`); the order row — the fixture records its calls and `publish` is absent when the answer is no (N-38).

### 6.2 Exports and the default

- **F-144 (Must) `--to markdown`.** Per §5.5. An existing file is refused (`… already exists — remove it, or pass --out`). Tested: the file holds every kept item's title and each of its sections in review order and no dropped item; every image link resolves to a file in the assets folder; `--no-screenshots`; `--out` as a file and as a directory.
- **F-145 (Must) `--to json`.** Per §5.5; the file parses, `schema` is 1, `items` equals what a destination's `plan` receives (one test asserts both from the same review).
- **F-146 (Must) The default, and the list.** `handoff.to` in the config (local over project over guest) names the destination plain `crt handoff` uses; without it PRD-zero §5.5's default rule stands. `--to` on the command line wins. `crt handoff --list` prints every destination — built-in, configured, external — one line each (`github    GitHub Issues    built in, options from .crt/config.json`), marks the default, loads no external module, and exits 0. Tested: the precedence rows; `--list` with an external entry whose file does not exist still lists it.

### 6.3 GitHub Issues

- **F-147 (Must) `--to github`.** Per §5.6: the repository from the remote or `repo`; the plan (the count, the repository, each title, the labels, the screenshots line, the `sends` line); the label check; one `gh issue create` per item in review order with the body from a temp file; the issue number and URL parsed from `gh`'s output and yielded; the half-way line. Refusals in `plan`, each one line: no remote and no `repo`; `gh` not on PATH; a remote that is not a GitHub-shaped URL and no `repo`. Tested with real `git` against a bare remote and `gh` answered by the `ctx.run` seam (the F-136 pattern): the argument lists (never `--web`, never an editor), the bodies, order, labels, the missing-label refusal with nothing created, a failure on the third issue then a second run that creates only the rest. **Should:** the index issue.
- **F-148 (Must) Screenshots for issues.** Per §5.6: the assets branch through the shared worktree helper — never the developer's checkout (PRD-zero N-35), never forced, a name that exists gets `-2`; only image files; the links pinned to the pushed commit; `--no-screenshots` / `"screenshots": "none"`. A push that is refused stops before any issue is created (`crt: could not push crt/review-…-assets (<git's line>) — no issue was created; fix that, or pass --no-screenshots`). On a continued run the branch of the `partial` entry is reused, not made again. Tested: the branch's tree is exactly the kept items' images; the N-35 before/after row; the bodies' links carry the branch's commit SHA; the refused push.

### 6.4 Doctor, docs and release

- **F-149 (Must) The `handoff` row, and the page's command.** `crt doctor` gains `ok    handoff   github (GitHub Issues) — gh found, remote simv/jack-of-clubs` / `warn  handoff   jira — tools/crt-jira.mjs not found` / `--    handoff   default (pr, branch or here)`: the default destination and whether its file or tool is there, without loading an external module and without a network call. The review page's copyable command is `crt handoff` — unchanged — because the default now carries the choice; its sentence names the destination (`When it reads right: crt handoff — to GitHub Issues`). Tested: the doctor rows over injected facts; a route row for the page's sentence.
- **F-150 (Must) Docs and release 0.9.0.** A tenth reference page, `docs/destinations.md`: what a destination is, the built-in ones with their options, **writing one** (the contract, a complete worked example of about sixty lines that posts each item to an HTTP endpoint, how to test it with `--to json` output, the trust rule), what is recorded. `docs/cli.md` (`--to`, `--list`, the new flags), `docs/review.md` (publishing to more than one place, continuing), `docs/how-it-works.md` (what leaves the machine and when), `docs/troubleshooting.md` (a publish that stopped half-way, a missing label, images that do not show). README: one line and one example under the zero-integration block (still ≤ 200 lines, PRD-polish F-115). `test/docs.test.ts` and the CI `changes` filter updated together for the tenth page. §9 rows applied and §10 ticked with evidence; version `0.9.0` in `packages/server/package.json`, both plugin manifests and the seven skills' pin (`claude-review-tool@0.9`); `npm run screenshots` re-run only if the review page's look changed; `v0.9.0` tagged, the release workflow green, the staged version promoted on npm (Simon).

## 7. Non-functional requirements

- **N-37 The four destinations of 0.8 behave the same.** `pr`, `branch`, `here` and `bundle`: the same flags, plan lines, files, commits, `gh` arguments, failure lines and `review.json` entries (plus `state: "complete"`). `test/handoff.test.ts` passes with its assertions untouched.
- **N-38 Every destination says first.** For any destination, built in or external, nothing is written, spawned or sent on its behalf between the start of `crt handoff` and the yes except what `plan` itself does, and a built-in's `plan` has no side effects beyond reads (`git fetch`, `git ls-remote`, `gh label list`). The plan printed is the destination's `lines` and `sends`, never a paraphrase. PRD-zero N-35 extended.
- **N-39 Outside code runs only when asked for.** An external destination's module is imported only by `crt handoff`, only when it is that run's destination, after the line naming its file. `crt`, `crt serve`, `crt review`, `crt doctor` and `crt handoff --list` never import one. No route of the server reads the `destinations` config.
- **N-40 What leaves the machine, restated.** PRD N-4 as restated by PRD-zero §9, plus: what `gh issue create` and the assets branch's `git push` send when the developer runs `crt handoff --to github` and answers yes — to the host of the project's remote and nowhere else, images only when the plan said so, `capture.json` never. CRT itself opens no network connection in v0.9: no `fetch` in `packages/server/src` outside tests. What an external destination sends is its own, stated by its `sends`. No new runtime dependency.

## 8. Milestones

Each milestone is one task file. DoD items are **worker-checkable** unless marked **Manual**. Order: M33 first; M34 and M35 need M33 and are independent of each other; M36 needs all three.

**M33 — The destination seam (`.crt/tasks/CRT-0054`).** F-140, F-141, F-142, F-143, N-37, N-38, N-39. The contract, the registry, `FeedbackItem`, the four destinations moved, the record, external modules and the `./destination` entry. DoD: `npm run check` and `npm run e2e` green; `test/handoff.test.ts` assertions unchanged (the diff shows it); a fixture external destination loaded from a scratch project's config.

**M34 — Exports and the default (`.crt/tasks/CRT-0055`).** F-144, F-145, F-146. DoD: `npm run check` green; **Manual**: `--to markdown` on a real review of five or more items, the file opened in a Markdown viewer with its images showing.

**M35 — GitHub Issues (`.crt/tasks/CRT-0056`).** F-147, F-148, N-40. DoD: `npm run check` green; the N-35 before/after row for the assets branch; **Manual**: a real review published as issues on a private repository — the issues readable, the screenshots showing for a signed-in reader, the checkout untouched; one issue URL in the Log. Creating issues on a repository is outward-facing: ask Simon which repository before that step.

**M36 — Doctor, docs, release 0.9.0 (`.crt/tasks/CRT-0057`).** F-149, F-150, the §9 rows not yet applied, §10 evidence. DoD: versions and pins `0.9.0` / `@0.9`; the worked example of `docs/destinations.md` is a file the tests load and run (so the page cannot drift from the contract); `v0.9.0` tagged; the release workflow green; promoted on npm (**Manual (Simon)**).

## 9. Amendments to the earlier PRDs, the docs and `CLAUDE.md`

Each row names the milestone that applies it; the `*v0.9: …*` notes inline in the earlier PRDs are written by M36 unless a row says otherwise.

| Statement | v0.9 |
|---|---|
| PRD-zero §3 "Hand-over to GitHub issues, or to any other tracker. The destination list is open by design (F-136) …" | GitHub Issues is a destination (F-147); any other tracker is an external destination (F-143) until CRT ships it (M33, M35). |
| PRD-zero §5.5 / F-136 "`--to pr \| branch \| here \| bundle`" | "`--to <destination>`": those four, `markdown`, `json`, `github`, and any configured one; the default is `handoff.to` when set, else the rule as written (F-140, F-146) (M33, M34). |
| PRD-zero F-133 `handovers: []`; §5.5 "`review.json` records the hand-over … and the review becomes `handed`" | entries per §5.4: `urls`, `state`; written as items land; `handed` only after a `complete` hand-over to a `final` destination (F-142) (M33). |
| PRD-zero §5.5 "Handing a `handed` review over again is refused unless `--again` is given" | "… to the same destination again"; another destination needs no flag (F-142) (M33). |
| PRD-zero F-136 "`git` and `gh` are … spawned … only from `handoff.ts`" | "… only through the destination context's `run`, from `handoff.ts` and `destinations/`, only inside `crt handoff`" (F-140) (M33). |
| PRD-zero N-35 "it writes `.crt/tasks/**` and nothing else" | unchanged for what is written **into a project**; the assets branch of `--to github` holds `.crt/tasks/assets/review-<review>/**` only (F-148); `markdown` and `json` write their announced file where the developer runs them, as `bundle` does (M34, M35). |
| PRD-zero §7 N-35 "`crt handoff` … prints its plan before any write and asks once" | holds for every destination, external ones included (N-38) (M33). |
| PRD N-4 / PRD-zero §9 "plus what `git push` and `gh pr create` send when the developer runs `crt handoff --to pr`" | "… and what `gh issue create` and the assets push send for `--to github`" (N-40) (M35). |
| PRD-zero §13 Open question 1 (where an issue's screenshots live) | answered: a branch of the project made for them, linked at its commit; text-only with `--no-screenshots` (F-148) (M35). |
| `CLAUDE.md` "Read `docs/PRD.md`, … and `docs/PRD-zero.md`" | "… `docs/PRD-zero.md` and `docs/PRD-destinations.md`" with the eighth's one-line description (applied in the PR that adds this document). `.claude/agents/prd-reviewer.md` reads this document's §6, §7 and §9 too and knows F-140…F-150 / N-37…N-40 live here (same PR). |
| `CLAUDE.md` entry points "`handoff.ts` (`crt handoff` … the only module that spawns `git` and `gh`)" | `handoff.ts` and `destinations/` (the contract, the registry, one file per destination); `git` and `gh` through the context's `run` (M33). |
| `CLAUDE.md` Don'ts "`crt handoff` is the only command that moves review items into a project …" | gains: "An external destination's module is imported only by `crt handoff` (PRD-destinations N-39), and CRT opens no network connection of its own (N-40)." (M33, M35). |
| `.claude/agents/prd-reviewer.md` spawn row "`git` / `gh` in `handoff.ts`" | "… in `handoff.ts` and `destinations/`, through the context's `run`"; a new invariant row: no `import(` of a config-named module outside `destinations/index.ts`, no `fetch(` in `packages/server/src` (M33, M35). |
| "the nine reference pages" in `CLAUDE.md`, the CI filter and `test/docs.test.ts` | ten, with `docs/destinations.md` (M36). |
| PRD-embedded F-97 as tested (`test/integrations-build.test.ts`: the package's `exports` are the four integration entries under `dist/integrations/`; `files` is `dist`) | `exports` gains `./destination` (`dist/destinations/api.js` and its `.d.ts`, built by `scripts/integrations.mjs`) and `./destination-command` (`examples/destination-command.mjs`); `files` gains `examples`. Neither is a browser entry, so N-18 does not apply to them (M33, M36). |

## 10. Definition of done (v0.9)

Ticked by M36 with evidence (test name, task Log entry or run URL).

- [x] `runHandoff` holds no destination-specific branch; the four destinations of 0.8 pass their tests with assertions untouched (F-140, N-37). *`test/handoff.test.ts` passes with no line of it changed (`git diff main -- packages/server/test/handoff.test.ts` is empty); `destinations.test.ts` "knows the seven built-in destinations, each with the contract's shape".*
- [x] A module named in the config is a destination, loaded only by `crt handoff` after the line naming it; a malformed one is refused in one line (F-143, N-39). *`destinations.test.ts` "loads a module named by `use`, says which file first, plans, asks, publishes and records ids and links", "refuses a module that is not there, speaks another contract version, or lacks a function — one line each", "imports a config-named module in one place only, and CRT opens no connection of its own", "lists every destination and imports none, even one whose file is missing".*
- [x] `plan` runs before the question and `publish` only after the yes, for a built-in and for an external destination (N-38). *"never calls publish when the answer is no, or off a terminal without --yes"; the PRD-zero rows of `handoff.test.ts` for the built-ins.*
- [x] A publish that stops after some items records exactly those; the next run creates only the rest; a review can go to a second destination without `--again` (F-142). *"keeps exactly what landed when a destination stops, and offers only the rest next time", "sends a handed review to a second destination without --again, and refuses the same one without it".*
- [x] `--to markdown` writes one file holding every kept item in full with working image links; `--to json` writes the `FeedbackItem`s (F-144, F-145). *"writes one file with every kept item in full, in review order, and images that resolve beside it", "writes the items as data — exactly what a destination is given". The look in a Markdown viewer is CRT-0055's Manual row, open.*
- [x] `handoff.to` sets the default; `crt handoff --list` shows every destination and loads none (F-146). *"uses handoff.to for plain crt handoff, and --to over it", "lists every destination and imports none, even one whose file is missing".*
- [x] `--to github` creates one issue per kept item in review order with the configured labels, and refuses before creating anything when a label is missing (F-147). *"creates one issue per kept item in review order, each with its brief and its screenshots from a branch that holds only images — the checkout untouched", "puts the configured labels on each issue, and refuses before creating anything when the repository lacks one" — against a `gh` on PATH that records its runs.*
- [ ] The issues show their screenshots from a branch that holds only images, made without touching the checkout; `--no-screenshots` sends none; `capture.json` is never pushed (F-148, N-40; unit + M35 Manual). *Unit: "creates one issue per kept item …" (the branch's tree is images only, the checkout byte-equal before and after), "publishes text only with --no-screenshots: no branch, no push, the images named", "gives the frontmatter, every section but the Log, and the images — never capture.json". Open: the Manual row — real issues on a private repository on github.com, to see the images render (Simon names the repository).*
- [x] No `fetch` and no new dependency in `packages/server` (N-40; the `package.json` diff, a grep row). *"imports a config-named module in one place only, and CRT opens no connection of its own" greps `src/` for `fetch(`, `node:http(s)` requests and `import(`; `dependencies` in `packages/server/package.json` is unchanged.*
- [x] `docs/destinations.md` exists and its worked example is run by the tests; `crt doctor` has the `handoff` row (F-149, F-150). *`destinations.test.ts` "walks through the example that ships and is tested here, and the contract's version", "runs the command once per kept item with the item as JSON on its standard input, and records what it answers"; `doctor.test.ts` the `handoff` row; `docs.test.ts` with ten pages.*
- [ ] CI green on `main`; `v0.9.0` tagged, published and promoted (M36).

## 11. Risks

| Risk | Mitigation |
|---|---|
| The contract turns out wrong once a second real tracker is written against it | `apiVersion`; the worked example and the fixture destination exercise it from outside the built-ins in M33, before `github` is written against it in M35; v0.9 documents it as version 1 and says additions will be optional fields. |
| An external destination is a way to run code from a repository the reviewer does not trust | It runs only on `crt handoff --to <its name>` (or as a configured default), after a line naming the file (N-39); it is the same trust as the project's `npm` scripts, and `docs/destinations.md` says so. Whether a first use should ask is Open question 1. |
| Images linked from a branch do not show (a private repository and a signed-out reader, a host that serves `?raw=true` differently) | M35's Manual row is on a private repository; §12 rule 2; `--no-screenshots` always works; the Evidence text names every image either way. |
| The assets branch clutters the project's branch list | One branch per review, named for it, stated in the plan; `docs/destinations.md` says it can be deleted once the issues are closed and that doing so breaks their images. |
| Screenshots carry data the reviewer did not mean to publish | The plan's `sends` line counts them and names the host before the question; `--no-screenshots`; `capture.json` (console and network) is never published by a built-in. |
| A repository's issue form or required labels reject a plain issue | `gh`'s own line is passed through in the half-way message; the label check runs in `plan`; issue forms do not apply to issues created through the API. |
| Moving four destinations behind the seam breaks one subtly | N-37: the existing tests are the gate, assertions untouched; the move and the new behaviour (F-142) are separate commits in M33's PR. |

## 12. Verification protocol for the builder

1. **`gh issue create` prints something other than the issue URL on its last line** (a newer `gh`, a host notice): parse the first `https://…/issues/<n>` in its output; when there is none, treat the item as not created, stop, and say so. Record the `gh` version in `github.ts`'s header and the Log.
2. **The `blob/<sha>/<path>?raw=true` link does not render in an issue** on the Manual row's private repository: try `https://<host>/<owner>/<name>/raw/<sha>/<path>`; if neither shows for a signed-in reader with access, keep the links as plain links (not images), say so in the plan line, record what was seen in the Log, and do not move the images anywhere off the project's own host to make them show.
3. **`git worktree add` cannot make the assets branch** the way `--to pr` makes its branch: PRD-zero §12 rule 7 applies — one line, offer `--no-screenshots`, never the developer's checkout.
4. **`import()` of a path fails on Windows** (a drive letter read as a URL scheme): always go through `pathToFileURL`; add the Windows row to the tests rather than special-casing in the caller.
5. **A package specifier in `use` cannot be resolved from the project root** with what Node 20 offers without a dependency: resolve with `createRequire(<root>/package.json).resolve`, and when the package is ESM-only with no `require` condition, document that `use` then takes the path to its entry file. Do not add a resolver dependency.
6. **Moving a destination changes a line `test/handoff.test.ts` asserts**: the move is wrong, not the test (N-37). Change the test only where this document changes the behaviour (the `state` field), and name each such assertion in the Log.
7. **`docs.test.ts`, the CI `changes` filter or `skill-pin.test.ts` pins something a §9 row changes**: change the pin and the statement together in the same commit (PRD-chat §12 rule 6).

## 13. Decisions taken and open questions

**Decisions** (the builder does not revisit these):

1. **Stop at GitHub Issues** — Simon, 2026-11-16. No other tracker is built in for v0.9.
2. **A destination is a module behind a published contract, and a module named in the config is one** — Simon, 2026-11-16: built so more can be added later, by us or by others. One extension mechanism, not two (§3 on `command`).
3. **`plan` and `publish` are separate, and `handoff.ts` owns the question** (§5.2, N-38).
4. **GitHub goes through `gh`**; CRT handles no token and opens no connection (N-40). The credential store waits for the first destination that needs one (§3).
5. **Issue screenshots live on a branch of the project**, linked at its commit, with `--no-screenshots` as the opt-out (F-148) — the recommendation of the proposal, accepted with the go-ahead.
6. **Destinations publish reviews**, not a set-up project's `.crt/tasks/`; `"store": "review"` is the way in for such a project (§3).
7. **Publishing to a tracker does not also write task files** (§5.6); the two are separate runs.
8. **Exports do not hand the review over** (§5.4).

**Open questions** (not blocking; answer in a task's Notes when they come up):

1. Should the first use of an external destination from a project's committed config ask once (`Run tools/crt-jira.mjs from this project? [y/N]`, remembered under the home), beyond the naming line?
2. Should `/crt:next` be able to work an item from its GitHub issue (`/crt:next #412`), reading the brief from the issue body?
3. Should CRT ship a conformance helper (`testDestination(dest)`) in the `./destination` entry for authors' own test suites?
4. Should the assets branch be deletable by CRT (`crt review prune`, PRD-zero Open question 2)?
5. Which token-based tracker is built in first, and does the credential store arrive with it as `crt connect`?

## 14. As built (v0.9.0)

Where the build differs from the text above, the build is what the docs (`docs/destinations.md`) and the tests describe. Each difference, and why:

1. **The worked example is the command destination** (§3, F-150), not a sixty-line HTTP poster: `packages/server/examples/destination-command.mjs`, published as `claude-review-tool/destination-command`. It runs a command of the developer's once per item with the item as JSON on standard input, and reads `{"id", "url"}`, a bare URL or nothing from the command's last line. Simon asked for it as the proof of concept for outside modules; it is also the shortest way to reach a tracker CRT does not ship (a ten-line script that posts the item is in the docs page). It imports nothing from CRT and makes no connection itself, so N-40 holds for what CRT ships; what the command does is the developer's own, and its plan says exactly that (`Sends each item to that command — what it sends on is the command's own.`).
2. **`use` resolves from the project root**, not from the config file that names it (§5.3): three files can name a destination (guest, local, project) and a path must mean the same in each. A package specifier is resolved from the project and then from CRT's own package, which is how `claude-review-tool/destination-command` works in a project with nothing installed.
3. **The config layering is guest, then `.crt/config.local.json`, then `.crt/config.json`** (F-146 says "local over project over guest"): the same order every other key has since PRD-zero §5.3.
4. **`state` is only ever `"partial"`** (§5.4): an entry without it is complete, so every 0.8 entry reads as complete and the 0.8 tests' `toEqual` rows stand unchanged (N-37).
5. **The contract gained fields** (§5.2), all within version 1: `FeedbackItem.file` and `.path` (the task file); `ctx.has(tool)`, `ctx.record(fields)` and `ctx.recorded` (a destination's own strings in its `review.json` entry — the assets branch and commit of `github`, the branch of `pr` — handed back to a run that continues); `ctx.run` takes any tool on PATH, not only `git` and `gh`.
6. **The `handoff` doctor row appears only when `handoff.to` is set** (F-149): no `--    handoff   default …` row, so a project that configures nothing sees the same `crt doctor` as in 0.8. Its detail is what can be known without running anything: `github (GitHub Issues) — built in`, `tracker — tools/crt-to-tracker.mjs`, or `warn  … not found`. Whether `gh` is logged in is said by the plan, which is where it matters.
7. **The review page names the destination only when one is configured** (F-149): ` — to GitHub Issues` after the command; otherwise the page is as it was, and the 0.8 screenshot stands (no `npm run screenshots` for this release).
8. **An export refuses an existing file** (F-144, F-145) instead of overwriting it, like `bundle` does: remove it or pass `--out`.
