import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ListResourcesResultSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startFixture, type Fixture } from "../e2e/fixture/server.mjs";
import { writeCapture } from "../src/captures.js";
import { INTERNAL_WRITE_TASK_PATH, MCP_ENV_MISSING, MCP_PROTOCOL_VERSIONS, McpStdioServer, mcpLaunch, runMcpStdio, STALE_TOKEN_LINE } from "../src/mcp-stdio.js";
import { createProxyServer } from "../src/proxy.js";
import { ProviderRegistry } from "../src/session.js";
import type { SessionEvent } from "../src/session-events.js";
import { SessionRegistry } from "../src/sessions.js";
import { validateTaskText } from "../src/tasks.js";
import { buildMcpShim } from "./helpers/fake-cli.js";
import { listen0 } from "./helpers/http.js";
import { samplePost } from "./helpers/sample-capture.js";

// F-49 transport contract test (PRD-providers §5.3, N-9): the official MCP TypeScript client
// spawns `crt mcp` as a real child process over stdio — the same code `dist/cli.js mcp` runs,
// bundled from src/ by esbuild so the test does not depend on the build step — and every call
// lands on a real CRT server: proxy routes, session registry, the internal route, the task
// writer. The stub provider owns the session whose token the shim carries.

let fixture: Fixture;
let crt: Awaited<ReturnType<typeof listen0>>;
let port: number;
let root: string;
let registry: SessionRegistry;
let shim: string;
const logs: string[] = [];

const request = {
  title: "Cart total excludes applied discount",
  summary: "The cart total ignores the SAVE10 promo that the page shows as applied.",
  context: "CartSummary (src/components/Cart.tsx:88) renders subtotal instead of total.",
  ask: "Render the discounted total and cover it with a unit test.",
  definitionOfDone: ["Cart total applies the promo discount", "Unit test covers the discounted total"],
  tags: ["cart"],
  files: ["src/components/Cart.tsx"],
};

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "crt-mcp-"));
  mkdirSync(join(root, ".crt", "tasks"), { recursive: true });
  // The shim as the agent would run it: one file, Node built-ins plus the bundled schema code.
  shim = await buildMcpShim();

  fixture = await startFixture();
  const providers = new ProviderRegistry({ root, env: { CRT_SESSION_STUB: "1" }, log: (l) => logs.push(l) });
  await providers.refresh();
  registry = new SessionRegistry({ projectRoot: root, tasksDir: join(root, ".crt", "tasks"), intakePrompt: "INTAKE", providers, log: (l) => logs.push(l) });
  crt = await listen0(createProxyServer({ target: fixture.url, projectRoot: root, overlayPath: join(root, "overlay.js"), sessions: registry, providers }));
  port = crt.port;
  registry.mcpPort = port;
}, 60_000);

