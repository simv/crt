import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeCapture } from "../../src/captures.js";
import { FIRST_MESSAGE_HEADING } from "../../src/intake-message.js";
import { HOLD_PHRASE, isQuickNote, makeStubProfile, STUB_CAPABILITIES, STUB_PROPOSALS, STUB_VARIANTS, stubCapabilities, stubProfile, stubVariantFromEnv } from "../../src/providers/stub.js";
import { samplePost } from "../helpers/sample-capture.js";
import { runConformance } from "./conformance.js";

// The stub provider through the F-59 conformance scenario, once per F-46 variant: as Claude
// (interactive, inline images, system instructions), `first-message`, and `sandboxed` (no cards,
// images by path). The variants are what M8's e2e sandboxed axis and M9's Codex driver rely on.

let root: string;
let captureDir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "crt-stub-"));
  mkdirSync(join(root, ".crt", "tasks"), { recursive: true });
  captureDir = writeCapture(root, samplePost()).dir;
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("stub provider variants (F-42, F-46)", () => {
  it("declares Claude's matrix by default and flips the channels per variant; the env picks one (F-46)", () => {
    expect(STUB_CAPABILITIES).toEqual({ streaming: true, toolEvents: true, permissions: "interactive", images: "inline", resume: true, interrupt: true, instructions: "system" });
    expect(stubCapabilities("first-message")).toMatchObject({ permissions: "interactive", images: "inline", instructions: "first-message" });
    expect(stubCapabilities("sandboxed")).toMatchObject({ permissions: "sandboxed", images: "path", instructions: "first-message" });
    expect(stubVariantFromEnv("1")).toBe("default");
    expect(stubVariantFromEnv("sandboxed")).toBe("sandboxed");
    expect(stubVariantFromEnv("first-message")).toBe("first-message");
    expect(stubVariantFromEnv(undefined)).toBe("default");
    expect(STUB_VARIANTS).toEqual(["default", "first-message", "sandboxed"]);
    expect(stubProfile.capabilities).toEqual(STUB_CAPABILITIES);
    expect(makeStubProfile("sandboxed").id).toBe("stub");
  });

  for (const variant of STUB_VARIANTS) {
    it(`passes the conformance scenario as ${variant} (F-46, F-50, F-51, F-59)`, async () => {
      const profile = makeStubProfile(variant);
      const id = randomUUID();
      const r = await runConformance({
        profile,
        root,
        captureDir,
        id,
        intake: "INTAKE INSTRUCTIONS for the capture directory named in the first message",
        prompts: { permissionAgain: "please run the tests", write: "write it", longTurn: "tell me something long" },
      });
      expect(r.init).toMatchObject({ nativeSessionId: id, resumeCommand: `claude --resume ${id}`, capabilities: stubCapabilities(variant) });
      const first = r.events.find((e) => e.type === "user") as Extract<(typeof r.events)[number], { type: "user" }>;
      // F-51: instructions in the first message for the non-default variants, nowhere else.
      expect(first.text.startsWith(`${FIRST_MESSAGE_HEADING}\n\nINTAKE INSTRUCTIONS`)).toBe(variant !== "default");
      expect(r.options.systemPromptAppend === "").toBe(variant !== "default");
      // F-50: every image has a path; base64 only for the inline variants.
      for (const img of r.options.first?.images ?? []) {
        expect(img.path).toContain(captureDir);
        expect(img.data !== undefined).toBe(variant !== "sandboxed");
      }
      // F-46: the sandboxed variant never asked for a permission but still ran the tool.
      const toolNames = r.events.filter((e) => e.type === "tool_use").map((e) => (e as { name: string }).name);
      expect(toolNames).toContain("Bash");
      expect(r.events.some((e) => e.type === "permission")).toBe(variant !== "sandboxed");
    });
  }

  it("detects quick-note mode by the last paragraph only, so instructions in the first message do not trigger it (F-14, F-51)", () => {
    expect(isQuickNote("capture\n\nQuick note (F-14): the developer is not watching.")).toBe(true);
    expect(isQuickNote("capture\n\nQuick note (F-14): the developer is not watching.\n\n")).toBe(true);
    expect(isQuickNote(`${FIRST_MESSAGE_HEADING}\n\nWhen the first message ends with a paragraph starting \`Quick note (F-14)\`, skip the wait.\n\n---\n\ncapture text`)).toBe(false);
    expect(isQuickNote("capture text")).toBe(false);
  });

  it("reports a mismatch between what the registry sent and the variant's channels (F-50, F-51)", async () => {
    const events: Array<{ type: string; message?: string }> = [];
    const driver = makeStubProfile("sandboxed").start({
      id: "x",
      cwd: root,
      systemPromptAppend: "should be empty",
      first: { text: "no heading", images: [{ mediaType: "image/png", path: join(root, "a.png"), data: "AAAA", label: "a" }] },
      decide: () => ({ kind: "allow" }),
      writeTask: async () => ({ id: "CRT-0001", path: "x" }),
      mcp: { command: "node", args: [], env: {} },
      model: null,
    });
    driver.onEvent((e) => events.push(e));
    await new Promise((r) => setTimeout(r, 50));
    const messages = events.filter((e) => e.type === "error").map((e) => e.message);
    expect(messages).toEqual([
      `stub (sandboxed) expected the first message to start with "${FIRST_MESSAGE_HEADING}"`,
      "stub (sandboxed) expected no system prompt text when instructions travel in the first message",
      "stub (sandboxed) received base64 image data it did not ask for (F-50)",
    ]);
    driver.close();
  });

  it(`stays running after its first sentence when the note says "${HOLD_PHRASE}" — no tool, no result — until interrupted (PRD-polish F-116, §12 rule 4)`, async () => {
    const events: Array<{ type: string; state?: string }> = [];
    let asked = 0;
    const driver = makeStubProfile().start({
      id: "hold",
      cwd: root,
      systemPromptAppend: "",
      first: { text: `CRT intake for capture x\n\n1. [select] "Heading reads like a placeholder — ${HOLD_PHRASE}"` },
      decide: () => (asked++, { kind: "ask" }),
      writeTask: async () => ({ id: "CRT-0001", path: "x" }),
      mcp: { command: "node", args: [], env: {} },
      model: null,
    });
    driver.onEvent((e) => events.push(e));
    await new Promise((r) => setTimeout(r, 600));
    // The first sentence streamed, then nothing: no Read, no permission, no result.
    expect(events.map((e) => e.type).filter((t) => t !== "text")).toEqual(["user", "init", "state", "assistant_start", "assistant_end"]);
    expect(events.filter((e) => e.type === "state").map((e) => e.state)).toEqual(["running"]);
    expect(asked).toBe(0);
    await driver.interrupt();
    expect(events.at(-2)).toMatchObject({ type: "result", ok: false, errors: ["interrupted"] });
    expect(events.at(-1)).toEqual({ type: "state", state: "idle" });
    driver.close();
  });

  it('re-proposes in the Deny shape when a reply says "no tests", without a second test run (PRD-chat F-120, §12 rule 4)', async () => {
    const events: Array<{ type: string; text?: string; name?: string; state?: string }> = [];
    const driver = makeStubProfile().start({
      id: "repropose",
      cwd: root,
      systemPromptAppend: "",
      first: { text: `CRT intake for capture x\n\n1. [select] "Total ignores the promo"` },
      decide: () => ({ kind: "allow" }),
      writeTask: async () => ({ id: "CRT-0001", path: "x" }),
      mcp: { command: "node", args: [], env: {} },
      model: null,
    });
    driver.onEvent((e) => events.push(e));
    const spoken = () => events.filter((e) => e.type === "text").map((e) => e.text).join("");
    await expect.poll(spoken, { timeout: 5_000 }).toContain(STUB_PROPOSALS.allow);
    await expect.poll(() => events.at(-1), { timeout: 5_000 }).toEqual({ type: "state", state: "idle" });
    const bashRuns = events.filter((e) => e.type === "tool_use" && e.name === "Bash").length;
    const mark = events.length;
    driver.send({ text: "no tests please" });
    await expect.poll(() => events.slice(mark).filter((e) => e.type === "text").map((e) => e.text).join(""), { timeout: 5_000 }).toBe(STUB_PROPOSALS.deny);
    expect(events.filter((e) => e.type === "tool_use" && e.name === "Bash").length).toBe(bashRuns);
    driver.close();
  });

  it.each([
    ["a React page: the first message's components and source lines", `${FIRST_MESSAGE_HEADING}\n\n1. [select] "Price ignores the promo"\n   element: <div class="price">\n   selector: [data-testid=card-mug] .price\n   components: ProductCard ← Shop ← HomePage\n   source: components/ProductCard.tsx:10 (debug_source)\n`, "ProductCard", "components/ProductCard.tsx"],
    ["a page without component detection: the script's own CartSummary", `${FIRST_MESSAGE_HEADING}\n\n1. [select] "Total ignores the promo"\n   element: <span class="price">\n   selector: .price\n`, "CartSummary", "src/components/Cart.tsx"],
  ])("names the annotated component and its source file from %s (PRD-polish F-116, §12 rule 4, CRT-0029)", async (_name, text, component, file) => {
    const events: Array<{ type: string; text?: string; label?: string }> = [];
    const driver = makeStubProfile().start({
      id: "subject",
      cwd: root,
      systemPromptAppend: "",
      first: { text },
      decide: (name) => (name === "Read" ? { kind: "allow" } : { kind: "deny", reason: "only Read is allowed here" }),
      writeTask: async () => ({ id: "CRT-0001", path: "x" }),
      mcp: { command: "node", args: [], env: {} },
      model: null,
    });
    driver.onEvent((e) => events.push(e));
    await expect.poll(() => events.some((e) => e.type === "tool_use"), { timeout: 5_000 }).toBe(true);
    const spoken = events.filter((e) => e.type === "text").map((e) => e.text).join("");
    expect(spoken).toContain(`The annotated element is rendered by **${component}**; let me look at the source.`);
    expect(events.find((e) => e.type === "tool_use")).toMatchObject({ label: `Read ${file}` });
    driver.close();
  });
});
