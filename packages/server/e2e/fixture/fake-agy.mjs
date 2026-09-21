// A fake Antigravity CLI for tests (PRD-providers F-111, F-59, F-61, N-9): stands in for `agy`
// 1.2.7 as docs/spikes/antigravity-2026-09.md recorded it, so the driver, the session plugin, the
// hooks, the shim, the token and the internal route run for real without a login. Installed
// npm-style into a scratch bin by fake-codex-install.mjs (`installFakeAgy`: an `agy.cmd` shim on
// Windows, an executable script elsewhere; the real agy is a bare .exe, which exec.ts finds first
// when present).
//
//   agy --version                                  → `<FAKE_AGY_VERSION | 1.2.7>`, exit 0
//   agy --output-format stream-json --input-format stream-json --print "" --dangerously-skip-permissions
//       --add-dir <dir> [--model m] [--conversation id]
//     → loads <dir>/.agents/plugins/*/ (mcp_config.json: spawns the servers with the inherited
//       environment and cwd = the plugin dir, initialize + tools/list before `init`; hooks.json:
//       PreToolUse and PreInvocation commands run through `cmd /c` / `sh -c` with cwd = the plugin
//       dir, the payload on stdin, the decision on stdout — exactly as agy 1.2.7 runs them), prints
//       `init`, then runs one turn per stdin line:
//         a new conversation replays image-by-path.jsonl (view_file through the hook, a run_command
//         the hook denies, streamed text); `--conversation <id>` replays resume.jsonl; a prompt
//         containing the word "write" (or a first message ending in the F-14 quick-note paragraph)
//         calls `write_task` on the crt_crt server through the hook and the real MCP server and
//         reports its answer; "slow" prints the user_input step and waits to be killed.
//       stdin end → exit 0. Malformed stdin lines fail the way the real CLI does (`result` with
//       status ERROR, exit 1); an unknown flag exits 2 with the Go usage line.
//   FAKE_AGY_RESUME_MISMATCH=1   → --conversation starts a NEW conversation (the F-111 assertion must catch it)
//   FAKE_AGY_NO_HOOKS=1          → hooks.json is ignored (no PreInvocation marker: the driver must kill the process)
//   FAKE_AGY_AUTH=logged-out     → the print-mode logged-out line on stderr, exit 1 (synthesised from the
//                                  binary's strings; not recorded — a real logged-out run needs a logged-out machine)
//   FAKE_AGY_THREAD=<uuid>       → the conversation id to use for a new conversation
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "test", "providers", "fixtures", "antigravity");
const TOOLS = ["ask_question", "call_mcp_tool", "find_by_name", "finish", "grep_search", "list_dir", "read_url_content", "run_command", "search_web", "view_file", "write_to_file"];
const VALUE_FLAGS = new Set(["--output-format", "--input-format", "--print", "-p", "--prompt", "--add-dir", "--model", "--conversation", "--effort", "--mode", "--agent", "--project", "--print-timeout", "--log-file", "--json-schema"]);
const BOOL_FLAGS = new Set(["--dangerously-skip-permissions", "--sandbox", "--continue", "-c", "--disable-slash-commands", "--new-project", "--remote-control"]);

const WRITE_TASK_REQUEST = {
  title: "Cart total excludes applied discount",
  summary: "The cart total ignores the SAVE10 promo that the page shows as applied.",
  context: "Reproduce: open /cart?promo=SAVE10. `CartSummary` (src/components/Cart.tsx:88) renders `subtotal` instead of `total`.",
  ask: "Render the discounted total and cover it with a unit test.",
  definitionOfDone: ["Cart total applies the promo discount", "Unit test covers the discounted total"],
  notes: "Fake Antigravity intake; nothing was read from disk.",
  tags: ["cart", "pricing"],
  files: ["src/components/Cart.tsx"],
};

const out = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const die = (message, code) => {
  process.stderr.write(`${message}\n`);
  process.exit(code);
};

