/**
 * The CRT home (PRD-zero §5.3, F-130): the one place outside a project the server writes at
 * runtime (N-34) — `~/.crt`, or `CRT_HOME` (tests always set it). It holds the CRT browser's
 * profile per project (`browser/<project-key>/`, F-125) and, from M29, a project's reviews.
 * Node built-ins only; nothing here is ever served to a page.
 */
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

/** `CRT_HOME`, else `<homedir>/.crt`. */
export function crtHome(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.CRT_HOME?.trim();
  return override ? resolve(override) : join(homedir(), ".crt");
}

/**
 * F-130: the project root's folder name (lower-cased, anything outside `[a-z0-9-]` → `-`) plus the
 * first 6 hex of the SHA-256 of the absolute root (case-folded on Windows, where paths compare
 * that way), so two checkouts of one name never share a profile or a review.
 */
export function projectKey(root: string, platform: NodeJS.Platform = process.platform): string {
  const abs = resolve(root);
  const name =
    basename(abs)
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-")
      .replace(/^-+|-+$/g, "") || "project";
  const hash = createHash("sha256")
    .update(platform === "win32" ? abs.toLowerCase() : abs)
    .digest("hex")
    .slice(0, 6);
  return `${name}-${hash}`;
}

/** F-125: the CRT browser's user-data directory for a project. */
export function browserProfileDir(root: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(crtHome(env), "browser", projectKey(root));
}
