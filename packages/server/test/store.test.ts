import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readConfig } from "../src/config.js";
import { createReview, guestConfigPath, projectKey, projectReviewsDir, readReview, writeReview } from "../src/home.js";
import { decidePermission, projectAllowList } from "../src/permissions.js";
import { renderReviewItems, reviewView, totalsLine } from "../src/review.js";
import { guestLine, openStore, readStoreConfig, storeKind } from "../src/store.js";
import { parseTask, type NewTaskInput } from "../src/tasks.js";
import { samplePost } from "./helpers/sample-capture.js";

// PRD-zero F-129, F-130, F-133, F-134, N-33, N-34: where a running CRT writes — the project's
// `.crt/` when it is set up, else (or under `--review`) the current review under the CRT home.
// Always under a temp `CRT_HOME`.

const SHA = "4f2a91c0d3b5e6f708192a3b4c5d6e7f8091a2b3";
const NOW = new Date(2026, 10, 16, 9, 30, 0);

let home: string;
let root: string;
let env: NodeJS.ProcessEnv;
let lines: string[];
const log = (line: string) => lines.push(line);

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "crt-home-"));
  root = mkdtempSync(join(tmpdir(), "crt-proj-"));
  env = { CRT_HOME: home };
  lines = [];
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

const put = (path: string, text: string) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text, "utf8");
};
const setUp = () => mkdirSync(join(root, ".crt", "tasks"), { recursive: true });
const onMain = () => {
  put(".git/HEAD", "ref: refs/heads/main\n");
  put(".git/refs/heads/main", `${SHA}\n`);
};
const task = (over: Partial<NewTaskInput> = {}): NewTaskInput => ({
  title: "Cart total excludes applied discount",
  summary: "The total ignores the discount.",
  context: "Reproduce at /cart?promo=SAVE10.",
  ask: "Apply the discount to the total.",
  definitionOfDone: ["Total applies the discount"],
  session: null,
  provider: "stub",
  ...over,
});

describe("which store (F-129)", () => {
  it("not set up → a guest's review; set up → the project; --review or store: review → a review that is not a guest (F-129)", () => {
    expect(storeKind(root)).toEqual({ kind: "review", guest: true });
    setUp();
    expect(storeKind(root)).toEqual({ kind: "project", guest: false });
    expect(storeKind(root, { review: true })).toEqual({ kind: "review", guest: false });
    expect(storeKind(root, { config: { store: "review" } })).toEqual({ kind: "review", guest: false });
    put(".crt/config.json", JSON.stringify({ store: "review" }));
    expect(readConfig(root).store).toBe("review");
    expect(openStore({ root, env })).toMatchObject({ kind: "review", guest: false });
    put(".crt/config.local.json", JSON.stringify({ store: "project" }));
    expect(openStore({ root, env })).toMatchObject({ kind: "project", guest: false });
    expect(openStore({ root, env, review: true })).toMatchObject({ kind: "review", guest: false });
    put(".crt/config.json", JSON.stringify({ store: "nonsense" }));
    put(".crt/config.local.json", "{}");
    expect(readConfig(root).store).toBe("project");
  });

  it("the guest line names the project and where the review is kept (F-129)", () => {
    expect(guestLine(root, env)).toBe(`crt: ${root} is not set up for CRT — keeping this review in ${join(home, "reviews", projectKey(root))} (nothing is written to the project; \`crt init\` adopts CRT here).`);
  });
});

