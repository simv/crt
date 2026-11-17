chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  (async () => {
    if (msg.kind === "fetch") {
      const res = await fetch(msg.url, { method: msg.method, headers: { "content-type": "application/json" }, body: JSON.stringify(msg.body) });
      reply({ status: res.status, json: await res.json() });
    } else if (msg.kind === "shot") {
      try {
        const url = await chrome.tabs.captureVisibleTab(sender.tab.windowId, { format: "png" });
        reply({ ok: true, prefix: url.slice(0, 22), chars: url.length });
      } catch (err) { reply({ ok: false, error: String(err.message ?? err) }); }
    }
  })();
  return true;
});
chrome.runtime.onConnect.addListener((port) => {
  port.onMessage.addListener(async (m) => {
    const res = await fetch(m.url);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      port.postMessage({ data: dec.decode(value).trim() });
    }
    port.postMessage({ done: true });
  });
});
