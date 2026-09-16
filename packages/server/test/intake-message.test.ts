import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeCapture } from "../src/captures.js";
import { buildIntakeMessage, CaptureNotFoundError, FIRST_MESSAGE_HEADING, prependInstructions, QUICK_NOTE_INSTRUCTIONS, readCaptureBundle, renderIntakeText, summarizeCapture } from "../src/intake-message.js";
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
    expect(msg.text).toContain("Failed network requests since load: 1 — first: GET /api/cart/promo → 500");
    expect(msg.text).not.toContain("Quick note");
    expect(msg.text).toContain("Attached images: viewport (annotated), annotation 1, annotation 2.");
    expect(msg.images?.map((i) => [i.label, i.mediaType, i.data === PNG_B64])).toEqual([
      ["viewport (annotated)", "image/png", true],
      ["annotation 1", "image/png", true],
      ["annotation 2", "image/png", true],
    ]);
    // F-50: the path is always there, absolute, inside the capture directory.
    expect(msg.images?.map((i) => i.path)).toEqual(["viewport-annotated.png", "ann-1.png", "ann-2.png"].map((f) => join(written.dir, f)));
  });

  it("images by path skip the base64 work and `none` drops them, saying so in the text (F-50)", () => {
    const written = writeCapture(root, samplePost());
    const byPath = buildIntakeMessage(written.dir, undefined, { images: "path" });
    expect(byPath.images).toHaveLength(3);
    expect(byPath.images?.every((i) => i.data === undefined && i.path.startsWith(written.dir))).toBe(true);
    expect(byPath.text).toContain("Attached images: viewport (annotated), annotation 1, annotation 2.");
    const none = buildIntakeMessage(written.dir, undefined, { images: "none" });
    expect(none.images).toEqual([]);
    expect(none.text).toContain("Images not attached: this agent does not accept images; the screenshots are the PNG files next to capture.json.");
    expect(none.text).not.toContain("Attached images");
  });

  it("keeps the quick-note sentinel as the last paragraph in both instruction channels (F-14, F-51)", () => {
    const written = writeCapture(root, samplePost());
    const quick = buildIntakeMessage(written.dir, undefined, { quick: true });
    const last = (text: string) => text.trim().split(/\n{2,}/).at(-1)!;
    // `system`: the message is sent as is; the sentinel paragraph is last.
    expect(last(quick.text)).toBe(QUICK_NOTE_INSTRUCTIONS);
    // `first-message`: instructions go above under the fixed heading; the sentinel is still last.
    const prepended = prependInstructions(quick, "Do intake.\n\nWhen the first message ends with a paragraph starting `Quick note (F-14)`, skip the wait.");
    expect(prepended.text.startsWith(`${FIRST_MESSAGE_HEADING}\n\nDo intake.\n\nWhen the first message ends`)).toBe(true);
    expect(prepended.text).toContain("\n\n---\n\nCRT intake for capture ");
    expect(last(prepended.text)).toBe(QUICK_NOTE_INSTRUCTIONS);
    expect(prepended.images).toBe(quick.images);
    // A plain (non-quick) message gains the heading and nothing after the capture text.
    const plain = prependInstructions(buildIntakeMessage(written.dir), "Do intake.");
    expect(plain.text.endsWith("Attached images: viewport (annotated), annotation 1, annotation 2.")).toBe(true);
    expect(FIRST_MESSAGE_HEADING).toBe("# CRT intake instructions");
  });

  it("falls back to the clean viewport and mentions console errors", () => {
    const bundle = sampleBundle();
    bundle.screenshots.annotated = null;
    bundle.console = [{ level: "error", message: "boom", stack: null, timestamp: "2026-09-15T00:00:00Z", url: null }];
    const text = renderIntakeText("/tmp/cap", bundle, ["viewport"]);
    expect(text).toContain("Console since load: 1 entries, 1 errors — first: boom");
    expect(text).toContain("Attached images: viewport.");
  });

  it("omits the failed-request line when there were none and names an errored request by its error (F-21)", () => {
    const bundle = sampleBundle();
    bundle.network = [];
    expect(renderIntakeText("/tmp/cap", bundle, [])).not.toContain("Failed network requests");
    bundle.network = [{ method: "POST", url: "/api/save", status: null, error: "TypeError: Failed to fetch", via: "xhr", durationMs: 3, timestamp: "2026-09-15T00:00:00Z" }];
    expect(renderIntakeText("/tmp/cap", bundle, [])).toContain("Failed network requests since load: 1 — first: POST /api/save → TypeError: Failed to fetch");
  });

  it("appends the quick-note instructions when asked (F-14)", () => {
    const written = writeCapture(root, samplePost());
    const msg = buildIntakeMessage(written.dir, undefined, { quick: true });
    expect(msg.text.endsWith(`\n\n${QUICK_NOTE_INSTRUCTIONS}`)).toBe(true);
    expect(QUICK_NOTE_INSTRUCTIONS).toMatch(/^Quick note \(F-14\)/);
    expect(QUICK_NOTE_INSTRUCTIONS).toContain("call write_task directly");
  });

  it("summarises a capture for the session list by its first note, else by its annotations and path (F-30)", () => {
    const bundle = sampleBundle();
    expect(summarizeCapture(bundle)).toBe("total excludes discount");
    for (const a of bundle.annotations) a.note = "  ";
    expect(summarizeCapture(bundle)).toBe("2 annotations on /cart?promo=SAVE10");
    bundle.annotations[0]!.note = "x".repeat(100);
    expect(summarizeCapture(bundle)).toHaveLength(80);
  });

  it("rejects a missing or invalid capture", () => {
    expect(() => readCaptureBundle(join(root, "nope"))).toThrow(CaptureNotFoundError);
    expect(() => buildIntakeMessage(join(root, "nope"))).toThrow(/not found/);
  });
});
