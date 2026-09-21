// A fake ACP agent for tests (PRD-providers F-54, F-59, F-61, N-9): stands in for Gemini CLI
// 0.60.0 in `--acp` mode as docs/spikes/gemini-acp-2026-09.md recorded it, so the ACP driver,
// the shim, the token and the internal route run for real without a login. Installed npm-style
// as `gemini` by fake-codex-install.mjs (`installFakeGemini`) for the gemini profile, and run
// directly as `node fake-acp.mjs` for the ad-hoc `{ kind: "acp" }` config.
//
//   gemini --version           → `<FAKE_GEMINI_VERSION | 0.60.0>`, exit 0
//   gemini --acp               → ACP over stdio (below); any other first argument exits 2
//
// Protocol, as Gemini 0.60.0 does it:
//   initialize                 → protocolVersion 1 (FAKE_ACP_PROTOCOL overrides it), agentInfo,
//                                agentCapabilities with promptCapabilities.image true
//                                (FAKE_ACP_NO_IMAGES=1 → false), authMethods
//   session/new                → spawns the `crt` stdio MCP server from `mcpServers` with the given
//                                env (initialize + tools/list, as the real one does before the
//                                model is contacted), then a fresh UUID sessionId, modes, models
//                                (FAKE_ACP_AUTH=missing → error -32000 "Gemini API key is missing…",
//                                FAKE_ACP_AUTH=tier → the ineligible-tier error)
//   session/prompt             → text streamed as agent_message_chunk, a thought chunk (ignored),
//                                a `read` tool_call + tool_call_update completed, then — on the
//                                first prompt or one containing "permission" — a
//                                session/request_permission for an `execute` tool ("Run npm test",
//                                options proceed_once/allow_once, proceed_always/allow_always,
//                                cancel/reject_once); allow → the tool completes, reject → it
//                                fails; the prompt then ends { stopReason: "end_turn" }.
//                                A prompt whose last paragraph is the F-14 quick note, or one
//                                containing "write", calls `write_task` through the MCP server and
//                                reports the shim's answer as a tool_call/tool_call_update titled
//                                `write_task` (F-25 label "Write task: <title>").
//                                A prompt containing "slow" waits for session/cancel and then
//                                answers { stopReason: "cancelled" }.
//   session/cancel             → cancels the running prompt
//   fs/*, terminal/*           → never sent (the client advertised none)
//   stdin end                  → exit 0 within a few ms (so close() never has to kill)
//
// Image blocks must carry base64 `data` and a mimeType; a text block must be first — a driver
// that drifts from the spike fails here, not on Simon's machine.
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const WRITE_TASK_REQUEST = {
  title: "Cart total excludes applied discount",
  summary: "The cart total ignores the SAVE10 promo that the page shows as applied.",
  context: "Reproduce: open /cart?promo=SAVE10. `CartSummary` (src/components/Cart.tsx:88) renders `subtotal` instead of `total`.",
  ask: "Render the discounted total and cover it with a unit test.",
  definitionOfDone: ["Cart total applies the promo discount", "Unit test covers the discounted total"],
  notes: "Fake ACP intake; nothing was read from disk.",
  tags: ["cart", "pricing"],
  files: ["src/components/Cart.tsx"],
};
const PERMISSION_OPTIONS = [
  { optionId: "proceed_once", name: "Allow", kind: "allow_once" },
  { optionId: "proceed_always", name: "Allow for this session", kind: "allow_always" },
  { optionId: "cancel", name: "Reject", kind: "reject_once" },
];

const die = (message, code) => {
  process.stderr.write(`${message}\n`);
  process.exit(code);
};

export async function main(argv) {
  const [head] = argv;
  if (head === "--version") {
    console.log(process.env.FAKE_GEMINI_VERSION ?? "0.60.0");
    return 0;
  }
  if (head !== "--acp" && head !== "--experimental-acp" && head !== undefined) die(`error: unknown argument '${head}'`, 2);
  if (head === "--experimental-acp") process.stderr.write("--experimental-acp is deprecated; use --acp\n");
  return new Promise((resolve) => serve(resolve));
}

