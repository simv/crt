// Tiny stand-in for a dev server, used by the Playwright e2e and the proxy unit tests
// (PRD §9: "static fixture app behind the proxy"). Node built-ins only, so CI installs nothing.
//
// Routes:
//   GET  /              HTML, identity encoding, has <head> and <body>
//   GET  /gzip          same HTML, gzip-encoded (when the client accepts gzip)
//   GET  /br            same HTML, brotli-encoded (when the client accepts br)
//   GET  /chunked       HTML streamed in pieces, no Content-Length
//   GET  /nohead        HTML fragment with neither <head> nor <body>
//   GET  /csp           HTML with a Content-Security-Policy that forbids scripts
//   GET  /redirect      302 → http://localhost:<port>/ (absolute, points at the fixture itself)
//   GET  /app           annotation playground: ids, classes, data-*, ARIA, a fixed header, long
//                       scroll, a console.error + uncaught error, a failing fetch/XHR and a missing
//                       image fired at load (M2 capture spec, F-21)
//   GET  /script-tag    the page from / but loading the overlay from ?crt=<origin> with a script
//                       tag instead of through the proxy (F-6)
//   GET  /react         React 18 dev build (UMD from node_modules) rendering a small component tree
//                       with __source set, for the fiber-walk spec (F-18)
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

// The UMD builds are not in React's `exports` map, so locate the package dir via package.json.
const require = createRequire(import.meta.url);
const pkgDir = (name) => dirname(require.resolve(`${name}/package.json`));
const VENDOR = {
  "/vendor/react.development.js": () => join(pkgDir("react"), "umd", "react.development.js"),
  "/vendor/react-dom.development.js": () => join(pkgDir("react-dom"), "umd", "react-dom.development.js"),
};

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

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
    switch (path) {
      case "/":
        return html(PAGE);
      case "/app":
        return html(APP_PAGE);
      case "/react":
        return html(REACT_PAGE);
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
        const crt = new URL(req.url ?? "/", "http://x").searchParams.get("crt") ?? "";
        const tag = `<script src="${crt}/__crt/overlay.js" defer></script>`;
        return html(PAGE.replace("</head>", `${tag}</head>`));
      }
      case "/csp":
        return html(PAGE, { "content-security-policy": "default-src 'none'; script-src 'nonce-abc'" });
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
