// Spike runner: node run.mjs  (Playwright's Chromium; see ../extension-2026-11.md)
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const here = dirname(fileURLToPath(import.meta.url));
const seen = [];
// stands in for the CRT server: no CORS headers for a non-loopback Origin, like http.ts applyCors
const crt = createServer((req, res) => {
  seen.push({ method: req.method, url: req.url, origin: req.headers.origin ?? null });
  if (req.url === "/__crt/events") {
    res.writeHead(200, { "content-type": "text/event-stream" });
    let n = 0;
    const t = setInterval(() => { res.write(`data: ${++n}\n\n`); if (n === 3) { clearInterval(t); res.end(); } }, 400);
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true }));
}).listen(0, "127.0.0.1");
await new Promise((r) => crt.once("listening", r));
const crtOrigin = `http://127.0.0.1:${crt.address().port}`;

const CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; frame-src 'none'";
const app = createServer((req, res) => {
  if (req.url === "/app.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(`window.__pageScriptRan = true; document.addEventListener("DOMContentLoaded", () => { document.getElementById("probe")["__reactFiber$abc"] = { type: "Probe" }; }, { capture: true });
      fetch(${JSON.stringify(crtOrigin)} + "/__crt/health").then(() => (window.__pageFetch = "allowed"), (e) => (window.__pageFetch = "refused: " + e.message));`);
    return;
  }
  res.writeHead(200, { "content-type": "text/html", "content-security-policy": CSP });
  res.end(`<!doctype html><html data-crt="${crtOrigin}"><head><script src="/app.js"></script></head><body><h1 id="probe">app under a strict policy</h1></body></html>`);
}).listen(0, "127.0.0.1");
await new Promise((r) => app.once("listening", r));
const appPort = app.address().port;

const ext = join(here, "ext");
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "crt-ext-spike-")), {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, `--host-resolver-rules=MAP app.example.test 127.0.0.1`],
});
const results = {};
for (const [name, url] of [["loopback page", `http://127.0.0.1:${appPort}/`], ["page on another host name", `http://app.example.test:${appPort}/`]]) {
  seen.length = 0;
  const page = await ctx.newPage();
  await page.goto(url);
  await page.waitForFunction(() => document.documentElement.dataset.spike, null, { timeout: 15000 });
  results[name] = {
    pageWorld: await page.evaluate(() => ({ mainRanBeforePageScript: window.__spikeMainSawPageScript === false, pageFetchToCrt: window.__pageFetch })),
    extension: JSON.parse(await page.evaluate(() => document.documentElement.dataset.spike)),
    serverSaw: seen.map((s) => `${s.method} ${s.url} Origin: ${s.origin}`),
  };
  await page.close();
}
console.log(JSON.stringify({ chromium: ctx.browser()?.version() ?? (await ctx.newPage().then((p) => p.evaluate(() => navigator.userAgent))), results }, null, 2));
await ctx.close();
crt.close(); app.close();
