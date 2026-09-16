// A fake Codex CLI for tests (PRD-providers F-59, F-61, N-9): stands in for codex-cli 0.154.0 as
// docs/spikes/codex-2026-09.md recorded it, so the driver, the shim, the token and the internal
// route run for real without a login. Installed npm-style into a scratch bin by
// fake-codex-install.mjs (`codex.cmd` shim on Windows, an executable script elsewhere).
//
//   codex --version            → `codex-cli <FAKE_CODEX_VERSION | 0.154.0>`, exit 0
//   codex login status         → exit FAKE_CODEX_LOGIN (0 = "Logged in using ChatGPT", 1 = "Not logged in")
//   codex exec --json … -      → reads the prompt from stdin, spawns the configured stdio MCP server
//                                (initialize + tools/list, as the real one does before the model is
//                                contacted), then replays test/providers/fixtures/codex/first-turn.jsonl
//                                with a fresh thread_id (FAKE_CODEX_THREAD overrides it)
//   codex exec resume <id> …   → the same, replaying resume.jsonl with that id; a prompt containing
//                                the word "write" calls `write_task` through the MCP server instead
//                                and reports the shim's answer as an mcp_tool_call item; "slow"
//                                prints thread.started + turn.started and then waits to be killed
//   FAKE_CODEX_AUTH=stale      → replays first-turn-auth-failed.jsonl / resume-auth-failed.jsonl, exit 1
//   FAKE_CODEX_RESUME_MISMATCH → resume starts a NEW thread (the F-53 assertion must catch it)
//
// The flag contract is enforced the way the real CLI does it: unknown flags exit 2, an unknown
// `-c` key exits 1 (as --strict-config would), `exec resume` rejects `--sandbox` and `-C`, and the
// MCP server gets only an allowlisted environment plus `env` / `env_vars` — so a driver that
// drifts from the spike's verdicts fails here, not on Simon's machine.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "providers", "fixtures", "codex");
const KNOWN_CONFIG = new Set([
  "approval_policy",
  "sandbox_mode",
  "analytics.enabled",
  "model_reasoning_effort",
  "mcp_servers.crt.command",
  "mcp_servers.crt.args",
  "mcp_servers.crt.env",
  "mcp_servers.crt.env_vars",
  "mcp_servers.crt.default_tools_approval_mode",
]);
// What codex 0.154.0 passes to a stdio MCP server (spike §2): a fixed allowlist, nothing else.
const MCP_ENV_ALLOWLIST = ["PATH", "PATHEXT", "SYSTEMROOT", "SYSTEMDRIVE", "COMSPEC", "WINDIR", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "SHELL", "USERNAME", "LANG"];

const WRITE_TASK_REQUEST = {
  title: "Cart total excludes applied discount",
  summary: "The cart total ignores the SAVE10 promo that the page shows as applied.",
  context: "Reproduce: open /cart?promo=SAVE10. `CartSummary` (src/components/Cart.tsx:88) renders `subtotal` instead of `total`.",
  ask: "Render the discounted total and cover it with a unit test.",
  definitionOfDone: ["Cart total applies the promo discount", "Unit test covers the discounted total"],
  notes: "Fake Codex intake; nothing was read from disk.",
  tags: ["cart", "pricing"],
  files: ["src/components/Cart.tsx"],
};

const out = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const die = (message, code) => {
  process.stderr.write(`${message}\n`);
  process.exit(code);
};

export async function main(argv) {
  const [head, second] = argv;
  if (head === "--version") {
    console.log(`codex-cli ${process.env.FAKE_CODEX_VERSION ?? "0.154.0"}`);
    return 0;
  }
  if (head === "login" && second === "status") {
    const status = Number(process.env.FAKE_CODEX_LOGIN ?? 0);
    console.log(status === 0 ? "Logged in using ChatGPT" : "Not logged in");
    return status;
  }
  if (head !== "exec") die(`error: unrecognized subcommand '${head ?? ""}'`, 2);
  const parsed = parseExec(argv.slice(1));
  const prompt = parsed.stdin ? await readStdin() : "";
  return runTurn(parsed, prompt);
}

