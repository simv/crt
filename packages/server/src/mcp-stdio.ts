/**
 * `crt mcp` (PRD-providers §5.3, F-49, N-8, N-11): a stdio MCP server with exactly one tool,
 * `write_task`, for every provider that is not driven in-process. The agent spawns it as
 * `node <dist/cli.js> mcp` (`mcpLaunch()` below builds that command line) and the shim forwards
 * each call to the running CRT server at `POST /__crt/internal/write-task` on 127.0.0.1 with the
 * session's bearer token. Token and port arrive through the **environment** (`CRT_MCP_TOKEN`,
 * `CRT_MCP_PORT`) — never on the command line, never in a URL, never logged.
 *
 * The protocol is hand-rolled newline-delimited JSON-RPC 2.0 over stdin/stdout (no runtime
 * dependency, N-11): `initialize`, `notifications/initialized`, `ping`, `tools/list`,
 * `tools/call`; anything else answers -32601. stdout carries protocol frames only; every
 * diagnostic goes to stderr. The official MCP TypeScript client drives it in
 * test/mcp-stdio.test.ts (the F-49 contract test).
 */
import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import type { WriteTaskRequest } from "./session-events.js";
import { CRT_MCP_SERVER, parseWriteTaskRequest, WRITE_TASK_DESCRIPTION, WRITE_TASK_TOOL, writeTaskJsonSchema } from "./write-task.js";

/** Newest first. `initialize` echoes the client's version when it is here, else `[0]`. */
export const MCP_PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"] as const;
export const INTERNAL_WRITE_TASK_PATH = "/__crt/internal/write-task";
export const MCP_TOKEN_ENV = "CRT_MCP_TOKEN";
export const MCP_PORT_ENV = "CRT_MCP_PORT";
/** N-7: what the agent reads back when the server no longer knows the token. */
export const STALE_TOKEN_LINE = "write_task was called with a stale token — the session had ended";
export const MCP_ENV_MISSING = `crt mcp: ${MCP_TOKEN_ENV} and ${MCP_PORT_ENV} must be set — this command is started by an intake session's agent, not by hand`;

type JsonRpcId = string | number | null;
interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: JsonRpcId;
  method: string;
  params?: unknown;
}
export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

/** What `tools/call` returns: MCP text content, `isError` when the write did not happen. */
export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

/** Outcome of forwarding one `write_task` to the server (`forwardWriteTask`, or a test double). */
export type ForwardResult = { ok: true; id: string; path: string } | { ok: false; error: string };

export interface McpStdioOptions {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  env: NodeJS.ProcessEnv;
  /** Reported as `serverInfo.version`. */
  version?: string;
  /** Where diagnostics go (stderr). */
  stderr?: (line: string) => void;
  /** Replaces the HTTP forward (tests). */
  forward?: (request: WriteTaskRequest, target: { token: string; port: number }) => Promise<ForwardResult>;
}

/**
 * F-49: the command line and environment a provider hands its agent so the agent can spawn CRT's
 * `write_task` server. `node` is this process's own executable (N-10: never a `.cmd` shim).
 */
export function mcpLaunch(token: string, port: number): { command: string; args: string[]; env: Record<string, string> } {
  return {
    command: process.execPath,
    args: [fileURLToPath(new URL("./cli.js", import.meta.url)), "mcp"],
    env: { [MCP_TOKEN_ENV]: token, [MCP_PORT_ENV]: String(port) },
  };
}

/**
 * Run the server over the given streams until `input` ends. Resolves with the exit code:
 * 2 when the environment lacks the token or port (one stderr line), else 0 once every in-flight
 * call has been answered.
 */
export function runMcpStdio(opts: McpStdioOptions): Promise<number> {
  const stderr = opts.stderr ?? ((line) => process.stderr.write(`${line}\n`));
  const token = opts.env[MCP_TOKEN_ENV];
  const port = Number(opts.env[MCP_PORT_ENV]);
  if (!token || !Number.isInteger(port) || port < 1 || port > 65535) {
    stderr(MCP_ENV_MISSING);
    return Promise.resolve(2);
  }
  const server = new McpStdioServer({ token, port }, opts.version ?? packageVersion(), opts.forward ?? forwardWriteTask);
  const inflight = new Set<Promise<void>>();
  const write = (response: JsonRpcResponse) => {
    opts.output.write(`${JSON.stringify(response)}\n`);
  };
  return new Promise((resolve) => {
    // Frames are UTF-8 lines; the decoder keeps a multi-byte character split across chunks intact.
    const decoder = new StringDecoder("utf8");
    let buffer = "";
    const handleLine = (line: string) => {
      const p = server.handle(line).then((response) => {
        if (response) write(response);
      });
      inflight.add(p);
      void p.finally(() => inflight.delete(p));
    };
    opts.input.on("data", (chunk: Buffer | string) => {
      buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
      let idx: number;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, "");
        buffer = buffer.slice(idx + 1);
        if (line.trim()) handleLine(line);
      }
    });
    opts.input.on("end", () => {
      buffer += decoder.end();
      if (buffer.trim()) handleLine(buffer);
      buffer = "";
      void Promise.allSettled([...inflight]).then(() => resolve(0));
    });
    opts.input.on("error", (err: Error) => {
      stderr(`crt mcp: stdin failed (${err.message})`);
      resolve(1);
    });
  });
}

