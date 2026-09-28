/**
 * The annotation tools (PRD F-8, F-9, F-10). Select outlines the element under the pointer with its
 * component and label — ↑ / ↓ walk to the parent or the first child, a click or Enter takes it; Box
 * drags a rectangle; Pin drops a point. While a tool is armed a transparent layer over the page
 * takes the pointer and a hint says what to do; Esc puts the tool away. Each new annotation is
 * handed to the host, which opens its popover (F-65).
 *
 * N-3: Select hit-tests at most once per frame, at the latest pointer position, and the outline
 * and label change only when the element under the pointer does.
 */
import type { AnnotationStore } from "./annotations.js";
import { nearestComponentName } from "./component.js";
import { escapeHtml } from "./dom-util.js";
import { labelOf } from "./element.js";
import { isOverlayNode } from "./selector.js";

export type Tool = "select" | "box" | "pin";

const HINTS: Record<Tool, string> = {
  select: "Select: click an element · ↑ parent · ↓ child · Esc cancel",
  box: "Box: drag a rectangle · Esc cancel",
  pin: "Pin: click a point · Esc cancel",
};

/** The tool layer's elements, inside the overlay's shadow root. */
export interface ToolEls {
  layer: HTMLElement;
  hover: HTMLElement;
  hoverLabel: HTMLElement;
  drag: HTMLElement;
  hint: HTMLElement;
}

export interface ToolHost {
  /** A send is running: no tool can be armed or put away (F-13). */
  busy(): boolean;
  /** A tool was armed, or put away (null). */
  armed(tool: Tool | null): void;
  /** F-11: annotation `n` was just made. */
  annotated(n: number): void;
}

/** The rectangle two drag points span. */
function normalise(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export class Tools {
  private tool: Tool | null = null;
  private candidate: Element | null = null;
  /** ↑ / ↓ picked the candidate: small pointer jitter must not replace it. */
  private candidateLocked = false;
  private dragStart: { x: number; y: number } | null = null;
  /** N-3: the pending hit test and the pointer position it will use. */
  private hoverFrame = 0;
  private hoverPoint: { x: number; y: number } | null = null;

  constructor(
    private readonly els: ToolEls,
    private readonly store: AnnotationStore,
    private readonly host: ToolHost,
  ) {
    this.wire();
  }

  current(): Tool | null {
    return this.tool;
  }

  set(tool: Tool | null): void {
    if (this.host.busy()) return;
    this.tool = tool;
    this.candidate = null;
    this.candidateLocked = false;
    this.dragStart = null;
    cancelAnimationFrame(this.hoverFrame);
    this.hoverFrame = 0;
    this.hoverPoint = null;
    const { layer, hover, hoverLabel, drag, hint } = this.els;
    layer.hidden = tool === null;
    hover.style.display = "none";
    hoverLabel.style.display = "none";
    drag.style.display = "none";
    hint.hidden = tool === null;
    if (tool) hint.textContent = HINTS[tool];
    this.host.armed(tool);
  }

  /** Programmatic hover for the Select tool (tests): outline the element at a viewport point. */
  hoverAt(x: number, y: number): Element | null {
    const el = this.elementAt(x, y);
    this.setCandidate(el);
    return el;
  }

  /** A keydown while a tool is armed: Esc puts it away; Select walks with ↑ / ↓ and takes the element with Enter. */
  onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.set(null);
      return;
    }
    if (this.tool !== "select" || (e.key !== "ArrowUp" && e.key !== "ArrowDown" && e.key !== "Enter")) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Enter") {
      if (this.candidate) this.commitSelect(this.candidate);
      return;
    }
    const cur = this.candidate;
    if (!cur) return;
    const next =
      e.key === "ArrowUp"
        ? cur.parentElement && cur.parentElement !== document.documentElement
          ? cur.parentElement
          : null
        : (Array.from(cur.children).find((c) => !isOverlayNode(c)) ?? null);
    if (next) {
      this.candidateLocked = true;
      this.setCandidate(next);
    }
  }

  private elementAt(x: number, y: number): Element | null {
    const el = document.elementsFromPoint(x, y).find((e) => !isOverlayNode(e) && !e.closest("#crt-host"));
    return el && el !== document.documentElement ? el : null;
  }

  /** N-3: the hit test for the last pointer position; the outline and label change only with the element under it. */
  private hoverNow(): void {
    cancelAnimationFrame(this.hoverFrame);
    this.hoverFrame = 0;
    const p = this.hoverPoint;
    this.hoverPoint = null;
    if (!p || this.tool !== "select" || this.candidateLocked) return;
    const el = this.elementAt(p.x, p.y);
    if (el !== this.candidate) this.setCandidate(el);
  }

  private setCandidate(el: Element | null): void {
    const { hover, hoverLabel } = this.els;
    this.candidate = el;
    if (!el) {
      hover.style.display = "none";
      hoverLabel.style.display = "none";
      return;
    }
    const r = el.getBoundingClientRect();
    Object.assign(hover.style, { display: "block", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    const comp = nearestComponentName(el);
    hoverLabel.innerHTML = comp ? `<b>${escapeHtml(comp)}</b> ${escapeHtml(labelOf(el))}` : escapeHtml(labelOf(el));
    const top = r.top > 28 ? r.top - 26 : r.bottom + 4;
    Object.assign(hoverLabel.style, {
      display: "block",
      left: `${Math.max(4, Math.min(r.left, window.innerWidth - 200))}px`,
      top: `${Math.min(top, window.innerHeight - 24)}px`,
    });
  }

  private wire(): void {
    const { layer, drag } = this.els;
    layer.addEventListener("pointermove", (e) => {
      if (this.tool === "select") {
        if (this.candidateLocked) {
          if (Math.hypot(e.movementX, e.movementY) < 3) return;
          this.candidateLocked = false;
        }
        // N-3: one hit test per frame, at the latest pointer position.
        this.hoverPoint = { x: e.clientX, y: e.clientY };
        this.hoverFrame ||= requestAnimationFrame(() => this.hoverNow());
      } else if (this.tool === "box" && this.dragStart) {
        const r = normalise(this.dragStart, { x: e.clientX, y: e.clientY });
        Object.assign(drag.style, { display: "block", left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
      }
    });
    layer.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      if (this.tool === "box") {
        this.dragStart = { x: e.clientX, y: e.clientY };
        layer.setPointerCapture(e.pointerId);
      }
    });
    layer.addEventListener("pointerup", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      if (this.tool === "select") {
        this.hoverNow(); // a move still waiting for its frame decides what the click selects
        const el = this.candidate ?? this.elementAt(e.clientX, e.clientY);
        if (el) this.commitSelect(el);
      } else if (this.tool === "pin") {
        this.commit(this.store.addPin(e.clientX, e.clientY).n);
      } else if (this.tool === "box" && this.dragStart) {
        const r = normalise(this.dragStart, { x: e.clientX, y: e.clientY });
        this.dragStart = null;
        drag.style.display = "none";
        if (r.width >= 4 && r.height >= 4) this.commit(this.store.addBox(r).n);
      }
    });
    layer.addEventListener("pointerleave", () => {
      this.hoverPoint = null;
      if (this.tool === "select" && !this.candidateLocked) this.setCandidate(null);
    });
    layer.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  private commitSelect(el: Element): void {
    this.commit(this.store.addSelect(el).n);
  }

  /** The annotation exists: put the tool away and let the host open its popover. */
  private commit(n: number): void {
    this.set(null);
    this.host.annotated(n);
  }
}
