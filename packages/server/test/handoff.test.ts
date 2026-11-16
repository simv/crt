import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CrtError } from "../src/errors.js";
import { defaultDestination, type HandoffOptions, nextTaskIds, rewriteTaskText, runHandoff, type ToolRunner } from "../src/handoff.js";
import { currentReview, type Handover, listReviews, readReview, writeReviewItems } from "../src/home.js";
import { type RunResult, runExecutable } from "../src/providers/exec.js";
import { openStore } from "../src/store.js";
import { type NewTaskInput, validateTaskText } from "../src/tasks.js";
import { samplePost } from "./helpers/sample-capture.js";

// PRD-zero F-136, F-137, N-35 (M31): `crt handoff` against scratch repositories with a bare
// remote and real git; `gh` is a file on PATH whose runs the test seam answers. Always under a
// temp `CRT_HOME`.

const NOW = new Date(2026, 10, 16, 9, 30, 0);
const LATER = new Date(2026, 10, 16, 16, 5, 0);
const PR_URL = "https://github.com/me/app/pull/7";

let scratch: string;
let home: string;
let root: string;
let remote: string;
let env: NodeJS.ProcessEnv;
let lines: string[];
let calls: { tool: "git" | "gh"; args: string[]; cwd: string }[];
let ghAnswer: RunResult;
let ghBody: string | null;

function git(args: string[], cwd = root): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}
function put(path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text, "utf8");
}

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

/** R-01 (/cart), R-02 (/checkout), R-03 (/cart), each from a capture with screenshots; then R-02 dropped. */
function seed(review = true): void {
  const store = openStore({ root, env, review });
  for (const [route, title] of [["/cart", "Cart total excludes applied discount"], ["/checkout", "Pay button is off-centre"], ["/cart", "Empty cart has no message"]] as const) {
    const post = samplePost();
    post.bundle.framework.route = route;
    store.createTask(task({ title, captureId: store.writeCapture(post, NOW).id }), NOW);
  }
  const r = currentReview(root, env)!;
  writeReviewItems(r.dir, [{ id: "R-01", keep: true }, { id: "R-02", keep: false }, { id: "R-03", keep: true }]);
}

/** A set-up project: one commit holding CRT-0003 and the assets folder of CRT-0005, pushed to a bare `origin`. */
function project(): void {
  git(["init", "--bare", "-b", "main", remote], scratch);
  git(["init", "-b", "main"]);
  git(["config", "user.email", "dev@example.invalid"]);
  git(["config", "user.name", "Dev"]);
  git(["config", "commit.gpgsign", "false"]);
  git(["remote", "add", "origin", remote]);
  put("src/app.ts", "export const total = 1;\n");
  mkdirSync(join(root, ".crt", "tasks"), { recursive: true });
  const store = openStore({ root, env });
  store.createTask(task({ title: "An older task" }), NOW); // CRT-0001
  for (const id of ["CRT-0002", "CRT-0003"]) {
    const old = readdirSync(join(root, ".crt", "tasks")).find((f) => f.startsWith("CRT-0001"))!;
    writeFileSync(join(root, ".crt", "tasks", old.replace("CRT-0001", id)), readFileSync(join(root, ".crt", "tasks", old), "utf8").replace("id: CRT-0001", `id: ${id}`));
  }
  put(".crt/tasks/assets/CRT-0005/viewport.png", "png");
  git(["add", "-A"]);
  git(["commit", "-m", "init"]);
  git(["push", "origin", "main"]);
}

const runner: ToolRunner = async (tool, exe, args, o) => {
  calls.push({ tool, args, cwd: o.cwd });
  if (tool === "gh") {
    ghBody = readFileSync(args[args.indexOf("--body-file") + 1]!, "utf8");
    return ghAnswer;
  }
  return runExecutable(exe, args, o);
};

