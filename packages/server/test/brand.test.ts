import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCENT, ACCENT_HOVER, BADGE, BEZEL_DARK, DANGER, ERROR, EXPERIMENTAL, GLASS, IDLE, INK, OK, PILL, WARN } from "../../overlay/src/tokens.js";
import { OVERLAY_CSS } from "../../overlay/src/ui.js";

// PRD-polish F-112 / N-25 (M20): the brand files under docs/brand/ — the mark from the chosen
// direction (§13 decision 1) with the review's fixes — and the tokens the overlay's CSS reads.

const brand = join(import.meta.dirname, "..", "..", "..", "docs", "brand");
const MARKS = ["crt-mark.svg", "crt-mark-dark.svg", "crt-mark-small.svg", "crt-lockup.svg", "crt-lockup-dark.svg"];
const FAVICON = "favicon.svg";
const PNGS = ["favicon-32.png", "favicon-16.png"];
const DARK = ["crt-mark-dark.svg", "crt-lockup-dark.svg"];
const SMALL = ["crt-mark-small.svg", FAVICON];
const svg = (name: string) => readFileSync(join(brand, name), "utf8");
const bytes = (name: string) => statSync(join(brand, name)).size;

/** Well-formedness without a DOM: every opened tag is closed in order (no comments or CDATA in these files). */
function openAndCloseInOrder(text: string, name: string): void {
  const stack: string[] = [];
  const tag = /<(\/?)([a-zA-Z][\w:-]*)(?:\s[^>]*?)?(\/?)>/g;
  for (let m = tag.exec(text); m; m = tag.exec(text)) {
    const [, closing, element, selfClosing] = m;
    if (closing) expect(stack.pop(), `${name}: </${element}>`).toBe(element);
    else if (!selfClosing) stack.push(element!);
  }
  expect(stack, `${name}: unclosed`).toEqual([]);
}

