/**
 * What was reviewed (PRD-zero F-134): the branch and commit of the project at capture time, and the
 * remote a review records (F-133), read straight from `<root>/.git` — `HEAD`, a loose ref file or
 * `packed-refs`, and `config` for the remote. The server spawns no `git` at runtime (PRD-zero §12
 * rule 6), so this reads the few files a checkout always has:
 *
 *   • `.git` is a directory                      → that is the git dir
 *   • `.git` is a file (`gitdir: <path>`)         → a worktree or a submodule: the git dir it names,
 *                                                   whose `commondir` file names where refs and config live
 *   • `HEAD` is `ref: refs/heads/<branch>`        → the branch; its commit from the loose ref, else `packed-refs`
 *   • `HEAD` is a full SHA                        → a detached HEAD: no branch
 *   • no `.git`, an unborn branch, a reftable repository or anything else unread → `null`s; a shape
 *     that is there but not understood is reported once through `onUnread` (rule 6)
 *
 * A dirty working tree is not detected (PRD-zero Open question 3). Node built-ins only.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

export interface GitState {
  /** The branch `HEAD` names; null when detached or when there is no repository. */
  branch: string | null;
  /** The full SHA of `HEAD`; null when there is none (no repository, no commit yet, an unread shape). */
  commit: string | null;
}

export const NO_GIT: GitState = { branch: null, commit: null };

const SHA_RE = /^[0-9a-f]{40}([0-9a-f]{24})?$/;
const HEADS = "refs/heads/";

function read(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** The git dir of `root` and the dir its shared files (refs, `packed-refs`, `config`) live in; null without a `.git`. */
export function gitDirs(root: string): { gitDir: string; commonDir: string } | null {
  const dot = join(root, ".git");
  let gitDir: string;
  try {
    if (statSync(dot).isDirectory()) gitDir = dot;
    else {
      const m = /^gitdir:\s*(.+?)\s*$/m.exec(read(dot) ?? "");
      if (!m) return null;
      gitDir = isAbsolute(m[1]!) ? resolve(m[1]!) : resolve(root, m[1]!);
    }
  } catch {
    return null;
  }
  const common = read(join(gitDir, "commondir"))?.trim();
  return { gitDir, commonDir: common ? (isAbsolute(common) ? resolve(common) : resolve(gitDir, common)) : gitDir };
}

/** F-134: the branch and commit `root` is on. `onUnread` hears a `.git` that is there but could not be read (once per call). */
export function readGitState(root: string, onUnread?: (why: string) => void): GitState {
  const dirs = gitDirs(root);
  if (!dirs) {
    if (existsSync(join(root, ".git"))) onUnread?.("no gitdir in the .git file");
    return NO_GIT;
  }
  const head = read(join(dirs.gitDir, "HEAD"))?.trim();
  if (head === undefined) {
    onUnread?.("no HEAD");
    return NO_GIT;
  }
  if (SHA_RE.test(head)) return { branch: null, commit: head };
  const ref = /^ref:\s*(\S+)$/.exec(head)?.[1];
  if (!ref) {
    onUnread?.("HEAD is neither a ref nor a commit");
    return NO_GIT;
  }
  if (existsSync(join(dirs.commonDir, "reftable"))) {
    // A reftable repository keeps a placeholder HEAD and its refs in a binary table.
    onUnread?.("a reftable repository");
    return NO_GIT;
  }
  const branch = ref.startsWith(HEADS) ? ref.slice(HEADS.length) : null;
  for (const dir of new Set([dirs.gitDir, dirs.commonDir])) {
    const loose = read(join(dir, ...ref.split("/")))?.trim();
    if (loose && SHA_RE.test(loose)) return { branch, commit: loose };
  }
  for (const line of (read(join(dirs.commonDir, "packed-refs")) ?? "").split(/\r?\n/)) {
    const m = /^([0-9a-f]{40,64}) (\S+)$/.exec(line);
    if (m && m[2] === ref && SHA_RE.test(m[1]!)) return { branch, commit: m[1]! };
  }
  // A branch with no commit yet (`git init`, nothing committed): the branch is known, the commit is not.
  return { branch, commit: null };
}

/** F-133: the URL of the `origin` remote (else the first remote) from the repository's `config`; null when there is none. */
export function readGitRemote(root: string): string | null {
  const dirs = gitDirs(root);
  const text = dirs ? read(join(dirs.commonDir, "config")) : null;
  if (!text) return null;
  const remotes = new Map<string, string>();
  let section: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const head = /^\[remote\s+"(.+)"\]$/.exec(line);
    if (head) section = head[1]!;
    else if (line.startsWith("[")) section = null;
    else if (section !== null) {
      const url = /^url\s*=\s*(.+)$/.exec(line)?.[1]?.trim();
      // A token in the URL (`https://user:token@host/…`) is not something a review file should carry.
      if (url && !remotes.has(section)) remotes.set(section, url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/@]+@/i, "$1"));
    }
  }
  return remotes.get("origin") ?? remotes.values().next().value ?? null;
}
