import { describe, expect, it } from "vitest";
import { detectComponents, nearestComponentName } from "../../overlay/src/component.js";

// N-3 (CRT-0039): the hover label's cheap name path must name what Send's full detection names
// first (F-18), without reading a React 19 `_debugStack.stack`. The fixtures are fiber graphs in
// the shapes React 18 and 19 dev builds leave on DOM nodes (see the /react page in
// e2e/fixture/server.mjs for the React 18 tree), built by hand because the unit tests have no DOM.

type Node = { parentElement: Node | null; [key: string]: unknown };

const FORWARD_REF = Symbol.for("react.forward_ref");
const MEMO = Symbol.for("react.memo");

/** A DOM-ish node carrying a fiber under React's hashed key, as `fiberOf` finds it. */
function host(fiber: object | null, parent: Node | null = null): Element {
  const node: Node = { parentElement: parent };
  if (fiber) node["__reactFiber$x7k2"] = fiber;
  return node as unknown as Element;
}

function fiber(type: unknown, owner: object | null, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { tag: typeof type === "string" ? 5 : 0, type, elementType: type, return: null, _debugOwner: owner, ...extra };
}

/** A React 19 `_debugStack` whose `.stack` reads are counted (reading it is what makes V8 format the trace). */
function counted(stack: string, reads: { n: number }): { stack: string } {
  return {
    get stack() {
      reads.n++;
      return stack;
    },
  };
}

const same = (el: Element) => detectComponents(el).components[0]?.name ?? null;

