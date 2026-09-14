/**
 * Capture store (PRD F-13, F-23): `.crt/captures/<id>/` holds `capture.json` plus the PNGs the
 * overlay sent. Ids are time-ordered so the folder lists chronologically. Captures older than
 * `PRUNE_AFTER_MS` are removed on server start; a capture that became a task has already been
 * moved to `.crt/tasks/assets/<TASK-ID>/` (M3), so pruning only ever hits unsent/abandoned ones.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CaptureBundle, type CapturePost, validateCapturePost } from "./capture-schema.js";

export const CAPTURES_DIRNAME = "captures";
export const PRUNE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const ID_RE = /^\d{8}-\d{6}-[a-f0-9]{4}$/;

export function capturesDir(projectRoot: string): string {
  return join(projectRoot, ".crt", CAPTURES_DIRNAME);
}

/** `YYYYMMDD-HHMMSS-xxxx` in local time: sortable, readable, and safe on every filesystem. */
export function newCaptureId(now: Date = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  const stamp =
    `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}` +
    `-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `${stamp}-${randomBytes(2).toString("hex")}`;
}

export interface WrittenCapture {
  id: string;
  dir: string;
  jsonPath: string;
  files: string[];
}

export class CaptureValidationError extends Error {
  readonly errors: string[];
  constructor(errors: string[]) {
    super(`invalid capture: ${errors.slice(0, 5).join("; ")}${errors.length > 5 ? ` (+${errors.length - 5} more)` : ""}`);
    this.name = "CaptureValidationError";
    this.errors = errors;
  }
}

/**
 * Validate a POST body and write it as `.crt/captures/<id>/`. The bundle's `id` is assigned here;
 * whatever the overlay sent is overwritten. Files are written with `\n` line endings.
 */
export function writeCapture(projectRoot: string, body: unknown, now: Date = new Date()): WrittenCapture {
  const errors = validateCapturePost(body);
  if (errors.length) throw new CaptureValidationError(errors);
  const post = body as CapturePost;

  const id = newCaptureId(now);
  const dir = join(capturesDir(projectRoot), id);
  mkdirSync(dir, { recursive: true });

  const files: string[] = [];
  for (const [name, b64] of Object.entries(post.images)) {
    writeFileSync(join(dir, name), Buffer.from(b64, "base64"));
    files.push(name);
  }
  const bundle: CaptureBundle = { ...post.bundle, id };
  const jsonPath = join(dir, "capture.json");
  writeFileSync(jsonPath, JSON.stringify(bundle, null, 2) + "\n", "utf8");
  files.push("capture.json");
  return { id, dir, jsonPath, files };
}

/** Remove capture directories whose mtime is older than `maxAgeMs`. Returns the ids removed. */
export function pruneCaptures(projectRoot: string, now: Date = new Date(), maxAgeMs = PRUNE_AFTER_MS): string[] {
  const dir = capturesDir(projectRoot);
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return [];
  }
  const removed: string[] = [];
  for (const name of entries) {
    if (!ID_RE.test(name)) continue;
    const full = join(dir, name);
    try {
      const st = statSync(full);
      if (!st.isDirectory()) continue;
      const age = now.getTime() - st.mtimeMs;
      if (age > maxAgeMs) {
        rmSync(full, { recursive: true, force: true });
        removed.push(name);
      }
    } catch {
      // A capture vanishing mid-scan is not an error.
    }
  }
  return removed;
}
