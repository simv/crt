// Throwaway stdio MCP server for the CRT-0009 spike.
// Logs its environment and every JSON-RPC message to PROBE_LOG, answers
// initialize / tools/list / tools/call for one tool (crt_ping) that POSTs to
// http://127.0.0.1:PROBE_PORT/ping and returns whatever the listener says.
import { appendFileSync } from "node:fs";
import { request } from "node:http";

const LOG = process.env.PROBE_LOG;
const PORT = Number(process.env.PROBE_PORT || 0);

function log(kind, data) {
  if (!LOG) return;
  appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), kind, data }) + "\n");
}

log("spawned", {
  argv: process.argv,
  cwd: process.cwd(),
  pid: process.pid,
  ppid: process.ppid,
  env: process.env,
});

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
  log("out", msg);
}

function ping(payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = request(
      { host: "127.0.0.1", port: PORT, path: "/ping", method: "POST", headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body) } },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ ok: true, status: res.statusCode, text }));
      },
    );
    req.on("error", (err) => resolve({ ok: false, error: String(err && err.code || err) }));
    req.setTimeout(5000, () => { req.destroy(new Error("timeout")); });
    req.end(body);
  });
}

// Spawn-time reachability check: same process that will serve tools/call.
ping({ from: "mcp-probe spawn", pid: process.pid }).then((r) => log("spawn-ping", r));

let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) handle(line);
  }
});
process.stdin.on("end", () => { log("stdin-end", {}); process.exit(0); });

async function handle(line) {
  let msg;
  try { msg = JSON.parse(line); } catch (e) { log("bad-json", line); return; }
  log("in", msg);
  const { id, method, params } = msg;
  if (method === "initialize") {
    send({ jsonrpc: "2.0", id, result: {
      protocolVersion: params && params.protocolVersion || "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "crt-probe", version: "0.0.0" },
    } });
  } else if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: [{
      name: "crt_ping",
      description: "Ping the CRT server on 127.0.0.1 and return its reply. Call it exactly once when asked to ping.",
      inputSchema: { type: "object", properties: { message: { type: "string", description: "Any short message" } }, required: ["message"] },
    }] } });
  } else if (method === "tools/call") {
    const r = await ping({ tool: params && params.name, args: params && params.arguments });
    log("ping-result", r);
    const text = r.ok ? `listener replied ${r.status}: ${r.text}` : `listener unreachable: ${r.error}`;
    send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text }], isError: !r.ok } });
  } else if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
  } else if (id !== undefined && method) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method ${method}` } });
  }
}