describe("nearestComponentName, the hover label's cheap path (N-3, F-18)", () => {
  describe("React 18 dev build (_debugSource)", () => {
    const src = (line: number) => ({ fileName: "src/components/Shop.jsx", lineNumber: line, columnNumber: 5 });
    function App() {}
    function Shop() {}
    class Card {}
    (Card.prototype as { isReactComponent?: object }).isReactComponent = {};
    function Price() {}
    const FancyButton = { $$typeof: FORWARD_REF, render: function FancyButton() {} };
    const MemoDesc = { $$typeof: MEMO, type: function Desc() {} };
    const app = fiber(App, null, { _debugSource: src(1) });
    const shop = fiber(Shop, app, { _debugSource: src(5) });
    const card = fiber(Card, shop, { tag: 1, _debugSource: src(11) });
    const price = fiber(Price, card, { _debugSource: src(23) });
    const fancy = fiber(FancyButton, card, { tag: 11, _debugSource: src(24) });
    const desc = fiber(MemoDesc.type, card, { tag: 15, elementType: MemoDesc, _debugSource: src(22) });

    it("names the owner of a function component's element (Price)", () => {
      const el = host(fiber("span", price, { _debugSource: src(30) }));
      expect(nearestComponentName(el)).toBe("Price");
      expect(nearestComponentName(el)).toBe(same(el));
    });

    it("names forwardRef and memo wrappers by their inner name, as the full chain does", () => {
      const button = host(fiber("button", fancy, { _debugSource: src(40) }));
      const p = host(fiber("p", desc, { _debugSource: src(50) }));
      expect([nearestComponentName(button), nearestComponentName(p)]).toEqual(["FancyButton", "Desc"]);
      expect([nearestComponentName(button), nearestComponentName(p)]).toEqual([same(button), same(p)]);
    });

    it("names a class component's own element (Card) and walks up to the nearest node with a fiber", () => {
      const article = host(fiber("article", card, { _debugSource: src(20) }));
      const inner = host(null, article as unknown as Node);
      expect(nearestComponentName(article)).toBe("Card");
      expect(nearestComponentName(inner)).toBe("Card");
      expect(nearestComponentName(inner)).toBe(same(inner));
    });

    it("skips unnamed owners and, without owner info (a production build), walks the parent tree", () => {
      const anonymous = fiber(() => undefined, card); // an inline arrow has no name
      const viaAnonymous = host(fiber("em", anonymous));
      expect(nearestComponentName(viaAnonymous)).toBe("Card");
      expect(nearestComponentName(viaAnonymous)).toBe(same(viaAnonymous));

      const prodCard = { tag: 1, type: Card, elementType: Card, return: null };
      const prodArticle = { tag: 5, type: "article", elementType: "article", return: prodCard };
      const prodSpan = host({ tag: 5, type: "span", elementType: "span", return: prodArticle });
      expect(nearestComponentName(prodSpan)).toBe("Card");
      expect(nearestComponentName(prodSpan)).toBe(same(prodSpan));
    });

    it("is null for a fiber with no named component anywhere, even with Vue on an ancestor", () => {
      const vueParent: Node = { parentElement: null, __vueParentComponent: { type: { name: "VueThing" } } };
      const el = host({ tag: 5, type: "div", elementType: "div", return: null, _debugOwner: null }, vueParent);
      expect(nearestComponentName(el)).toBeNull();
      expect(same(el)).toBeNull();
    });
  });

  describe("React 19 dev build (_debugStack, server components)", () => {
    const at = (file: string, line: number) =>
      `Error: react-stack-top-frame\n    at exports.jsxDEV (webpack-internal:///(app-pages-browser)/./node_modules/react/cjs/react-jsx-dev-runtime.development.js:339:32)\n    at X (webpack-internal:///(app-pages-browser)/./${file}:${line}:12)`;

    function build() {
      const reads = { n: 0 };
      const layout = { name: "RootLayout", env: "Server", owner: null, debugStack: counted(at("app/layout.tsx", 12), reads) };
      const page = { name: "HomePage", env: "Server", owner: layout, debugStack: counted(at("app/page.tsx", 16), reads) };
      const unnamed = { name: "", env: "Server", owner: page, debugStack: counted(at("app/unnamed.tsx", 1), reads) };
      function CartSummary() {}
      const cart = fiber(CartSummary, page, { _debugStack: counted(at("components/Cart.tsx", 88), reads) });
      const client = host(fiber("strong", cart, { _debugStack: counted(at("components/Cart.tsx", 90), reads) }));
      const server = host(fiber("h1", page, { _debugStack: counted(at("app/page.tsx", 20), reads) }));
      const viaUnnamed = host(fiber("footer", unnamed, { _debugStack: counted(at("app/unnamed.tsx", 3), reads) }));
      return { reads, client, server, viaUnnamed };
    }

    it("names the client component that owns the element, and never reads a stack", () => {
      const f = build();
      expect(nearestComponentName(f.client)).toBe("CartSummary");
      expect(f.reads.n).toBe(0);
      expect(same(f.client)).toBe("CartSummary");
      expect(f.reads.n).toBeGreaterThan(0); // the full detection reads it for the source (F-18)
    });

    it("names server-component owners and skips an unnamed one, as the full chain does", () => {
      const f = build();
      expect([nearestComponentName(f.server), nearestComponentName(f.viaUnnamed)]).toEqual(["HomePage", "HomePage"]);
      expect(f.reads.n).toBe(0);
      expect([same(f.server), same(f.viaUnnamed)]).toEqual(["HomePage", "HomePage"]);
    });
  });

  describe("Vue and plain pages", () => {
    it("names the nearest named Vue 3 and Vue 2 component", () => {
      const v3: Node = { parentElement: null, __vueParentComponent: { type: {}, parent: { type: { __name: "ProductCard" }, parent: { type: { name: "App" } } } } };
      const v2: Node = { parentElement: null, __vue__: { $options: {}, $parent: { $options: { _componentTag: "cart-summary" } } } };
      const in3 = { parentElement: v3 } as unknown as Element;
      const in2 = v2 as unknown as Element;
      expect([nearestComponentName(in3), nearestComponentName(in2)]).toEqual(["ProductCard", "cart-summary"]);
      expect([nearestComponentName(in3), nearestComponentName(in2)]).toEqual([same(in3), same(in2)]);
    });

    it("is null on a page with no framework", () => {
      const el = host(null, host(null) as unknown as Node);
      expect(nearestComponentName(el)).toBeNull();
      expect(same(el)).toBeNull();
    });
  });
});