function serve(exit) {
  const out = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
  let nextId = 1;
  const pending = new Map();
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      out({ jsonrpc: "2.0", id, method, params });
    });
  const notify = (method, params) => out({ jsonrpc: "2.0", method, params });
  const sessions = new Map();
  let mcp = null;
  let prompts = 0;

  const handleRequest = async (id, method, params) => {
    try {
      const result = await dispatch(method, params ?? {});
      out({ jsonrpc: "2.0", id, result });
    } catch (err) {
      const error = err && typeof err.code === "number" ? { code: err.code, message: err.message } : { code: -32603, message: String(err?.message ?? err) };
      process.stderr.write(`Error handling request ${method}: ${error.message}\n`);
      out({ jsonrpc: "2.0", id, error });
    }
  };

  const dispatch = async (method, params) => {
    switch (method) {
      case "initialize":
        return {
          protocolVersion: process.env.FAKE_ACP_PROTOCOL ? Number(process.env.FAKE_ACP_PROTOCOL) : 1,
          authMethods: [{ id: "oauth-personal", name: "Log in with Google", description: "Log in with your Google account" }, { id: "gemini-api-key", name: "Gemini API key", description: "Use an API key with Gemini Developer API" }],
          agentInfo: { name: "gemini-cli", title: "Gemini CLI", version: process.env.FAKE_GEMINI_VERSION ?? "0.60.0" },
          agentCapabilities: { loadSession: true, promptCapabilities: { image: !process.env.FAKE_ACP_NO_IMAGES, audio: true, embeddedContext: true }, mcpCapabilities: { http: true, sse: true } },
        };
      case "authenticate":
        return null;
      case "session/new": {
        if (process.env.FAKE_ACP_AUTH === "missing") throw { code: -32000, message: "Gemini API key is missing or not configured." };
        if (process.env.FAKE_ACP_AUTH === "tier") throw { code: -32000, message: "This client is no longer supported for Gemini Code Assist for individuals. To continue using Gemini, please migrate to the Antigravity suite of products: https://antigravity.google" };
        if (typeof params.cwd !== "string") throw { code: -32602, message: "cwd must be a string" };
        const server = (params.mcpServers ?? []).find((s) => s.name === "crt");
        if (!server || !("command" in server)) throw { code: -32602, message: "no stdio MCP server named crt in mcpServers" };
        mcp = await connectMcp(server, params.cwd);
        if (!mcp.tools.includes("write_task")) throw { code: -32000, message: `crt MCP server listed no write_task tool: ${JSON.stringify(mcp.tools)}` };
        const sessionId = process.env.FAKE_ACP_SESSION ?? randomUUID();
        sessions.set(sessionId, { cancelled: false, cancel: null });
        setTimeout(() => notify("session/update", { sessionId, update: { sessionUpdate: "available_commands_update", availableCommands: [] } }), 0);
        return {
          sessionId,
          modes: { availableModes: [{ id: "default", name: "Default" }, { id: "plan", name: "Plan" }], currentModeId: "default" },
          models: { availableModels: [{ modelId: "gemini-2.5-pro", name: "Gemini 2.5 Pro" }], currentModelId: "gemini-2.5-pro" },
        };
      }
      case "session/prompt": {
        const session = sessions.get(params.sessionId);
        if (!session) throw { code: -32602, message: `Session not found: ${params.sessionId}` };
        return runPrompt(session, params);
      }
      case "session/cancel": {
        const session = sessions.get(params.sessionId);
        if (session) {
          session.cancelled = true;
          session.cancel?.();
        }
        return null;
      }
      default:
        throw { code: -32601, message: `Method not found: ${method}` };
    }
  };

  const runPrompt = async (session, params) => {
    prompts += 1;
    const sessionId = params.sessionId;
    const blocks = params.prompt ?? [];
    if (!blocks.length || blocks[0].type !== "text" || typeof blocks[0].text !== "string") throw { code: -32602, message: "prompt must start with a text block" };
    for (const b of blocks.slice(1)) {
      if (b.type === "image" && (typeof b.data !== "string" || !b.data || typeof b.mimeType !== "string")) throw { code: -32602, message: "image blocks need mimeType and base64 data" };
      if (b.type === "image" && process.env.FAKE_ACP_NO_IMAGES) throw { code: -32602, message: "this agent does not accept images" };
    }
    const text = blocks[0].text;
    session.cancelled = false;
    const update = (u) => notify("session/update", { sessionId, update: u });
    const say = async (s) => {
      for (const piece of s.split(/(?<=\s)/)) {
        if (session.cancelled) return;
        update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text: piece } });
        await sleep(5);
      }
    };

    if (/\bslow\b/i.test(text)) {
      await say("This will take a while… ");
      if (!session.cancelled) {
        await new Promise((resolve) => {
          session.cancel = resolve;
          setTimeout(resolve, 60_000).unref();
        });
        session.cancel = null;
      }
      return { stopReason: "cancelled" };
    }

    const lastParagraph = text.trim().split(/\n{2,}/).at(-1) ?? "";
    const quick = /^Quick note \(F-14\)/.test(lastParagraph);
    if (quick || (prompts > 1 && /\bwrite\b/i.test(text))) {
      const toolCallId = `call_${prompts}_write`;
      update({ sessionUpdate: "tool_call", toolCallId, title: "write_task (crt MCP Server)", kind: "other", status: "in_progress", content: [], locations: [], rawInput: WRITE_TASK_REQUEST });
      const result = await mcp.call("write_task", WRITE_TASK_REQUEST);
      const failed = result.isError === true;
      const reply = result.content?.[0]?.text ?? "";
      update({ sessionUpdate: "tool_call_update", toolCallId, status: failed ? "failed" : "completed", title: "write_task (crt MCP Server)", content: [{ type: "content", content: { type: "text", text: reply } }], kind: "other", rawOutput: reply });
      await say(failed ? `write_task failed: ${reply}` : `${reply}. Anything else?`);
      return { stopReason: "end_turn" };
    }

    update({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Looking at the capture." } });
    await say(prompts === 1 ? "I looked at the capture: the cart total ignores the applied discount. " : "Sure. ");
    if (session.cancelled) return { stopReason: "cancelled" };
    const readId = `call_${prompts}_read`;
    update({ sessionUpdate: "tool_call", toolCallId: readId, title: "ReadFile AGENTS.md", kind: "read", status: "in_progress", content: [], locations: [{ path: "AGENTS.md" }] });
    await sleep(5);
    update({ sessionUpdate: "tool_call_update", toolCallId: readId, status: "completed", title: "ReadFile AGENTS.md", content: [{ type: "content", content: { type: "text", text: "# Agents\n…" } }], kind: "read" });
    if (prompts === 1 || /\bpermission\b/i.test(text)) {
      const execId = `call_${prompts}_exec`;
      const toolCall = { toolCallId: execId, title: "Shell npm test", kind: "execute", status: "pending", content: [], locations: [], rawInput: { command: "npm test" } };
      const answer = await request("session/request_permission", { sessionId, options: PERMISSION_OPTIONS, toolCall });
      const outcome = answer?.outcome?.outcome === "selected" ? answer.outcome.optionId : "cancelled";
      if (outcome === "proceed_always") throw { code: -32000, message: "the fake never expects allow_always (F-54)" };
      if (outcome === "proceed_once") {
        update({ sessionUpdate: "tool_call", ...toolCall, status: "in_progress" });
        await sleep(5);
        update({ sessionUpdate: "tool_call_update", toolCallId: execId, status: "completed", title: "Shell npm test", content: [{ type: "content", content: { type: "text", text: "3 passing" } }], kind: "execute" });
        await say("Tests pass. What should the definition of done say?");
      } else {
        update({ sessionUpdate: "tool_call_update", toolCallId: execId, status: "failed", title: "Shell npm test", content: [{ type: "content", content: { type: "text", text: `Tool "run_shell_command" was ${outcome === "cancelled" ? "canceled" : "rejected"} by the user.` } }], kind: "execute" });
        await say("Understood, I will not run it. What should the definition of done say?");
      }
    } else {
      await say(`You said: ${text.split("\n")[0].slice(0, 80)}`);
    }
    return { stopReason: session.cancelled ? "cancelled" : "end_turn" };
  };

  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.method !== undefined) {
        if (msg.id === undefined) void dispatch(msg.method, msg.params ?? {}).catch(() => undefined);
        else void handleRequest(msg.id, msg.method, msg.params);
      } else if (pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.reject(msg.error);
        else p.resolve(msg.result);
      }
    }
  });
  process.stdin.on("end", () => {
    mcp?.close();
    exit(0);
    process.exit(0);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Spawn the `crt` stdio MCP server the way Gemini does — the given env over the parent's, cwd = the session's — and do initialize/tools/list. */
async function connectMcp(server, cwd) {
  const env = { ...process.env };
  for (const { name, value } of server.env ?? []) env[name] = value;
  const child = spawn(server.command, server.args ?? [], { env, cwd, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  child.on("error", (err) => die(`crt MCP server could not start: ${err.message}`, 1));
  let buffer = "";
  const waiters = new Map();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      const msg = JSON.parse(line);
      const w = waiters.get(msg.id);
      if (w) {
        waiters.delete(msg.id);
        w(msg);
      }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (c) => process.stderr.write(`[crt mcp] ${c}`));
  let nextId = 0;
  const request = (method, params) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => reject(new Error(`MCP ${method} timed out`)), 15_000);
      waiters.set(id, (msg) => {
        clearTimeout(timer);
        if (msg.error) reject(new Error(`MCP ${method}: ${msg.error.message}`));
        else resolve(msg.result);
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake-acp", version: "0.60.0" } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  const list = await request("tools/list", {});
  return {
    tools: (list.tools ?? []).map((t) => t.name),
    call: (name, args) => request("tools/call", { name, arguments: args }),
    close: () => child.stdin.end(),
  };
}

if (process.argv[1] && /fake-acp\.mjs$/.test(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
