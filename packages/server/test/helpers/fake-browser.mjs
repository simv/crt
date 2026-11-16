// A stand-in for Chrome behind `--remote-debugging-pipe` (PRD-zero F-125, F-126, F-128), spawned by
// test/browser.test.ts through `fakeBrowser()` (fake-cli.ts): it reads NUL-terminated JSON on fd 3
// and answers on fd 4, the way the real browser does. Node built-ins only.
//
// FAKE_BROWSER (the mode):
//   exit     print a line on stderr and exit 1 at once (the F-125 "exits" line)
//   silent   never answer anything (the F-125 "no answer" line)
//   ok       speak enough of the protocol for CrtBrowser: one paused about:blank tab (T1/S1) after
//            Target.setAutoAttach, a new one per Target.createTarget, and for every Page.navigate a
//            paused document response carrying a Content-Security-Policy. A URL containing
//            `close-window` makes the process exit, like a closed window; Browser.close exits too.
//   restored the same, plus a tab (T9/S9) that is already on http://localhost:3000/restored when
//            CRT attaches — what a browser restoring its last session looks like.
// FAKE_BROWSER_LOG: a file every received message is appended to, one JSON object per line, after
// a first line holding the process arguments.
import { appendFileSync } from "node:fs";
import { Socket } from "node:net";

const mode = process.env.FAKE_BROWSER ?? "ok";
const logFile = process.env.FAKE_BROWSER_LOG;
const record = (entry) => {
  if (logFile) appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
};
record({ argv: process.argv.slice(2) });

if (mode === "exit") {
  process.stderr.write("some earlier noise\nfake-browser: cannot open display\n");
  process.exit(1);
}

const input = new Socket({ fd: 3, readable: true, writable: false });
const output = new Socket({ fd: 4, readable: false, writable: true });
const send = (msg) => output.write(`${JSON.stringify(msg)}\0`);

if (mode === "silent") {
  input.resume();
} else {
  const targets = new Map([["T1", { sessionId: "S1", url: "about:blank" }]]);
  let requests = 0;
  if (mode === "restored") targets.set("T9", { sessionId: "S9", url: "http://localhost:3000/restored" });
  const attach = (targetId) =>
    send({ method: "Target.attachedToTarget", params: { sessionId: targets.get(targetId).sessionId, waitingForDebugger: true, targetInfo: { targetId, type: "page", url: targets.get(targetId).url } } });
  const handle = (msg) => {
    record(msg);
    const reply = (result = {}) => send({ id: msg.id, result, ...(msg.sessionId ? { sessionId: msg.sessionId } : {}) });
    switch (msg.method) {
      case "Target.setAutoAttach":
        reply();
        for (const targetId of [...targets.keys()]) attach(targetId);
        return;
      case "Target.getTargets":
        return reply({ targetInfos: [...targets].map(([targetId, t]) => ({ targetId, type: "page", url: t.url })) });
      case "Target.createTarget": {
        const n = [...targets.keys()].filter((id) => id !== "T9").length + 1;
        const targetId = `T${n}`;
        targets.set(targetId, { sessionId: `S${n}`, url: "about:blank" });
        reply({ targetId });
        return attach(targetId);
      }
      case "Page.navigate": {
        const [targetId, target] = [...targets].find(([, t]) => t.sessionId === msg.sessionId);
        target.url = msg.params.url;
        reply({ frameId: targetId });
        if (msg.params.url.includes("close-window")) return process.exit(0);
        // The document response, paused: gzip on the wire, a strict policy, and a cookie that must survive.
        return send({
          method: "Fetch.requestPaused",
          sessionId: msg.sessionId,
          params: {
            requestId: `R${++requests}`,
            frameId: targetId,
            resourceType: "Document",
            request: { url: msg.params.url },
            responseStatusCode: 200,
            responseHeaders: [
              { name: "Content-Type", value: "text/html" },
              { name: "Content-Security-Policy", value: "default-src 'self'" },
              { name: "Content-Encoding", value: "gzip" },
              { name: "Set-Cookie", value: "a=1" },
            ],
          },
        });
      }
      case "Fetch.getResponseBody":
        return reply({ body: Buffer.from("<html></html>").toString("base64"), base64Encoded: true });
      case "Browser.close":
        reply();
        return process.exit(0);
      default:
        return reply();
    }
  };
  let pending = Buffer.alloc(0);
  input.on("data", (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    for (let i = pending.indexOf(0); i !== -1; i = pending.indexOf(0)) {
      handle(JSON.parse(pending.subarray(0, i).toString("utf8")));
      pending = pending.subarray(i + 1);
    }
  });
  // The pipe closing is CRT going away: a real browser exits with it.
  input.on("end", () => process.exit(0));
  input.on("error", () => process.exit(0));
}
