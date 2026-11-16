import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseAnswer } from "../examples/destination-command.mjs";
import { API_VERSION, defineDestination } from "../src/destinations/api.js";
import { assetsPath, parseGithubRemote, renderIssueBody } from "../src/destinations/github.js";
import { BUILTIN_DESTINATIONS, destinationFact, destinationProblem, listDestinations, readDestinationsConfig, resolveUse } from "../src/destinations/index.js";
import { readFeedbackItem, renderItemMarkdown } from "../src/destinations/item.js";
import { exportJson } from "../src/destinations/json.js";
import { listHandoff } from "../src/handoff.js";
import { currentReview, guestConfigPath, type Handover, reviewTasksDir } from "../src/home.js";
import { reviewPayload } from "../src/review-page.js";
import { ok, type ReviewFixture, reviewFixture } from "./helpers/review-fixture.js";

// PRD-destinations M33–M36: the destination seam (F-140…F-143, N-37…N-39), the exports and the
// default (F-144…F-146), GitHub Issues (F-147, F-148, N-40) and the example destination that sends
// each item to a command (F-150). Real `git`, `gh` answered by the run seam, a temp `CRT_HOME`.
// What the four destinations of 0.8 do is test/handoff.test.ts, unchanged (N-37).

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "fixtures", "destinations");
const SRC = join(HERE, "..", "src");

let f: ReviewFixture;
beforeEach(() => {
  f = reviewFixture();
});
afterEach(() => f.dispose());

const tasksDir = () => reviewTasksDir(f.review().dir);
const handovers = () => f.manifest().handovers as Handover[];
const callsOf = (file: string) => readFileSync(file, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { call: string; items: string[]; already?: string[] });
/** A recorder destination named `tracker`, from a path relative to the project root. */
function recorder(options: Record<string, unknown> = {}): string {
  const calls = join(f.scratch, "calls.jsonl");
  mkdirSync(join(f.root, "tools"), { recursive: true });
  writeFileSync(join(f.root, "tools", "recorder.mjs"), readFileSync(join(FIXTURES, "recorder.mjs"), "utf8"));
  f.config({ destinations: { tracker: { use: "./tools/recorder.mjs", calls, ...options } } });
  return calls;
}

describe("the registry (F-140, F-146)", () => {
  it("knows the seven built-in destinations, each with the contract's shape (F-140)", () => {
    expect(BUILTIN_DESTINATIONS.map((d) => d.id)).toEqual(["pr", "branch", "here", "bundle", "markdown", "json", "github"]);
    for (const d of BUILTIN_DESTINATIONS) expect(destinationProblem(d), d.id).toBeNull();
    expect(BUILTIN_DESTINATIONS.filter((d) => !d.final).map((d) => d.id)).toEqual(["markdown", "json"]);
    expect(defineDestination(BUILTIN_DESTINATIONS[0]!)).toBe(BUILTIN_DESTINATIONS[0]);
    expect(API_VERSION).toBe(1);
  });

  it("refuses a name nobody has, and a module that takes a built-in's name (F-140, F-143)", async () => {
    expect(await f.failure({ to: "nope" })).toBe('no destination "nope" — `crt handoff --list` shows them');
    f.config({ destinations: { pr: { use: "./tools/mine.mjs" } } });
    expect(await f.failure({ to: "pr" })).toBe("destinations.pr in .crt/config.json names a module, but pr is built in and cannot be replaced — give yours another name");
  });

  it("reads handoff.to and destinations from the guest file, then the local one, then the project's (F-146)", () => {
    f.config({ handoff: { to: "github" }, destinations: { github: { labels: ["crt"] }, tracker: { use: "./a.mjs", project: "WEB" }, "Bad Name": { use: "x" } } });
    let c = readDestinationsConfig(f.root, f.env);
    expect(c.defaultTo).toBe("github");
    expect(c.entries.get("github")).toMatchObject({ use: null, options: { labels: ["crt"] }, source: "project" });
    expect(c.entries.get("tracker")).toMatchObject({ use: "./a.mjs", options: { project: "WEB" } });
    expect(c.entries.has("Bad Name")).toBe(false);
    f.put(".crt/config.local.json", JSON.stringify({ handoff: { to: "markdown" }, destinations: { tracker: { use: "./b.mjs" } } }));
    c = readDestinationsConfig(f.root, f.env);
    expect([c.defaultTo, c.entries.get("tracker")!.use, c.entries.get("tracker")!.source]).toEqual(["markdown", "./b.mjs", "local"]);
    mkdirSync(dirname(guestConfigPath(f.root, f.env)), { recursive: true });
    writeFileSync(guestConfigPath(f.root, f.env), JSON.stringify({ handoff: { to: "json" } }));
    c = readDestinationsConfig(f.root, f.env);
    expect([c.defaultTo, c.entries.get("tracker")!.use]).toEqual(["json", "./b.mjs"]);
  });

  it("uses handoff.to for plain crt handoff, and --to over it (F-146)", async () => {
    f.config({ handoff: { to: "json" } });
    await f.handoff();
    expect(handovers().map((h) => h.to)).toEqual(["json"]);
    await f.handoff({ to: "markdown" });
    expect(handovers().map((h) => h.to)).toEqual(["json", "markdown"]);
  });

  it("lists every destination and imports none, even one whose file is missing (F-146, N-39)", async () => {
    f.config({ handoff: { to: "tracker" }, destinations: { tracker: { use: "./tools/gone.mjs" }, github: { labels: ["crt"] } } });
    const lines: string[] = [];
    await listHandoff({ root: f.root, env: f.env, log: (l) => lines.push(l) });
    expect(lines.slice(0, 7).map((l) => l.slice(0, 12).trimEnd())).toEqual(["  pr", "  branch", "  here", "  bundle", "  markdown", "  json", "  github"]);
    expect(lines[6]).toBe("  github    GitHub Issues — built in, options from .crt/config.json");
    expect(lines[7]).toBe("* tracker   (a module from outside CRT) — ./tools/gone.mjs, from .crt/config.json");
    expect(lines.at(-1)).toBe("* is what plain `crt handoff` uses (handoff.to in .crt/config.json).");
    expect(listDestinations(readDestinationsConfig(f.root, f.env)).map((d) => d.kind)).toEqual(["builtin", "builtin", "builtin", "builtin", "builtin", "builtin", "builtin", "external"]);
    // F-149: what `crt doctor` can say without importing anything.
    const c = readDestinationsConfig(f.root, f.env);
    expect(destinationFact("tracker", c, f.root)).toEqual({ ok: false, title: "tracker", detail: "./tools/gone.mjs not found" });
    expect(destinationFact("github", c, f.root)).toEqual({ ok: true, title: "GitHub Issues", detail: "built in" });
  });
});