describe("a set-up project without --review writes exactly as before (F-129, F-134)", () => {
  it("captures in .crt/captures, CRT-0001 in .crt/tasks with branch and commit, the local config in .crt/, nothing under the home (F-129, F-134, N-34)", () => {
    setUp();
    onMain();
    const store = openStore({ root, env, log });
    expect(store).toMatchObject({ kind: "project", guest: false });
    expect(store.review()).toBeNull();
    expect(store.tasksDir()).toBe(join(root, ".crt", "tasks"));
    expect(store.tasksLabel()).toBe(".crt/tasks");
    expect(store.writeRoots()).toEqual([join(root, ".crt")]);
    expect(store.readDirs()).toEqual([]);
    const capture = store.writeCapture(samplePost(), NOW);
    expect(capture.dir).toBe(join(root, ".crt", "captures", capture.id));
    expect(store.captureDir(capture.id)).toBe(capture.dir);
    const written = store.createTask(task({ captureId: capture.id }), NOW);
    expect(written).toMatchObject({ id: "CRT-0001", path: ".crt/tasks/CRT-0001-cart-total-excludes-applied-discount.md" });
    const file = parseTask(readFileSync(join(root, written.path), "utf8"));
    expect(file.frontmatter).toMatchObject({ id: "CRT-0001", branch: "main", commit: SHA });
    expect(existsSync(join(root, ".crt", "tasks", "assets", "CRT-0001", "capture.json"))).toBe(true);
    expect(store.taskCount()).toBe(1);
    expect(store.writeLocalConfig({ target: "http://localhost:3000" })).toBe(join(root, ".crt", "config.local.json"));
    expect(store.localConfigLabel()).toBe(".crt/config.local.json");
    expect(store.readConfig().target).toBe("http://localhost:3000");
    expect(readdirSync(home)).toEqual([]);
    expect(lines).toEqual([]);
  });

  it("the git state is the one at capture time, not at write time (F-134)", () => {
    setUp();
    onMain();
    const store = openStore({ root, env });
    const capture = store.writeCapture(samplePost(), NOW);
    put(".git/HEAD", "ref: refs/heads/later\n");
    const written = store.createTask(task({ captureId: capture.id }), NOW);
    expect(parseTask(readFileSync(join(root, written.path), "utf8")).frontmatter).toMatchObject({ branch: "main", commit: SHA });
    // Without a capture there is only now.
    const bare = store.createTask(task({ title: "Second thing" }), NOW);
    expect(parseTask(readFileSync(join(root, bare.path), "utf8")).frontmatter).toMatchObject({ branch: "later", commit: null });
  });
});

