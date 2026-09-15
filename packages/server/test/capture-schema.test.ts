import { describe, expect, it } from "vitest";
import {
  CaptureBundleSchema,
  MAX_CONSOLE_ENTRIES,
  MAX_HTML_CHARS,
  MAX_NETWORK_ENTRIES,
  type Schema,
  validateCaptureBundle,
  validateCapturePost,
} from "../src/capture-schema.js";
import { PNG_B64, sampleBundle, samplePost } from "./helpers/sample-capture.js";

describe("capture bundle schema (F-15…F-22)", () => {
  it("accepts a well-formed bundle", () => {
    expect(validateCaptureBundle(sampleBundle())).toEqual([]);
  });

  it("reports every missing or mistyped field with its path", () => {
    const b = sampleBundle() as unknown as Record<string, unknown>;
    delete b.page;
    (b.annotations as unknown[])[0] = { ...(sampleBundle().annotations[0] as object), kind: "lasso", n: "1" };
    const errors = validateCaptureBundle(b);
    expect(errors).toContain("page: missing");
    expect(errors.some((e) => e.startsWith("annotations[0].kind: expected one of select|box|pin"))).toBe(true);
    expect(errors.some((e) => e.startsWith("annotations[0].n: expected finite number"))).toBe(true);
  });

  it("rejects non-objects and wrong versions", () => {
    expect(validateCaptureBundle(null)).toEqual(["$: expected object, got null"]);
    expect(validateCaptureBundle({ ...sampleBundle(), version: 2 })[0]).toBe("version: expected 1, got number");
  });

  it("enforces the PRD caps (F-19 4 KB HTML, F-20 50 console entries, F-21 50 failed requests)", () => {
    const b = sampleBundle();
    b.annotations[0]!.element!.outerHtml = "x".repeat(MAX_HTML_CHARS + 1);
    b.console = Array.from({ length: MAX_CONSOLE_ENTRIES + 1 }, () => b.console[0]!);
    b.network = Array.from({ length: MAX_NETWORK_ENTRIES + 1 }, () => b.network[0]!);
    const errors = validateCaptureBundle(b);
    expect(errors).toContain(`annotations[0].element.outerHtml: string longer than ${MAX_HTML_CHARS} chars`);
    expect(errors).toContain(`console: more than ${MAX_CONSOLE_ENTRIES} items`);
    expect(errors).toContain(`network: more than ${MAX_NETWORK_ENTRIES} items`);
  });

  it("requires the failed-request list and checks each entry (F-21)", () => {
    const b = sampleBundle() as unknown as Record<string, unknown>;
    delete b.network;
    expect(validateCaptureBundle(b)).toContain("network: missing");
    const bad = sampleBundle();
    bad.network = [{ method: "GET", url: "/x", status: null, error: "TypeError: Failed to fetch", via: "fetch", durationMs: null, timestamp: "2026-09-15T00:00:00Z" }];
    expect(validateCaptureBundle(bad)).toEqual([]);
    (bad.network[0] as unknown as { via: string }).via = "beacon";
    expect(validateCaptureBundle(bad)[0]).toMatch(/^network\[0\]\.via: expected one of fetch\|xhr\|resource/);
  });

  it("allows null screenshots and null crops when rasterisation failed (F-16 best-effort)", () => {
    const b = sampleBundle();
    b.screenshots = { viewport: null, annotated: null, error: "rasterisation failed: canvas tainted" };
    for (const a of b.annotations) a.image = null;
    expect(validateCaptureBundle(b)).toEqual([]);
  });

  it("documents every field with the requirement id that needs it", () => {
    const missing: string[] = [];
    const walk = (s: Schema<unknown> & { fields?: Record<string, Schema<unknown>> }, path: string) => {
      if (!/^(F-\d+|schema version)/.test(s.doc)) missing.push(`${path}: "${s.doc}"`);
      for (const [k, f] of Object.entries(s.fields ?? {})) walk(f as typeof s, path ? `${path}.${k}` : k);
    };
    walk(CaptureBundleSchema, "");
    expect(missing).toEqual([]);
  });
});

describe("capture POST body (F-13)", () => {
  it("accepts a bundle with all referenced images", () => {
    expect(validateCapturePost(samplePost())).toEqual([]);
  });

  it("rejects unsafe image names and missing referenced images", () => {
    const p = samplePost();
    delete p.images["ann-2.png"];
    p.images["../evil.png"] = PNG_B64;
    const errors = validateCapturePost(p);
    expect(errors).toContain("images: bundle references ann-2.png which was not sent");
    expect(errors).toContain("images.../evil.png: file name must match [a-z0-9-]+.png");
  });
});
