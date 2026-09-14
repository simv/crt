import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateCaptureBundle } from "../src/capture-schema.js";
import { CaptureValidationError, capturesDir, newCaptureId, pruneCaptures, writeCapture } from "../src/captures.js";
import { samplePost } from "./helpers/sample-capture.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "crt-captures-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("capture ids", () => {
  it("are local-time stamps plus a random suffix, and sort chronologically", () => {
    const a = newCaptureId(new Date(2026, 8, 15, 7, 5, 9));
    const b = newCaptureId(new Date(2026, 8, 15, 7, 5, 10));
    expect(a).toMatch(/^20260915-070509-[a-f0-9]{4}$/);
    expect(a < b).toBe(true);
  });
});

describe("writeCapture (F-13, F-23)", () => {
  it("writes capture.json and every PNG under .crt/captures/<id>/ with the id filled in", () => {
    const written = writeCapture(root, samplePost(), new Date(2026, 8, 15, 7, 5, 9));
    expect(written.dir).toBe(join(capturesDir(root), written.id));
    expect(written.files.sort()).toEqual(["ann-1.png", "ann-2.png", "capture.json", "viewport-annotated.png", "viewport.png"]);
    const json = readFileSync(written.jsonPath, "utf8");
    expect(json.endsWith("\n")).toBe(true);
    expect(json).not.toContain("\r\n");
    const bundle = JSON.parse(json) as { id: string };
    expect(bundle.id).toBe(written.id);
    expect(validateCaptureBundle(bundle)).toEqual([]);
    const png = readFileSync(join(written.dir, "viewport.png"));
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  });

  it("rejects an invalid body without writing anything", () => {
    expect(() => writeCapture(root, { bundle: {}, images: {} })).toThrow(CaptureValidationError);
    expect(existsSync(capturesDir(root))).toBe(false);
  });
});

describe("pruneCaptures (F-23)", () => {
  function makeCapture(id: string, ageDays: number): string {
    const dir = join(capturesDir(root), id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "capture.json"), "{}");
    const t = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
    utimesSync(dir, t, t);
    return dir;
  }

  it("removes capture dirs older than 7 days and keeps newer ones and unrelated entries", () => {
    const old = makeCapture("20260901-120000-aaaa", 8);
    const fresh = makeCapture("20260914-120000-bbbb", 1);
    const stranger = join(capturesDir(root), "notes.txt");
    writeFileSync(stranger, "keep me");
    const t = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    utimesSync(stranger, t, t);
    const removed = pruneCaptures(root);
    expect(removed).toEqual(["20260901-120000-aaaa"]);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(stranger)).toBe(true);
  });

  it("is a no-op when there is no captures dir", () => {
    expect(pruneCaptures(root)).toEqual([]);
  });
});