const handoff = (o: Partial<HandoffOptions> = {}) => runHandoff({ root, env, log: (l) => lines.push(l), now: LATER, run: runner, yes: true, cwd: scratch, ...o });
const failure = async (o: Partial<HandoffOptions> = {}): Promise<string> => {
  try {
    await handoff(o);
  } catch (err) {
    expect(err).toBeInstanceOf(CrtError);
    return (err as Error).message;
  }
  throw new Error("expected crt handoff to fail");
};
const review = () => listReviews(root, env).at(-1)!;
const manifest = () => readReview(review().dir)!;
const onBranch = (branch: string) => git(["ls-tree", "-r", "--name-only", branch, "--", ".crt/tasks/"]).split("\n").sort();
/** N-35: what the developer's checkout looks like. */
const checkout = () => ({ head: git(["rev-parse", "HEAD"]), branch: git(["branch", "--show-current"]), stash: git(["stash", "list"]), status: git(["status", "--porcelain"]), worktrees: git(["worktree", "list", "--porcelain"]) });

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "crt-handoff-test-"));
  home = join(scratch, "home");
  root = join(scratch, "app");
  remote = join(scratch, "remote.git");
  mkdirSync(root);
  // `gh` is found on PATH (a file; the seam answers its runs), git is the machine's.
  const bin = join(scratch, "bin");
  mkdirSync(bin);
  for (const name of process.platform === "win32" ? ["gh.exe"] : ["gh"]) {
    writeFileSync(join(bin, name), "");
    chmodSync(join(bin, name), 0o755);
  }
  env = { ...process.env, CRT_HOME: home, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` };
  lines = [];
  calls = [];
  ghAnswer = { status: 0, stdout: `${PR_URL}\n`, stderr: "", error: null };
  ghBody = null;
});
afterEach(() => {
  // A half-way failure keeps its pull request body for the printed command; not in the real temp dir after a test.
  for (const f of readdirSync(tmpdir())) if (/^crt-handoff-.*\.md$/.test(f) && f.endsWith(`-${process.pid}.md`)) rmSync(join(tmpdir(), f), { force: true });
  rmSync(scratch, { recursive: true, force: true });
});

describe("the pure pieces (F-136)", () => {
  it("picks pr with a remote and gh, branch in a repository without either, here otherwise (F-136)", () => {
    expect(defaultDestination({ repo: true, git: true, remote: true, gh: true })).toBe("pr");
    expect(defaultDestination({ repo: true, git: true, remote: false, gh: true })).toBe("branch");
    expect(defaultDestination({ repo: true, git: true, remote: true, gh: false })).toBe("branch");
    expect(defaultDestination({ repo: true, git: false, remote: false, gh: true })).toBe("here");
    expect(defaultDestination({ repo: false, git: true, remote: false, gh: true })).toBe("here");
  });

  it("allocates consecutive ids above the highest file or assets folder (F-136)", () => {
    expect(nextTaskIds([], 2)).toEqual(["CRT-0001", "CRT-0002"]);
    expect(nextTaskIds(["CRT-0003-old.md", "CRT-0005", "README.md", "R-09-x.md", "CRT-00099"], 3)).toEqual(["CRT-0006", "CRT-0007", "CRT-0008"]);
  });

  it("rewrites the id, updated, the asset links and appends the Log line (F-136)", () => {
    const text = "---\nid: R-01\ntitle: T\nupdated: 2026-11-16T09:30:00+08:00\n---\n\n## Evidence\n![shot](assets/R-01/viewport.png) and assets/R-010/x\n\n## Log\n- one\n";
    const out = rewriteTaskText(text, "R-01", "CRT-0006", "2026-11-16", LATER);
    expect(out).toMatch(/^---\nid: CRT-0006\ntitle: T\nupdated: 2026-11-16T16:05:00[+-]\d\d:\d\d\n---\n/);
    expect(out).toContain("(assets/CRT-0006/viewport.png) and assets/R-010/x");
    expect(out).toMatch(/\n- one\n- 2026-11-16T16:05[+-]\d\d:\d\d — handed over from review 2026-11-16 \(was R-01\) by crt handoff\n$/);
  });
});

describe("crt handoff --to pr and branch (F-136, N-35)", () => {
  beforeEach(() => {
    project();
    seed();
    // N-35: a dirty checkout — a stash, a modified tracked file and an untracked one.
    put("src/app.ts", "export const total = 2;\n");
    git(["stash"]);
    put("src/app.ts", "export const total = 3;\n");
    put("notes.txt", "wip\n");
  });

  it("puts exactly the kept items on a new branch with fresh ids, pushes it and opens one pull request, the checkout untouched (F-136, N-35)", async () => {
    const before = checkout();
    const result = await handoff();
    const name = review().name;
    const branch = `crt/review-${name}`;
    expect(result.outcome).toBe("handed");

    // N-35: the same HEAD, branch, stash, status and worktrees.
    expect(checkout()).toEqual(before);

    // The branch: the base's files plus the two kept items as CRT-0006 and CRT-0007 (above CRT-0005's assets), R-02 absent.
    const files = onBranch(branch);
    expect(files.filter((f) => /CRT-000[67]/.test(f) && f.endsWith(".md"))).toEqual([
      ".crt/tasks/CRT-0006-cart-total-excludes-applied-discount.md",
      ".crt/tasks/CRT-0007-empty-cart-has-no-message.md",
    ]);
    expect(files).toContain(".crt/tasks/assets/CRT-0006/viewport.png");
    expect(files).toContain(".crt/tasks/assets/CRT-0007/viewport-annotated.png");
    expect(files.some((f) => f.includes("R-0") || f.includes("off-centre"))).toBe(false);
    for (const [id, file] of [["CRT-0006", "CRT-0006-cart-total-excludes-applied-discount.md"], ["CRT-0007", "CRT-0007-empty-cart-has-no-message.md"]] as const) {
      const text = git(["show", `${branch}:.crt/tasks/${file}`]) + "\n";
      expect(validateTaskText(text, file)).toEqual([]);
      expect(text).toContain(`id: ${id}`);
      expect(text).toContain(`assets/${id}/`);
      expect(text).not.toMatch(/assets\/R-\d/);
      expect(text).toMatch(new RegExp(`handed over from review ${name} \\(was R-0[13]\\) by crt handoff\\n$`));
    }
    const index = git(["show", `${branch}:.crt/tasks/README.md`]);
    expect(index).toContain("CRT-0006");
    expect(index).toContain("CRT-0007");
    // One commit, on origin/main, with the task files only.
    expect(git(["log", "--format=%s", `origin/main..${branch}`])).toBe(`chore(crt): review ${name} — 2 items`);
    expect(git(["diff", "--name-only", `origin/main...${branch}`]).split("\n").every((f) => f.startsWith(".crt/tasks/"))).toBe(true);
    // Pushed, and the pull request opened with the summary as its body.
    expect(git(["rev-parse", `refs/heads/${branch}`], remote)).toBe(git(["rev-parse", branch]));
    const gh = calls.filter((c) => c.tool === "gh");
    expect(gh).toHaveLength(1);
    expect(gh[0]!.args.slice(0, 8)).toEqual(["pr", "create", "--base", "main", "--head", branch, "--title", `CRT review ${name}: 2 items`]);
    expect(ghBody).toContain(`# CRT review ${name}: 2 items`);
    expect(ghBody).toContain("## /cart");
    expect(ghBody).not.toContain("## /checkout");
    expect(ghBody).toContain("**CRT-0006** (normal) Cart total excludes applied discount");
    expect(ghBody).toContain("/crt:next");
    // review.json: the hand-over and `handed`.
    expect(manifest().status).toBe("handed");
    expect(manifest().handovers).toEqual([{ to: "pr", at: expect.any(String), items: { "R-01": "CRT-0006", "R-03": "CRT-0007" }, branch, base: "origin/main", url: PR_URL } satisfies Handover]);
    expect(lines.at(-2)).toBe(`Handed over review ${name}: 2 items on ${branch} — ${PR_URL}`);
    // The plan came first.
    expect(lines[0]).toBe(`Hand over review ${name} as a pull request: 2 of 3 items.`);
    expect(lines[1]).toMatch(/^ {2}R-01 → CRT-0006 {2}normal {2}\/cart {2}Cart total excludes applied discount$/);
  });

  it("never force-pushes, merges or touches a branch it did not create (F-136, N-35)", async () => {
    await handoff();
    const branch = `crt/review-${review().name}`;
    const gitCalls = calls.filter((c) => c.tool === "git").map((c) => c.args);
    const pushes = gitCalls.filter((a) => a[0] === "push");
    expect(pushes).toEqual([["push", "origin", `refs/heads/${branch}:refs/heads/${branch}`]]);
    for (const args of gitCalls) {
      // The one forced step is removing its own temporary worktree.
      if (args[0] === "worktree" && args[1] === "remove") {
        expect(args).toEqual(["worktree", "remove", "--force", expect.stringContaining("crt-handoff-")]);
        continue;
      }
      expect(args.some((a) => /^(-f|-D|--force|--force-with-lease|--mirror|--delete|\+)/.test(a))).toBe(false);
      expect(["merge", "rebase", "reset", "checkout", "switch", "stash", "pull", "cherry-pick"]).not.toContain(args[0]);
    }
    // What changes the checkout's repository: the new branch (in a worktree under the temp dir) and its commit, nothing else.
    expect(gitCalls.filter((a) => a[0] === "worktree" && a[1] === "add")).toEqual([["worktree", "add", "--no-track", "-b", branch, expect.stringContaining("crt-handoff-"), "origin/main"]]);
    expect(calls.filter((c) => c.tool === "git" && (c.args[0] === "add" || c.args[0] === "commit")).every((c) => c.cwd !== root)).toBe(true);
  });

  it("keeps the branch local with --to branch, and suffixes a name that is taken (F-136)", async () => {
    const name = review().name;
    git(["branch", `crt/review-${name}`]);
    await handoff({ to: "branch" });
    const branch = `crt/review-${name}-2`;
    expect(onBranch(branch)).toContain(".crt/tasks/CRT-0006-cart-total-excludes-applied-discount.md");
    expect(spawnSync("git", ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: remote }).status).not.toBe(0);
    expect(calls.some((c) => c.tool === "gh" || c.args[0] === "push")).toBe(false);
    expect(manifest().handovers).toEqual([{ to: "branch", at: expect.any(String), items: { "R-01": "CRT-0006", "R-03": "CRT-0007" }, branch, base: "origin/main" }]);
    expect(lines).toContain(`Push it and open a pull request when you are ready: git push origin ${branch}`);
  });

  it("says the branch was committed but not pushed, and leaves the review open (F-136)", async () => {
    const hook = join(remote, "hooks", "pre-receive");
    writeFileSync(hook, "#!/bin/sh\necho refused by policy >&2\nexit 1\n");
    chmodSync(hook, 0o755);
    const message = await failure();
    const branch = `crt/review-${review().name}`;
    expect(message).toMatch(new RegExp(`^committed ${branch} locally but could not push it \\(.+\\) — the review is still open; push it and open the pull request with: git push origin ${branch} && gh pr create --base main --head ${branch} --title "CRT review .+: 2 items" --body-file .+$`));
    expect(git(["rev-parse", "--verify", branch])).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest().status).toBe("open");
    expect(manifest().handovers).toEqual([]);
    expect(calls.some((c) => c.tool === "gh")).toBe(false);
  });

  it("says the branch was pushed but the pull request not opened, and leaves the review open (F-136)", async () => {
    ghAnswer = { status: 1, stdout: "", stderr: "GraphQL: Resource not accessible by integration\n", error: null };
    const message = await failure();
    const branch = `crt/review-${review().name}`;
    expect(message).toMatch(new RegExp(`^pushed ${branch} but could not open the pull request \\(GraphQL: Resource not accessible by integration\\) — the review is still open; open it with: gh pr create `));
    expect(git(["rev-parse", `refs/heads/${branch}`], remote)).toMatch(/^[0-9a-f]{40}$/);
    expect(manifest().status).toBe("open");
  });

  it("asks once and writes nothing off a terminal without --yes, or when the answer is no (N-35)", async () => {
    const before = checkout();
    expect(await failure({ yes: false, interactive: false })).toBe("crt handoff asks before it writes — run it on a terminal, or pass --yes (nothing was written)");
    const asked: string[] = [];
    const prompt = { ask: async (q: string) => (asked.push(q), "n"), waitFor: async () => ({ kind: "ready" as const }) };
    expect(await failure({ yes: false, interactive: true, prompt })).toBe("cancelled — nothing was written");
    expect(asked).toEqual(["Go ahead? [Y/n]"]);
    expect(checkout()).toEqual(before);
    expect(git(["branch", "--list", "crt/*"])).toBe("");
    expect(manifest().status).toBe("open");
  });

  it("refuses a handed review without --again, and hands it over again with it (F-136)", async () => {
    await handoff({ to: "branch" });
    const name = review().name;
    expect(await failure({ to: "branch" })).toBe(`review ${name} was already handed over (--to branch, branch crt/review-${name}) — pass --again to hand it over once more`);
    await handoff({ to: "branch", again: true });
    expect(manifest().handovers.map((h) => (h as Handover).branch)).toEqual([`crt/review-${name}`, `crt/review-${name}-2`]);
  });
});

