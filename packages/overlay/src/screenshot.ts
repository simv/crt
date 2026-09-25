/**
 * Screenshots (PRD F-16): rasterise the current viewport in-page with `modern-screenshot`
 * (SVG foreignObject → canvas; best-effort per PRD non-goal 3), then draw the annotation markers
 * onto a copy and cut one crop per annotation. All output is PNG as base64 (no data: prefix),
 * keyed by the file name the bundle references.
 *
 * Library choice (task CRT-0002 Ask 6): `modern-screenshot` over `html-to-image`. Same lineage and
 * API, but actively maintained, handles shadow roots and scrolled children, and is ~14 KB gzipped.
 * One gap it has that html-to-image does not: it skips cross-origin stylesheets it cannot read, so
 * Google-Fonts-style `<link>` sheets lose their `@font-face` rules; `inlineCrossOriginFonts` below
 * closes that gap. Rationale and the trial-app comparison are in the task Log.
 */
import { domToCanvas } from "modern-screenshot";
import type { Rect } from "../../server/src/capture-schema.js";
import { pauseNetworkLog, resumeNetworkLog } from "./network-hook.js";
import { isOverlayNode } from "./selector.js";
import { ACCENT } from "./tokens.js";

export interface MarkerSpec {
  n: number;
  kind: "select" | "box" | "pin";
  /** Viewport coordinates. */
  rect: Rect;
  point: { x: number; y: number } | null;
}

export interface ScreenshotResult {
  /** base64 PNGs keyed by file name. */
  images: Record<string, string>;
  viewport: string | null;
  annotated: string | null;
  /** annotation n → file name */
  crops: Map<number, string>;
  error: string | null;
}

const CROP_PAD = 24;
const PIN_CROP = 160;
const FIXED_ATTR = "data-crt-fixed";

export async function takeScreenshots(markers: MarkerSpec[]): Promise<ScreenshotResult> {
  const result: ScreenshotResult = { images: {}, viewport: null, annotated: null, crops: new Map(), error: null };
  let clean: HTMLCanvasElement;
  // The rasteriser's own fetches (fonts, images) go through the page's hooked fetch; their
  // failures are CRT's, not the page's, and must not reach the next capture (F-21).
  pauseNetworkLog();
  try {
    clean = await rasteriseViewport();
  } catch (err) {
    result.error = `rasterisation failed: ${err instanceof Error ? err.message : String(err)}`;
    return result;
  } finally {
    resumeNetworkLog();
  }
  const dpr = clean.width / window.innerWidth || 1;
  result.images["viewport.png"] = toBase64(clean);
  result.viewport = "viewport.png";

  const annotated = document.createElement("canvas");
  annotated.width = clean.width;
  annotated.height = clean.height;
  const ctx = annotated.getContext("2d")!;
  ctx.drawImage(clean, 0, 0);
  ctx.scale(dpr, dpr);
  for (const m of markers) drawMarker(ctx, m);
  result.images["viewport-annotated.png"] = toBase64(annotated);
  result.annotated = "viewport-annotated.png";

  for (const m of markers) {
    const region = cropRegion(m);
    if (region.width < 1 || region.height < 1) continue;
    const crop = document.createElement("canvas");
    crop.width = Math.round(region.width * dpr);
    crop.height = Math.round(region.height * dpr);
    crop
      .getContext("2d")!
      .drawImage(annotated, region.x * dpr, region.y * dpr, crop.width, crop.height, 0, 0, crop.width, crop.height);
    const name = `ann-${m.n}.png`;
    result.images[name] = toBase64(crop);
    result.crops.set(m.n, name);
  }
  return result;
}

/**
 * Render exactly the visible viewport: the document is cloned and clipped to innerWidth ×
 * innerHeight, and `restoreScrollPosition` translates the children of every scrolled element
 * (including <body> under a scrolled <html>) by its scroll offset. `position: fixed` elements
 * would move with that translate (a transformed ancestor becomes their containing block), so
 * they are tagged with their viewport position and re-anchored absolutely in the clone.
 */
async function rasteriseViewport(): Promise<HTMLCanvasElement> {
  const sx = window.scrollX;
  const sy = window.scrollY;
  const tagged = sx || sy ? tagFixedElements() : [];
  const fontStyle = await inlineCrossOriginFonts();
  try {
    return await domToCanvas(document.documentElement, {
      width: window.innerWidth,
      height: window.innerHeight,
      scale: Math.min(window.devicePixelRatio || 1, 2),
      backgroundColor: "#fff",
      filter: (node) => !isOverlayNode(node),
      features: { restoreScrollPosition: true },
      timeout: 8000,
      onCloneNode: (cloned) => {
        if (!(cloned instanceof Element)) return;
        for (const el of Array.from(cloned.querySelectorAll<HTMLElement>(`[${FIXED_ATTR}]`))) {
          const [top, left] = (el.getAttribute(FIXED_ATTR) ?? "0,0").split(",").map(Number);
          el.style.position = "absolute";
          el.style.top = `${(top ?? 0) + sy}px`;
          el.style.left = `${(left ?? 0) + sx}px`;
          el.style.bottom = "auto";
          el.style.right = "auto";
          el.style.margin = "0";
          el.removeAttribute(FIXED_ATTR);
        }
      },
    });
  } finally {
    for (const el of tagged) el.removeAttribute(FIXED_ATTR);
    fontStyle?.remove();
  }
}

