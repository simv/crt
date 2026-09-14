/**
 * Annotation store (PRD F-11, F-12). Annotations are numbered 1..n in creation order and
 * renumbered on delete so badges stay contiguous. Geometry is kept in document coordinates so
 * markers follow scrolling; the capture converts to viewport coordinates at send time.
 *
 * The store lives in memory for the life of the page (SPA navigation keeps it, F-12) and is
 * mirrored to `sessionStorage` so a full reload restores it (F-12 Should). Element references
 * are re-resolved from the stored selector after a reload or navigation; when that fails the
 * annotation-time snapshot is sent with `detached: true`.
 */
import type { ElementInfo, Rect } from "../../server/src/capture-schema.js";
import { describeElement } from "./element.js";
import { isOverlayNode } from "./selector.js";

export type AnnotationKind = "select" | "box" | "pin";

export interface BoxElement {
  el: Element | null;
  info: ElementInfo;
}

export interface Annotation {
  /** Stable key (badge numbers change on delete). */
  id: string;
  n: number;
  kind: AnnotationKind;
  note: string;
  /** Document coordinates. */
  pageRect: Rect;
  /** Document coordinates; pins only. */
  point: { x: number; y: number } | null;
  element: Element | null;
  elementInfo: ElementInfo | null;
  elements: BoxElement[];
}

type Persisted = Omit<Annotation, "element" | "elements"> & { elements: ElementInfo[] };

const STORAGE_KEY = "crt.annotations.v1";
const MAX_BOX_ELEMENTS = 10; // F-9

export type Listener = (annotations: Annotation[]) => void;

export class AnnotationStore {
  private items: Annotation[] = [];
  private listeners = new Set<Listener>();

  constructor() {
    this.restore();
  }

  all(): Annotation[] {
    return this.items.slice();
  }

  get(n: number): Annotation | undefined {
    return this.items.find((a) => a.n === n);
  }

  count(): number {
    return this.items.length;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** F-8: pin an element. */
  addSelect(el: Element): Annotation {
    const info = describeElement(el);
    return this.push({
      kind: "select",
      pageRect: toPageRect(el.getBoundingClientRect()),
      point: null,
      element: el,
      elementInfo: info,
      elements: [],
    });
  }

  /** F-9: a dragged rectangle in viewport coordinates; records the elements inside it. */
  addBox(viewportRect: Rect): Annotation {
    const elements = elementsInBox(viewportRect).map((el) => ({ el, info: describeElement(el) }));
    return this.push({
      kind: "box",
      pageRect: toPageRect(viewportRect),
      point: null,
      element: null,
      elementInfo: null,
      elements,
    });
  }

  /** F-10: a point in viewport coordinates, bound to nothing. */
  addPin(x: number, y: number): Annotation {
    return this.push({
      kind: "pin",
      pageRect: toPageRect({ x, y, width: 1, height: 1 }),
      point: { x: x + window.scrollX, y: y + window.scrollY },
      element: null,
      elementInfo: null,
      elements: [],
    });
  }

  setNote(n: number, note: string): void {
    const a = this.get(n);
    if (!a || a.note === note) return;
    a.note = note;
    this.changed();
  }

  remove(n: number): void {
    const before = this.items.length;
    this.items = this.items.filter((a) => a.n !== n);
    if (this.items.length === before) return;
    this.items.forEach((a, i) => (a.n = i + 1));
    this.changed();
  }

  clear(): void {
    if (!this.items.length) return;
    this.items = [];
    this.changed();
  }

  /**
   * Re-resolve element references after navigation (F-12): a selected element still in the
   * document keeps its live reference; one that vanished is looked up by selector; otherwise the
   * snapshot is used. Returns the annotations with `element` current.
   */
  resolve(): Annotation[] {
    for (const a of this.items) {
      if (a.kind === "select") {
        if (!a.element?.isConnected) a.element = resolveBySelector(a.elementInfo);
        if (a.element) a.pageRect = toPageRect(a.element.getBoundingClientRect());
      }
      for (const be of a.elements) {
        if (!be.el?.isConnected) be.el = resolveBySelector(be.info);
      }
    }
    return this.all();
  }

  private push(partial: Omit<Annotation, "id" | "n" | "note">): Annotation {
    const a: Annotation = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      n: this.items.length + 1,
      note: "",
      ...partial,
    };
    this.items.push(a);
    this.changed();
    return a;
  }

  private changed(): void {
    this.persist();
    for (const fn of this.listeners) fn(this.all());
  }

  private persist(): void {
    try {
      if (!this.items.length) {
        sessionStorage.removeItem(STORAGE_KEY);
        return;
      }
      const data: Persisted[] = this.items.map(({ element: _e, elements, ...rest }) => ({
        ...rest,
        elements: elements.map((b) => b.info),
      }));
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
      // sessionStorage may be unavailable (sandboxed iframe, quota); persistence is a Should.
    }
  }

  private restore(): void {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as Persisted[];
      if (!Array.isArray(data)) return;
      this.items = data.map((p, i) => ({
        ...p,
        n: i + 1,
        element: resolveBySelector(p.elementInfo),
        elements: (p.elements ?? []).map((info) => ({ el: resolveBySelector(info), info })),
      }));
      this.resolve();
    } catch {
      this.items = [];
    }
  }
}

function resolveBySelector(info: ElementInfo | null): Element | null {
  if (!info) return null;
  try {
    const found = document.querySelectorAll(info.selector);
    return found.length === 1 ? found[0]! : null;
  } catch {
    return null;
  }
}

export function toPageRect(r: { left?: number; x?: number; top?: number; y?: number; width: number; height: number }): Rect {
  const x = r.left ?? r.x ?? 0;
  const y = r.top ?? r.y ?? 0;
  return { x: x + window.scrollX, y: y + window.scrollY, width: r.width, height: r.height };
}

export function toViewportRect(r: Rect): Rect {
  return { x: r.x - window.scrollX, y: r.y - window.scrollY, width: r.width, height: r.height };
}

/**
 * F-9 (task Ask 3): the elements a box "contains", largest first, at most 10. An element counts
 * when at least half of its own area lies inside the box, so page-sized containers that merely
 * overlap the box are not reported; if nothing qualifies, the deepest element at the box centre is.
 */
export function elementsInBox(box: Rect): Element[] {
  const bx2 = box.x + box.width;
  const by2 = box.y + box.height;
  const inside: { el: Element; area: number }[] = [];
  const all = document.body ? document.body.querySelectorAll("*") : [];
  for (const el of Array.from(all)) {
    if (isOverlayNode(el) || el.closest("#crt-host")) continue;
    if (el instanceof HTMLScriptElement || el instanceof HTMLStyleElement) continue;
    const r = el.getBoundingClientRect();
    const area = r.width * r.height;
    if (area <= 0) continue;
    const ix = Math.max(0, Math.min(r.right, bx2) - Math.max(r.left, box.x));
    const iy = Math.max(0, Math.min(r.bottom, by2) - Math.max(r.top, box.y));
    const inter = ix * iy;
    if (inter >= area * 0.5) inside.push({ el, area });
  }
  inside.sort((a, b) => b.area - a.area);
  if (inside.length) return inside.slice(0, MAX_BOX_ELEMENTS).map((i) => i.el);
  const centre = document
    .elementsFromPoint(box.x + box.width / 2, box.y + box.height / 2)
    .find((e) => !isOverlayNode(e) && e !== document.documentElement && e !== document.body);
  return centre ? [centre] : [];
}
