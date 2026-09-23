import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CaptureBundle } from "../src/capture-schema.js";
import { writeCapture } from "../src/captures.js";
import { buildIntakeMessage, CaptureNotFoundError, FIRST_MESSAGE_HEADING, prependInstructions, QUICK_NOTE_INSTRUCTIONS, readCaptureBundle, renderIntakeText, summarizeCapture, summarizeIntake } from "../src/intake-message.js";
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

  it("renders a page-level chat as Developer's message with no annotations (F-68)", () => {
    const post = samplePost();
    post.bundle.annotations = [];
    post.bundle.note = "  the whole page feels slow after applying a promo  ";
    post.bundle.screenshots.annotated = null;
    post.images = { "viewport.png": PNG_B64 };
    const written = writeCapture(root, post);
    const msg = buildIntakeMessage(written.dir);
    expect(msg.text).toContain(`Developer's message: "the whole page feels slow after applying a promo"`);
    expect(msg.text).toContain("Annotations (0):");
    expect(msg.text).toContain("(none — the developer is asking about the page as a whole");
    expect(msg.images.map((i) => i.label)).toEqual(["viewport"]);
    expect(summarizeCapture(post.bundle)).toBe("the whole page feels slow after applying a promo");
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

describe("the developer's words for the first bubble (PRD-chat F-119, N-28)", () => {
  const plain = { quick: false, instructions: false };

  it("summarizeIntake: a page-level chat's note is the words, trimmed, with no annotations (F-68)", () => {
    const bundle = sampleBundle();
    bundle.id = "20260923-000000-abcd";
    bundle.annotations = [];
    bundle.note = "  the whole page feels slow after applying a promo  ";
    expect(summarizeIntake(bundle, plain)).toEqual({
      captureId: "20260923-000000-abcd",
      note: "the whole page feels slow after applying a promo",
      annotations: [],
      quick: false,
      instructions: false,
    });
  });

  it("summarizeIntake: one select annotation with a note and a component gets the F-8 label the popover header shows (F-119)", () => {
    const bundle = sampleBundle();
    bundle.annotations = [bundle.annotations[0]!];
    bundle.annotations[0]!.element!.id = "";
    const s = summarizeIntake(bundle, plain);
    expect(s.note).toBeNull();
    expect(s.annotations).toEqual([{ n: 1, kind: "select", note: "total excludes discount", label: "CartSummary span.cart-total" }]);
    // With an id the short form is the overlay's `labelOf`: tag#id.class (at most three classes, then …).
    bundle.annotations[0]!.element!.id = "total";
    bundle.annotations[0]!.element!.classes = ["a", "b", "c", "d"];
    expect(summarizeIntake(bundle, plain).annotations[0]!.label).toBe("CartSummary span#total.a.b.c…");
    bundle.annotations[0]!.element!.components = [];
    expect(summarizeIntake(bundle, plain).annotations[0]!.label).toBe("span#total.a.b.c…");
  });

  it("summarizeIntake: three annotations of the three kinds, in order, the empty note kept empty, box and pin labelled by kind (F-119)", () => {
    const bundle = sampleBundle();
    const [select, pin] = bundle.annotations as [CaptureBundle["annotations"][0], CaptureBundle["annotations"][1]];
    bundle.annotations = [
      select,
      { n: 2, kind: "box", note: "   ", rect: { x: 5, y: 6, width: 199.6, height: 80.2 }, point: null, element: null, elements: [], image: null },
      { ...pin, n: 3, note: "  missing a coupon field here " },
    ];
    expect(summarizeIntake(bundle, plain).annotations).toEqual([
      { n: 1, kind: "select", note: "total excludes discount", label: "CartSummary span#total.cart-total" },
      { n: 2, kind: "box", note: "", label: "box 200×80" },
      { n: 3, kind: "pin", note: "missing a coupon field here", label: "pin" },
    ]);
  });

  it("summarizeIntake: `quick` and `instructions` are passed through (F-14, F-51)", () => {
    const bundle = sampleBundle();
    expect(summarizeIntake(bundle, { quick: true, instructions: false })).toMatchObject({ quick: true, instructions: false });
    expect(summarizeIntake(bundle, { quick: false, instructions: true })).toMatchObject({ quick: false, instructions: true });
  });

  it("buildIntakeMessage's text for the fixture is byte-identical to v0.6 — SHA-256 pinned at 5fdcbd8 (N-28)", () => {
    const written = writeCapture(root, samplePost());
    // Only the capture directory and the minted id vary between runs and platforms.
    const norm = (t: string) => t.split(join(written.dir, "capture.json")).join("<bundle>").split(written.id).join("<id>");
    const sha = (t: string) => createHash("sha256").update(norm(t)).digest("hex");
    expect(sha(buildIntakeMessage(written.dir).text)).toBe("7281e834f694a9c39c19ae4f6ddc0baaa2a20c0e64010e88048179b0d1589cfa");
    expect(sha(buildIntakeMessage(written.dir, undefined, { quick: true }).text)).toBe("16263037fefb0130018398a2cdf7ff91a692b1605c6773cf964fdcb9e48bf694");
  });
});