describe("crt handoff --to here and bundle (F-136, F-137)", () => {
  /** A guest project: a repository without `.crt/` (and so without CRT ids). */
  beforeEach(() => {
    git(["init", "-b", "main"]);
    put("src/app.ts", "export const total = 1;\n");
    seed(false);
  });

  it("writes the kept items into the working tree uncommitted, with ids from CRT-0001 and the summary printed (F-136)", async () => {
    await handoff({ to: "here" });
    const dir = join(root, ".crt", "tasks");
    expect(readdirSync(dir).sort()).toEqual(["CRT-0001-cart-total-excludes-applied-discount.md", "CRT-0002-empty-cart-has-no-message.md", "README.md", "assets"]);
    expect(readdirSync(join(dir, "assets")).sort()).toEqual(["CRT-0001", "CRT-0002"]);
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".md") && f !== "README.md")) expect(validateTaskText(readFileSync(join(dir, f), "utf8"), f)).toEqual([]);
    // Nothing else in the project: src/ and the new .crt/ only.
    expect(readdirSync(root).sort()).toEqual([".crt", ".git", "src"]);
    expect(readdirSync(join(root, ".crt"))).toEqual(["tasks"]);
    expect(lines).toContain("This project is not set up for CRT yet. `crt init` adds the `.gitignore` lines and the instructions for agents; the task files work without it.");
    expect(lines.at(-1)).toBe(`Handed over review ${review().name}: 2 task files written to .crt/tasks/ (uncommitted).`);
    expect(manifest().handovers).toEqual([{ to: "here", at: expect.any(String), items: { "R-01": "CRT-0001", "R-03": "CRT-0002" } }]);
    // --again continues the project's own numbering.
    await handoff({ to: "here", again: true });
    expect(readdirSync(dir).filter((f) => f.startsWith("CRT-")).length).toBe(4);
  });

  it("writes a bundle with REVIEW.md, the files and assets, ids left as R-NN (F-137)", async () => {
    await handoff({ to: "bundle" });
    const name = review().name;
    const dir = join(scratch, `crt-review-app-${name}`);
    expect(readdirSync(dir).sort()).toEqual(["R-01-cart-total-excludes-applied-discount.md", "R-03-empty-cart-has-no-message.md", "REVIEW.md", "assets"]);
    expect(existsSync(join(dir, "assets", "R-01", "viewport-annotated.png"))).toBe(true);
    const summary = readFileSync(join(dir, "REVIEW.md"), "utf8");
    expect(summary).toContain("[R-01](R-01-cart-total-excludes-applied-discount.md) (normal) Cart total excludes applied discount");
    expect(summary).toContain("([screenshot](assets/R-01/viewport-annotated.png))");
    expect(existsSync(join(root, ".crt"))).toBe(false);
    expect(manifest().handovers).toEqual([{ to: "bundle", at: expect.any(String), items: { "R-01": "R-01", "R-03": "R-03" }, dir }]);
  });

  it("says when nothing is kept, and hands nothing over (F-136)", async () => {
    writeReviewItems(review().dir, [{ id: "R-01", keep: false }, { id: "R-02", keep: false }, { id: "R-03", keep: false }]);
    expect((await handoff({ to: "here" })).outcome).toBe("nothing");
    expect(lines).toEqual([`crt: review ${review().name} has no kept items — nothing to hand over`]);
    expect(manifest().status).toBe("open");
  });

  it("refuses pr where there is no remote (F-136)", async () => {
    expect(await failure({ to: "pr" })).toBe("this repository has no remote to push to — use `crt handoff --to branch`");
  });
});
