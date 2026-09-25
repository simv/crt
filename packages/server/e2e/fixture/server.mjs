// Tiny stand-in for a dev server, used by the Playwright e2e and the proxy unit tests
// (PRD §9: "static fixture app behind the proxy"). Node built-ins only, so CI installs nothing.
//
// PRD-embedded F-110 (M18): the pages an app would carry the CRT integration on — /, /app and
// /react — load the CRT loader first in <head> from the origin they are told: `?crt=<origin>` on
// the request, else FIXTURE_CRT_ORIGIN in the environment (playwright.config.ts sets it to the
// primary embedded server). A request that arrives through `crt proxy` (x-forwarded-host set) gets
// no tag, so the proxy server injects into the same pages it always did; the unit tests start the
// fixture without the variable and see the plain pages.
//
// Routes:
//   GET  /              HTML, identity encoding, has <head> and <body>
//   GET  /gzip          same HTML, gzip-encoded (when the client accepts gzip)
//   GET  /br            same HTML, brotli-encoded (when the client accepts br)
//   GET  /chunked       HTML streamed in pieces, no Content-Length
//   GET  /nohead        HTML fragment with neither <head> nor <body>
//   GET  /csp           HTML with a Content-Security-Policy that forbids scripts
//   GET  /csp-strict    HTML with a 'strict-dynamic' CSP: the injected overlay tag is blocked by the
//                       browser even after CRT relaxes the header (PRD-setup F-80)
//   GET  /csp-meta      HTML whose CSP sits in a <meta http-equiv> tag, which CRT cannot rewrite (F-80)
//   GET  /redirect      302 → http://localhost:<port>/ (absolute, points at the fixture itself)
//   GET  /app           annotation playground: ids, classes, data-*, ARIA, a fixed header, long
//                       scroll, a console.error + uncaught error, a failing fetch/XHR and a missing
//                       image fired at load (M2 capture spec, F-21)
//   GET  /script-tag    the page from / but loading the overlay from ?crt=<origin> with a script
//                       tag instead of through the proxy (F-6)
//   GET  /embedded      the /app playground in embedded mode (PRD-embedded F-95, F-96): a
//                       console.error fired before the loader tag (missed by design — F-95), then
//                       <script src="<?crt=origin>/__crt/loader.js"> first in <head>, then a
//                       console.error fired before the overlay executes (captured by the loader's hooks)
//   GET  /embedded-bundled  the /app playground with <script src="/embedded-bundle.js"> first in
//                       <head>: the ESM loader bundled by the embedded spec (Playwright fulfils that
//                       URL), so the pill exists without a server (F-96 step 6)
//   GET  /fonts         a heading in a font whose @font-face comes from a cross-origin stylesheet
//                       (the other loopback host) sent without CORS headers: the page renders it,
//                       CRT's rasteriser cannot fetch it (F-21, CRT-0038)
//   GET  /fonts.css     that stylesheet: one @font-face over local() fonts, no Access-Control-Allow-Origin
//   GET  /react         React 18 dev build (UMD from node_modules) rendering a small component tree
//                       with __source set, for the fiber-walk spec (F-18)
//   GET  /shop          the trial app's shop page (tool-validation) on the same React dev build: the
//                       page npm run screenshots pictures (PRD-polish F-116, N-27; CRT-0029)
//   GET  /vendor/*.js   react.development.js / react-dom.development.js
//   GET  /api/json      application/json
//   GET  /echo-headers  JSON of the request headers as received
//   POST /echo          echoes the request body back as application/octet-stream
//   GET  /ws (upgrade)  WebSocket echo: text/binary frames come straight back
//   anything else       404 text/plain

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { brotliCompressSync, gzipSync } from "node:zlib";

const PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>CRT fixture</title>
</head>
<body>
  <h1 id="heading">CRT fixture app</h1>
  <p>Served by packages/server/e2e/fixture/server.mjs</p>
  <script>window.__fixture = "ok";</script>