export async function main(argv) {
  if (argv[0] === "--version") {
    console.log(process.env.FAKE_AGY_VERSION ?? "1.2.7");
    return 0;
  }
  const flags = parseFlags(argv);
  if (flags.get("--output-format") !== "stream-json" || flags.get("--input-format") !== "stream-json") die("the fake speaks --output-format stream-json --input-format stream-json only", 2);
  if (!flags.has("--print")) die("flag needs an argument: -print", 2);
  if (flags.get("--print") !== "") die("Prompts are read only from stdin in stream-json input mode; the fake takes no --print prompt", 2);
  if (!flags.has("--dangerously-skip-permissions")) die("headless mode auto-denies every tool; the driver must pass --dangerously-skip-permissions (F-111)", 2);
  if (flags.has("--effort")) die(`error: invalid model selection (--model "${flags.get("--model")}" --effort "${flags.get("--effort")}"): --model conflicts with --effort`, 1);
  const addDirs = flags.get("--add-dir") ?? [];
  if (!addDirs.length) die("the fake needs --add-dir <sessionDir> with the CRT plugin (F-111)", 2);
  if (process.env.FAKE_AGY_AUTH === "logged-out") die("Print mode: not logged in and no controlling terminal; cannot complete interactive login", 1);

  // The plugins under every --add-dir: MCP servers first (before init, as recorded), then hooks.
  const plugins = addDirs.flatMap(discoverPlugins);
  const servers = new Map();
  for (const plugin of plugins) {
    for (const [name, cfg] of Object.entries(plugin.mcp)) {
      const namespaced = `${plugin.name}_${name}`;
      try {
        servers.set(namespaced, await connectMcp(cfg, plugin.dir));
      } catch (err) {
        process.stderr.write(`error: MCP server ${namespaced} failed to start: ${err.message}\n`);
      }
    }
  }
  const hooks = process.env.FAKE_AGY_NO_HOOKS ? [] : plugins.flatMap((p) => p.hooks);

  const requested = flags.get("--conversation") ?? null;
  const mismatch = Boolean(process.env.FAKE_AGY_RESUME_MISMATCH);
  let conversationId;
  let resumed = false;
  if (requested !== null && !mismatch && /^[0-9a-f-]{36}$/i.test(requested)) {
    conversationId = requested;
    resumed = true;
  } else {
    if (requested !== null) process.stderr.write(`warning: conversation "${requested}" not found\n`);
    conversationId = process.env.FAKE_AGY_THREAD ?? randomUUID();
  }
  const model = flags.get("--model") ?? null;
  out({ event: "init", conversation_id: conversationId, init: { ...(model ? { model } : {}), cwd: process.cwd(), tools: TOOLS, permission_mode: "always-proceed" } });

  let step = resumed ? 4 : 0;
  let turns = 0;
  const finish = (code) => {
    for (const s of servers.values()) s.close();
    return code;
  };
  for await (const line of stdinLines()) {
    if (!line.trim()) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch (err) {
      return finish(inputError(conversationId, `failed to decode stream input: ${err.message}`));
    }
    if (typeof msg.event !== "string") return finish(inputError(conversationId, 'stream input message is missing the "event" field'));
    if (msg.event !== "user") {
      process.stderr.write(`warning: ignoring unsupported stream input message event ${JSON.stringify(msg.event)}\n`);
      continue;
    }
    if (!msg.message) return finish(inputError(conversationId, 'stream input "user" message is missing the "message" field'));
    const content = msg.message.content;
    let prompt;
    if (typeof content === "string") prompt = content;
    else if (Array.isArray(content)) {
      const bad = content.find((b) => b?.type !== "text");
      if (bad) return finish(inputError(conversationId, `stream input content block type ${JSON.stringify(bad?.type)} is not supported (only "text")`));
      prompt = content.map((b) => b.text ?? "").join("");
    } else return finish(inputError(conversationId, 'stream input "user" content must be a string or a list of content blocks'));
    if (!prompt.trim()) return finish(inputError(conversationId, 'stream input "user" message has no content'));

    turns++;
    const turn = { conversationId, step, hooks, servers, turns, prompt, resumed: resumed && turns === 1 };
    step = await runTurn(turn);
  }
  process.stderr.write(`Print mode: stream input closed after ${turns} turn(s)\n`);
  return finish(0);
}