/** `exec [resume <id>] flags… [-]`; mirrors what `codex exec --help` / `exec resume --help` accept. */
function parseExec(args) {
  const p = { resume: null, json: false, sandbox: null, cd: null, config: {}, images: [], model: null, stdin: false };
  let i = 0;
  if (args[0] === "resume") {
    p.resume = args[1] ?? die("error: missing thread id for `exec resume`", 2);
    i = 2;
  }
  for (; i < args.length; i++) {
    const a = args[i];
    const next = () => {
      if (i + 1 >= args.length) die(`error: a value is required for '${a}' but none was supplied`, 2);
      return args[++i];
    };
    if (a === "--json") p.json = true;
    else if (a === "--strict-config") continue;
    else if (a === "-c" || a === "--config") {
      const kv = next();
      const eq = kv.indexOf("=");
      if (eq === -1) die(`error: invalid -c override '${kv}'`, 2);
      const key = kv.slice(0, eq);
      if (!KNOWN_CONFIG.has(key)) die(`Error loading config.toml: unknown configuration field \`${key}\` in -c/--config override`, 1);
      p.config[key] = tomlValue(kv.slice(eq + 1));
    } else if (a === "--image" || a === "-i") p.images.push(next());
    else if (a === "-m" || a === "--model") p.model = next();
    else if (a === "--sandbox" || a === "-s") {
      if (p.resume) die("error: unexpected argument '--sandbox' found", 2);
      p.sandbox = next();
    } else if (a === "-C" || a === "--cd") {
      if (p.resume) die("error: unexpected argument '-C' found", 2);
      p.cd = next();
    } else if (a === "-") p.stdin = true;
    else if (a.startsWith("-")) die(`error: unexpected argument '${a}' found`, 2);
    else die(`error: unexpected prompt argument '${a}' — the fake takes the prompt on stdin only`, 2);
  }
  return p;
}

/** Enough TOML for `-c` values: strings, arrays of strings, inline tables of strings, booleans, bare words. */
function tomlValue(raw) {
  const s = raw.trim();
  if (s.startsWith("[")) return splitTop(s.slice(1, -1)).map(tomlValue);
  if (s.startsWith("{")) {
    const table = {};
    for (const pair of splitTop(s.slice(1, -1))) {
      const eq = pair.indexOf("=");
      table[pair.slice(0, eq).trim()] = tomlValue(pair.slice(eq + 1));
    }
    return table;
  }
  if (s.startsWith("'")) return s.slice(1, -1);
  if (s.startsWith('"')) return JSON.parse(s);
  if (s === "true" || s === "false") return s === "true";
  return s;
}

function splitTop(body) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let cur = "";
  for (const ch of body) {
    if (quote) {
      cur += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) {
      parts.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((s) => s.trim());
}

function readStdin() {
  return new Promise((resolve) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (text += c));
    process.stdin.on("end", () => resolve(text));
  });
}

/** The recorded events of a fixture, with the thread id swapped for the one this run uses. */
function fixture(name, threadId) {
  return readFileSync(join(FIXTURES, name), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => JSON.parse(l))
    .map((e) => (e.type === "thread.started" ? { ...e, thread_id: threadId } : e));
}