</body>
</html>
`;

const APP_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>CRT fixture app</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; }
    header.top { position: fixed; top: 0; left: 0; right: 0; height: 48px; background: #223; color: #fff;
                 display: flex; align-items: center; padding: 0 16px; }
    main { padding: 64px 16px 16px; }
    .card { border: 1px solid #ccc; border-radius: 8px; padding: 12px; margin: 12px 0; width: 320px; }
    .card .price { font-weight: bold; color: #063; }
    .spacer { height: 1600px; background: linear-gradient(#fff, #eee); }
    #footer-note { padding: 12px; background: #ffd; }
  </style>
</head>
<body>
  <header class="top" id="top-bar"><strong>Fixture shop</strong></header>
  <main>
    <h1 id="heading">CRT fixture app</h1>
    <section class="cards" data-section="products" aria-label="Products">
      <article class="card" data-product-id="p-1" data-testid="card-1">
        <h2 class="title">Widget</h2>
        <p class="desc">A fine widget.</p>
        <span class="price" role="text" aria-label="Price of Widget">$10.00</span>
        <button type="button" class="buy">Buy</button>
      </article>
      <article class="card featured" data-product-id="p-2" data-testid="card-2">
        <h2 class="title">Gadget</h2>
        <p class="desc">An even finer gadget.</p>
        <span class="price">$20.00</span>
        <button type="button" class="buy">Buy</button>
      </article>
    </section>
    <div class="spacer"></div>
    <p id="footer-note">Bottom of the page.</p>
  </main>
  <img id="missing-img" src="/missing.png" alt="" width="1" height="1">
  <script>
    window.__fixture = "app";
    console.error("fixture: something went wrong %s", "at load");
    console.warn("fixture: a warning");
    setTimeout(() => { throw new Error("fixture: uncaught boom"); }, 0);
    Promise.reject(new Error("fixture: rejected"));
    fetch("/api/missing").catch(() => {});
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/save");
    xhr.send("{}");
  </script>
</body>
</html>
`;

const FONTS_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>CRT fixture fonts</title>
  <link rel="stylesheet" href="__FONTS_CSS__">
  <style>h1 { font-family: "CrtFixtureFont", sans-serif; }</style>
</head>
<body>
  <h1 id="heading">A heading in a cross-origin font</h1>
</body>
</html>
`;

// local() only, so the page needs no font file: Windows has Arial, the Linux CI runner Liberation
// Sans or DejaVu Sans, macOS Helvetica.
const FONTS_CSS = `@font-face { font-family: "CrtFixtureFont"; src: local("Arial"), local("Liberation Sans"), local("DejaVu Sans"), local("Helvetica"); }
`;

const REACT_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>CRT fixture react</title>
</head>
<body>
  <div id="root"></div>
  <script src="/vendor/react.development.js"></script>
  <script src="/vendor/react-dom.development.js"></script>
  <script>
    // Hand-written createElement calls with __source, as the JSX dev transform would emit.
    const h = (type, props, ...children) => React.createElement(type, props, ...children);
    const src = (line) => ({ fileName: "src/components/Shop.jsx", lineNumber: line, columnNumber: 5 });
    function Price({ value }) {
      return h("span", { className: "price", __source: src(30) }, "$" + value.toFixed(2));
    }
    const FancyButton = React.forwardRef(function FancyButton(props, ref) {
      return h("button", { ref, type: "button", className: "buy", __source: src(40) }, props.children);
    });
    const MemoDesc = React.memo(function Desc({ text }) {
      return h("p", { className: "desc", __source: src(50) }, text);
    });
    class Card extends React.Component {
      render() {
        return h("article", { className: "card", "data-product-id": this.props.id, __source: src(20) },
          h("h2", { className: "title", __source: src(21) }, this.props.title),
          h(MemoDesc, { text: this.props.desc, __source: src(22) }),
          h(Price, { value: this.props.price, __source: src(23) }),
          h(FancyButton, { __source: src(24) }, "Buy"));
      }
    }
    function Shop() {
      return h("section", { className: "cards", __source: src(10) },
        h(Card, { id: "p-1", title: "Widget", desc: "A fine widget.", price: 10, __source: src(11) }),
        h(Card, { id: "p-2", title: "Gadget", desc: "An even finer gadget.", price: 20, __source: src(12) }));
    }
    function App() { return h(Shop, { __source: src(5) }); }
    ReactDOM.createRoot(document.getElementById("root")).render(h(App, { __source: src(1) }));
  </script>
</body>
</html>
`;

