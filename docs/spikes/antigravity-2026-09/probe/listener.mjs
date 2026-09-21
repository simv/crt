// Throwaway HTTP listener on 127.0.0.1 for the CRT-0023 spike: logs every request.
import { appendFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";

const PORT = Number(process.argv[2] || 47123);
const LOG = process.argv[3];
if (!LOG) { console.error("usage: node listener.mjs <port> <log-file>"); process.exit(2); }
let n = 0;
const server = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    n += 1;
    appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), n, method: req.method, url: req.url, headers: req.headers, body }) + "\n");
    res.setHeader("content-type", "text/plain");
    res.end(`pong #${n}`);
  });
});
server.listen(PORT, "127.0.0.1", () => {
  writeFileSync(LOG + ".ready", String(PORT));
  console.log(`listening on 127.0.0.1:${PORT}`);
});