function inputError(conversationId, error) {
  process.stderr.write(`error: ${error}\n`);
  out({ event: "result", result: { conversation_id: conversationId, status: "ERROR", response: "", error, duration_seconds: 0, num_turns: 0, usage: zeroUsage() } });
  return 1;
}

const zeroUsage = () => ({ input_tokens: 0, output_tokens: 0, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 0 });

/** Go-style flags: `--flag value`, `--flag=value`, booleans; unknown flags exit 2 like the real binary. */
function parseFlags(argv) {
  const flags = new Map();
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let value;
    const eq = a.indexOf("=");
    if (a.startsWith("-") && eq !== -1) {
      value = a.slice(eq + 1);
      a = a.slice(0, eq);
    }
    if (a === "-p") a = "--print";
    if (a === "--prompt") a = "--print";
    if (BOOL_FLAGS.has(a)) {
      flags.set(a, true);
      continue;
    }
    if (!VALUE_FLAGS.has(a)) {
      if (a.startsWith("-")) die(`flags provided but not defined: ${a.replace(/^--?/, "-")}\nUsage of agy.exe:`, 2);
      die("Prompts are read only from -p/--print, -i/--prompt-interactive, or stdin, so this argument would have been ignored.", 2);
    }
    if (value === undefined) {
      if (i + 1 >= argv.length) die(`flag needs an argument: ${a.replace(/^--/, "-")}`, 2);
      value = argv[++i];
    }
    if (a === "--add-dir") flags.set(a, [...(flags.get(a) ?? []), value]);
    else flags.set(a, value);
  }
  return flags;
}

/** `<dir>/.agents/plugins/<name>/` with plugin.json (the marker), mcp_config.json and hooks.json. */
function discoverPlugins(addDir) {
  const root = join(addDir, ".agents", "plugins");
  if (!existsSync(root)) return [];
  const plugins = [];
  for (const name of readdirSync(root)) {
    const dir = join(root, name);
    if (!existsSync(join(dir, "plugin.json"))) continue;
    const manifest = JSON.parse(readFileSync(join(dir, "plugin.json"), "utf8"));
    const mcp = existsSync(join(dir, "mcp_config.json")) ? (JSON.parse(readFileSync(join(dir, "mcp_config.json"), "utf8")).mcpServers ?? {}) : {};
    const hooks = [];
    if (existsSync(join(dir, "hooks.json"))) {
      const spec = JSON.parse(readFileSync(join(dir, "hooks.json"), "utf8"));
      for (const [hookName, events] of Object.entries(spec)) {
        if (events.enabled === false) continue;
        for (const group of events.PreToolUse ?? []) {
          for (const h of group.hooks ?? []) hooks.push({ event: "PreToolUse", name: hookName, matcher: group.matcher ?? "*", command: h.command, timeout: h.timeout ?? 30, dir });
        }
        for (const h of events.PreInvocation ?? []) hooks.push({ event: "PreInvocation", name: hookName, matcher: "*", command: h.command, timeout: h.timeout ?? 30, dir });
      }
    }
    plugins.push({ name: manifest.name ?? name, dir, mcp, hooks });
  }
  return plugins;
}

/** Run a hook command the way agy does: `cmd /c` / `sh -c`, cwd = the plugin dir, JSON in, JSON out. */
function runHook(hook, payload) {
  const shell = process.platform === "win32" ? ["cmd", ["/c", hook.command]] : ["sh", ["-c", hook.command]];
  const r = spawnSync(shell[0], shell[1], { cwd: hook.dir, input: JSON.stringify(payload), encoding: "utf8", timeout: hook.timeout * 1000, windowsHide: true, shell: false });
  if (r.status !== 0) throw new Error(`JSON hook "jsonhook__${hook.name}_${hook.event}_0_0" failed: command failed: exit status ${r.status ?? "?"}, stderr: ${(r.stderr ?? "").trim()}`);
  try {
    return JSON.parse(r.stdout || "{}");
  } catch {
    throw new Error(`JSON hook "jsonhook__${hook.name}_${hook.event}_0_0" failed: invalid JSON on stdout`);
  }
}

function matches(matcher, toolName) {
  if (!matcher || matcher === "*") return true;
  return matcher.split("\\|").some((m) => new RegExp(`^${m}$`).test(toolName));
}

