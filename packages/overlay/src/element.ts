/**
 * Element details for the capture bundle (PRD F-17, F-18, F-19): selector, XPath, attributes,
 * text, rect, curated computed styles, component chain and truncated outer HTML.
 */
import type { ElementInfo, Rect } from "../../server/src/capture-schema.js";
import { detectComponents } from "./component.js";
import { selectorFor, xpathFor } from "./selector.js";

const MAX_TEXT = 500; // F-17
const MAX_HTML = 4096; // F-19

/** F-17 curated computed-style subset. */
const STYLE_PROPS = [
  "display",
  "position",
  "width",
  "height",
  "margin",
  "padding",
  "border",
  "border-radius",
  "font-family",
  "font-size",
  "font-weight",
  "line-height",
  "color",
  "background-color",
  "background-image",
  "opacity",
  "z-index",
  "overflow",
  "flex",
  "grid-area",
] as const;

export function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: round(r.left), y: round(r.top), width: round(r.width), height: round(r.height) };
}

export function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

export function describeElement(el: Element, detached = false): ElementInfo {
  const cs = getComputedStyle(el);
  const styles: Record<string, string> = {};
  for (const p of STYLE_PROPS) {
    const v = cs.getPropertyValue(p);
    if (v && v !== "none" && v !== "normal" && v !== "auto") styles[p] = v;
  }
  const dataset: Record<string, string> = {};
  if (el instanceof HTMLElement || el instanceof SVGElement) {
    for (const [k, v] of Object.entries(el.dataset)) if (v !== undefined) dataset[k] = truncate(v, 200);
  }
  const { framework, components, source } = detectComponents(el);
  const parent = el.parentElement;
  return {
    selector: selectorFor(el),
    xpath: xpathFor(el),
    tag: el.localName,
    id: el.id ?? "",
    classes: Array.from(el.classList),
    dataset,
    role: el.getAttribute("role"),
    ariaLabel: el.getAttribute("aria-label"),
    text: truncate((el.textContent ?? "").replace(/\s+/g, " ").trim(), MAX_TEXT),
    rect: rectOf(el),
    styles,
    components,
    source,
    componentFramework: framework,
    outerHtml: truncate(el.outerHTML, MAX_HTML),
    parentOuterHtml: parent && parent !== document.documentElement ? truncate(parent.outerHTML, MAX_HTML) : "",
    detached,
  };
}

/** Short label for the hover tooltip: `div#id.class.class`. */
export function labelOf(el: Element): string {
  let s = el.localName;
  if (el.id) s += `#${el.id}`;
  const classes = Array.from(el.classList).slice(0, 3);
  if (classes.length) s += "." + classes.join(".");
  if (el.classList.length > 3) s += "…";
  return s;
}