// PRD-polish F-116 (CRT-0029): the page `npm run screenshots` pictures — the trial app's shop
// (C:\Projects\Claude\tool-validation, a Next.js page) ported here so the screenshots are
// reproducible from this repo alone (N-27): its markup and CSS as they are there, rendered with the
// React 18 dev build as the same four components (Header, Shop, ProductCard, CartSummary, with
// __source) so the overlay's hover label reads the component name, as it does on the real app.
// The cart holds one notebook with SAVE10 applied and a total that ignores the discount — the trial
// app's deliberate bug, the thing the screenshots' notes point at.
const SHOP_PAGE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Tool Validation Shop</title>
  <style>
    :root {
      --bg: #f6f7f9;
      --card: #ffffff;
      --ink: #1b1f24;
      --muted: #6b7280;
      --accent: #2563eb;
      --danger: #dc2626;
      --ok: #16a34a;
      --border: #e5e7eb;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink);
                 font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; font-size: 16px; line-height: 1.5; }
    a { color: var(--accent); }
    main { max-width: 960px; margin: 0 auto; padding: 24px 16px 64px; }
    h1, h2, h3 { margin: 0 0 8px; }
    button { font: inherit; cursor: pointer; border-radius: 6px; border: 1px solid var(--border); background: var(--card); padding: 8px 14px; }
    button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
    button.danger { border-color: var(--danger); color: var(--danger); }
    .site-header { background: var(--card); border-bottom: 1px solid var(--border); padding: 12px 16px; }
    .site-header .inner { max-width: 960px; margin: 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .site-header nav a { margin-left: 16px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
    .card { background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 16px; display: flex; flex-direction: column; gap: 8px; }
    .card .thumb { height: 96px; border-radius: 8px; background: linear-gradient(135deg, #dbeafe, #e0e7ff); }
    .card .price { font-weight: 600; }
    .card .price.sale { color: var(--ok); }
    .card .was { color: var(--muted); text-decoration: line-through; margin-left: 6px; font-weight: 400; }
    .summary { margin-top: 32px; background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 16px; max-width: 420px; }
    .summary dl { display: grid; grid-template-columns: 1fr auto; gap: 6px 16px; margin: 0 0 12px; }
    .summary dd { margin: 0; text-align: right; }
    .summary .total { font-weight: 700; font-size: 18px; }
    .summary .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #dcfce7; color: var(--ok); font-size: 13px; margin-left: 8px; }
    .actions { margin-top: 32px; display: flex; flex-wrap: wrap; gap: 12px; }
    .status { margin-top: 12px; color: var(--muted); min-height: 24px; }
    .muted { color: var(--muted); }
    footer.site-footer { border-top: 1px solid var(--border); padding: 16px; text-align: center; color: var(--muted); font-size: 14px; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script src="/vendor/react.development.js"></script>
  <script src="/vendor/react-dom.development.js"></script>
  <script>
    // The trial app's components, as the JSX dev transform would emit them (__source per element).
    const h = React.createElement;
    const at = (fileName, lineNumber) => ({ fileName, lineNumber, columnNumber: 5 });
    const PRODUCTS = [
      { id: "mug", name: "Enamel mug", description: "Holds 350 ml. Dishwasher safe, campfire approved.", price: 14 },
      { id: "notebook", name: "Dot-grid notebook", description: "A5, 160 pages, lay-flat binding.", price: 12, salePrice: 9 },
      { id: "pen", name: "Brass pen", description: "Refillable, takes standard cartridges.", price: 28 },
    ];
    const PROMOS = { SAVE10: 10 };
    const effectivePrice = (p) => p.salePrice ?? p.price;
    const money = (n) => "$" + n.toFixed(2);

    function Header() {
      const f = "components/Header.tsx";
      return h("header", { className: "site-header", __source: at(f, 5) },
        h("div", { className: "inner", __source: at(f, 6) },
          h("strong", { id: "brand", __source: at(f, 7) }, "Tool Validation Shop"),
          h("nav", { "aria-label": "Main", __source: at(f, 8) },
            h("a", { href: "/shop", __source: at(f, 9) }, "Shop"),
            h("a", { href: "#about", __source: at(f, 10) }, "About"))));
    }

    function ProductCard({ product, onAdd }) {
      const f = "components/ProductCard.tsx";
      const onSale = product.salePrice !== undefined;
      return h("article", { className: "card", "data-testid": "card-" + product.id, __source: at(f, 6) },
        h("div", { className: "thumb", "aria-hidden": "true", __source: at(f, 7) }),
        h("h3", { __source: at(f, 8) }, product.name),
        h("p", { className: "muted", __source: at(f, 9) }, product.description),
        h("div", { className: onSale ? "price sale" : "price", __source: at(f, 10) },
          money(effectivePrice(product)),
          onSale ? h("span", { className: "was", __source: at(f, 12) }, money(product.price)) : null),
        h("button", { type: "button", onClick: () => onAdd(product.id), __source: at(f, 14) }, "Add to cart"));
    }

    function CartSummary({ items, promo }) {
      const f = "components/CartSummary.tsx";
      const lines = PRODUCTS.filter((p) => items[p.id]).map((p) => ({ product: p, qty: items[p.id], amount: effectivePrice(p) * items[p.id] }));
      const subtotal = lines.reduce((sum, l) => sum + l.amount, 0);
      const discountPct = promo ? (PROMOS[promo] ?? 0) : 0;
      const discount = (subtotal * discountPct) / 100;
      // BUG (deliberate, as in the trial app): the total ignores the discount that is shown as applied.
      const total = subtotal;
      return h("section", { className: "summary", "aria-label": "Cart summary", __source: at(f, 12) },
        h("h2", { __source: at(f, 13) }, "Cart", promo && discountPct > 0 ? h("span", { className: "badge", __source: at(f, 15) }, promo + " applied") : null),
        lines.length === 0
          ? h("p", { className: "muted", __source: at(f, 18) }, "Nothing in the cart yet.")
          : h("dl", { __source: at(f, 20) },
              ...lines.map((l) => h("div", { key: l.product.id, style: { display: "contents" }, __source: at(f, 22) },
                h("dt", { __source: at(f, 23) }, l.product.name + " × " + l.qty),
                h("dd", { __source: at(f, 26) }, money(l.amount)))),
              h("dt", { __source: at(f, 29) }, "Subtotal"),
              h("dd", { className: "subtotal", __source: at(f, 30) }, money(subtotal)),
              h("dt", { __source: at(f, 31) }, "Discount"),
              h("dd", { className: "discount", __source: at(f, 32) }, "−" + money(discount)),
              h("dt", { className: "total", __source: at(f, 33) }, "Total"),
              h("dd", { className: "total", "data-testid": "cart-total", __source: at(f, 34) }, money(total))));
    }

    function Shop() {
      const f = "components/Shop.tsx";
      const [items, setItems] = React.useState({ notebook: 1 });
      const [promoInput, setPromoInput] = React.useState("SAVE10");
      const [promo, setPromo] = React.useState("SAVE10");
      const [status, setStatus] = React.useState("");
      const add = (id) => setItems((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
      const applyPromo = () => {
        const code = promoInput.trim().toUpperCase();
        if (PROMOS[code]) { setPromo(code); setStatus("Promo " + code + " applied."); }
        else { setPromo(null); setStatus('Unknown promo code "' + code + '".'); console.warn("promo rejected", code); }
      };
      const checkout = async () => {
        setStatus("Checking out…");
        try {
          const res = await fetch("/api/checkout", { method: "POST", body: JSON.stringify({ items, promo }) });
          if (!res.ok) throw new Error("checkout failed with " + res.status);
          setStatus("Order placed.");
        } catch (err) {
          console.error("checkout error", err);
          setStatus("Checkout failed: " + err.message);
        }
      };
      const explode = () => { setTimeout(() => { throw new Error("Deliberate uncaught error from the Explode button"); }, 0); };
      return h(React.Fragment, null,
        h("section", { "aria-label": "Products", __source: at(f, 46) },
          h("h2", { __source: at(f, 47) }, "Products"),
          h("div", { className: "grid", __source: at(f, 48) },
            ...PRODUCTS.map((p) => h(ProductCard, { key: p.id, product: p, onAdd: add, __source: at(f, 50) })))),
        h(CartSummary, { items, promo, __source: at(f, 55) }),
        h("div", { className: "actions", __source: at(f, 57) },
          h("label", { __source: at(f, 58) }, "Promo code ",
            h("input", { value: promoInput, onChange: (e) => setPromoInput(e.target.value), "aria-label": "Promo code", __source: at(f, 60) })),
          h("button", { type: "button", onClick: applyPromo, __source: at(f, 62) }, "Apply"),
          h("button", { type: "button", className: "primary", onClick: checkout, "data-testid": "checkout", __source: at(f, 65) }, "Checkout"),
          h("button", { type: "button", className: "danger", onClick: explode, "data-testid": "explode", __source: at(f, 68) }, "Explode"),
          h("button", { type: "button", onClick: () => setItems({}), __source: at(f, 71) }, "Empty cart")),
        h("p", { className: "status", role: "status", __source: at(f, 75) }, status));
    }

    function HomePage() {
      const f = "app/page.tsx";
      return h("main", { __source: at(f, 5) },
        h("h1", { id: "heading", __source: at(f, 6) }, "A small shop, for pointing at things"),
        h("p", { className: "muted", __source: at(f, 7) },
          "Every element here exists to be annotated with CRT. The cart has a deliberate bug (the total ignores the applied discount),",
          h("strong", { __source: at(f, 9) }, " Checkout"), " hits an API route that always fails, and ",
          h("strong", { __source: at(f, 9) }, "Explode"), " throws an uncaught error."),
        h(Shop, { __source: at(f, 11) }),
        h("footer", { className: "site-footer", __source: at(f, 12) }, "tool-validation · not a real shop"));
    }

    function RootLayout() {
      const f = "app/layout.tsx";
      return h(React.Fragment, null, h(Header, { __source: at(f, 15) }), h(HomePage, { __source: at(f, 16) }));
    }
    ReactDOM.createRoot(document.getElementById("root")).render(h(RootLayout, { __source: at("app/layout.tsx", 12) }));
    window.__fixture = "shop";
  </script>
</body>
</html>
`;

// The UMD builds are not in React's `exports` map, so locate the package dir via package.json.
const require = createRequire(import.meta.url);
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));
const VENDOR = {
  "/vendor/react.development.js": () => join(pkgDir("react"), "umd", "react.development.js"),
  "/vendor/react-dom.development.js": () => join(pkgDir("react-dom"), "umd", "react-dom.development.js"),
};

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/**
 * The origin of `value` when it is an http(s) URL on a loopback host (the F-6 list), else null.
 * The fixture writes this into <script src> attributes, so only a re-serialised, allowlisted origin
 * ever gets there — never the request's own text.
 * @param {string | null | undefined} value
 * @returns {string | null}
 */
export function loopbackOrigin(value) {
  if (!value) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const host = url.hostname;
  if (host !== "localhost" && !host.endsWith(".localhost") && host !== "127.0.0.1" && host !== "[::1]") return null;
  return url.origin;
}

/**
 * @param {{ port?: number }} [opts]
 * @returns {Promise<{ port: number, url: string, close(): Promise<void> }>}
 */
export function startFixture(opts = {}) {
  const server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const accepts = String(req.headers["accept-encoding"] ?? "");
    const html = (body, extra = {}) => {
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(Buffer.byteLength(body)),
        ...extra,
      });
      res.end(body);
    };
    const query = new URL(req.url ?? "/", "http://x").searchParams;
    /** `?crt=<origin>` as a validated loopback origin (never the raw string: it lands in HTML), or null. */
    const queryOrigin = loopbackOrigin(query.get("crt"));
    /** The CRT origin this page should load the loader from, or null for the plain page (F-110). */
    const loaderOrigin = queryOrigin ?? (req.headers["x-forwarded-host"] ? null : loopbackOrigin(process.env.FIXTURE_CRT_ORIGIN));
    const withLoader = (body) => (loaderOrigin ? body.replace("<head>\n", `<head>\n  <script src="${loaderOrigin}/__crt/loader.js"></script>\n`) : body);
    switch (path) {
      case "/":
        return html(withLoader(PAGE));
      case "/app":
        return html(withLoader(APP_PAGE));
      case "/fonts": {
        // The stylesheet lives on the other loopback host, so it is cross-origin whichever one the page is on.
        const other = String(req.headers.host ?? "").startsWith("127.0.0.1") ? "localhost" : "127.0.0.1";
        return html(withLoader(FONTS_PAGE.replace("__FONTS_CSS__", `http://${other}:${server.address().port}/fonts.css`)));
      }
      case "/fonts.css":
        res.writeHead(200, { "content-type": "text/css", "content-length": String(Buffer.byteLength(FONTS_CSS)) });
        return res.end(FONTS_CSS);
      case "/react":
        return html(withLoader(REACT_PAGE));
      case "/shop":
        return html(withLoader(SHOP_PAGE));
      case "/gzip": {
        if (!/\bgzip\b/.test(accepts)) return html(PAGE);
        const gz = gzipSync(PAGE);
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-encoding": "gzip",
          "content-length": String(gz.length),
        });
        return res.end(gz);
      }
      case "/br": {
        if (!/\bbr\b/.test(accepts)) return html(PAGE);
        const br = brotliCompressSync(PAGE);
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "content-encoding": "br",
          "content-length": String(br.length),
        });
        return res.end(br);
      }
      case "/chunked": {
        res.writeHead(200, { "content-type": "text/html" });
        const parts = PAGE.match(/[\s\S]{1,40}/g) ?? [PAGE];
        let i = 0;
        const tick = () => {
          if (i < parts.length) {
            res.write(parts[i++]);
            setTimeout(tick, 2);
          } else res.end();
        };
        return tick();
      }
      case "/nohead":
        return html("<p>no head, no body</p>");
      case "/script-tag": {
        const crt = queryOrigin ?? "";
        const tag = `<script src="${crt}/__crt/overlay.js" defer></script>`;
        return html(PAGE.replace("</head>", `${tag}</head>`));
      }
      case "/embedded": {
        const crt = queryOrigin ?? "";
        const head = [
          `<script>console.error("fixture: before the loader");</script>`,
          `<script src="${crt}/__crt/loader.js"></script>`,
          `<script>console.error("fixture: after the loader, before the overlay");</script>`,
        ].join("\n  ");
        return html(APP_PAGE.replace("<head>\n", `<head>\n  ${head}\n`));
      }
      case "/embedded-bundled":
        return html(APP_PAGE.replace("<head>\n", `<head>\n  <script src="/embedded-bundle.js"></script>\n`));
      case "/csp":
        return html(PAGE, { "content-security-policy": "default-src 'none'; script-src 'nonce-abc'" });
      case "/csp-strict":
        return html(PAGE, { "content-security-policy": "script-src 'nonce-abc' 'strict-dynamic'" });
      case "/csp-meta":
        return html(PAGE.replace("<title>", `<meta http-equiv="Content-Security-Policy" content="script-src 'none'">\n  <title>`));
      case "/redirect":
        res.writeHead(302, { location: `http://localhost:${server.address().port}/?from=redirect` });
        return res.end();
      case "/api/json":
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ hello: "world" }));
      case "/echo-headers":
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify(req.headers));
      case "/echo": {
        const chunks = [];
        req.on("data", (c) => chunks.push(c));
        req.on("end", () => {
          const body = Buffer.concat(chunks);
          res.writeHead(200, { "content-type": "application/octet-stream", "content-length": String(body.length) });
          res.end(body);
        });
        return;
      }
      default: {
        const vendor = VENDOR[path];
        if (vendor) {
          const js = readFileSync(vendor());
          res.writeHead(200, { "content-type": "text/javascript", "content-length": String(js.length) });
          return res.end(js);
        }
        res.writeHead(404, { "content-type": "text/plain" });
        return res.end(`fixture: no route ${path}`);
      }
    }
  });

  server.on("upgrade", (req, socket, head) => {
    if ((req.url ?? "").split("?")[0] !== "/ws") {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    const key = req.headers["sec-websocket-key"];
    const accept = createHash("sha1").update(key + WS_GUID).digest("base64");
    socket.write(
      [
        "HTTP/1.1 101 Switching Protocols",
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Accept: ${accept}`,
        "",
        "",
      ].join("\r\n"),
    );
    let buf = head.length ? Buffer.from(head) : Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const frame = readFrame(buf);
        if (!frame) break;
        buf = buf.subarray(frame.size);
        if (frame.opcode === 0x8) {
          socket.end(encodeFrame(0x8, frame.payload));
          return;
        }
        if (frame.opcode === 0x9) socket.write(encodeFrame(0xa, frame.payload));
        else if (frame.opcode === 0x1 || frame.opcode === 0x2) socket.write(encodeFrame(frame.opcode, frame.payload));
      }
    });
    socket.on("error", () => socket.destroy());
  });

  return new Promise((resolve) => {
    server.listen(opts.port ?? 0, "127.0.0.1", () => {
      const port = server.address().port;
      resolve({
        port,
        url: `http://localhost:${port}`,
        close: () =>
          new Promise((r) => {
            server.closeAllConnections();
            server.close(() => r());
          }),
      });
    });
  });
}