describe("FeedbackItem (F-141)", () => {
  it("gives the frontmatter, every section but the Log, and the images — never capture.json (F-141, N-40)", () => {
    const file = readdirSync(tasksDir()).find((n) => n.startsWith("R-01"))!;
    const item = readFeedbackItem(tasksDir(), file);
    expect(item).toMatchObject({ id: "R-01", title: "Cart total excludes applied discount", priority: "normal", route: "/cart", file });
    expect(item.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(item.branch).toBe("main");
    expect(Object.keys(item.sections)).toEqual(["Summary", "Context", "Evidence", "Ask", "Definition of Done", "Notes"]);
    expect(item.sections.Ask).toBe("Apply the discount to the total.");
    expect(item.sections["Definition of Done"]).toBe("- [ ] Total applies the discount");
    expect(item.markdown).toContain("## Log");
    expect(readdirSync(join(tasksDir(), "assets", "R-01"))).toContain("capture.json");
    expect(item.images.map((i) => i.name)).not.toContain("capture.json");
    expect(item.images.slice(0, 2).map((i) => i.name)).toEqual(["viewport-annotated.png", "viewport.png"]);
    expect(item.images.every((i) => existsSync(i.path) && i.bytes > 0)).toBe(true);
  });

  it("tolerates a file from before 0.8 and an item with no assets (F-141)", () => {
    writeFileSync(join(tasksDir(), "R-09-old.md"), "---\nid: R-09\ntitle: Old\nstatus: backlog\npriority: urgent\ntags: [a]\n---\n\n## Summary\nS\n\n## Ask\n\n## Log\n- x\n");
    const item = readFeedbackItem(tasksDir(), "R-09-old.md");
    expect(item).toMatchObject({ id: "R-09", priority: "normal", branch: null, commit: null, url: null, tags: ["a"], files: [], images: [] });
    expect(item.sections).toMatchObject({ Summary: "S", Ask: "", Evidence: "" });
  });

  it("renders an item with its image links pointed where the caller says, or named when not published (F-141)", () => {
    const item = readFeedbackItem(tasksDir(), readdirSync(tasksDir()).find((n) => n.startsWith("R-01"))!);
    const linked = renderItemMarkdown(item, { image: (i) => `https://img.invalid/${i.name}` });
    expect(linked).toMatch(/^### Summary\n\nThe total ignores the discount\.\n\n### Context\n/);
    expect(linked).toContain("](https://img.invalid/viewport-annotated.png)");
    expect(linked).not.toContain("](assets/R-01/");
    expect(linked).toContain("### Definition of Done\n\n- [ ] Total applies the discount");
    expect(linked).not.toContain("## Log");
    const bare = renderItemMarkdown(item, { image: () => null });
    expect(bare).not.toMatch(/\]\((assets|https)/);
    expect(bare).toContain("`viewport-annotated.png` (not published; it stays with the review)");
  });
});

describe("a destination from outside CRT (F-143, N-38, N-39)", () => {
  it("loads a module named by `use`, says which file first, plans, asks, publishes and records ids and links (F-143)", async () => {
    const calls = recorder();
    const result = await f.handoff({ to: "tracker" });
    expect(f.lines[0]).toBe("crt: --to tracker is tools/recorder.mjs, from .crt/config.json");
    expect(f.lines.slice(1, 3)).toEqual([`Record review ${f.review().name}: 2 items.`, "Sends nothing anywhere."]);
    expect(callsOf(calls)).toEqual([
      { call: "plan", items: ["R-01", "R-03"], already: [] },
      { call: "publish", items: ["R-01", "R-03"], state: { n: 2 } },
    ]);
    expect(result.handover).toEqual({ to: "tracker", at: expect.any(String), items: { "R-01": "T-01", "R-03": "T-03" }, urls: { "R-01": "https://tracker.invalid/R-01", "R-03": "https://tracker.invalid/R-03" } });
    expect(f.manifest().status).toBe("handed");
  });

  it("never calls publish when the answer is no, or off a terminal without --yes (N-38)", async () => {
    const calls = recorder();
    const prompt = { ask: async () => "n", waitFor: async () => ({ kind: "ready" as const }) };
    expect(await f.failure({ to: "tracker", yes: false, interactive: true, prompt })).toBe("cancelled — nothing was written");
    expect(await f.failure({ to: "tracker", yes: false, interactive: false })).toBe("crt handoff asks before it writes — run it on a terminal, or pass --yes (nothing was written)");
    expect(callsOf(calls).map((c) => c.call)).toEqual(["plan", "plan"]);
    expect(handovers()).toEqual([]);
  });

  it("turns a module's refusal into one line, and writes nothing (F-143)", async () => {
    recorder({ refuse: true });
    expect(await f.failure({ to: "tracker" })).toBe("tracker cannot publish this review: the recorder was told to refuse (nothing was written)");
    expect(handovers()).toEqual([]);
  });

  it("refuses a module that is not there, speaks another contract version, or lacks a function — one line each (F-143)", async () => {
    f.config({ destinations: { a: { use: "./tools/gone.mjs" }, b: { use: join(FIXTURES, "future.mjs") }, c: { use: join(FIXTURES, "no-publish.mjs") }, d: { use: "no-such-crt-package" } } });
    expect(await f.failure({ to: "a" })).toBe(`--to a is ./tools/gone.mjs (from .crt/config.json), which was not found — a path is taken from ${f.root}, a package must be installed there`);
    expect(await f.failure({ to: "b" })).toBe(`${join(FIXTURES, "future.mjs")} is not a destination: it was written for destination contract version 2, and this CRT speaks version 1`);
    expect(await f.failure({ to: "c" })).toBe(`${join(FIXTURES, "no-publish.mjs")} is not a destination: its \`publish\` function is missing`);
    expect(await f.failure({ to: "d" })).toMatch(/^--to d is no-such-crt-package \(from \.crt\/config\.json\), which was not found/);
    expect(handovers()).toEqual([]);
  });

  it("finds the example destination as a package of CRT's own, with nothing installed in the project (F-143, F-150)", () => {
    expect(resolveUse(f.root, "claude-review-tool/destination-command")).toBe(join(HERE, "..", "examples", "destination-command.mjs"));
  });

  it("imports a config-named module in one place only, and CRT opens no connection of its own (N-39, N-40)", () => {
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) e.isDirectory() ? walk(join(dir, e.name)) : e.name.endsWith(".ts") && sources.push(join(dir, e.name));
    };
    walk(SRC);
    const using = (re: RegExp) => sources.filter((s) => re.test(readFileSync(s, "utf8"))).map((s) => s.slice(SRC.length + 1).split("\\").join("/"));
    expect(using(/resolveDestination\(/)).toEqual(["destinations/index.ts", "handoff.ts"]);
    expect(using(/import\(pathToFileURL/)).toEqual(["destinations/index.ts"]);
    // N-40: no `fetch(` call in the destinations or the hand-over — `gh` and `git` are the only way out.
    expect([...using(/\bfetch\(/)].filter((s) => s.startsWith("destinations/") || s === "handoff.ts")).toEqual([]);
  });
});

describe("recorded as it lands, continued where it stopped (F-142)", () => {
  it("keeps exactly what landed when a destination stops, and offers only the rest next time (F-142)", async () => {
    writeReviewKeepAll();
    const calls = recorder({ failAfter: 2 });
    expect(await f.failure({ to: "tracker" })).toBe("tracker stopped after 2 of 3 items (the tracker said no) — run `crt handoff --to tracker` again to publish the rest");
    expect(handovers()).toEqual([{ to: "tracker", at: expect.any(String), items: { "R-01": "T-01", "R-02": "T-02" }, urls: expect.any(Object), state: "partial" }]);
    expect(f.manifest().status).toBe("open");

    f.lines.length = 0;
    await f.handoff({ to: "tracker" });
    expect(callsOf(calls).slice(2)).toEqual([
      { call: "plan", items: ["R-03"], already: ["R-01", "R-02"] },
      { call: "publish", items: ["R-03"], state: { n: 1 } },
    ]);
    expect(f.lines).toContain("2 of 3 are already there from an earlier run; 1 to go.");
    expect(handovers()).toEqual([{ to: "tracker", at: expect.any(String), items: { "R-01": "T-01", "R-02": "T-02", "R-03": "T-03" }, urls: expect.any(Object) }]);
    expect(f.manifest().status).toBe("handed");
  });

  it("leaves the review open after an export, which can be repeated (F-142, F-144)", async () => {
    await f.handoff({ to: "json" });
    await f.handoff({ to: "json", out: "again" });
    expect(f.manifest().status).toBe("open");
    expect(handovers().map((h) => [h.to, h.state])).toEqual([["json", undefined], ["json", undefined]]);
  });

  it("sends a handed review to a second destination without --again, and refuses the same one without it (F-142)", async () => {
    recorder();
    await f.handoff({ to: "tracker" });
    expect(f.manifest().status).toBe("handed");
    await f.handoff({ to: "bundle" });
    expect(handovers().map((h) => h.to)).toEqual(["tracker", "bundle"]);
    expect(await f.failure({ to: "tracker" })).toBe(`review ${f.review().name} was already handed over (--to tracker) — pass --again to hand it over once more`);
    await f.handoff({ to: "tracker", again: true });
    expect(handovers().map((h) => h.to)).toEqual(["tracker", "bundle", "tracker"]);
  });
});

function writeReviewKeepAll(): void {
  const dir = f.review().dir;
  const m = f.manifest();
  writeFileSync(join(dir, "review.json"), JSON.stringify({ ...m, items: m.items.map((i) => ({ ...i, keep: true })) }, null, 2));
}

describe("crt handoff --to markdown and json (F-144, F-145)", () => {
  it("writes one file with every kept item in full, in review order, and images that resolve beside it (F-144)", async () => {
    await f.handoff({ to: "markdown" });
    const name = f.review().name;
    const file = join(f.scratch, `crt-review-app-${name}.md`);
    const text = readFileSync(file, "utf8");
    expect(text).toMatch(new RegExp(`^# CRT review ${name}: 2 items\\n`));
    expect(text.indexOf("## R-01 — Cart total excludes applied discount")).toBeGreaterThan(text.indexOf("## /cart"));
    expect(text.indexOf("## R-03 — Empty cart has no message")).toBeGreaterThan(text.indexOf("## R-01 — "));
    expect(text).not.toContain("off-centre");
    expect(text).not.toContain("Working them");
    for (const section of ["### Summary", "### Context", "### Evidence", "### Ask", "### Definition of Done"]) expect(text.split(section).length, section).toBe(3);
    expect(text).toMatch(/Priority: normal · Page: \S+ · Reviewed at `[0-9a-f]{7}` on `main`/);
    const links = [...text.matchAll(/\]\(([^)\s]+\.png)\)/g)].map((m) => m[1]!);
    expect(links.length).toBeGreaterThanOrEqual(4);
    for (const link of links) expect(existsSync(join(f.scratch, decodeURI(link))), link).toBe(true);
    expect(readdirSync(join(f.scratch, `crt-review-app-${name}-assets`)).sort()).toEqual(["R-01", "R-03"]);
    expect(readdirSync(join(f.scratch, `crt-review-app-${name}-assets`, "R-01"))).not.toContain("capture.json");
    expect(f.lines.at(-1)).toBe(`Exported review ${name}: 2 items in ${file}.`);
    expect(handovers()).toEqual([{ to: "markdown", at: expect.any(String), items: { "R-01": "R-01", "R-03": "R-03" }, file }]);
    expect(await f.failure({ to: "markdown" })).toBe(`${file} already exists — remove it, or pass --out <file or dir>`);
  });

  it("takes --out as a file or a directory, and writes no images with --no-screenshots (F-144)", async () => {
    await f.handoff({ to: "markdown", out: "notes/review.md", flags: { "no-screenshots": true } });
    const text = readFileSync(join(f.scratch, "notes", "review.md"), "utf8");
    expect(readdirSync(join(f.scratch, "notes"))).toEqual(["review.md"]);
    expect(text).not.toMatch(/\]\(\S+\.png\)/);
    expect(text).toContain("(not published; it stays with the review)");
    mkdirSync(join(f.scratch, "out"));
    await f.handoff({ to: "markdown", out: "out" });
    expect(readdirSync(join(f.scratch, "out")).sort()).toEqual([`crt-review-app-${f.review().name}-assets`, `crt-review-app-${f.review().name}.md`]);
  });

  it("writes the items as data — exactly what a destination is given (F-145)", async () => {
    const calls = recorder();
    await f.handoff({ to: "json" });
    const data = JSON.parse(readFileSync(join(f.scratch, `crt-review-app-${f.review().name}.json`), "utf8")) as ReturnType<typeof exportJson>;
    expect(data.schema).toBe(1);
    expect(data.review).toEqual({ name: f.review().name, created: expect.any(String), totals: { items: 3, kept: 2, routes: 2 } });
    expect(data.project).toMatchObject({ root: f.root, name: "app", setUp: false });
    expect(data.items.map((i) => i.id)).toEqual(["R-01", "R-03"]);
    expect(data.items[0]).toEqual(JSON.parse(JSON.stringify(readFeedbackItem(tasksDir(), data.items[0]!.file))));
    await f.handoff({ to: "tracker" });
    expect(callsOf(calls)[0]!.items).toEqual(data.items.map((i) => i.id));
  });
});

