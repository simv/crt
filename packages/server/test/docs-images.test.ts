import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// PRD-polish F-116 / F-117 / N-27 (M22): the images under docs/images/ — the five screenshots
// `npm run screenshots` writes and the four hand-drawn illustrations — exist, stay under budget
// (PNG ≤ 400 KB, SVG ≤ 10 KB) and the SVGs render through <img> on GitHub in both themes (a
// viewBox, fixed colours: no currentColor, no CSS variables, no <style>). Every image a README or a
// docs page references by a relative path must exist; the pixels themselves are never diffed
// here (F-116: never in CI — a reviewer regenerates and looks).

const root = join(import.meta.dirname, "..", "..", "..");
const images = join(root, "docs", "images");
const PNG_BUDGET = 400 * 1024;
const SVG_BUDGET = 10 * 1024;
/** F-116 §5.3: the five screenshots, 1280 × 800 CSS px at DPR 2. */
const SCREENSHOTS = ["arrival.png", "select.png", "chat.png", "marker-states.png", "landing.png"];
/** F-117: the two illustrations, light and dark. */
const ILLUSTRATIONS = ["loop.svg", "loop-dark.svg", "architecture.svg", "architecture-dark.svg"];
const bytes = (name: string) => statSync(join(images, name)).size;

/** The pages whose image references the test follows: the two READMEs and every Markdown page under docs/ (one level). */
function pages(): string[] {
  const docs = join(root, "docs");
  return [join(root, "README.md"), join(root, "packages", "server", "README.md"), ...readdirSync(docs).filter((n) => n.endsWith(".md")).map((n) => join(docs, n))];
}

/**
 * Local image paths referenced from `file` — Markdown `![](…)`, `<img src>` and `<source srcset>` —
 * outside fenced code and indented sample blocks (docs/PRD.md quotes a task file, assets and all,
 * indented under a list item).
 */
function imageRefs(file: string): string[] {
  const out: string[] = [];
  let fenced = false;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.startsWith("```")) fenced = !fenced;
    if (fenced || /^\s{2,}/.test(line)) continue;
    for (const m of line.matchAll(/!\[[^\]]*\]\(([^)\s]+)(?:\s[^)]*)?\)/g)) out.push(m[1]!);
    for (const m of line.matchAll(/<(?:img|source)\b[^>]*\b(?:src|srcset)="([^"]+)"/g)) out.push(m[1]!);
  }
  return out.filter((p) => !/^(https?:|data:|\/\/)/.test(p)).map((p) => p.replace(/#.*$/, ""));
}

function pngSize(name: string): { width: number; height: number } {
  const buf = readFileSync(join(images, name));
  expect(buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), `${name}: PNG signature`).toBe(true);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("docs/images (PRD-polish F-116, F-117, N-27)", () => {
  it("every image a README or a docs page references by a relative path exists (F-116)", () => {
    for (const file of pages()) {
      for (const ref of imageRefs(file)) {
        expect(existsSync(resolve(dirname(file), ref)), `${file.slice(root.length + 1)} → ${ref}`).toBe(true);
      }
    }
  });

  it("the five screenshots exist, are PNGs of 1280 × 800 CSS px at DPR 2 and stay ≤ 400 KB each (F-116)", () => {
    for (const name of SCREENSHOTS) {
      expect(existsSync(join(images, name)), name).toBe(true);
      expect(pngSize(name), name).toEqual({ width: 2560, height: 1600 });
      expect(bytes(name), `${name}: ${bytes(name)} bytes`).toBeLessThanOrEqual(PNG_BUDGET);
    }
  });

  it("the four illustrations exist, stay ≤ 10 KB each, carry a viewBox and use fixed colours only: no currentColor, no var(), no <style> (F-117)", () => {
    for (const name of ILLUSTRATIONS) {
      expect(existsSync(join(images, name)), name).toBe(true);
      expect(bytes(name), `${name}: ${bytes(name)} bytes`).toBeLessThanOrEqual(SVG_BUDGET);
      const text = readFileSync(join(images, name), "utf8");
      const svg = /^<svg\s([^>]*)>/.exec(text);
      expect(svg, `${name}: <svg> root`).not.toBeNull();
      expect(svg![1], name).toMatch(/\sviewBox="\d+ \d+ \d+ \d+"/);
      expect(svg![1], name).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(text, name).not.toMatch(/currentColor/i);
      expect(text, name).not.toContain("var(");
      expect(text, name).not.toMatch(/<style\b/);
      expect(text, name).not.toMatch(/\b(href|xlink:href)=/); // nothing fetched: GitHub's <img> would not
      expect(text.endsWith("</svg>\n"), `${name}: ends with </svg> and one newline`).toBe(true);
      expect(text, name).not.toContain("\r");
    }
    // The dark file is the light one with the palette swapped: same drawing, same size class.
    for (const light of ["loop.svg", "architecture.svg"]) {
      const dark = light.replace(".svg", "-dark.svg");
      expect(Math.abs(bytes(light) - bytes(dark)), `${light} vs ${dark}`).toBeLessThan(512);
    }
  });

  it("every file under docs/images is one of the nine images or the README, and each PNG/SVG there is under its budget (F-116, F-117)", () => {
    for (const name of readdirSync(images)) {
      if (name === "README.md") continue;
      expect([...SCREENSHOTS, ...ILLUSTRATIONS], `unexpected docs/images/${name}`).toContain(name);
      expect(bytes(name), name).toBeLessThanOrEqual(name.endsWith(".png") ? PNG_BUDGET : SVG_BUDGET);
    }
  });
});
