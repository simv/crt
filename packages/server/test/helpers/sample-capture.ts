/** A valid capture bundle / POST body shared by the schema, store, proxy and e2e tests. */
import type { CaptureBundle, CapturePost } from "../../src/capture-schema.js";

/** 1×1 transparent PNG. */
export const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export function sampleBundle(): CaptureBundle {
  return {
    version: 1,
    id: "",
    page: {
      url: "http://localhost:4400/cart?promo=SAVE10#top",
      pathname: "/cart",
      query: "?promo=SAVE10",
      hash: "#top",
      title: "Cart",
      viewport: { width: 1280, height: 720 },
      devicePixelRatio: 2,
      userAgent: "Mozilla/5.0 test",
      timestamp: "2026-09-15T00:00:00.000Z",
      scroll: { x: 0, y: 120 },
    },
    framework: { name: "next", version: "15.0.0", bundler: "webpack", route: "/cart", hints: ["window.__NEXT_DATA__"] },
    annotations: [
      {
        n: 1,
        kind: "select",
        note: "total excludes discount",
        rect: { x: 10, y: 20, width: 100, height: 30 },
        point: null,
        element: {
          selector: "#total",
          xpath: "/html/body/div/span",
          tag: "span",
          id: "total",
          classes: ["cart-total"],
          dataset: { testid: "total" },
          role: null,
          ariaLabel: null,
          text: "$90.00",
          rect: { x: 10, y: 20, width: 100, height: 30 },
          styles: { display: "inline", color: "rgb(0, 0, 0)" },
          components: [{ name: "CartSummary", kind: "function" }],
          source: { file: "src/components/Cart.tsx", line: 88, column: 5, via: "debug_source" },
          componentFramework: "react",
          outerHtml: '<span id="total" class="cart-total">$90.00</span>',
          parentOuterHtml: "<div>…</div>",
          detached: false,
        },
        elements: [],
        image: "ann-1.png",
      },
      {
        n: 2,
        kind: "pin",
        note: "missing a coupon field here",
        rect: { x: 300, y: 400, width: 1, height: 1 },
        point: { x: 300, y: 400 },
        element: null,
        elements: [],
        image: "ann-2.png",
      },
    ],
    console: [
      { level: "error", message: "boom", stack: null, timestamp: "2026-09-15T00:00:00.000Z", url: "http://localhost:4400/cart" },
    ],
    screenshots: { viewport: "viewport.png", annotated: "viewport-annotated.png", error: null },
  };
}

export function samplePost(): CapturePost {
  return {
    bundle: sampleBundle(),
    images: { "viewport.png": PNG_B64, "viewport-annotated.png": PNG_B64, "ann-1.png": PNG_B64, "ann-2.png": PNG_B64 },
  };
}