afterAll(async () => {
  registry.closeAll();
  await crt.close();
  await fixture.close();
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** A connected official client talking to a fresh `crt mcp` process with the given environment. */
async function connect(env: Record<string, string>): Promise<{ client: Client; transport: StdioClientTransport; stderr: string[] }> {
  const transport = new StdioClientTransport({ command: process.execPath, args: [shim], env: { ...process.env, ...env } as Record<string, string>, stderr: "pipe" });
  const stderr: string[] = [];
  transport.stderr?.on("data", (c: Buffer) => stderr.push(c.toString()));
  const client = new Client({ name: "crt-contract-test", version: "0.0.0" });
  await client.connect(transport);
  return { client, transport, stderr };
}

describe("crt mcp with the official MCP client (F-49)", () => {
  it("initialize → tools/list → tools/call writes the task through the internal route; ping works; other methods are -32601 (F-49)", async () => {
    const cap = writeCapture(root, samplePost());
    const session = registry.create(cap.id);
    const events: SessionEvent[] = [];
    registry.subscribe(session.id, 0, (_seq, e) => events.push(e));
    const token = registry.tokenOf(session.id)!;
    const { client } = await connect({ CRT_MCP_TOKEN: token, CRT_MCP_PORT: String(port) });
    try {
      // connect() succeeded, so the negotiated version is one the client supports (it throws otherwise).
      expect(client.getServerVersion()).toMatchObject({ name: "crt" });
      expect(client.getServerCapabilities()).toEqual({ tools: {} });

      const tools = await client.listTools();
      expect(tools.tools.map((t) => t.name)).toEqual(["write_task"]);
      const schema = tools.tools[0]!.inputSchema as { type: string; properties: Record<string, unknown>; required?: string[] };
      expect(schema.type).toBe("object");
      expect(Object.keys(schema.properties).sort()).toEqual(["ask", "context", "definitionOfDone", "evidence", "files", "notes", "priority", "summary", "tags", "title"]);
      expect(schema.required).toEqual(["title", "summary", "context", "ask", "definitionOfDone"]);

      await expect(client.ping()).resolves.toEqual({});

      const result = await client.callTool({ name: "write_task", arguments: request });
      expect(result.isError).toBeFalsy();
      const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
      expect(text).toMatch(/^Task CRT-\d{4} written to \.crt\/tasks\/CRT-\d{4}-cart-total-excludes-applied-discount\.md$/);
      const id = /CRT-\d{4}/.exec(text)![0];
      // §5.3: the server performed the write, emitted task_written and the registry learned the id.
      expect(events).toContainEqual({ type: "task_written", id, path: `.crt/tasks/${id}-cart-total-excludes-applied-discount.md` });
      expect(registry.get(session.id)?.taskId).toBe(id);
      const file = join(root, ".crt", "tasks", `${id}-cart-total-excludes-applied-discount.md`);
      expect(validateTaskText(readFileSync(file, "utf8"), basename(file))).toEqual([]);
      expect(readFileSync(file, "utf8")).toContain("provider: stub");

      // Bad arguments come back as a tool error the agent can read and fix, not a protocol error.
      const bad = await client.callTool({ name: "write_task", arguments: { title: "x" } });
      expect(bad.isError).toBe(true);
      expect((bad.content as Array<{ text: string }>)[0]!.text).toMatch(/^write_task failed: /);

      await expect(client.callTool({ name: "nope", arguments: {} })).rejects.toThrow(McpError);
      await expect(client.request({ method: "resources/list" }, ListResourcesResultSchema)).rejects.toMatchObject({ code: -32601 });
    } finally {
      await client.close();
      registry.close(session.id);
    }
  }, 30_000);

  it("a wrong or expired token is a 404 with an empty body and one log line; the agent reads the N-7 line (F-49, N-7)", async () => {
    const before = logs.filter((l) => l.includes(STALE_TOKEN_LINE)).length;
    const { client } = await connect({ CRT_MCP_TOKEN: "not-a-token", CRT_MCP_PORT: String(port) });
    try {
      const r = await client.callTool({ name: "write_task", arguments: request });
      expect(r.isError).toBe(true);
      expect((r.content as Array<{ text: string }>)[0]!.text).toBe(STALE_TOKEN_LINE);
    } finally {
      await client.close();
    }
    expect(logs.filter((l) => l.includes(STALE_TOKEN_LINE)).length).toBe(before + 1);

    // A session that has ended takes its token with it.
    const cap = writeCapture(root, samplePost());
    const session = registry.create(cap.id);
    const token = registry.tokenOf(session.id)!;
    registry.close(session.id);
    const raw = await fetch(`http://127.0.0.1:${port}${INTERNAL_WRITE_TASK_PATH}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(request) });
    expect(raw.status).toBe(404);
    expect(await raw.text()).toBe("");
  }, 30_000);

  it("the token never appears in argv, a URL, a page-readable response or a log line (F-49, N-8)", async () => {
    const cap = writeCapture(root, samplePost());
    const session = registry.create(cap.id);
    const token = registry.tokenOf(session.id)!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/); // 32 random bytes, base64url
    const launch = mcpLaunch(token, port);
    expect(launch.command).toBe(process.execPath);
    expect(launch.args.at(-1)).toBe("mcp");
    expect(launch.args.join(" ")).not.toContain(token);
    expect(launch.env).toEqual({ CRT_MCP_TOKEN: token, CRT_MCP_PORT: String(port) });
    expect(INTERNAL_WRITE_TASK_PATH).not.toContain(token);
    // What the page can read: the session info, the list, and the replayed events.
    const info = await (await fetch(`http://127.0.0.1:${port}/__crt/sessions/${session.id}`)).text();
    const list = await (await fetch(`http://127.0.0.1:${port}/__crt/sessions`)).text();
    expect(info).not.toContain(token);
    expect(list).not.toContain(token);
    const events: SessionEvent[] = [];
    registry.subscribe(session.id, 0, (_seq, e) => events.push(e));
    expect(JSON.stringify(events)).not.toContain(token);
    expect(logs.join("\n")).not.toContain(token);
    registry.close(session.id);
  });

  it("refuses the internal route to anything carrying an Origin header, before reading the token (F-49, N-8)", async () => {
    const cap = writeCapture(root, samplePost());
    const session = registry.create(cap.id);
    const token = registry.tokenOf(session.id)!;
    const res = await fetch(`http://127.0.0.1:${port}${INTERNAL_WRITE_TASK_PATH}`, {
      method: "POST",
      headers: { origin: "http://localhost:4400", authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
    expect(registry.get(session.id)?.taskId).toBeNull();
    // Not even a preflight gets through.
    expect((await fetch(`http://127.0.0.1:${port}${INTERNAL_WRITE_TASK_PATH}`, { method: "OPTIONS", headers: { origin: "http://localhost:4400" } })).status).toBe(403);
    expect((await fetch(`http://127.0.0.1:${port}/__crt/internal/other`, { method: "POST" })).status).toBe(404);
    registry.close(session.id);
  });

  it("exits 2 with one stderr line when CRT_MCP_TOKEN or CRT_MCP_PORT is missing (F-49)", async () => {
    const { spawn } = await import("node:child_process");
    const env = { ...process.env } as Record<string, string>;
    delete env.CRT_MCP_TOKEN;
    delete env.CRT_MCP_PORT;
    const child = spawn(process.execPath, [shim], { env, stdio: ["pipe", "pipe", "pipe"], shell: false });
    let stderr = "";
    let stdout = "";
    child.stderr.on("data", (c: Buffer) => (stderr += c.toString()));
    child.stdout.on("data", (c: Buffer) => (stdout += c.toString()));
    const code = await new Promise<number | null>((r) => child.on("close", r));
    expect(code).toBe(2);
    expect(stderr.trim()).toBe(MCP_ENV_MISSING);
    expect(stdout).toBe("");
  });
});

describe("JSON-RPC framing (F-49)", () => {
  const forward = async () => ({ ok: true as const, id: "CRT-0042", path: ".crt/tasks/CRT-0042-x.md" });
  const server = new McpStdioServer({ token: "t", port: 1 }, "test", forward);

  it("answers -32700 to a non-JSON line, -32600 to a non-request, nothing to a notification, -32601 to an unknown method (F-49)", async () => {
    expect(await server.handle("{nope")).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    expect(await server.handle(JSON.stringify({ id: 7, foo: 1 }))).toEqual({ jsonrpc: "2.0", id: 7, error: { code: -32600, message: "Invalid Request" } });
    expect(await server.handle(JSON.stringify([1, 2]))).toMatchObject({ error: { code: -32600 } });
    expect(await server.handle(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }))).toBeNull();
    expect(await server.handle(JSON.stringify({ jsonrpc: "2.0", id: "a", method: "prompts/list" }))).toMatchObject({ id: "a", error: { code: -32601 } });
  });

  it("echoes a supported protocol version and offers the newest one otherwise (F-49)", async () => {
    const asked = await server.handle(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "x", version: "1" } } }));
    expect(asked).toMatchObject({ result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "crt", version: "test" } } });
    const future = await server.handle(JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2099-01-01" } }));
    expect(future).toMatchObject({ result: { protocolVersion: MCP_PROTOCOL_VERSIONS[0] } });
  });

  it("tools/call: unknown tool is -32602, bad arguments an isError result, a forward failure the one-line reason (F-49, N-7)", async () => {
    expect(await server.handle(JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "other" } }))).toMatchObject({ error: { code: -32602 } });
    expect(await server.handle(JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "write_task", arguments: {} } }))).toMatchObject({
      result: { isError: true, content: [{ type: "text", text: expect.stringMatching(/^write_task failed: title/) }] },
    });
    expect(await server.handle(JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "write_task", arguments: request } }))).toEqual({
      jsonrpc: "2.0",
      id: 5,
      result: { content: [{ type: "text", text: "Task CRT-0042 written to .crt/tasks/CRT-0042-x.md" }] },
    });
    const stale = new McpStdioServer({ token: "t", port: 1 }, "test", async () => ({ ok: false, error: STALE_TOKEN_LINE }));
    expect(await stale.handle(JSON.stringify({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "write_task", arguments: request } }))).toMatchObject({
      result: { isError: true, content: [{ type: "text", text: STALE_TOKEN_LINE }] },
    });
  });

  it("reassembles frames split across chunks, even inside a multi-byte character, and exits 0 when stdin ends (F-49)", async () => {
    const { PassThrough } = await import("node:stream");
    const input = new PassThrough();
    const output = new PassThrough();
    const seen: string[] = [];
    output.on("data", (c: Buffer) => seen.push(...c.toString("utf8").split("\n").filter(Boolean)));
    const titles: string[] = [];
    const done = runMcpStdio({
      input,
      output,
      env: { CRT_MCP_TOKEN: "t", CRT_MCP_PORT: "1" },
      forward: async (req) => {
        titles.push(req.title);
        return { ok: true, id: "CRT-0007", path: ".crt/tasks/CRT-0007-x.md" };
      },
    });
    const frame = Buffer.from(`${JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "write_task", arguments: { ...request, title: "Café total excludes discount" } } })}\n${JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" })}\n`);
    const cut = frame.indexOf(Buffer.from("é")) + 1; // between the two bytes of "é"
    input.write(frame.subarray(0, cut));
    await new Promise((r) => setTimeout(r, 20));
    input.write(frame.subarray(cut));
    input.end();
    expect(await done).toBe(0);
    expect(titles).toEqual(["Café total excludes discount"]);
    // Responses may come back in any order (the tool call is async, ping is not); match by id.
    expect(seen.map((l) => JSON.parse(l) as { id: number }).sort((a, b) => a.id - b.id)).toEqual([
      { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: "Task CRT-0007 written to .crt/tasks/CRT-0007-x.md" }] } },
      { jsonrpc: "2.0", id: 2, result: {} },
    ]);
  });

  it("the shim bundle exists only for this test and the real command is `node <cli.js> mcp` (F-49, N-10)", () => {
    expect(existsSync(shim)).toBe(true);
    const launch = mcpLaunch("tok", 4400);
    expect(basename(launch.args[0]!)).toBe("cli.js");
    expect(launch.args[1]).toBe("mcp");
    expect(launch.command.endsWith(".cmd")).toBe(false);
  });
});
