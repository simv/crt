import { describe, expect, it } from "vitest";
import { placePopover, POPOVER_GAP, POPOVER_MARGIN } from "../../overlay/src/popover.js";

const viewport = { width: 1280, height: 800 };
const size = { width: 360, height: 180 };

describe("popover placement (F-65)", () => {
  it("prefers the right of the marker, top-aligned (F-65)", () => {
    const p = placePopover({ x: 100, y: 200, width: 200, height: 100 }, size, viewport);
    expect(p).toEqual({ x: 300 + POPOVER_GAP, y: 200, side: "right" });
  });

  it("falls back to the left when the right does not fit (F-65)", () => {
    const p = placePopover({ x: 1000, y: 200, width: 200, height: 100 }, size, viewport);
    expect(p).toEqual({ x: 1000 - POPOVER_GAP - size.width, y: 200, side: "left" });
  });

  it("goes below, then above, when neither side fits a wide element (F-65)", () => {
    const wide = { x: 20, y: 100, width: 1240, height: 60 };
    expect(placePopover(wide, size, viewport)).toEqual({ x: 20, y: 160 + POPOVER_GAP, side: "below" });
    const wideLow = { x: 20, y: 700, width: 1240, height: 60 };
    expect(placePopover(wideLow, size, viewport)).toEqual({ x: 20, y: 700 - POPOVER_GAP - size.height, side: "above" });
  });

  it("clamps the cross axis so the popover stays inside the viewport (F-65)", () => {
    // Near the bottom: right fits horizontally, but y must move up.
    const p = placePopover({ x: 100, y: 750, width: 100, height: 40 }, size, viewport);
    expect(p.side).toBe("right");
    expect(p.y).toBe(viewport.height - size.height - POPOVER_MARGIN);
    // A wide element ending near the right edge: neither side fits, so below, with x pulled left.
    const q = placePopover({ x: 100, y: 100, width: 1170, height: 40 }, { width: 360, height: 180 }, viewport);
    expect(q.side).toBe("below");
    expect(q.x).toBe(100);
    const r = placePopover({ x: 1000, y: 100, width: 270, height: 40 }, { width: 1100, height: 180 }, viewport);
    expect(r.side).toBe("below");
    expect(r.x).toBe(viewport.width - 1100 - POPOVER_MARGIN);
  });

  it("clamps both axes when nothing fits (element fills the viewport) (F-65)", () => {
    const p = placePopover({ x: 0, y: 0, width: 1280, height: 800 }, size, viewport);
    expect(p).toEqual({ x: viewport.width - size.width - POPOVER_MARGIN, y: POPOVER_MARGIN, side: "right" });
  });

  it("handles a pin (1×1 anchor) like any other marker (F-65)", () => {
    const p = placePopover({ x: 400, y: 300, width: 1, height: 1 }, size, viewport);
    expect(p).toEqual({ x: 401 + POPOVER_GAP, y: 300, side: "right" });
  });
});
