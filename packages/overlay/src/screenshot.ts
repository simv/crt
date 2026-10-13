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
 *
 * A strict app policy (CRT-0047): without `'unsafe-inline'` in `style-src`, modern-screenshot's
 * web-font step (a `<style>` in a scratch document) fails, so the font CSS is collected here and
 * handed over as `font.cssText`; without `data:` in `img-src`, the SVG it draws cannot be loaded in
 * the page, so it is drawn in CRT's rasteriser frame instead (`/__crt/raster`, server
 * raster-frame.ts). Pages without such a policy take modern-screenshot's own path, unchanged.
 */
import { domToCanvas, domToForeignObjectSvg, type Options } from "modern-screenshot";
import type { Rect } from "../../server/src/capture-schema.js";
import { rasterFrameUrl } from "./api.js";
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
  // Probed before the listener below: the probes' own refusals are expected, not the reason a pass failed.
  const policy = await pagePolicy();
  // A strict app policy (`style-src` / `img-src` without 'unsafe-inline' / data:) stops the
  // rasteriser, whose error alone does not say why; the directives it hit do (CRT-0046, F-16).
  const blocked = new Set<string>();
  const onViolation = (e: SecurityPolicyViolationEvent) => blocked.add(e.effectiveDirective);
  document.addEventListener("securitypolicyviolation", onViolation);
  try {
    clean = await rasteriseViewport(policy);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    // Violation events are queued as tasks: let the ones the failure raised arrive.
    await new Promise((r) => setTimeout(r, 0));
    result.error = blocked.size
      ? `rasterisation failed: the page's Content-Security-Policy blocked the screenshot (${Array.from(blocked).sort().join(", ")}): ${why}`
      : `rasterisation failed: ${why}`;
    return result;
  } finally {
    document.removeEventListener("securitypolicyviolation", onViolation);
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
async function rasteriseViewport(policy: PagePolicy): Promise<HTMLCanvasElement> {
  const sx = window.scrollX;
  const sy = window.scrollY;
  const tagged = sx || sy ? tagFixedElements() : [];
  // Under a strict style-src neither modern-screenshot's scratch <style> nor ours below would apply.
  const fontStyle = policy.inlineStyles ? await inlineCrossOriginFonts() : null;
  try {
    const options: Options = {
      ...(policy.inlineStyles ? {} : { font: await fontOption() }),
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
    };
    if (policy.dataImages) return await domToCanvas(document.documentElement, options);
    return await rasteriseInFrame(await domToForeignObjectSvg(document.documentElement, options), options);
  } finally {
    for (const el of tagged) el.removeAttribute(FIXED_ATTR);
    fontStyle?.remove();
  }
}

interface PagePolicy {
  /** A `<style>` element applies (no strict `style-src`). */
  inlineStyles: boolean;
  /** A `data:` image loads (no strict `img-src`). */
  dataImages: boolean;
}

let policyProbe: Promise<PagePolicy> | null = null;

/**
 * What the page's Content-Security-Policy lets the rasteriser do, probed once per page: a `<style>`
 * in a scratch document (it inherits the page's policy) gets no `sheet` when inline styles are
 * refused, and a one-pixel `data:` image errors when `data:` images are. A refused probe logs one
 * console line per directive, once.
 */
function pagePolicy(): Promise<PagePolicy> {
  policyProbe ??= (async () => {
    let inlineStyles = true;
    try {
      const doc = document.implementation.createHTMLDocument("");
      const style = doc.createElement("style");
      style.textContent = "a{}";
      doc.head.appendChild(style);
      inlineStyles = style.sheet !== null;
    } catch {
      // keep the default path
    }
    const img = new Image();
    img.src = "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='1'%20height='1'/%3E";
    const dataImages = await img.decode().then(
      () => true,
      () => false,
    );
    // Let the probes' violation events arrive before the capture starts listening for its own.
    await new Promise((r) => setTimeout(r, 0));
    return { inlineStyles, dataImages };
  })();
  return policyProbe;
}

/** The message type the rasteriser frame answers (server raster-frame.ts `RASTER_MESSAGE`). */
const RASTER_MESSAGE = "crt-raster";
let rasterSeq = 0;

/**
 * Draw modern-screenshot's SVG in CRT's rasteriser frame (CRT-0047): the frame loads it as the
 * `data:` image the page's `img-src` refuses and posts back a PNG Blob, decoded here with
 * `createImageBitmap` (no fetch, so no policy check). The same canvas `domToCanvas` would return:
 * width × height at `scale`, on `backgroundColor`. A page whose `frame-src` refuses the frame
 * gets no answer and fails on the timeout (the violation names `frame-src`).
 */
async function rasteriseInFrame(svg: SVGElement, options: Options): Promise<HTMLCanvasElement> {
  const scale = options.scale ?? 1;
  const width = Math.floor((options.width ?? window.innerWidth) * scale);
  const height = Math.floor((options.height ?? window.innerHeight) * scale);
  const redraws = Math.min(svg.querySelectorAll("img, image").length, 5);
  // Control characters make the XML invalid (modern-screenshot's removeControlCharacter).
  const text = new XMLSerializer().serializeToString(svg).replace(/[\u0000-\u0008\v\f\u000E-\u001F\uD800-\uDFFF\uFFFE\uFFFF]/gu, "");
  const src = new URL(rasterFrameUrl(), location.href);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.tabIndex = -1;
  // CSSOM, not a style attribute: the page's style-src does not govern it.
  Object.assign(frame.style, { position: "fixed", width: "0", height: "0", border: "0", visibility: "hidden", pointerEvents: "none" });
  const id = ++rasterSeq;
  let onMessage: ((e: MessageEvent) => void) | null = null;
  let timer = 0;
  try {
    const png = await new Promise<Blob>((resolve, reject) => {
      timer = window.setTimeout(() => reject(new Error(`the rasteriser frame at ${src.href} did not answer`)), options.timeout ?? 8000);
      onMessage = (e: MessageEvent) => {
        const m = e.data as { type?: unknown; id?: unknown; png?: unknown; error?: unknown } | null;
        if (e.source !== frame.contentWindow || e.origin !== src.origin || !m || m.type !== RASTER_MESSAGE || m.id !== id) return;
        if (m.png instanceof Blob) resolve(m.png);
        else reject(new Error(`the rasteriser frame could not draw the page: ${String(m.error)}`));
      };
      window.addEventListener("message", onMessage);
      frame.addEventListener("load", () => {
        frame.contentWindow?.postMessage(
          { type: RASTER_MESSAGE, id, svg: text, width, height, redraws, background: options.backgroundColor ?? null },
          src.origin,
        );
      });
      frame.src = src.href;
      document.documentElement.appendChild(frame);
    });
    const bitmap = await createImageBitmap(png);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
    bitmap.close();
    return canvas;
  } finally {
    window.clearTimeout(timer);
    if (onMessage) window.removeEventListener("message", onMessage);
    frame.remove();
  }
}

/** `font.cssText` when there is font CSS; `false` otherwise, since an empty cssText falls back to the web-font step. */
async function fontOption(): Promise<Options["font"]> {
  const cssText = await collectFontCss();
  return cssText ? { cssText } : false;
}

/**
 * The @font-face CSS for the families the page has loaded, every `url()` a data URL, for
 * modern-screenshot's `font.cssText` (CRT-0047): its own web-font step needs a `<style>` a strict
 * `style-src` refuses. Readable sheets give their rules (inside @media, @supports, @layer and
 * @import too); cross-origin ones are fetched as in `inlineCrossOriginFonts`.
 */
async function collectFontCss(): Promise<string> {
  const loaded = loadedFamilies();
  if (!loaded.size) return "";
  const key = Array.from(loaded).sort().join("|");
  const blocks: string[] = [];
  const walk = (rules: CSSRuleList, base: string, out: string[]) => {
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSFontFaceRule) out.push(rule.cssText);
      else if (rule instanceof CSSImportRule) {
        try {
          if (rule.styleSheet) walk(rule.styleSheet.cssRules, rule.styleSheet.href ?? base, out);
        } catch {
          // a cross-origin @import: its faces fall back
        }
      } else if ("cssRules" in rule) walk((rule as CSSGroupingRule).cssRules, base, out);
    }
  };
  for (const sheet of Array.from(document.styleSheets)) {
    const base = sheet.href ?? location.href;
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      // cross-origin
    }
    // Linked sheets are cached like inlineCrossOriginFonts' (an inline sheet is cheap to read again).
    const cacheKey = `${sheet.href}\n${key}`;
    let css = sheet.href ? fontCssCache.get(cacheKey) : undefined;
    if (css === undefined) {
      try {
        if (rules) {
          const faces: string[] = [];
          walk(rules, base, faces);
          css = faces.length ? await inlineFontFaces(faces.join("\n"), base, loaded) : "";
        } else if (sheet.href) {
          css = await inlineFontFaces(await (await fetch(sheet.href, { mode: "cors" })).text(), sheet.href, loaded);
        } else css = "";
      } catch {
        css = "";
      }
      if (sheet.href) fontCssCache.set(cacheKey, css);
    }
    if (css) blocks.push(css);
  }
  return blocks.join("\n");
}

function loadedFamilies(): Set<string> {
  const loaded = new Set<string>();
  try {
    document.fonts.forEach((f) => {
      if (f.status === "loaded") loaded.add(f.family.replace(/^["']|["']$/g, ""));
    });
  } catch {
    // no FontFaceSet: no fonts to embed
  }
  return loaded;
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
  const loaded = loadedFamilies();
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