/** The recorded events of a fixture, conversation ids swapped for this run's and steps renumbered from `base`. */
function fixture(name, conversationId, base) {
  const events = readFileSync(join(FIXTURES, name), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#"))
    .map((l) => JSON.parse(l));
  const first = events.find((e) => e.event === "step_update")?.step_update.step_index ?? 0;
  return events.map((e) => {
    if (e.event === "init") return { ...e, conversation_id: conversationId };
    if (e.event === "step_update") return { ...e, step_update: { ...e.step_update, conversation_id: conversationId, step_index: e.step_update.step_index - first + base } };
    if (e.event === "result") return { ...e, result: { ...e.result, conversation_id: conversationId } };
    return e;
  });
}

async function runTurn(t) {
  const common = { conversationId: t.conversationId, workspacePaths: [process.cwd()], modelName: "gemini-3.8-flash-high" };
  const stepUpdate = (s) => out({ event: "step_update", step_update: { conversation_id: t.conversationId, ...s } });
  let step = t.step;
  stepUpdate({ step_index: step++, state: "DONE", step_type: "user_input" });
  const preInvocation = () => {
    for (const h of t.hooks.filter((h) => h.event === "PreInvocation")) {
      try {
        runHook(h, { ...common, invocationNum: 0, initialNumSteps: step });
      } catch (err) {
        process.stderr.write(`error: ${err.message}\n`);
      }
    }
  };
  /** Run a tool step through the PreToolUse hooks; `execute` runs when allowed and returns the output. */
  const tool = async (name, parameters, execute) => {
    const index = step++;
    const info = { name, parameters };
    stepUpdate({ step_index: index, state: "ACTIVE", step_type: "tool", tool_name: name, tool_info: info });
    let denied = null;
    for (const h of t.hooks.filter((h) => h.event === "PreToolUse" && matches(h.matcher, name))) {
      try {
        const d = runHook(h, { ...common, stepIdx: index, toolCall: { name, args: parameters } });
        if (d.decision === "deny") denied = `tool call denied by pre-tool hook: ${d.reason ?? ""}`.trim();
      } catch (err) {
        denied = err.message;
      }
      if (denied) break;
    }
    if (denied) {
      stepUpdate({ step_index: index, state: "ERROR", step_type: "tool", tool_name: name, duration_seconds: 0.01, tool_info: { ...info, error: { type: "TOOL_ERROR", message: denied } } });
      return { ok: false, text: denied };
    }
    try {
      const output = await execute();
      stepUpdate({ step_index: index, state: "DONE", step_type: "tool", tool_name: name, duration_seconds: 0.05, tool_info: { ...info, output } });
      return { ok: true, text: output };
    } catch (err) {
      stepUpdate({ step_index: index, state: "ERROR", step_type: "tool", tool_name: name, duration_seconds: 0.05, tool_info: { ...info, error: { type: "TOOL_ERROR", message: err.message } } });
      return { ok: false, text: err.message };
    }
  };
  const say = (text) => {
    const index = step++;
    const usage = { input_tokens: 12345, output_tokens: 42, thinking_tokens: 30, cache_read_tokens: 0, total_tokens: 12387 };
    for (const chunk of text.match(/.{1,12}/g) ?? [""]) stepUpdate({ step_index: index, state: "ACTIVE", step_type: "agent_response", text_delta: chunk });
    stepUpdate({ step_index: index, state: "DONE", step_type: "agent_response", text_delta: "\n", duration_seconds: 1.5, usage });
    return `${text}\n`;
  };
  const result = (response, extra = {}) => {
    out({ event: "result", result: { conversation_id: t.conversationId, status: "SUCCESS", response, duration_seconds: 2, num_turns: t.turns, usage: { input_tokens: 12345, output_tokens: 42, thinking_tokens: 30, cache_read_tokens: 0, total_tokens: 12387 }, ...extra } });
    return step;
  };

  preInvocation();
  const lastParagraph = t.prompt.trim().split(/\n{2,}/).at(-1) ?? "";
  const quick = /^Quick note \(F-14\)/.test(lastParagraph);
  if (/\bslow\b/i.test(t.prompt)) {
    await new Promise((r) => setTimeout(r, 60_000)); // to be killed by interrupt()
    return step;
  }
  // The first message is the intake text, which mentions writing; only its F-14 sentinel triggers the write there.
  if (t.turns > 1 ? /\bwrite\b/i.test(t.prompt) : quick) {
    const server = t.servers.get("crt_crt");
    const r = await tool("call_mcp_tool", { Arguments: WRITE_TASK_REQUEST, ServerName: "crt_crt", ToolName: "write_task" }, async () => {
      if (!server) throw new Error("MCP server crt_crt is not connected");
      if (!server.tools.includes("write_task")) throw new Error(`server crt_crt has no tool write_task (has ${server.tools.join(", ")})`);
      const res = await server.call("write_task", WRITE_TASK_REQUEST);
      const text = (res.content ?? []).map((c) => c.text ?? "").join("\n");
      if (res.isError) throw new Error(text || "write_task failed");
      return text;
    });
    preInvocation();
    const response = say(r.ok ? `${r.text}. Anything else?` : `write_task failed: ${r.text}`);
    return result(response);
  }

  // Replay the recording: every tool step goes through the hooks; text and usage are the fixture's.
  const events = fixture(t.resumed ? "resume.jsonl" : "image-by-path.jsonl", t.conversationId, t.step);
  let text = "";
  let textStep = null;
  const pending = new Map();
  for (const e of events) {
    if (e.event !== "step_update") {
      if (e.event === "result") return result(text, e.result.denied_actions ? { denied_actions: e.result.denied_actions } : {});
      continue;
    }
    const s = e.step_update;
    if (s.step_type === "user_input") continue;
    if (s.step_type === "tool") {
      if (s.state === "ACTIVE") {
        pending.set(s.step_index, s);
        continue;
      }
      const started = pending.get(s.step_index) ?? s;
      pending.delete(s.step_index);
      step = s.step_index;
      if (s.tool_name === "call_mcp_tool" && !t.servers.has(String(started.tool_info?.parameters?.ServerName))) continue; // the spike's probe server is not here
      await tool(s.tool_name, started.tool_info?.parameters ?? {}, async () => {
        if (s.state === "ERROR") throw new Error(s.tool_info?.error?.message ?? "failed");
        return s.tool_info?.output ?? "";
      });
      continue;
    }
    if (s.step_type === "agent_response") {
      if (textStep !== s.step_index) preInvocation();
      textStep = s.step_index;
      step = s.step_index + 1;
      text += s.text_delta ?? "";
      stepUpdate({ ...s, step_index: s.step_index });
      continue;
    }
    stepUpdate(s); // system_message and the like
  }
  return result(text);
}

async function* stdinLines() {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      yield buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
    }
  }
  if (buffer.trim()) yield buffer;
}