describe("the brand files (PRD-polish F-112, N-25)", () => {
  it("every SVG has an <svg> root with a viewBox and no width/height, and references nothing: no <text>, <image>, <script>, href or xlink:href (F-112)", () => {
    for (const name of [...MARKS, FAVICON]) {
      const text = svg(name);
      openAndCloseInOrder(text, name);
      const root = /^<svg\s([^>]*)>/.exec(text);
      expect(root, `${name}: <svg> root`).not.toBeNull();
      const attrs = root![1]!;
      expect(attrs, name).toMatch(/\sviewBox="\d+ \d+ \d+ \d+"/);
      expect(attrs, name).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(attrs, name).not.toMatch(/\s(width|height)=/);
      expect(text, name).not.toMatch(/<(text|image|script|foreignObject|use)\b/);
      expect(text, name).not.toMatch(/\b(href|xlink:href)=/);
      expect(text, name).not.toMatch(/url\((?!#)/); // only in-file references (the clip-path)
      expect(text.endsWith("</svg>\n"), `${name}: ends with </svg> and one newline`).toBe(true);
      expect(text, name).not.toContain("\r");
    }
    // The favicon is the one file allowed a <style>: its dark-mode rule switches the bezel.
    for (const name of MARKS) expect(svg(name), name).not.toMatch(/<style\b/);
    expect(svg(FAVICON)).toMatch(/<style>@media \(prefers-color-scheme: dark\) \{ \.b \{ fill: #f2f2f4; \} \}<\/style>/);
    expect(svg(FAVICON)).toMatch(/<path class="b" fill="#111"/);
  });

  it("stays under budget: marks and lockups ≤ 4 KB, the favicon ≤ 2 KB, each PNG fallback ≤ 2 KB (N-25)", () => {
    for (const name of MARKS) expect(bytes(name), name).toBeLessThanOrEqual(4 * 1024);
    expect(bytes(FAVICON)).toBeLessThanOrEqual(2 * 1024);
    for (const name of PNGS) {
      expect(bytes(name), name).toBeLessThanOrEqual(2 * 1024);
      expect(readFileSync(join(brand, name)).subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), `${name}: PNG signature`).toBe(true);
    }
  });

  it("uses the tokens' colours and nothing else: ink on light, the dark bezel on dark (no #111 there), the glass on both, the accent exactly once — in the badge (F-112, §5.1)", () => {
    for (const name of MARKS) {
      const text = svg(name);
      const dark = DARK.includes(name);
      expect(text.split(ACCENT).length - 1, `${name}: the accent once`).toBe(1);
      expect(text, name).toMatch(new RegExp(`<circle [^>]*fill="${BADGE}"`)); // and that once is the badge
      if (dark) {
        expect(text, name).not.toContain("#111");
        expect(text, name).toContain(`fill="${BEZEL_DARK}"`);
      } else {
        expect(text, name).toContain(`fill="${INK}"`);
        expect(text, name).not.toContain(BEZEL_DARK);
      }
      // No colour outside the palette: ink, the dark bezel, the glass, the accent, white (the numeral).
      const colours = new Set((text.match(/#[0-9a-fA-F]{3,6}\b/g) ?? []).map((c) => c.toLowerCase()));
      for (const c of colours) expect([INK, BEZEL_DARK, GLASS, ACCENT, "#fff"], `${name}: ${c}`).toContain(c);
    }
    for (const name of ["crt-mark.svg", "crt-mark-dark.svg", "crt-lockup.svg", "crt-lockup-dark.svg"]) {
      const text = svg(name);
      expect(text, `${name}: the glass`).toContain(`fill="${GLASS}"`);
      expect(text, `${name}: the numeral in white`).toContain('fill="#fff"');
      expect(text, `${name}: no glass highlight`).not.toMatch(/opacity=/);
      // The badge sits on the tube's corner (computed on the Bézier, not eyeballed) with a 2-unit ring cut out of the bezel.
      expect(text, name).toContain('<circle cx="105.9" cy="32.8" r="16"');
      expect(text, name).toContain('M87.9 32.8a18 18 0 1 0 36 0a18 18 0 1 0 -36 0Z');
    }
    // The small variant: a solid tube, no glass, a plain dot (r = 2 → 4 px at 16 px, ≥ 3.5) and no numeral.
    for (const name of SMALL) {
      const text = svg(name);
      expect(text, name).not.toContain(GLASS);
      expect(text, name).not.toContain("#fff");
      expect(text, name).toContain(`<circle cx="14" cy="4" r="2" fill="${ACCENT}"/>`);
      expect(text, name).toContain(`fill="${INK}"`);
      expect(text, name).toContain('viewBox="0 0 16 16"');
    }
    // The favicon is the small mark plus its dark-mode rule and nothing else.
    expect(svg(FAVICON).replace(/<style>.*<\/style>\n/, "").replace(' class="b"', "")).toBe(svg("crt-mark-small.svg"));
  });

  it("the small mark's coordinates are whole pixels (§5.1: crisp at 16 px)", () => {
    for (const name of SMALL) {
      const text = svg(name);
      const numbers = text.match(/(?:\sd|cx|cy|r|viewBox)="([^"]*)"/g)!.flatMap((attr) => attr.match(/-?\d+(?:\.\d+)?/g) ?? []);
      expect(numbers.length, name).toBeGreaterThan(20);
      for (const n of numbers) expect(Number.isInteger(Number(n)), `${name}: ${n}`).toBe(true);
    }
  });
});

describe("the tokens feed the overlay's CSS (PRD-polish F-112, decision 7)", () => {
  it("renders the same declarations the literals did — the rendered CSS is byte-identical to before tokens.ts (F-112)", () => {
    // Every site that carried a literal before M20, as it read then (docs/PRD-polish.md §5.1; task CRT-0024 Ask 3).
    const sites = [
      "color: #111; display: block; }",
      "background: #111; color: #fff; font-weight: 600; box-shadow: 0 4px 16px rgba(0,0,0,.25); cursor: grab; }",
      "background: #ff3d71; color: #fff; font-size: 11px; line-height: 18px; text-align: center; }",
      '.launcher[data-health="connected"] .health { background: #2e9e5b; }',
      '.launcher[data-health="agent not ready"] .health, .launcher[data-health="different project"] .health { background: #e0a800; }',
      '.launcher[data-health="unreachable"] .health { background: #d7263d; }',
      ".toolbar button.active { background: #111; color: #fff; }",
      "button.primary { background: #ff3d71; color: #fff; font-weight: 600; }",
      "button.primary:hover { background: #e62e63; }",
      '.provider .dot[data-state="ready"] { background: #2e9e5b; }',
      '.provider .dot[data-state="unknown"] { background: #e0a800; }',
      "background: #fff3cd; color: #7a5200; font-size: 10px; font-weight: 600; vertical-align: 1px; }",
      ".provider .tick { color: #2e9e5b; font-weight: 700; visibility: hidden; }",
      ".status.error { background: #b00020; }",
      '.pill[data-state="running"], .pill[data-state="starting"] { background: #fff3cd; color: #7a5a00; }',
      '.pill[data-state="waiting"] { background: #ff3d71; color: #fff; }',
      '.pill[data-state="idle"] { background: #dbe7ff; color: #1a4d99; }',
      '.pill[data-state="task"] { background: #d9f5e3; color: #0a5b2b; }',
      '.pill[data-state="error"] { background: #fde2e2; color: #8b0000; }',
      ".mark { position: fixed; border: 2px solid #ff3d71; border-radius: 2px; }",
      ".mark.pin { width: 14px; height: 14px; border-radius: 7px; background: #ff3d71; border: 2px solid #fff;",
      '[data-state="starting"], [data-state="running"] { --st: #e0a800; }',
      '[data-state="waiting"] { --st: #ff3d71; }',
      '[data-state="idle"] { --st: #2f6fed; }',
      '[data-state="task"] { --st: #2e9e5b; }',
      '[data-state="error"] { --st: #b00020; }',
      ".pop-head .close:hover { background: #eee; color: #111; }",
      ".pop-foot button.primary:hover { background: #e62e63; }",
      // chat.ts takes the accent from tokens.ts too.
      '.chat-head .state[data-state="waiting"] { background: #ff3d71; color: #fff; }',
      ".chat-input button { padding: 0 14px; border-radius: 8px; background: #ff3d71; color: #fff; font-weight: 600; }",
    ];
    for (const site of sites) expect(OVERLAY_CSS, site).toContain(site);
    // A template mistake would leave one of these behind.
    expect(OVERLAY_CSS).not.toMatch(/\$\{|undefined|\[object Object\]|,#/);
    // Every hex in the stylesheet, counted as before the move (a grep for each token; the greys are untouched literals).
    const counts: Record<string, number> = {};
    for (const hex of OVERLAY_CSS.match(/#[0-9a-fA-F]{3,6}\b/g) ?? []) counts[hex.toLowerCase()] = (counts[hex.toLowerCase()] ?? 0) + 1;
    expect(counts).toMatchObject({
      [INK]: 10,
      [ACCENT]: 17,
      [ACCENT_HOVER]: 2,
      [OK]: 5,
      [WARN]: 3,
      [DANGER]: 1,
      [ERROR]: 3,
      [IDLE]: 1,
      [PILL.running[0]]: 4, // twice as the running pill (ui, chat), twice as the experimental badge
      [PILL.running[1]]: 2,
      [PILL.idle[0]]: 1,
      [PILL.idle[1]]: 2,
      [PILL.task[0]]: 3,
      [PILL.task[1]]: 3,
      [PILL.error[0]]: 3,
      [PILL.error[1]]: 2,
      [EXPERIMENTAL[1]]: 2,
      "#fff": 25,
    });
    expect(OVERLAY_CSS).toHaveLength(20104);
  });

  it("the tokens are the review's values and the brand files carry the same ones (§5.1)", () => {
    expect({ INK, ACCENT, GLASS, BEZEL_DARK, OK, WARN, DANGER }).toEqual({
      INK: "#111",
      ACCENT: "#ff3d71",
      GLASS: "#2b2b31",
      BEZEL_DARK: "#f2f2f4",
      OK: "#2e9e5b",
      WARN: "#e0a800",
      DANGER: "#d7263d",
    });
    expect(BADGE).toBe(ACCENT);
    expect(EXPERIMENTAL[0]).toBe(PILL.running[0]);
  });
});
