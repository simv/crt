/**
 * Markers and their positioning (PRD F-11, F-67; N-3). Each annotation has an outline (dashed for
 * a Box, a dot for a Pin), a number badge and a state pill, patched in place — a keystroke in a
 * note re-renders, so nothing is rebuilt and no listener is added; one delegated click listener
 * serves every badge and pill. The badge, outline and pill are coloured by the thread's state.
 *
 * Idle cost (N-3, CRT-0039): nothing runs per frame while the page is idle. A capture-phase scroll
 * listener (scroll does not bubble), `resize` and a ResizeObserver on the anchored elements each ask
 * the `Positioner` for one pass on the next frame; the per-frame loop runs only while the overlay
 * asks for it. A pass reads every rectangle before it writes, and writes a marker only when its
 * anchor rectangle changed since it was last placed.
 */
import { type Annotation, toViewportRect } from "./annotations.js";
import { STATE_LABEL, type ThreadState } from "./dom-util.js";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Where an annotation is on screen now (the read half of a pass). */
export interface Anchor {
  a: Annotation;
  rect: Rect;
  /** A Select annotation whose element left the document: drawn faded at its last position. */
  detached: boolean;
}

/** What a marker shows: its thread's state and task id; null before the annotation is sent. */
export interface MarkerState {
  state: ThreadState;
  taskId: string | null;
}

/** One annotation's marker elements; `at` is the anchor rectangle they were last placed at. */
interface MarkerEls {
  mark: HTMLElement;
  badge: HTMLButtonElement;
  pill: HTMLButtonElement;
  at: string;
}

/** N-3: one positioning pass on the next frame, or one every frame while `loop(true)`. */
export class Positioner {
  /** The one pass scheduled for the next frame, else 0. */
  private frame = 0;
  /** The per-frame loop, else 0. */
  private loopFrame = 0;

  constructor(private readonly pass: () => void) {}

  /** One pass on the next frame (none while the loop runs, which places everything anyway). */
  schedule(): void {
    if (this.frame || this.loopFrame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.pass();
    });
  }

  loop(on: boolean): void {
    if (on && !this.loopFrame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      this.loopFrame = requestAnimationFrame(this.tick);
    } else if (!on && this.loopFrame) {
      cancelAnimationFrame(this.loopFrame);
      this.loopFrame = 0;
    }
  }

  private tick = (): void => {
    this.pass();
    this.loopFrame = requestAnimationFrame(this.tick);
  };
}

export class Markers {
  private readonly els = new Map<string, MarkerEls>();
  /** The anchored elements (and the document) whose resize moves the markers. */
  private readonly observer: ResizeObserver | null;
  private readonly observed = new Set<Element>();

  /** `moved`: something may have moved (scroll, resize); `onBadge`: a badge or pill was clicked. */
  constructor(
    private readonly container: HTMLElement,
    moved: () => void,
    onBadge: (n: number) => void,
  ) {
    this.observer = typeof ResizeObserver === "function" ? new ResizeObserver(moved) : null;
    window.addEventListener("resize", moved);
    // A scroll of the page or of any scroller in it moves the markers.
    document.addEventListener("scroll", moved, { capture: true, passive: true });
    this.observer?.observe(document.documentElement); // content growing above an anchor moves it
    container.addEventListener("click", (e) => {
      const hit = (e.target as Element).closest<HTMLElement>(".num-badge, .mark-state");
      if (hit?.dataset.n) onBadge(Number(hit.dataset.n));
    });
  }

