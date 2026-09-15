import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeCapture } from "../src/captures.js";
import { buildIntakeMessage, CaptureNotFoundError, readCaptureBundle, renderIntakeText } from "../src/intake-message.js";
import { PNG_B64, sampleBundle, samplePost } from "./helpers/sample-capture.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "crt-intake-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("first intake message (F-24)", () => {
  it("summarises page, framework, console and every annotation, and attaches the PNGs as images", () => {
    const written = writeCapture(root, samplePost());
    const msg = buildIntakeMessage(written.dir);
    expect(msg.text).toContain(`CRT intake for capture ${written.id}.`);
    expect(msg.text).toContain(`Capture bundle: ${join(written.dir, "capture.json")}`);
    expect(msg.text).toContain("Page: http://localhost:4400/cart?promo=SAVE10#top");
    expect(msg.text).toContain("Framework: next 15.0.0 (webpack) · route pattern /cart");
    expect(msg.text).toContain('1. [select] "total excludes discount"');
    expect(msg.text).toContain('element: <span id="total" class="cart-total">');
    expect(msg.text).toContain("selector: #total");
    expect(msg.text).toContain("components: CartSummary");
    expect(msg.text).toContain("source: src/components/Cart.tsx:88 (debug_source)");
    expect(msg.text).toContain('2. [pin] "missing a coupon field here"');
    expect(msg.text).toContain("Attached images: viewport (annotated), annotation 1, annotation 2.");
    expect(msg.images?.map((i) => [i.label, i.mediaType, i.data === PNG_B64])).toEqual([
      ["viewport (annotated)", "image/png", true],
      ["annotation 1", "image/png", true],
      ["annotation 2", "image/png", true],
    ]);
  });

  it("falls back to the clean viewport and mentions console errors", () => {
    const bundle = sampleBundle();
    bundle.screenshots.annotated = null;
    bundle.console = [{ level: "error", message: "boom", stack: null, timestamp: "2026-09-15T00:00:00Z", url: null }];
    const text = renderIntakeText("/tmp/cap", bundle, ["viewport"]);
    expect(text).toContain("Console since load: 1 entries, 1 errors — first: boom");
    expect(text).toContain("Attached images: viewport.");
  });

  it("rejects a missing or invalid capture", () => {
    expect(() => readCaptureBundle(join(root, "nope"))).toThrow(CaptureNotFoundError);
    expect(() => buildIntakeMessage(join(root, "nope"))).toThrow(/not found/);
  });
});
