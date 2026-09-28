/**
 * The launcher (PRD F-7, F-81, F-82): the pill that toggles the overlay, with the health dot. It
 * is dragged anywhere — a click that is not a drag toggles, as do Enter and Space — stays inside
 * the window, and its spot is kept in localStorage. The dock (status, lists, toolbar) sits above
 * it, and page-level popovers and the welcome card above the dock (F-68, F-82).
 *
 * The dot (F-81) is one `GET /__crt/health` at mount, when the tab becomes visible again and after
 * any failed CRT request — never on a timer; its state and tooltip come from health.ts's
 * `deriveHealth` over that answer, the provider list and the project this tab first saw.
 */
import type { ProviderRow } from "../../server/src/session-events.js";
import { clamp, setStyle } from "./dom-util.js";
import { crtPort, deriveHealth, fetchHealth, type HealthPayload, type HealthState, rememberServer } from "./health.js";
import { safeGetJson, safeSet } from "./storage.js";

const LAUNCHER_KEY = "crt.launcher.v1";
const EDGE = 16;

/** Distances from the window's right and bottom edges. */
export interface LauncherPos {
  right: number;
  bottom: number;
}

/** A stored position, or null when it is missing or not two finite numbers. */
export function parseLauncherPos(value: unknown): LauncherPos | null {
  const p = value as Partial<Record<keyof LauncherPos, unknown>> | null;
  return typeof p?.right === "number" && typeof p.bottom === "number" && Number.isFinite(p.right) && Number.isFinite(p.bottom)
    ? { right: p.right, bottom: p.bottom }
    : null;
}

/** Keep the launcher reachable: at most 60 px short of the window's left edge and 40 px of its top. */
export function clampLauncher(pos: LauncherPos, viewport: { width: number; height: number }): LauncherPos {
  return {
    right: clamp(pos.right, 0, Math.max(0, viewport.width - 60)),
    bottom: clamp(pos.bottom, 0, Math.max(0, viewport.height - 40)),
  };
}

export interface LauncherHost {
  /** A click that was not a drag, or Enter / Space. */
  toggle(): void;
  /** N-3: a drag started (true) or ended; the positioning loop runs while it lasts. */
  dragging(on: boolean): void;
  /** The launcher and the dock moved: docked popovers follow. */
  moved(): void;
  /** F-56: the provider list's row for health's provider — its name and N-7 line go in the tooltip. */
  row(providerId: string | null): ProviderRow | undefined;
}

export class Launcher {
  private pos: LauncherPos;
  /** F-81: the last health answer; null until the first one lands. */
  health: HealthPayload | "failed" | null = null;
  /** F-81 Should: the project this tab first saw, from sessionStorage; null before the first answer. */
  private firstProjectRoot: string | null = null;

  constructor(
    readonly el: HTMLElement,
    private readonly dock: HTMLElement,
    private readonly host: LauncherHost,
  ) {
    this.pos = parseLauncherPos(safeGetJson("local", LAUNCHER_KEY)) ?? { right: EDGE, bottom: EDGE };
    window.addEventListener("resize", () => this.place());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") void this.checkHealth();
    });
    this.wire();
  }

  /** One `GET /__crt/health`; paints the dot from the answer and the last provider list. */
  async checkHealth(): Promise<HealthPayload | "failed"> {
    const h = await fetchHealth();
    this.health = h;
    if (h !== "failed" && this.firstProjectRoot === null) this.firstProjectRoot = rememberServer(h) ?? h.projectRoot;
    this.paintHealth();
    return h;
  }

  /** The dot and its tooltip for what is known now (a fresh provider list repaints it). */
  paintHealth(): void {
    const h = this.health;
    const row = this.host.row(h && h !== "failed" ? h.provider : null);
    const view = deriveHealth({ health: h, agentName: row?.displayName ?? null, problem: row?.problem ?? null, firstProjectRoot: this.firstProjectRoot, port: crtPort() });
    this.el.dataset.health = view.state;
    this.el.title = view.tooltip;
  }

  /** The dot's state as painted (tests). */
  healthState(): HealthState {
    return (this.el.dataset.health as HealthState | undefined) ?? "checking";
  }

  /** Clamp to the window and move the launcher and the dock (the dock's offset is the launcher's height, a layout read). */
  place(): void {
    const { right, bottom } = (this.pos = clampLauncher(this.pos, { width: window.innerWidth, height: window.innerHeight }));
    this.el.style.right = `${right}px`;
    this.el.style.bottom = `${bottom}px`;
    this.dock.style.right = `${right}px`;
    this.dock.style.bottom = `${bottom + this.el.offsetHeight + 8}px`;
    this.host.moved();
  }

  /** Where docked popovers end: above the launcher, and above the dock while it is open (a layout read). */
  dockedBottom(): number {
    return this.pos.bottom + this.el.offsetHeight + 8 + (this.dock.hidden ? 0 : this.dock.offsetHeight + 8);
  }

  /** The write half of placing the docked popovers and the welcome card (N-3: `dockedBottom` was read with the other reads). */
  placeDocked(pops: HTMLElement[], welcome: HTMLElement | null, bottom: number): void {
    const right = `${this.pos.right}px`;
    for (const pop of pops) {
      setStyle(pop, "right", right);
      setStyle(pop, "bottom", `${bottom}px`);
      setStyle(pop, "maxHeight", `${Math.max(120, window.innerHeight - bottom - 8)}px`);
    }
    if (welcome) {
      // F-82: the card sits where a page-level popover would, so it never covers the launcher or the dock.
      setStyle(welcome, "right", right);
      setStyle(welcome, "bottom", `${bottom}px`);
    }
  }

  private wire(): void {
    let start: { x: number; y: number; right: number; bottom: number } | null = null;
    let dragged = false;
    this.el.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY, ...this.pos };
      dragged = false;
      this.el.setPointerCapture(e.pointerId);
    });
    this.el.addEventListener("pointermove", (e) => {
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (!dragged && Math.hypot(dx, dy) < 4) return;
      if (!dragged) {
        dragged = true;
        this.host.dragging(true);
      }
      this.pos = { right: start.right - dx, bottom: start.bottom - dy };
      this.place();
    });
    const finish = (e: PointerEvent) => {
      if (!start) return;
      start = null;
      this.host.dragging(false);
      if (this.el.hasPointerCapture(e.pointerId)) this.el.releasePointerCapture(e.pointerId);
      if (dragged) safeSet("local", LAUNCHER_KEY, JSON.stringify(this.pos));
      else this.host.toggle();
    };
    this.el.addEventListener("pointerup", finish);
    this.el.addEventListener("pointercancel", finish);
    // The launcher is a <button>; keyboard activation toggles without a pointer sequence.
    this.el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.host.toggle();
      }
    });
  }
}