describe("crt handoff --to github (F-147, F-148, N-40)", () => {
  let issue: number;
  const created = () => f.calls.filter((c) => c.tool === "gh" && c.args[0] === "issue");
  beforeEach(() => {
    issue = 40;
    f.config({ destinations: { github: { repo: "me/app" } } });
    f.gh = (args) => (args[0] === "label" ? ok(JSON.stringify([{ name: "crt" }, { name: "Priority: High" }])) : ok(`https://github.com/me/app/issues/${++issue}\n`));
    // N-35: a dirty checkout.
    f.put("src/app.ts", "export const total = 2;\n");
    f.git(["stash"]);
    f.put("src/app.ts", "export const total = 3;\n");
    f.put("notes.txt", "wip\n");
  });

  it("tells a repository from a remote URL (F-147)", () => {
    expect(parseGithubRemote("git@github.com:me/app.git")).toEqual({ host: "github.com", slug: "me/app" });
    expect(parseGithubRemote("https://github.com/me/app")).toEqual({ host: "github.com", slug: "me/app" });
    expect(parseGithubRemote("https://x-token@ghe.example.com/team/my.app.git/")).toEqual({ host: "ghe.example.com", slug: "team/my.app" });
    expect(parseGithubRemote("ssh://git@github.com:22/me/app.git")).toEqual({ host: "github.com", slug: "me/app" });
    expect(parseGithubRemote("/srv/git/app.git")).toBeNull();
    expect(parseGithubRemote("C:\\repos\\app.git")).toBeNull();
  });

  it("creates one issue per kept item in review order, each with its brief and its screenshots from a branch that holds only images — the checkout untouched (F-147, F-148, N-35)", async () => {
    const before = f.checkout();
    const result = await f.handoff({ to: "github" });
    const name = f.review().name;
    const branch = `crt/review-${name}-assets`;
    expect(f.checkout()).toEqual(before);

    // The plan came first, and says what leaves the machine.
    expect(f.lines[0]).toBe(`Publish review ${name} as GitHub issues in me/app: 2 of 3 items.`);
    expect(f.lines.find((l) => l.startsWith("Pushes "))).toMatch(new RegExp(`^Pushes \\d+ screenshots to a new branch ${branch} of origin, so the issues can show them — made from origin/main in a temporary worktree, your checkout is not touched\\.`));
    expect(f.lines.find((l) => l.startsWith("Sends "))).toMatch(/^Sends 2 issues and \d+ screenshots to github\.com\.$/);

    // The assets branch: one commit on origin/main with the kept items' images and nothing else, pushed.
    const tree = f.git(["diff", "--name-only", `origin/main...${branch}`]).split("\n");
    expect(tree.every((p) => /^\.crt\/tasks\/assets\/review-[\w-]+\/R-0[13]\/[\w-]+\.png$/.test(p)), tree.join(" ")).toBe(true);
    expect(tree).toContain(assetsPath(name, "R-01", "viewport-annotated.png"));
    expect(tree.some((p) => p.includes("R-02") || p.includes("capture"))).toBe(false);
    const sha = f.git(["rev-parse", branch]);
    expect(f.git(["rev-parse", `refs/heads/${branch}`], f.remote)).toBe(sha);
    expect(f.calls.filter((c) => c.tool === "git" && c.args[0] === "push").map((c) => c.args)).toEqual([["push", "origin", `refs/heads/${branch}:refs/heads/${branch}`]]);
    for (const c of f.calls.filter((c) => c.tool === "git")) {
      if (c.args[0] === "worktree" && c.args[1] === "remove") continue;
      expect(c.args.some((a) => /^(-f|-D|--force|--force-with-lease|--mirror|--delete|\+)/.test(a)), c.args.join(" ")).toBe(false);
      expect(["merge", "rebase", "reset", "checkout", "switch", "stash", "pull", "cherry-pick"]).not.toContain(c.args[0]);
    }

    // The issues: gh only, never --web or an editor, in review order, the body from a file.
    expect(created().map((c) => c.args.slice(0, 6))).toEqual([
      ["issue", "create", "--repo", "me/app", "--title", "Cart total excludes applied discount"],
      ["issue", "create", "--repo", "me/app", "--title", "Empty cart has no message"],
    ]);
    for (const c of created()) expect(c.args.filter((a) => a.startsWith("--"))).toEqual(["--repo", "--title", "--body-file"]);
    const body = created()[0]!.body!;
    expect(body).toMatch(/^### Summary\n\nThe total ignores the discount\./);
    expect(body).toContain(`](https://github.com/me/app/blob/${sha}/.crt/tasks/assets/review-${name}/R-01/viewport-annotated.png?raw=true)`);
    expect(body).toContain("### Definition of Done\n\n- [ ] Total applies the discount");
    expect(body).toMatch(new RegExp(`\\n---\\n_Filed with CRT from review ${name} \\(R-01\\) · reviewed at \`[0-9a-f]{7}\` on \`main\` · /cart_\\n$`));
    expect(body).not.toContain("## Log");

    // The record: each issue's number and link, the branch, and the review handed over.
    expect(result.handover).toEqual({
      to: "github",
      at: expect.any(String),
      items: { "R-01": "#41", "R-03": "#42" },
      urls: { "R-01": "https://github.com/me/app/issues/41", "R-03": "https://github.com/me/app/issues/42" },
      assetsBranch: branch,
      assetsCommit: sha,
    });
    expect(f.manifest().status).toBe("handed");
    expect(f.lines.at(-1)).toBe(`Published review ${name}: 2 issues in me/app.`);
    // Nothing went into the project's own tasks.
    expect(readdirSync(join(f.root, ".crt"))).toEqual(["config.json"]);
  });

  it("puts the configured labels on each issue, and refuses before creating anything when the repository lacks one (F-147)", async () => {
    f.config({ destinations: { github: { repo: "me/app", labels: ["crt"], priorityLabels: { normal: "priority: high" } } } });
    await f.handoff({ to: "github", flags: { "no-screenshots": true } });
    expect(created()[0]!.args.slice(8)).toEqual(["--label", "crt", "--label", "priority: high"]);
    expect(f.lines).toContain("Labels: crt, priority: high.");

    f.calls.length = 0;
    f.config({ destinations: { github: { repo: "me/app", labels: ["crt", "from-review"] } } });
    expect(await f.failure({ to: "github", again: true })).toBe('me/app has no label "from-review" — create it there, or change destinations.github in the config; nothing was created');
    expect(created()).toEqual([]);
    expect(f.calls.some((c) => c.args[0] === "push" || c.args[0] === "worktree")).toBe(false);
  });

  it("publishes text only with --no-screenshots: no branch, no push, the images named (F-148)", async () => {
    await f.handoff({ to: "github", flags: { "no-screenshots": true } });
    expect(f.git(["branch", "--list", "crt/*"])).toBe("");
    expect(f.calls.filter((c) => c.tool === "git" && ["push", "worktree", "fetch"].includes(c.args[0]!))).toEqual([]);
    expect(created()[0]!.body).toContain("`viewport-annotated.png` (not published; it stays with the review)");
    expect(f.lines).toContain("No screenshots are published.");
    expect(f.lines).toContain("Sends 2 issues to github.com.");
    expect(handovers()[0]).not.toHaveProperty("assetsBranch");
  });

  it("stops with how many exist when gh fails, and the next run creates only the rest on the same branch (F-142, F-147, F-148)", async () => {
    writeReviewKeepAll();
    f.gh = (args) => (args[0] !== "issue" ? ok("[]") : issue >= 42 ? { status: 1, stdout: "", stderr: "HTTP 502: Bad Gateway\n", error: null } : ok(`https://github.com/me/app/issues/${++issue}\n`));
    expect(await f.failure({ to: "github" })).toBe("created 2 of 3 issues, then gh said: HTTP 502: Bad Gateway — run `crt handoff --to github` again to create the other 1");
    const name = f.review().name;
    expect(handovers()).toEqual([{ to: "github", at: expect.any(String), items: { "R-01": "#41", "R-02": "#42" }, urls: expect.any(Object), state: "partial", assetsBranch: `crt/review-${name}-assets`, assetsCommit: expect.stringMatching(/^[0-9a-f]{40}$/) }]);
    expect(f.manifest().status).toBe("open");

    f.calls.length = 0;
    f.lines.length = 0;
    f.gh = () => ok(`https://github.com/me/app/issues/${++issue}\n`);
    await f.handoff({ to: "github" });
    expect(created().map((c) => c.args[5])).toEqual(["Empty cart has no message"]);
    expect(f.calls.some((c) => c.tool === "git" && (c.args[0] === "push" || c.args[0] === "worktree"))).toBe(false);
    expect(created()[0]!.body).toContain(`/blob/${handovers()[0]!.assetsCommit as string}/.crt/tasks/assets/review-${name}/R-03/`);
    expect(f.lines).toContain(`The screenshots are already on the branch crt/review-${name}-assets, pushed by the earlier run.`);
    expect(handovers()).toHaveLength(1);
    expect(handovers()[0]!.items).toEqual({ "R-01": "#41", "R-02": "#42", "R-03": "#43" });
    expect(f.manifest().status).toBe("handed");
    expect(f.git(["branch", "--list", "crt/*"]).split("\n")).toHaveLength(1);
  });

  it("creates no issue when the screenshots cannot be pushed (F-148)", async () => {
    const hook = join(f.remote, "hooks", "pre-receive");
    writeFileSync(hook, "#!/bin/sh\necho refused by policy >&2\nexit 1\n");
    chmodSync(hook, 0o755);
    const name = f.review().name;
    expect(await f.failure({ to: "github" })).toMatch(new RegExp(`^could not push crt/review-${name}-assets \\(.+\\) — no issue was created; fix that, or pass --no-screenshots$`));
    expect(created()).toEqual([]);
    expect(f.manifest().status).toBe("open");
  });

  it("refuses without gh, and without a way to tell the repository (F-147)", async () => {
    f.config({});
    expect(await f.failure({ to: "github" })).toBe(`could not tell a GitHub repository from the remote origin (${f.remote}) — set "destinations": { "github": { "repo": "owner/name" } } in .crt/config.json`);
    f.config({ destinations: { github: { repo: "me/app" } } });
    expect(await f.failure({ to: "github", env: { ...f.env, PATH: dirname(process.execPath) } })).toBe("gh (the GitHub CLI) not found on PATH — install it (https://cli.github.com) and run `gh auth login`; nothing was created");
    expect(created()).toEqual([]);
  });

  it("adds an issue that lists them all with \"index\": true (F-147, Should)", async () => {
    f.config({ destinations: { github: { repo: "me/app", index: true, screenshots: "none" } } });
    const result = await f.handoff({ to: "github" });
    const name = f.review().name;
    expect(created().map((c) => c.args[5])).toEqual(["Cart total excludes applied discount", "Empty cart has no message", `CRT review ${name}: 2 items`]);
    expect(created()[2]!.body).toContain("- [ ] #41 (normal) Cart total excludes applied discount — The total ignores the discount.");
    expect(result.handover).toMatchObject({ items: { "R-01": "#41", "R-03": "#42" }, url: "https://github.com/me/app/issues/43" });
  });

  it("renders an issue body as a pure function of the item (F-147)", () => {
    const item = readFeedbackItem(tasksDir(), readdirSync(tasksDir()).find((n) => n.startsWith("R-03"))!);
    const body = renderIssueBody(item, "r1", (file) => `u/${file}`);
    expect(renderIssueBody(item, "r1", (file) => `u/${file}`)).toBe(body);
    expect(body).toContain("](u/viewport-annotated.png)");
    expect(body.endsWith("_\n")).toBe(true);
  });
});

describe("the example destination: each item to a command of your own (F-150)", () => {
  const log = () => join(f.scratch, "tracker.log");
  const use = (extra: Record<string, unknown> = {}) =>
    f.config({ destinations: { tracker: { use: "claude-review-tool/destination-command", command: [process.execPath, join(FIXTURES, "tracker.mjs")], ...extra } } });

  it("runs the command once per kept item with the item as JSON on its standard input, and records what it answers (F-150)", async () => {
    use();
    const result = await f.handoff({ to: "tracker", env: { ...f.env, TRACKER_LOG: log() } });
    const name = f.review().name;
    expect(readFileSync(log(), "utf8")).toBe(`${name} R-01 R-01 Apply the discount to the total.\n${name} R-03 R-03 Apply the discount to the total.\n`);
    expect(f.lines[0]).toMatch(/^crt: --to tracker is .*destination-command\.mjs, from \.crt\/config\.json$/);
    expect(f.lines[1]).toBe(`Send review ${name} to your command: 2 items.`);
    expect(f.lines).toContain("Sends each item to that command — what it sends on is the command's own.");
    expect(f.lines).toContain("  R-01 → WEB-01  https://tracker.invalid/WEB-01");
    expect(result.handover).toEqual({ to: "tracker", at: expect.any(String), items: { "R-01": "WEB-01", "R-03": "WEB-03" }, urls: { "R-01": "https://tracker.invalid/WEB-01", "R-03": "https://tracker.invalid/WEB-03" } });
  });

  it("stops at the item the command fails on, and sends only the rest next time (F-142, F-150)", async () => {
    use();
    expect(await f.failure({ to: "tracker", env: { ...f.env, TRACKER_LOG: log(), TRACKER_FAIL_ON: "R-03" } })).toMatch(/^tracker stopped after 1 of 2 items \(`.+tracker\.mjs` failed on R-03 \(the tracker is down for R-03\); 1 of 2 were sent\) — run `crt handoff --to tracker` again to publish the rest$/);
    await f.handoff({ to: "tracker", env: { ...f.env, TRACKER_LOG: log() } });
    expect(readFileSync(log(), "utf8").trim().split("\n").map((l) => l.split(" ")[1])).toEqual(["R-01", "R-03"]);
    expect(handovers()).toHaveLength(1);
    expect(f.manifest().status).toBe("handed");
  });

  it("refuses without a command, in one line (F-150)", async () => {
    f.config({ destinations: { tracker: { use: "claude-review-tool/destination-command" } } });
    expect(await f.failure({ to: "tracker" })).toBe('tracker cannot publish this review: the "command" option is missing — give it as an array, e.g. "command": ["node", "tools/to-tracker.mjs"] (nothing was written)');
  });

  it("reads the command's last line as JSON, a bare URL, or nothing (F-150)", () => {
    expect(parseAnswer('log\n{"id":"WEB-1","url":"https://t/1"}\n', "R-01")).toEqual({ id: "WEB-1", url: "https://t/1" });
    expect(parseAnswer("https://t/2\n\n", "R-01")).toEqual({ id: "R-01", url: "https://t/2" });
    expect(parseAnswer("done", "R-01")).toEqual({ id: "R-01" });
    expect(parseAnswer("", "R-01")).toEqual({ id: "R-01" });
  });
});

describe("where a hand-over goes, on the review page (F-149; the doctor row is in doctor.test.ts)", () => {
  it("names the configured destination beside the command on the review page, and nothing without one (F-149)", () => {
    const review = currentReview(f.root, f.env);
    expect(reviewPayload(f.root, review)).not.toHaveProperty("handoffTo");
    f.config({ handoff: { to: "github" } });
    const env = process.env.CRT_HOME;
    process.env.CRT_HOME = f.env.CRT_HOME;
    try {
      expect(reviewPayload(f.root, review)).toMatchObject({ handoff: "crt handoff", handoffTo: "GitHub Issues" });
    } finally {
      process.env.CRT_HOME = env;
    }
  });
});

describe("docs/destinations.md, the tenth reference page (F-150)", () => {
  const page = readFileSync(join(HERE, "..", "..", "..", "docs", "destinations.md"), "utf8");

  it("lists every built-in destination as `crt handoff --list` prints it (F-146, F-150)", () => {
    for (const d of BUILTIN_DESTINATIONS) expect(page, d.id).toContain(`  ${d.id.padEnd(8)}  ${d.title} — built in`);
    for (const heading of ["## What a destination is", "## Choosing one", "### `markdown`", "### `json`", "### `github`", "## When a publish stops half-way", "## Writing your own", "## Trust"]) expect(page).toContain(`\n${heading}\n`);
  });

  it("walks through the example that ships and is tested here, and the contract's version (F-143, F-150)", () => {
    expect(page).toContain("(../packages/server/examples/destination-command.mjs)");
    expect(page).toContain('"use": "claude-review-tool/destination-command"');
    expect(page).toContain(`apiVersion: ${API_VERSION},`);
    const pkg = JSON.parse(readFileSync(join(HERE, "..", "package.json"), "utf8")) as { exports: Record<string, unknown>; files: string[] };
    expect(pkg.exports["./destination-command"]).toBe("./examples/destination-command.mjs");
    expect(pkg.files).toContain("examples");
  });

  it("says a module from outside is loaded by `crt handoff` only, after the line that names it (N-39)", () => {
    expect(page).toContain("CRT loads such a module in one place only: `crt handoff`");
    expect(page).toContain("`crt handoff --list`, `crt doctor`, `crt review` and the server never load one.");
  });
});
