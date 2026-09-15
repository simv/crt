import { describe, expect, it } from "vitest";
import { parseOwnerStack } from "../../overlay/src/component.js";

// F-18 on React ≥ 19: `_debugStack` replaces `_debugSource`. The parser is pure, so it is unit-tested
// here against the stack shapes the browsers and bundlers actually produce.

describe("parseOwnerStack (F-18, React 19)", () => {
  it("skips React/JSX-runtime frames and returns the first app frame under Next.js webpack dev", () => {
    const stack = [
      "Error: react-stack-top-frame",
      "    at exports.jsxDEV (webpack-internal:///(app-pages-browser)/./node_modules/react/cjs/react-jsx-dev-runtime.development.js:339:32)",
      "    at CartSummary (webpack-internal:///(app-pages-browser)/./src/components/Cart.tsx:88:102)",
      "    at react_stack_bottom_frame (webpack-internal:///(app-pages-browser)/./node_modules/react-dom/cjs/react-dom-client.development.js:23055:20)",
    ].join("\n");
    expect(parseOwnerStack(stack)).toEqual({ file: "src/components/Cart.tsx", line: 88, column: 102, via: "owner_stack" });
  });

  it("strips React 19 server-component and webpack module-id decorations", () => {
    const stack =
      "Error\n    at jsx (webpack-internal:///(rsc)/./node_modules/react/cjs/react-jsx-runtime.development.js:1:1)\n    at SiteHeader (about://React/Server/webpack-internal:///(rsc)/./components/SiteHeader.tsx?39:93:92)";
    expect(parseOwnerStack(stack)).toEqual({ file: "components/SiteHeader.tsx", line: 93, column: 92, via: "owner_stack" });
  });

  it("handles anonymous V8 frames, Firefox format and file URLs", () => {
    expect(parseOwnerStack("Error\n    at http://localhost:3000/_next/static/chunks/app_page_tsx.js:12:5")).toEqual({
      file: "http://localhost:3000/_next/static/chunks/app_page_tsx.js",
      line: 12,
      column: 5,
      via: "owner_stack",
    });
    expect(parseOwnerStack("jsxDEV@http://x/node_modules/react/jsx-dev-runtime.js:1:1\nPrice@file:///C:/app/src/Price.jsx:30:7")).toEqual({
      file: "C:/app/src/Price.jsx",
      line: 30,
      column: 7,
      via: "owner_stack",
    });
  });

  it("returns null when every frame is framework code", () => {
    expect(parseOwnerStack("Error\n    at jsx (http://x/node_modules/react/jsx-runtime.js:1:1)\n    at <anonymous>")).toBeNull();
  });
});