/** The JSON-RPC dispatcher, one instance per process; `handle()` is pure apart from the forward. */
export class McpStdioServer {
  constructor(
    private readonly target: { token: string; port: number },
    private readonly version: string,
    private readonly forward: (request: WriteTaskRequest, target: { token: string; port: number }) => Promise<ForwardResult>,
  ) {}

  /** One raw line in, one response out (null for notifications and for nothing-to-say). */
  async handle(line: string): Promise<JsonRpcResponse | null> {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return { jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } };
    }
    if (!isRequest(msg)) {
      const id = msg && typeof msg === "object" && !Array.isArray(msg) ? idOf((msg as { id?: unknown }).id) : null;
      return { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request" } };
    }
    const id = msg.id === undefined ? undefined : idOf(msg.id);
    if (id === undefined) {
      // A notification: `notifications/initialized` and anything else get no reply (JSON-RPC §4.1).
      return null;
    }
    const params = (msg.params ?? {}) as Record<string, unknown>;
    switch (msg.method) {
      case "initialize": {
        const asked = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
        const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(asked) ? asked : MCP_PROTOCOL_VERSIONS[0];
        return { jsonrpc: "2.0", id, result: { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: CRT_MCP_SERVER, version: this.version } } };
      }
      case "ping":
        return { jsonrpc: "2.0", id, result: {} };
      case "tools/list":
        return { jsonrpc: "2.0", id, result: { tools: [{ name: WRITE_TASK_TOOL, description: WRITE_TASK_DESCRIPTION, inputSchema: writeTaskJsonSchema() }] } };
      case "tools/call": {
        if (params.name !== WRITE_TASK_TOOL) {
          return { jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool: ${String(params.name)}` } };
        }
        return { jsonrpc: "2.0", id, result: await this.callWriteTask(params.arguments) };
      }
      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
    }
  }

  private async callWriteTask(args: unknown): Promise<ToolResult> {
    const parsed = parseWriteTaskRequest(args ?? {});
    if (!parsed.ok) return { content: [{ type: "text", text: `write_task failed: ${parsed.error}` }], isError: true };
    let r: ForwardResult;
    try {
      r = await this.forward(parsed.value, this.target);
    } catch (err) {
      r = { ok: false, error: (err as Error).message };
    }
    if (!r.ok) return { content: [{ type: "text", text: r.error === STALE_TOKEN_LINE ? r.error : `write_task failed: ${r.error}` }], isError: true };
    return { content: [{ type: "text", text: `Task ${r.id} written to ${r.path}` }] };
  }
}

/** POST the request to the server with the bearer token; maps the route's answers to one line each. */
export function forwardWriteTask(request: WriteTaskRequest, target: { token: string; port: number }): Promise<ForwardResult> {
  return new Promise((resolve) => {
    const body = JSON.stringify(request);
    const req = httpRequest(
      {
        host: "127.0.0.1",
        port: target.port,
        method: "POST",
        path: INTERNAL_WRITE_TASK_PATH,
        headers: {
          authorization: `Bearer ${target.token}`,
          "content-type": "application/json",
          "content-length": String(Buffer.byteLength(body)),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          if (status === 404) return resolve({ ok: false, error: STALE_TOKEN_LINE });
          let data: { ok?: boolean; id?: string; path?: string; error?: string } = {};
          try {
            data = JSON.parse(Buffer.concat(chunks).toString("utf8")) as typeof data;
          } catch {
            // an empty or non-JSON body is reported by status below
          }
          if (status >= 200 && status < 300 && data.ok && data.id && data.path) return resolve({ ok: true, id: data.id, path: data.path });
          resolve({ ok: false, error: data.error ?? `CRT server answered ${status}` });
        });
        res.on("error", (err) => resolve({ ok: false, error: err.message }));
      },
    );
    req.on("error", (err: NodeJS.ErrnoException) => resolve({ ok: false, error: `cannot reach the CRT server on 127.0.0.1:${target.port} (${err.code ?? err.message})` }));
    req.end(body);
  });
}

function isRequest(v: unknown): v is JsonRpcRequest {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return o.jsonrpc === "2.0" && typeof o.method === "string";
}

function idOf(v: unknown): JsonRpcId {
  return typeof v === "string" || typeof v === "number" ? v : null;
}

function packageVersion(): string {
  try {
    return (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: string }).version ?? "unknown";
  } catch {
    return "unknown";
  }
}
