// MAIN world, document_start: what the console/network hooks and the framework lookups need.
window.__spikeMainRanAt = performance.now();
window.__spikeMainSawPageScript = typeof window.__pageScriptRan !== "undefined";
window.addEventListener("DOMContentLoaded", () => {
  const el = document.getElementById("probe");
  const key = el && Object.keys(el).find((k) => k.startsWith("__reactFiber$"));
  // one-way: page world -> isolated world, as data
  window.postMessage({ crtSpike: "main", fiberKey: key ?? null }, location.origin);
});