/** Inlined @font-face CSS per cross-origin stylesheet href (+ the families it was filtered for). */
const fontCssCache = new Map<string, string>();

/**
 * modern-screenshot embeds fonts only from stylesheets whose `cssRules` are readable, which
 * excludes cross-origin `<link>` sheets (Google Fonts, CDN icon fonts). For each such sheet, fetch
 * its text, keep the `@font-face` blocks for families the page has actually loaded, turn their
 * `url()`s into data URLs, and drop them into a temporary same-origin `<style>` for the duration
 * of the capture. The browser already fetched these fonts to render the page; refetching them is
 * the page's own traffic, not CRT's (N-4).
 */
async function inlineCrossOriginFonts(): Promise<HTMLStyleElement | null> {
  const loaded = new Set<string>();
  try {
    document.fonts.forEach((f) => {
      if (f.status === "loaded") loaded.add(f.family.replace(/^["']|["']$/g, ""));
    });
  } catch {
    return null;
  }
  if (!loaded.size) return null;
  const key = Array.from(loaded).sort().join("|");
  const blocks: string[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    const href = sheet.href;
    if (!href) continue;
    try {
      void sheet.cssRules;
      continue; // readable: modern-screenshot handles it
    } catch {
      // cross-origin
    }
    const cacheKey = `${href}\n${key}`;
    let css = fontCssCache.get(cacheKey);
    if (css === undefined) {
      try {
        const text = await (await fetch(href, { mode: "cors" })).text();
        css = await inlineFontFaces(text, href, loaded);
      } catch {
        css = "";
      }
      fontCssCache.set(cacheKey, css);
    }
    if (css) blocks.push(css);
  }
  if (!blocks.length) return null;
  const style = document.createElement("style");
  style.setAttribute("data-crt-fonts", "");
  style.textContent = blocks.join("\n");
  document.head.appendChild(style);
  return style;
}

async function inlineFontFaces(cssText: string, baseUrl: string, families: Set<string>): Promise<string> {
  const out: string[] = [];
  for (const block of cssText.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
    const family = /font-family\s*:\s*["']?([^;"']+)/.exec(block)?.[1]?.trim();
    if (!family || !families.has(family)) continue;
    let b = block;
    for (const m of Array.from(block.matchAll(/url\((["']?)([^)"']+)\1\)/g))) {
      const url = m[2]!;
      if (url.startsWith("data:")) continue;
      try {
        const blob = await (await fetch(new URL(url, baseUrl).href, { mode: "cors" })).blob();
        b = b.replace(m[0], `url(${await blobToDataUrl(blob)})`);
      } catch {
        // leave the remote url; the face just falls back
      }
    }
    out.push(b);
  }
  return out.join("\n");
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function tagFixedElements(): Element[] {
  const tagged: Element[] = [];
  for (const el of Array.from(document.body?.querySelectorAll("*") ?? [])) {
    if (isOverlayNode(el)) continue;
    if (getComputedStyle(el).position !== "fixed") continue;
    const r = el.getBoundingClientRect();
    el.setAttribute(FIXED_ATTR, `${r.top},${r.left}`);
    tagged.push(el);
  }
  return tagged;
}

function drawMarker(ctx: CanvasRenderingContext2D, m: MarkerSpec): void {
  ctx.save();
  ctx.strokeStyle = ACCENT;
  ctx.fillStyle = ACCENT;
  ctx.lineWidth = 2;
  let badgeX: number;
  let badgeY: number;
  if (m.kind === "pin" && m.point) {
    const { x, y } = m.point;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 11, 0, Math.PI * 2);
    ctx.stroke();
    badgeX = x + 14;
    badgeY = y - 14;
  } else {
    const { x, y, width, height } = m.rect;
    if (m.kind === "box") ctx.setLineDash([6, 4]);
    ctx.strokeRect(x, y, width, height);
    ctx.setLineDash([]);
    badgeX = x;
    badgeY = y;
  }
  const r = 11;
  ctx.beginPath();
  ctx.arc(badgeX, badgeY, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.font = "bold 13px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(m.n), badgeX, badgeY + 0.5);
  ctx.restore();
}

function cropRegion(m: MarkerSpec): Rect {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let x: number, y: number, w: number, h: number;
  if (m.kind === "pin" && m.point) {
    x = m.point.x - PIN_CROP / 2;
    y = m.point.y - PIN_CROP / 2;
    w = PIN_CROP;
    h = PIN_CROP;
  } else {
    x = m.rect.x - CROP_PAD;
    y = m.rect.y - CROP_PAD;
    w = m.rect.width + CROP_PAD * 2;
    h = m.rect.height + CROP_PAD * 2;
  }
  const x1 = Math.max(0, Math.floor(x));
  const y1 = Math.max(0, Math.floor(y));
  const x2 = Math.min(vw, Math.ceil(x + w));
  const y2 = Math.min(vh, Math.ceil(y + h));
  return { x: x1, y: y1, width: Math.max(0, x2 - x1), height: Math.max(0, y2 - y1) };
}

function toBase64(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png").replace(/^data:image\/png;base64,/, "");
}