/** Parse one (client → server, masked) frame from the front of `buf`, or return null if incomplete. */
export function readFrame(buf) {
  if (buf.length < 2) return null;
  const opcode = buf[0] & 0x0f;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f;
  let off = 2;
  if (len === 126) {
    if (buf.length < 4) return null;
    len = buf.readUInt16BE(2);
    off = 4;
  } else if (len === 127) {
    if (buf.length < 10) return null;
    len = Number(buf.readBigUInt64BE(2));
    off = 10;
  }
  const maskLen = masked ? 4 : 0;
  if (buf.length < off + maskLen + len) return null;
  const mask = masked ? buf.subarray(off, off + 4) : null;
  const payload = Buffer.from(buf.subarray(off + maskLen, off + maskLen + len));
  if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
  return { opcode, payload, size: off + maskLen + len };
}

/** Encode one frame. Server → client frames are unmasked; pass `mask` to build a client frame. */
export function encodeFrame(opcode, payload, mask = null) {
  const len = payload.length;
  const header = [0x80 | opcode];
  const maskBit = mask ? 0x80 : 0;
  if (len < 126) header.push(maskBit | len);
  else if (len < 65536) header.push(maskBit | 126, len >> 8, len & 0xff);
  else {
    header.push(maskBit | 127);
    const b = Buffer.alloc(8);
    b.writeBigUInt64BE(BigInt(len));
    header.push(...b);
  }
  if (!mask) return Buffer.concat([Buffer.from(header), payload]);
  const body = Buffer.from(payload);
  for (let i = 0; i < body.length; i++) body[i] ^= mask[i & 3];
  return Buffer.concat([Buffer.from(header), mask, body]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.FIXTURE_PORT ?? 3999);
  startFixture({ port }).then((f) => console.log(`fixture listening at ${f.url}`));
}
