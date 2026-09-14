/**
 * Project root detection (PRD §5.1, F-4 /__crt/health, N-5).
 * The root is the nearest ancestor of the launch directory that contains `.git`
 * (a directory, or a file for worktrees); fallback is the launch directory itself.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function findProjectRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}
