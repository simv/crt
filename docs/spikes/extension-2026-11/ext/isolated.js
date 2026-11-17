// ISOLATED world: where the overlay UI and the bridge to the service worker would live.
const out = { world: "isolated" };
window.addEventListener("message", (e) => {
  if (e.source === window && e.data && e.data.crtSpike === "main") out.fiberKeyFromMain = e.data.fiberKey;
});
window.addEventListener("DOMContentLoaded", async () => {
  const el = document.getElementById("probe");
  out.fiberKeySeenInIsolated = Object.keys(el).find((k) => k.startsWith("__reactFiber$")) ?? null;
  out.pageGlobalSeenInIsolated = typeof window.__pageScriptRan !== "undefined";
  const crt = document.documentElement.dataset.crt;
  // direct fetch from the content script (the page's network context)
  try { out.directFetch = (await (await fetch(crt + "/__crt/health")).json()).ok; } catch (err) { out.directFetch = "refused: " + err.message; }
  // through the service worker
  out.viaWorker = await chrome.runtime.sendMessage({ kind: "fetch", url: crt + "/__crt/captures", method: "POST", body: { hello: 1 } });
  // an event stream relayed over a port
  out.events = await new Promise((resolve) => {
    const port = chrome.runtime.connect({ name: "sse" });
    const got = [];
    port.onMessage.addListener((m) => { if (m.done) resolve(got); else got.push({ t: Math.round(performance.now()), data: m.data }); });
    port.postMessage({ url: crt + "/__crt/events" });
  });
  out.screenshot = await chrome.runtime.sendMessage({ kind: "shot" });
  // UI in a shadow root under the page's strict style-src
  const host = document.createElement("div");
  const root = host.attachShadow({ mode: "closed" });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync("button{position:fixed;right:16px;bottom:16px;background:rgb(1,2,3)}");
  root.adoptedStyleSheets = [sheet];
  const b = document.createElement("button"); b.textContent = "CRT"; root.append(b);
  document.documentElement.append(host);
  out.styled = getComputedStyle(b).backgroundColor;
  document.documentElement.dataset.spike = JSON.stringify(out);
});
