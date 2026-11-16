import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { CrtError } from "../../src/errors.js";
import { type HandoffOptions, runHandoff, type ToolRunner } from "../../src/handoff.js";
import { currentReview, listReviews, readReview, writeReviewItems } from "../../src/home.js";
import { type RunResult, runExecutable } from "../../src/providers/exec.js";
import { openStore } from "../../src/store.js";
import type { NewTaskInput } from "../../src/tasks.js";
import { samplePost } from "./sample-capture.js";

/**
 * A scratch project with a review of three items, for the destination tests (PRD-destinations
 * M33–M36): real `git` against a bare remote, `gh` a file on PATH whose runs `gh` answers, a temp
 * `CRT_HOME`. R-01 (/cart), R-02 (/checkout, dropped), R-03 (/cart), each with screenshots.
 */
export interface ReviewFixture {
  scratch: string;
  root: string;
  remote: string;
  env: NodeJS.ProcessEnv;
  lines: string[];
  calls: { tool: string; args: string[]; cwd: string; body: string | null }[];
  /** How a `gh` run is answered; the default prints nothing and exits 0. */
  gh: (args: string[], body: string | null) => RunResult;
  git(args: string[], cwd?: string): string;
  put(path: string, text: string): void;
  /** `.crt/config.json` */
  config(value: unknown): void;
  handoff(o?: Partial<HandoffOptions>): ReturnType<typeof runHandoff>;
  /** The message `crt handoff` fails with. */
  failure(o?: Partial<HandoffOptions>): Promise<string>;
  review(): { name: string; dir: string };
  manifest(): NonNullable<ReturnType<typeof readReview>>;
  /** What the developer's checkout looks like (PRD-zero N-35). */
  checkout(): Record<string, string>;
  dispose(): void;
}

export const FIXTURE_NOW = new Date(2026, 10, 16, 9, 30, 0);
export const FIXTURE_LATER = new Date(2026, 10, 16, 16, 5, 0);
export const ok = (stdout = ""): RunResult => ({ status: 0, stdout, stderr: "", error: null });

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

export function reviewFixture(opts: { remote?: boolean } = {}): ReviewFixture {
  const scratch = mkdtempSync(join(tmpdir(), "crt-destinations-test-"));
  const root = join(scratch, "app");
  const remote = join(scratch, "remote.git");
  mkdirSync(root);
  const bin = join(scratch, "bin");
  mkdirSync(bin);
  const ghFile = join(bin, process.platform === "win32" ? "gh.exe" : "gh");
  writeFileSync(ghFile, "");
  chmodSync(ghFile, 0o755);
  const env: NodeJS.ProcessEnv = { ...process.env, CRT_HOME: join(scratch, "home"), PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` };
  const git = (args: string[], cwd = root): string => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
    if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  };
  const put = (path: string, text: string): void => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text, "utf8");
  };
  const f: ReviewFixture = {
    scratch,
    root,
    remote,
    env,
    lines: [],
    calls: [],
    gh: () => ok(),
    git,
    put,
    config: (value) => put(".crt/config.json", JSON.stringify(value, null, 2) + "\n"),
    handoff: (o = {}) => runHandoff({ root, env, log: (l) => f.lines.push(l), now: FIXTURE_LATER, run: runner, yes: true, cwd: scratch, ...o }),
    failure: async (o = {}) => {
      try {
        await f.handoff(o);
      } catch (err) {
        if (!(err instanceof CrtError)) throw err;
        return err.message;
      }
      throw new Error("expected crt handoff to fail");
    },
    review: () => listReviews(root, env).at(-1)!,
    manifest: () => readReview(f.review().dir)!,
    checkout: () => ({ head: git(["rev-parse", "HEAD"]), branch: git(["branch", "--show-current"]), stash: git(["stash", "list"]), status: git(["status", "--porcelain"]), worktrees: git(["worktree", "list", "--porcelain"]) }),
    dispose: () => rmSync(scratch, { recursive: true, force: true }),
  };
  const runner: ToolRunner = async (tool, exe, args, o) => {
    const at = args.indexOf("--body-file");
    const body = at === -1 ? null : readFileSyncOrNull(args[at + 1]!);
    f.calls.push({ tool, args, cwd: o.cwd, body });
    return tool === "gh" ? f.gh(args, body) : runExecutable(exe, args, o);
  };

  git(["init", "-b", "main"]);
  git(["config", "user.email", "dev@example.invalid"]);
  git(["config", "user.name", "Dev"]);
  git(["config", "commit.gpgsign", "false"]);
  put("src/app.ts", "export const total = 1;\n");
  git(["add", "-A"]);
  git(["commit", "-m", "init"]);
  if (opts.remote !== false) {
    git(["init", "--bare", "-b", "main", remote], scratch);
    git(["remote", "add", "origin", remote]);
    git(["push", "origin", "main"]);
  }
  // A guest review: the project has no `.crt/`.
  const store = openStore({ root, env, review: false });
  for (const [route, title] of [["/cart", "Cart total excludes applied discount"], ["/checkout", "Pay button is off-centre"], ["/cart", "Empty cart has no message"]] as const) {
    const post = samplePost();
    post.bundle.framework.route = route;
    store.createTask(task({ title, captureId: store.writeCapture(post, FIXTURE_NOW).id }), FIXTURE_NOW);
  }
  writeReviewItems(currentReview(root, env)!.dir, [{ id: "R-01", keep: true }, { id: "R-02", keep: false }, { id: "R-03", keep: true }]);
  return f;
}

function readFileSyncOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}
