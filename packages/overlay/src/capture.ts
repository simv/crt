/**
 * Capture engine (PRD F-13, F-15…F-22): freeze the annotation set into a CaptureBundle
 * with screenshots, then POST it to the CRT server, which writes `.crt/captures/<id>/`.
 */
import type { AnnotationInfo, CaptureBundle, CapturePost, ElementInfo, PageInfo } from "../../server/src/capture-schema.js";
import { type Annotation, type AnnotationStore, toViewportRect } from "./annotations.js";
import { crtUrl } from "./base.js";
import { detectFramework } from "./component.js";
import { consoleEntries } from "./console-hook.js";
import { describeElement } from "./element.js";
import { networkEntries } from "./network-hook.js";
import { type MarkerSpec, takeScreenshots } from "./screenshot.js";

export const CAPTURES_ENDPOINT = "/__crt/captures";

export interface CaptureResult {
  bundle: CaptureBundle;
  images: Record<string, string>;
}

export interface SendResult {
  id: string;
  dir: string;
  files: string[];
}

/** F-15 page metadata. */
export function pageInfo(timestamp = new Date()): PageInfo {
  return {
    url: location.href,
    pathname: location.pathname,
    query: location.search,
    hash: location.hash,
    title: document.title,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    devicePixelRatio: window.devicePixelRatio || 1,
    userAgent: navigator.userAgent,
    timestamp: timestamp.toISOString(),
    scroll: { x: window.scrollX, y: window.scrollY },
  };
}

/** Fresh details when the element is still in the document, else the annotation-time snapshot. */
function currentInfo(el: Element | null, snapshot: ElementInfo | null): ElementInfo | null {
  if (el?.isConnected) return describeElement(el);
  if (snapshot) return { ...snapshot, detached: true };
  return null;
}

export function markerFor(a: Annotation): MarkerSpec {
  const rect = a.element?.isConnected ? viewportRectOf(a.element) : toViewportRect(a.pageRect);
  return {
    n: a.n,
    kind: a.kind,
    rect,
    point: a.point ? { x: a.point.x - window.scrollX, y: a.point.y - window.scrollY } : null,
  };
}

function viewportRectOf(el: Element) {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

/** Build the bundle and images for the store's current annotations. Pure with respect to the store. */
export async function capture(store: AnnotationStore): Promise<CaptureResult> {
  const started = new Date();
  // Snapshot the buffers before rasterising: the screenshot pass fetches stylesheets and images
  // itself, and those must not show up as the page's own failures (F-21).
  const consoleLog = consoleEntries();
  const network = networkEntries();
  const annotations = store.resolve();
  const markers = annotations.map(markerFor);
  const shots = await takeScreenshots(markers);

  const captured: AnnotationInfo[] = annotations.map((a, i) => {
    const m = markers[i]!;
    return {
      n: a.n,
      kind: a.kind,
      note: a.note,
      rect: m.rect,
      point: m.point,
      element: a.kind === "select" ? currentInfo(a.element, a.elementInfo) : null,
      elements: a.kind === "box" ? a.elements.map((b) => currentInfo(b.el, b.info)).filter(isInfo) : [],
      image: shots.crops.get(a.n) ?? null,
    };
  });

  const bundle: CaptureBundle = {
    version: 1,
    id: "",
    page: pageInfo(started),
    framework: detectFramework(),
    annotations: captured,
    console: consoleLog,
    network,
    screenshots: { viewport: shots.viewport, annotated: shots.annotated, error: shots.error },
  };
  return { bundle, images: shots.images };
}

function isInfo(x: ElementInfo | null): x is ElementInfo {
  return x !== null;
}

/** F-13: POST the capture; the server assigns the id and returns where it was written. */
export async function send(result: CaptureResult): Promise<SendResult> {
  const body: CapturePost = { bundle: result.bundle, images: result.images };
  const res = await fetch(crtUrl(CAPTURES_ENDPOINT), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Partial<SendResult> & { ok?: boolean; error?: string };
  if (!res.ok || !data.ok || !data.id || !data.dir) {
    throw new Error(data.error ?? `CRT server answered ${res.status}`);
  }
  return { id: data.id, dir: data.dir, files: data.files ?? [] };
}
