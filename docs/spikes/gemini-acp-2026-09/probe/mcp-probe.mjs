// Throwaway stdio MCP server for the CRT-0013 spike: the shape of `crt mcp` (one tool,
// `write_task`, the real F-49 schema) without a CRT server behind it. Logs its environment and
// every JSON-RPC message to PROBE_LOG so the spike can see what an ACP agent hands its MCP
// servers (cwd, env, protocol version) and whether the model reaches the tool.
import { appendFileSync } from "node:fs";
import { writeTaskJsonSchema, WRITE_TASK_DESCRIPTION, WRITE_TASK_TOOL } from "../../../../packages/server/dist/write-task.js";

const LOG = process.env.PROBE_LOG;

function log(kind, data) {
  if (!LOG) return;
  appendFileSync(LOG, JSON.stringify({ t: new Date().toISOString(), kind, data }) + "\n");
}

log("spawned", { argv: process.argv, cwd: process.cwd(), pid: process.pid, ppid: process.ppid, env: process.env });

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
  log("out", msg);
}

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
process.stdin.on("end", () => {
  log("stdin-end", {});
  process.exit(0);
});

let calls = 0;
function handle(line) {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    log("bad-json", line);
    return;
  }
  log("in", msg);
  const { id, method, params } = msg;
  if (method === "initialize") {
    send({ jsonrpc: "2.0", id, result: { protocolVersion: (params && params.protocolVersion) || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "crt-probe", version: "0.0.0" } } });
  } else if (method === "tools/list") {
    send({ jsonrpc: "2.0", id, result: { tools: [{ name: WRITE_TASK_TOOL, description: WRITE_TASK_DESCRIPTION, inputSchema: writeTaskJsonSchema() }] } });
  } else if (method === "tools/call") {
    calls += 1;
    log("write_task-call", { n: calls, name: params && params.name, args: params && params.arguments });
    send({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `Task CRT-9999 written to .crt/tasks/CRT-9999-probe.md (probe #${calls})` }] } });
  } else if (method === "ping") {
    send({ jsonrpc: "2.0", id, result: {} });
  } else if (id !== undefined && method) {
    send({ jsonrpc: "2.0", id, error: { code: -32601, message: `unknown method ${method}` } });
  }
}