async function runTurn(p, prompt) {
  if (!p.json) die("the fake only speaks --json", 2);
  if (!p.stdin) die("the fake takes the prompt on stdin (`-`)", 2);
  if (p.resume === null && (p.sandbox !== "read-only" || !p.cd)) die("turn 1 must pass --sandbox read-only and -C <projectRoot> (F-53)", 2);
  if (p.resume !== null && p.config.sandbox_mode !== "read-only") die('exec resume must pass -c sandbox_mode="read-only" (spike §3)', 2);
  if (p.config.approval_policy !== "never") die('missing -c approval_policy="never" (spike §1)', 2);
  if (p.config["mcp_servers.crt.default_tools_approval_mode"] !== "approve") die('missing -c mcp_servers.crt.default_tools_approval_mode="approve" (spike §2a)', 2);
  for (const image of p.images) if (!existsSync(image)) die(`--image ${image}: no such file`, 1);
  if (!prompt.trim()) die("empty prompt on stdin", 1);

  const mismatch = Boolean(process.env.FAKE_CODEX_RESUME_MISMATCH);
  // A non-UUID resume id silently starts a new thread, as the real CLI does (spike §3).
  const threadId = p.resume !== null && !mismatch && /^[0-9a-f-]{36}$/i.test(p.resume) ? p.resume : (process.env.FAKE_CODEX_THREAD ?? randomUUID());

  if (process.env.FAKE_CODEX_AUTH === "stale") {
    for (const e of fixture(p.resume === null ? "first-turn-auth-failed.jsonl" : "resume-auth-failed.jsonl", threadId)) out(e);
    return 1;
  }

  // Every turn spawns the MCP server and lists its tools before the model is contacted (spike §2).
  const mcp = await connectMcp(p.config);
  if (!mcp.tools.includes("write_task")) {
    out({ type: "thread.started", thread_id: threadId });
    out({ type: "turn.started" });
    out({ type: "error", message: `crt MCP server listed no write_task tool: ${JSON.stringify(mcp.tools)}` });
    out({ type: "turn.failed", error: { message: "MCP server misconfigured" } });
    mcp.close();
    return 1;
  }

  const lastParagraph = prompt.trim().split(/\n{2,}/).at(-1) ?? "";
  const quick = /^Quick note \(F-14\)/.test(lastParagraph);
  const wantsWrite = p.resume !== null ? /\bwrite\b/i.test(prompt) : quick;
  if (/\bslow\b/i.test(prompt) && p.resume !== null) {
    out({ type: "thread.started", thread_id: threadId });
    out({ type: "turn.started" });
    await new Promise((r) => setTimeout(r, 60_000)); // to be killed by interrupt()
    mcp.close();
    return 0;
  }
  if (wantsWrite) {
    out({ type: "thread.started", thread_id: threadId });
    out({ type: "turn.started" });
    const item = { id: "item_0", type: "mcp_tool_call", server: "crt", tool: "write_task", arguments: WRITE_TASK_REQUEST, result: null, error: null, status: "in_progress" };
    out({ type: "item.started", item });
    const result = await mcp.call("write_task", WRITE_TASK_REQUEST);
    mcp.close();
    const failed = result.isError === true;
    out({ type: "item.completed", item: { ...item, result: failed ? null : { content: result.content, structured_content: null }, error: failed ? { message: result.content?.[0]?.text ?? "failed" } : null, status: failed ? "failed" : "completed" } });
    const text = result.content?.[0]?.text ?? "";
    out({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: failed ? `write_task failed: ${text}` : `${text}. Anything else?` } });
    out({ type: "turn.completed", usage: { input_tokens: 1234, cached_input_tokens: 1000, cache_write_input_tokens: 0, output_tokens: 56, reasoning_output_tokens: 7 } });
    return 0;
  }
  mcp.close();
  for (const e of fixture(p.resume === null ? "first-turn.jsonl" : "resume.jsonl", threadId)) out(e);
  return 0;
}

/** Spawn `mcp_servers.crt.*` the way Codex does — allowlisted env + `env` + `env_vars` — and do initialize/tools/list. */
async function connectMcp(config) {
  const command = config["mcp_servers.crt.command"];
  const args = config["mcp_servers.crt.args"] ?? [];
  if (!command) die("missing -c mcp_servers.crt.command", 2);
  const env = {};
  for (const k of MCP_ENV_ALLOWLIST) {
    const key = Object.keys(process.env).find((e) => e.toUpperCase() === k);
    if (key) env[key] = process.env[key];
  }
  Object.assign(env, config["mcp_servers.crt.env"] ?? {});
  for (const name of config["mcp_servers.crt.env_vars"] ?? []) if (process.env[name] !== undefined) env[name] = process.env[name];

  const child = spawn(command, args, { env, cwd: process.cwd(), shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
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
  try {
    await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "fake-codex", version: "0.154.0" } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    const list = await request("tools/list", {});
    return {
      tools: (list.tools ?? []).map((t) => t.name),
      call: (name, args) => request("tools/call", { name, arguments: args }),
      close: () => child.stdin.end(),
    };
  } catch (err) {
    die(`crt MCP server failed: ${err.message}`, 1);
  }
}

if (process.argv[1] && /fake-codex\.mjs$/.test(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