/** Spawn a plugin's MCP server the way agy does — the inherited environment plus `env`, cwd = the plugin dir — and do initialize/tools/list. */
async function connectMcp(cfg, pluginDir) {
  if (!cfg.command) throw new Error("mcp_config.json server has no command");
  const child = spawn(cfg.command, cfg.args ?? [], { env: { ...process.env, ...(cfg.env ?? {}) }, cwd: pluginDir, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
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
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const w = waiters.get(msg.id);
      if (w) {
        waiters.delete(msg.id);
        w(msg);
      }
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (c) => process.stderr.write(`[crt mcp] ${c}`));
  let nextId = 1;
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
  const failed = new Promise((_, reject) => child.on("error", (err) => reject(new Error(`could not start: ${err.message}`))));
  await Promise.race([request("server/discover", { _meta: {} }).catch(() => undefined), failed]);
  await Promise.race([request("initialize", { clientInfo: { name: "antigravity-client", version: "v1.0.0" }, protocolVersion: "2025-11-25", capabilities: { elicitation: { form: {}, url: {} }, roots: { listChanged: true } } }), failed]);
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`);
  const list = await request("tools/list", {});
  return {
    tools: (list.tools ?? []).map((t) => t.name),
    call: (name, args) => request("tools/call", { name, arguments: args }),
    close: () => {
      try {
        child.stdin.end();
      } catch {
        // already gone
      }
    },
  };
}

if (process.argv[1] && /fake-agy\.mjs$/.test(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
