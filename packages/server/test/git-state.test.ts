import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NO_GIT, readGitRemote, readGitState } from "../src/git-state.js";

// PRD-zero F-134: the branch and commit a task records are read from `.git` itself — no `git`
// spawn (§12 rule 6) — over the shapes a checkout comes in. Every fixture is written here, file by
// file, so the rows say exactly what the reader has to cope with.

const SHA_A = "4f2a91c0d3b5e6f708192a3b4c5d6e7f8091a2b3";
const SHA_B = "0123456789abcdef0123456789abcdef01234567";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "crt-git-"));
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

const put = (path: string, text: string) => {
  mkdirSync(dirname(join(tmp, path)), { recursive: true });
  writeFileSync(join(tmp, path), text, "utf8");
};

describe("readGitState (F-134)", () => {
  it("a branch with a loose ref: the branch name and the full SHA (F-134)", () => {
    put("repo/.git/HEAD", "ref: refs/heads/feat/checkout\n");
    put("repo/.git/refs/heads/feat/checkout", `${SHA_A}\n`);
    expect(readGitState(join(tmp, "repo"))).toEqual({ branch: "feat/checkout", commit: SHA_A });
  });

  it("a detached HEAD: no branch, the commit HEAD holds (F-134)", () => {
    put("repo/.git/HEAD", `${SHA_B}\n`);
    expect(readGitState(join(tmp, "repo"))).toEqual({ branch: null, commit: SHA_B });
  });

  it("packed refs: the commit comes from packed-refs when there is no loose ref, and a loose ref wins when both exist (F-134)", () => {
    put("repo/.git/HEAD", "ref: refs/heads/main\n");
    put("repo/.git/packed-refs", `# pack-refs with: peeled fully-peeled sorted\n${SHA_B} refs/heads/other\n${SHA_A} refs/heads/main\n^${SHA_B}\n`);
    expect(readGitState(join(tmp, "repo"))).toEqual({ branch: "main", commit: SHA_A });
    put("repo/.git/refs/heads/main", `${SHA_B}\n`);
    expect(readGitState(join(tmp, "repo"))).toEqual({ branch: "main", commit: SHA_B });
  });

  it("a worktree: `.git` is a file naming the git dir, whose commondir holds the refs (F-134)", () => {
    put("main/.git/HEAD", "ref: refs/heads/main\n");
    put("main/.git/refs/heads/main", `${SHA_A}\n`);
    put("main/.git/packed-refs", `${SHA_B} refs/heads/review\n`);
    put("main/.git/worktrees/wt/HEAD", "ref: refs/heads/review\n");
    put("main/.git/worktrees/wt/commondir", "../..\n");
    put("wt/.git", `gitdir: ${join(tmp, "main", ".git", "worktrees", "wt")}\n`);
    expect(readGitState(join(tmp, "wt"))).toEqual({ branch: "review", commit: SHA_B });
    // A relative gitdir (a submodule's shape) resolves against the checkout.
    put("wt2/.git", "gitdir: ../main/.git/worktrees/wt\n");
    expect(readGitState(join(tmp, "wt2"))).toEqual({ branch: "review", commit: SHA_B });
  });

  it("no repository: nulls, and nothing is reported (F-134)", () => {
    mkdirSync(join(tmp, "plain"));
    const unread: string[] = [];
    expect(readGitState(join(tmp, "plain"), (why) => unread.push(why))).toEqual(NO_GIT);
    expect(unread).toEqual([]);
  });

  it("a branch with no commit yet: the branch, a null commit (F-134)", () => {
    put("repo/.git/HEAD", "ref: refs/heads/main\n");
    expect(readGitState(join(tmp, "repo"))).toEqual({ branch: "main", commit: null });
  });

  it("a shape it does not read — a reftable repository, a junk HEAD, a `.git` file without a gitdir — is nulls and one reason (F-134)", () => {
    put("reftable/.git/HEAD", "ref: refs/heads/.invalid\n");
    put("reftable/.git/reftable/tables.list", "");
    put("junk/.git/HEAD", "what\n");
    put("file/.git", "nothing useful\n");
    for (const [name, why] of [
      ["reftable", "a reftable repository"],
      ["junk", "HEAD is neither a ref nor a commit"],
      ["file", "no gitdir in the .git file"],
    ] as const) {
      const unread: string[] = [];
      expect(readGitState(join(tmp, name), (w) => unread.push(w)), name).toEqual(NO_GIT);
      expect(unread, name).toEqual([why]);
    }
  });
});

describe("readGitRemote (F-133)", () => {
  it("origin's URL, else the first remote's, else null; credentials in the URL are dropped (F-133)", () => {
    put("repo/.git/HEAD", "ref: refs/heads/main\n");
    expect(readGitRemote(join(tmp, "repo"))).toBeNull();
    put("repo/.git/config", '[core]\n\tbare = false\n[remote "upstream"]\n\turl = git@github.com:someone/app.git\n[branch "main"]\n\tremote = origin\n');
    expect(readGitRemote(join(tmp, "repo"))).toBe("git@github.com:someone/app.git");
    put("repo/.git/config", '[remote "upstream"]\n\turl = git@github.com:someone/app.git\n[remote "origin"]\n\turl = https://me:s3cret@github.com/me/app.git\n\tfetch = +refs/heads/*:refs/remotes/origin/*\n');
    expect(readGitRemote(join(tmp, "repo"))).toBe("https://github.com/me/app.git");
    expect(readGitRemote(join(tmp, "nowhere"))).toBeNull();
  });
});
