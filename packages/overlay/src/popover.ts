/**
 * Popover placement (PRD F-65): where a note/chat popover goes relative to the annotation it
 * belongs to. Pure — takes rectangles, returns a position — so it is unit-tested from
 * `packages/server/test/popover.test.ts` without a DOM.
 *
 * Order of preference: to the right of the marker, then to the left, then below, then above;
 * the first side where the popover fits inside the viewport wins, with the cross axis clamped so
 * the popover never leaves the viewport. When no side fits (a huge element, a tiny window) the
 * right-hand position is clamped on both axes, which keeps the popover reachable.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Size {
  width: number;
  height: number;
}

export type Side = "right" | "left" | "below" | "above";

export interface Placement {
  x: number;
  y: number;
  side: Side;
}

/** Distance between the marker edge and the popover, and the minimum gap to the viewport edge. */
export const POPOVER_GAP = 12;
export const POPOVER_MARGIN = 8;

export function placePopover(anchor: Box, size: Size, viewport: Size, gap = POPOVER_GAP, margin = POPOVER_MARGIN): Placement {
  const clampX = (x: number) => clamp(x, margin, Math.max(margin, viewport.width - size.width - margin));
  const clampY = (y: number) => clamp(y, margin, Math.max(margin, viewport.height - size.height - margin));
  const fitsX = (x: number) => x >= margin && x + size.width <= viewport.width - margin;
  const fitsY = (y: number) => y >= margin && y + size.height <= viewport.height - margin;

  const right = anchor.x + anchor.width + gap;
  if (fitsX(right)) return { x: right, y: clampY(anchor.y), side: "right" };
  const left = anchor.x - gap - size.width;
  if (fitsX(left)) return { x: left, y: clampY(anchor.y), side: "left" };
  const below = anchor.y + anchor.height + gap;
  if (fitsY(below)) return { x: clampX(anchor.x), y: below, side: "below" };
  const above = anchor.y - gap - size.height;
  if (fitsY(above)) return { x: clampX(anchor.x), y: above, side: "above" };
  return { x: clampX(right), y: clampY(anchor.y), side: "right" };
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
