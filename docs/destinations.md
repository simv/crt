# Destinations

Where `crt handoff` can send a review — the seven destinations CRT ships with their options, how to choose one, and how to write your own, walking through the example that sends each item to a command of yours. The review and the hand-over in short: [README › Install](../README.md#install) and [review.md](review.md).

## What a destination is

A **destination** is what follows `--to`: one module that says what it will do with the kept items of a review (`plan`) and then does it one item at a time (`publish`). CRT owns everything around it — which review, which items, printing the plan, the one question `Go ahead? [Y/n]`, and the record in `review.json` — so every destination behaves the same: it says what will exist and what leaves your machine before anything happens, `--yes` skips the question, and off a terminal without `--yes` nothing is written or sent.

```
$ crt handoff --list
  pr        A pull request with the items as task files — built in
  branch    A local branch with the items as task files — built in
  here      This working tree — built in
  bundle    A folder with REVIEW.md, the task files and their assets — built in
  markdown  One Markdown file, the images beside it — built in
  json      One JSON file with the items as data — built in
  github    GitHub Issues — built in, options from .crt/config.json
* tracker   (a module from outside CRT) — claude-review-tool/destination-command, from .crt/config.json

* is what plain `crt handoff` uses (handoff.to in .crt/config.json).
```

Two kinds, and the difference is what happens to the review afterwards:

- **A hand-over** (`pr`, `branch`, `here`, `bundle`, `github`, and a module of yours unless it says otherwise) is final: the review becomes `handed`, and new feedback starts a new review.
- **An export** (`markdown`, `json`) is a copy: the review stays `open`, you can export it as often as you like and hand it over afterwards.

## Choosing one

`crt handoff --to <name>` for one run. For every run, `handoff.to` in the config:

```json
{
  "handoff": { "to": "github" },
  "destinations": {
    "github": { "labels": ["crt"], "priorityLabels": { "high": "priority: high" } }
  }
}
```

`destinations.<name>` holds that destination's options. Both keys are read from `.crt/config.json` (committed, for the team), `.crt/config.local.json` (yours, gitignored) and, for a project that is not set up, the guest config under the CRT home; the first file that sets a key wins, per destination. Without `handoff.to`, plain `crt handoff` uses `pr` with a git remote and `gh`, `branch` in a repository without either, and `here` otherwise, as before.

## The built-in destinations

`pr`, `branch`, `here` and `bundle` are the hand-over as [cli.md › Hand-over](cli.md#hand-over) describes it: the items become task files in the project.

### `markdown`

One file `crt-review-<project>-<review>.md` in the current directory, with a folder `crt-review-<project>-<review>-assets/` of the screenshots beside it: the summary (totals, the commit reviewed, the items by route), then every kept item in full, its images linked relatively so the file reads in any Markdown viewer and survives being zipped with its folder. `--out <path>` names another file (or a directory to put it in); `--no-screenshots` writes the file alone. A file or folder that is already there is not overwritten: the line says to remove it or pass `--out`.

### `json`

One file `crt-review-<project>-<review>.json`: `{ "schema": 1, "review", "project", "items" }`, each item with its id, title, priority, URL, route, branch, commit, tags, files, its sections by name, the whole task file as `markdown`, and its images as absolute paths on this machine. It is for a script of your own; `--out <path>` as above, and an existing file is refused the same way. Nothing is copied.

### `github`

One GitHub issue per kept item, created with the GitHub CLI (`gh issue create`) under your own login — CRT stores no token and makes no network call of its own.

```
$ crt handoff --to github
Publish review 2026-11-16 as GitHub issues in acme/shop: 9 of 11 items.
  R-01  high    /checkout  Cart total excludes applied discount
  …
Labels: crt.
Pushes 18 screenshots to a new branch crt/review-2026-11-16-assets of origin, so the issues can show them — made from origin/main in a temporary worktree, your checkout is not touched. Nothing else is on it, and it is never merged.
Sends 9 issues and 18 screenshots to github.com.
Go ahead? [Y/n]
```

| Option | Meaning |
|---|---|
| `repo` | `owner/name`. Default: read from the project's git remote. |
| `host` | For GitHub Enterprise, with `repo`. Default `github.com`. |
| `labels` | Labels every issue gets. |
| `priorityLabels` | A label per priority: `{ "high": "priority: high", "normal": …, "low": … }`. |
| `index` | `true` adds one more issue listing the others as a task list. |
| `screenshots` | `"none"` is `--no-screenshots` for every run. |

The issue title is the item's title; the body is its Summary, Context, Evidence, Ask and Definition of Done (as a task list), then where it was reviewed (URL, branch, commit) and its `R-NN`. Labels must exist in the repository: a missing one stops the run before anything is created, and the line names it.

**Screenshots.** GitHub has no way for a command-line tool to attach an image to an issue, so CRT commits the screenshots to a branch of their own in the project's repository — `crt/review-<review>-assets`, made in a temporary `git worktree` like the hand-over branch, holding `.crt/tasks/assets/review-<review>/<R-NN>/<image>` and nothing else — pushes it, and links each image at that commit. Your checkout is not touched, and the branch is never merged; keep it for as long as the issues should show their images. Anyone who can read the repository can see them, and nobody else. `--no-screenshots` creates text-only issues and pushes nothing; each image is then named in the issue as not published.

## When a publish stops half-way

Every item is recorded in `review.json` the moment it lands. When the sixth of nine fails — the network, a rate limit, a command of yours exiting non-zero — the line says how many exist and the review stays `open`:

```
crt: created 5 of 9 issues, then gh said: HTTP 502 — run `crt handoff --to github` again to create the other 4
```

Running the same command again plans and sends only the items that have not gone, and says so before its plan (`5 of 9 are already there from an earlier run; 4 to go.`). The review becomes `handed` when the last one lands. `--again` is for the other case: a review already handed over, sent once more in full.

## What is recorded

`review.json` in the review's folder under the CRT home keeps one entry per destination under `handovers`: `to`, `at`, `items` (each `R-NN` and its id there — `CRT-0031`, `#412`), `urls` when the destination gave links, and whatever else it noted (`branch`, `url`, `file`, `assetsBranch`). An entry still being published carries `"state": "partial"`; `crt review --json` gives the entries as they are.

## Writing your own

A destination from outside CRT is one JavaScript module, named in the config:

```json
{
  "destinations": {
    "tracker": { "use": "./tools/crt-to-tracker.mjs", "project": "WEB" }
  }
}
```

`use` is a path, taken from the project root, or a package specifier, resolved from the project and then from CRT's own package. Everything else in the object is the module's options. The name (`tracker`) is yours: lowercase letters, digits and `-`; a built-in name cannot be replaced.

The module exports `destination` (or a default export) — a plain object:

```js
/** @type {import("claude-review-tool/destination").Destination} */
export const destination = {
  apiVersion: 1,
  id: "tracker",
  title: "Our tracker",
  final: true, // false for an export that leaves the review open

  // Say what will happen. No side effects: CRT prints `lines`, then `Sends <sends>.`, then asks.
  plan(input, ctx) {
    return {
      lines: [`Create ${input.items.length} tickets in ${ctx.options.project}.`],
      sends: [`${input.items.length} tickets to tracker.example`],
    };
  },

  // Do it, after the yes. Yield each item as it lands; throw to stop.
  async *publish(input, plan, ctx) {
    for (const item of input.items) {
      const ticket = await createTicket(ctx.options.project, item.title, item.sections.Summary);
      yield { item: item.id, id: ticket.key, url: ticket.url };
    }
  },
};
```

That is the whole contract (version 1), and `claude-review-tool/destination` exports its types — `Destination`, `PublishInput`, `FeedbackItem`, `DestinationPlan`, `PublishedItem`, `DestinationContext` — and `defineDestination()` for editors that prefer a function. The module needs to import nothing from CRT at runtime.

- **`input`** — `review` (name, created, totals), `project` (root, name, remote), `items` (the kept items not yet published here, in review order) and `already` (what an earlier, unfinished run published). An item has `id` (`R-03`), `title`, `priority`, `url`, `route`, `branch`, `commit`, `tags`, `files`, `sections` (Summary, Context, Evidence, Ask, Definition of Done, Notes — by name, as written), `markdown` (the whole task file), `file` and `path`, and `images` (name, absolute path, bytes; the annotated screenshot first).
- **`ctx`** — `options` (your object from the config, without `use`), `flags` (the flags of this run CRT does not own, so `crt handoff --to tracker --sprint 12` gives `flags.sprint`), `env`, `cwd`, `now`, `log(line)`, `has(tool)` and `run(tool, args)` (a tool on PATH, run without a shell; never throws), `tmp()` (a directory removed afterwards), and `record(fields)` / `recorded` (a few strings kept in the review's entry, handed back to a later run that continues this one).
- **Refusing** — throw an `Error` with a one-line message from `plan` when it cannot work here (a missing option, no login). CRT prints it after `crt: ` and nothing has happened.
- **Stopping** — throw from `publish`. What was yielded is recorded; the next run gets only the rest.
- **Saying what leaves the machine** — `sends` is printed before the question. Be exact; when you cannot know (the example below hands items to an arbitrary command), say that.

A module written for a contract version this CRT does not speak is refused with both versions in the line. Additions to version 1 are optional fields only.

### The example: send each item to your own command

`claude-review-tool/destination-command` is a complete destination in one file — [`packages/server/examples/destination-command.mjs`](../packages/server/examples/destination-command.mjs), importing nothing from CRT — and it is useful as it is: it runs a command of yours once per item, so a ten-line script in any language can put the feedback wherever you keep work.

```json
{
  "destinations": {
    "tracker": {
      "use": "claude-review-tool/destination-command",
      "command": ["node", "tools/to-tracker.mjs"]
    }
  }
}
```

```
$ crt handoff --to tracker
crt: --to tracker is node_modules/claude-review-tool/examples/destination-command.mjs, from .crt/config.json
Send review 2026-11-16 to your command: 9 items.
  R-01  high    /checkout  Cart total excludes applied discount
  …
Runs `node tools/to-tracker.mjs` in C:\my-app once per item, the item as JSON on its standard input.
Sends each item to that command — what it sends on is the command's own.
Go ahead? [Y/n]
  R-01 → WEB-17  https://tracker.example/WEB-17
  …
Sent review 2026-11-16 to your command: 9 items.
```

The command is started in the project root, without a shell (on Windows name `node` or an `.exe`, not a `.cmd`), with `{ "schema": 1, "review", "project", "item" }` as JSON on its standard input and `CRT_REVIEW`, `CRT_ITEM_ID`, `CRT_ITEM_TITLE` and `CRT_ITEM_FILE` (the task file's path) in its environment. Exit 0 means the item went; the last line it printed says where — `{"id": "WEB-17", "url": "https://…"}`, a bare URL, or nothing. Any other exit stops the run there, with the last line of its standard error in the `crt:` line, and the next `crt handoff --to tracker` sends only the rest. `timeoutSeconds` (default 120) is how long one item may take.

```js
// tools/to-tracker.mjs
let text = "";
for await (const chunk of process.stdin) text += chunk;
const { item } = JSON.parse(text);
const res = await fetch("https://tracker.example/api/tickets", {
  method: "POST",
  headers: { authorization: `Bearer ${process.env.TRACKER_TOKEN}`, "content-type": "application/json" },
  body: JSON.stringify({ title: item.title, body: item.markdown, priority: item.priority }),
});
if (!res.ok) throw new Error(`tracker said ${res.status}`);
const ticket = await res.json();
console.log(JSON.stringify({ id: ticket.key, url: ticket.url }));
```

To write a destination of your own rather than a command, copy the example file into your project, point `use` at the copy, and change `plan` and `publish`; the comments in it say what each part is for.

## Trust

A module named by `use`, and a command it runs, is your code running with your rights — like a script in `package.json`. CRT loads such a module in one place only: `crt handoff`, for the destination of that run, after printing the line that names the file and the config it came from, and still before the plan and the question. `crt handoff --list`, `crt doctor`, `crt review` and the server never load one. CRT itself sends nothing anywhere: `pr` and `github` run `git` and `gh` with your credentials after you confirmed the plan, and that is all ([how-it-works.md › Privacy](how-it-works.md)).