  /** F-67: one mark, badge and pill per annotation, patched in place; placing them is the next pass's job. */
  render(items: Annotation[], stateOf: (a: Annotation) => MarkerState | null): void {
    const live = new Set(items.map((a) => a.id));
    for (const [id, m] of this.els) {
      if (live.has(id)) continue;
      m.mark.remove();
      m.badge.remove();
      m.pill.remove();
      this.els.delete(id);
    }
    for (const a of items) {
      let m = this.els.get(a.id);
      if (!m) {
        m = newMarker(a);
        this.container.append(m.mark, m.badge, m.pill);
        this.els.set(a.id, m);
      }
      const status = stateOf(a);
      const state = status?.state ?? null;
      const n = String(a.n);
      for (const el of [m.mark, m.badge, m.pill]) {
        if (el.dataset.n !== n) el.dataset.n = n;
        if (state && el.dataset.state !== state) el.dataset.state = state;
        else if (!state && el.dataset.state !== undefined) delete el.dataset.state;
      }
      setText(m.badge, n);
      setTitle(m.badge, a.note || `Annotation ${a.n}`);
      if (m.pill.hidden !== !state) m.pill.hidden = !state;
      if (state) {
        setText(m.pill, status?.taskId ?? STATE_LABEL[state]);
        setTitle(m.pill, `Annotation ${a.n}: ${STATE_LABEL[state]} — click to open the chat`);
      }
    }
    this.observe(items);
  }

  /** The read half of a pass: where every annotation is now. */
  read(items: Annotation[]): Anchor[] {
    return items.map((a) => ({ a, ...anchorRect(a) }));
  }

  /** The write half: move the markers whose anchor changed since they were last placed. */
  write(anchors: Anchor[]): void {
    for (const { a, rect, detached } of anchors) {
      const m = this.els.get(a.id);
      if (!m) continue;
      const at = `${rect.x},${rect.y},${rect.width},${rect.height},${detached}`;
      if (m.at === at) continue;
      m.at = at;
      placeMarker(m, a.kind, rect, detached);
    }
  }

  /** A Select annotation's element resizing moves its marker; the ResizeObserver watches exactly those. */
  private observe(items: Annotation[]): void {
    const ro = this.observer;
    if (!ro) return;
    const wanted = new Set<Element>();
    for (const a of items) if (a.kind === "select" && a.element && a.element !== document.documentElement) wanted.add(a.element);
    for (const el of this.observed) {
      if (wanted.has(el)) continue;
      ro.unobserve(el);
      this.observed.delete(el);
    }
    for (const el of wanted) {
      if (this.observed.has(el)) continue;
      ro.observe(el);
      this.observed.add(el);
    }
  }
}

/** The viewport rectangle a marker (and its popover) anchors to: a live element's box, else the stored page rectangle. */
function anchorRect(a: Annotation): { rect: Rect; detached: boolean } {
  if (a.kind === "select" && a.element?.isConnected) {
    const r = a.element.getBoundingClientRect();
    return { rect: { x: r.left, y: r.top, width: r.width, height: r.height }, detached: false };
  }
  return { rect: toViewportRect(a.pageRect), detached: a.kind === "select" };
}

/** A marker's three elements, unplaced; `render` fills in the rest. */
function newMarker(a: Annotation): MarkerEls {
  const mark = document.createElement("div");
  mark.className = `mark ${a.kind}`;
  const badge = document.createElement("button");
  badge.type = "button";
  badge.className = "num-badge";
  const pill = document.createElement("button");
  pill.type = "button";
  pill.className = "pill mark-state";
  pill.hidden = true;
  return { mark, badge, pill, at: "" };
}

/** Write a marker's position: a pin's dot centres on the point, the badge and pill sit at the top-left corner. */
function placeMarker(m: MarkerEls, kind: Annotation["kind"], rect: Rect, detached: boolean): void {
  m.mark.classList.toggle("detached", detached);
  let bx: number;
  let by: number;
  if (kind === "pin") {
    m.mark.style.left = `${rect.x - 7}px`;
    m.mark.style.top = `${rect.y - 7}px`;
    bx = rect.x + 16;
    by = rect.y - 14;
  } else {
    m.mark.style.left = `${rect.x}px`;
    m.mark.style.top = `${rect.y}px`;
    m.mark.style.width = `${rect.width}px`;
    m.mark.style.height = `${rect.height}px`;
    bx = rect.x;
    by = rect.y;
  }
  m.badge.style.left = `${bx}px`;
  m.badge.style.top = `${by}px`;
  m.pill.style.left = `${bx + 14}px`;
  m.pill.style.top = `${by}px`;
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function setTitle(el: HTMLElement, title: string): void {
  if (el.title !== title) el.title = title;
}