describe("a review store (F-129, F-130, F-133, F-134)", () => {
  it("names the review the first capture will create, and creates nothing until then (F-129, F-133)", () => {
    const store = openStore({ root, env, log });
    expect(store).toMatchObject({ kind: "review", guest: true });
    expect(store.review()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(store.tasksDir()).toBeNull();
    expect(store.taskCount()).toBe(0);
    expect(store.pruneCaptures()).toEqual([]);
    expect(store.readConfig().target).toBeNull();
    expect(readdirSync(home)).toEqual([]);
    expect(lines).toEqual([]);
  });

  it("a capture creates the review; its task is R-01 under the home with its assets, the index, branch and commit, and joins review.json (F-130, F-133, F-134)", () => {
    onMain();
    put(".git/config", '[remote "origin"]\n\turl = git@github.com:me/app.git\n');
    const store = openStore({ root, env, log });
    const capture = store.writeCapture(samplePost(), NOW);
    const reviewDir = join(projectReviewsDir(root, env), "2026-11-16");
    expect(capture.dir).toBe(join(reviewDir, "captures", capture.id));
    expect(store.review()).toBe("2026-11-16");
    expect(readReview(reviewDir)).toMatchObject({ name: "2026-11-16", status: "open", project: { root, remote: "git@github.com:me/app.git" }, items: [] });
    // N-34: one announcement for the run, for the outermost thing created.
    expect(lines).toEqual([`crt: created ${join(home, "reviews")}`]);

    const written = store.createTask(task({ captureId: capture.id }), NOW);
    const file = join(reviewDir, "tasks", "R-01-cart-total-excludes-applied-discount.md");
    expect(written).toMatchObject({ id: "R-01", path: file });
    const parsed = parseTask(readFileSync(file, "utf8"), "R-01-cart-total-excludes-applied-discount.md");
    expect(parsed.frontmatter).toMatchObject({ id: "R-01", route: "/cart", branch: "main", commit: SHA, provider: "stub" });
    expect(parsed.sections.Evidence).toContain("![viewport (annotated)](assets/R-01/viewport-annotated.png)");
    expect(readdirSync(join(reviewDir, "tasks", "assets", "R-01")).sort()).toEqual(["ann-1.png", "ann-2.png", "capture.json", "viewport-annotated.png", "viewport.png"]);
    expect(existsSync(capture.dir)).toBe(false);
    expect(readFileSync(join(reviewDir, "tasks", "README.md"), "utf8")).toContain("| [R-01](R-01-cart-total-excludes-applied-discount.md) | backlog |");
    expect(readReview(reviewDir)?.items).toEqual([{ id: "R-01", keep: true, order: 1 }]);
    expect(store.tasksDir()).toBe(join(reviewDir, "tasks"));
    expect(store.taskCount()).toBe(1);

    const second = store.createTask(task({ title: "Second thing", captureId: store.writeCapture(samplePost(), NOW).id }), NOW);
    expect(second.id).toBe("R-02");
    expect(readReview(reviewDir)?.items.map((i) => `${i.id}:${i.order}`)).toEqual(["R-01:1", "R-02:2"]);
    expect(lines).toHaveLength(1);

    // What `crt review` prints from it (F-135's line, used by the M29 CLI forms).
    const view = reviewView({ name: "2026-11-16", dir: reviewDir, manifest: readReview(reviewDir)! });
    expect(view.totals).toEqual({ items: 2, kept: 2, routes: 1 });
    expect(totalsLine(view.totals)).toBe("2 items · 2 kept · 1 route");
    expect(renderReviewItems(view)).toEqual(["R-01  normal  kept     /cart  Cart total excludes applied discount", "R-02  normal  kept     /cart  Second thing"]);
    expect(view.items[0]).toMatchObject({ id: "R-01", branch: "main", commit: SHA, file: "R-01-cart-total-excludes-applied-discount.md" });
  });

  it("nothing is written under the project: not a guest's, and not a set-up project's under --review (N-33)", () => {
    const listing = () => (readdirSync(root, { recursive: true }) as string[]).sort();
    for (const prepare of [() => undefined, setUp]) {
      prepare();
      const before = listing();
      const store = openStore({ root, env, review: prepare === setUp ? true : undefined });
      expect(store.kind).toBe("review");
      const capture = store.writeCapture(samplePost(), NOW);
      store.createTask(task({ captureId: capture.id }), NOW);
      store.writeLocalConfig({ target: "http://localhost:3000", allow: ["Bash(npm test:*)"] });
      store.readDirs();
      store.pruneCaptures();
      expect(listing()).toEqual(before);
      expect(store.scratchDir().startsWith(root)).toBe(false);
    }
  });

  it("the machine-local config lives beside the reviews and outranks the project's two files (F-130)", () => {
    setUp();
    put(".crt/config.json", JSON.stringify({ target: "http://localhost:3000", port: 4410, provider: "codex", models: { claude: "a" }, permissions: { allow: ["Bash(git status)"] } }));
    put(".crt/config.local.json", JSON.stringify({ target: "http://localhost:5173", models: { claude: "b", codex: "c" } }));
    const store = openStore({ root, env, review: true, log });
    expect(store.localConfigLabel()).toBe(guestConfigPath(root, env));
    // Before the home has a file: `.crt/config.local.json` over `.crt/config.json`, as today.
    expect(store.readConfig()).toMatchObject({ target: "http://localhost:5173", targetSource: "local", port: 4410, provider: "codex", providerSource: "project" });
    expect(store.writeLocalConfig({ target: "http://localhost:8080", provider: "claude", models: { claude: "z" } })).toBe(guestConfigPath(root, env));
    expect(lines).toEqual([`crt: created ${join(home, "reviews")}`]);
    expect(JSON.parse(readFileSync(guestConfigPath(root, env), "utf8"))).toEqual({ target: "http://localhost:8080", provider: "claude", models: { claude: "z" } });
    expect(store.readConfig()).toMatchObject({ target: "http://localhost:8080", targetSource: "local", port: 4410, provider: "claude", providerSource: "local", models: { claude: "z", codex: "c" } });
    expect(readStoreConfig(root, "review", env).target).toBe("http://localhost:8080");
    // The project's own files are as they were, and a start without --review does not see the home's.
    expect(JSON.parse(readFileSync(join(root, ".crt", "config.local.json"), "utf8")).target).toBe("http://localhost:5173");
    expect(readStoreConfig(root, "project", env).target).toBe("http://localhost:5173");
    expect(readConfig(root).target).toBe("http://localhost:5173");
    // F-124: Always allow goes to the home's file too, and both lists apply.
    const allow = projectAllowList(root, store);
    expect(allow.allows({ kind: "command", command: "git status" })).toBe(true);
    expect(allow.allows({ kind: "command", command: "npm test" })).toBe(false);
    allow.add("Bash(npm test:*)");
    expect(allow.allows({ kind: "command", command: "npm test" })).toBe(true);
    expect(existsSync(join(root, ".crt", "config.local.json")) && readFileSync(join(root, ".crt", "config.local.json"), "utf8")).not.toContain("npm test");
  });

  it("the session reads the project's folder under the home and writes there silently — not under the project's .crt/ (F-129, N-33)", () => {
    const store = openStore({ root, env, log });
    const dir = projectReviewsDir(root, env);
    expect(store.readDirs()).toEqual([dir]);
    expect(existsSync(join(dir, "project.json"))).toBe(true);
    expect(store.writeRoots()).toEqual([dir]);
    const decide = (path: string) => decidePermission("Write", { file_path: path }, root, store.writeRoots()).kind;
    expect(decide(join(dir, "2026-11-16", "tasks", "R-01-x.md"))).toBe("allow");
    expect(decide(join(root, ".crt", "tasks", "CRT-0001-x.md"))).toBe("ask");
    expect(decide(join(root, "src", "app.ts"))).toBe("ask");
    expect(decide(join(dir, "..", "other-project", "x.md"))).toBe("ask");
    expect(decide(dir)).toBe("ask");
    // A project store keeps F-26 as it was.
    expect(decidePermission("Write", { file_path: ".crt/tasks/x.md" }, root).kind).toBe("allow");
    expect(decidePermission("Write", { file_path: join(dir, "x.md") }, root).kind).toBe("ask");
  });

  it("--review <name> starts that review on the first capture and continues it on the next start (F-129, F-133)", () => {
    setUp();
    const store = openStore({ root, env, review: "sprint-12" });
    expect(store.review()).toBe("sprint-12");
    createReview(root, undefined, { env, now: NOW }); // an unrelated, newer open review
    const capture = store.writeCapture(samplePost(), NOW);
    expect(capture.dir).toBe(join(projectReviewsDir(root, env), "sprint-12", "captures", capture.id));
    expect(store.createTask(task({ captureId: capture.id }), NOW).id).toBe("R-01");
    const again = openStore({ root, env, review: "sprint-12" });
    expect(again.review()).toBe("sprint-12");
    expect(again.taskCount()).toBe(1);
    expect(again.createTask(task({ title: "Another" }), NOW).id).toBe("R-02");
  });

  it("a capture stays with its review: after `crt review new`, a restart or a hand-over its task still lands beside it (F-133)", () => {
    const store = openStore({ root, env });
    const capture = store.writeCapture(samplePost(), NOW);
    const first = join(projectReviewsDir(root, env), "2026-11-16");
    const newer = createReview(root, "next", { env, created: "2026-11-17T09:00:00+08:00" });
    expect(store.review()).toBe("next");
    // A restart forgets the in-memory map; the capture is found on disk.
    const restarted = openStore({ root, env });
    expect(restarted.captureDir(capture.id)).toBe(capture.dir);
    writeReview(first, { ...readReview(first)!, status: "handed" });
    const written = restarted.createTask(task({ captureId: capture.id }), NOW);
    expect(written.path).toBe(join(first, "tasks", "R-01-cart-total-excludes-applied-discount.md"));
    expect(readReview(first)?.items.map((i) => i.id)).toEqual(["R-01"]);
    // The next capture goes to the current review, and a handed one is never reopened.
    expect(restarted.writeCapture(samplePost(), NOW).dir.startsWith(join(newer.dir, "captures"))).toBe(true);
    writeReview(newer.dir, { ...readReview(newer.dir)!, status: "handed" });
    expect(dirname(dirname(restarted.writeCapture(samplePost(), NOW).dir))).toBe(join(projectReviewsDir(root, env), "2026-11-16-2"));
  });

  it("prunes captures older than 7 days in the current review only (F-130)", () => {
    const store = openStore({ root, env });
    const old = store.writeCapture(samplePost(), new Date(2026, 10, 1, 9, 0, 0));
    const fresh = store.writeCapture(samplePost(), NOW);
    const eightDays = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
    expect(store.pruneCaptures(new Date()).length).toBe(0);
    expect(store.pruneCaptures(eightDays).sort()).toEqual([old.id, fresh.id].sort());
  });

  it("a .git it cannot read is reported once, and the items carry nulls (F-134)", () => {
    put(".git/HEAD", "what\n");
    const store = openStore({ root, env, log });
    const a = store.writeCapture(samplePost(), NOW);
    store.writeCapture(samplePost(), NOW);
    expect(lines.filter((l) => l.includes("could not read"))).toEqual(["crt: could not read the current commit from .git (HEAD is neither a ref nor a commit)"]);
    const written = store.createTask(task({ captureId: a.id }), NOW);
    expect(parseTask(readFileSync(written.path, "utf8")).frontmatter).toMatchObject({ branch: null, commit: null });
  });
});
