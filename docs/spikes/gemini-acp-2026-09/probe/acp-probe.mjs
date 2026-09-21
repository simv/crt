// Throwaway ACP client for the CRT-0013 spike (PRD-providers F-54, M10). Spawns `gemini --acp`
// (or any command after `--`), drives one scenario over newline-delimited JSON-RPC 2.0 and
// records every line both ways to out/<name>.jsonl (the fixture material) plus a readable
// out/<name>.log. Answers `session/request_permission` Allow first, then Deny.
//
//   node acp-probe.mjs init      [--flag]           initialize only
//   node acp-probe.mjs new       [--flag]           initialize + session/new with the MCP probe
//   node acp-probe.mjs prompt    [--image] "<text>" full turn; permission answers allow, deny, deny…
//   node acp-probe.mjs cancel    "<text>"           prompt, then session/cancel after 1500 ms
//   node acp-probe.mjs badver                       initialize with protocolVersion 999
//   node acp-probe.mjs noauth    "<text>"           like prompt, with an empty HOME (logged out)
//   … -- <command> [args]                           drive another ACP agent instead of gemini
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveExecutable } from "../../../../packages/server/dist/providers/exec.js";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "out");
mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2);
const dash = args.indexOf("--");
const scenario = args[0] ?? "init";
const flags = new Set(args.slice(1, dash === -1 ? undefined : dash).filter((a) => a.startsWith("--")));
const positional = args.slice(1, dash === -1 ? undefined : dash).filter((a) => !a.startsWith("--"));
const text = positional[0] ?? "Reply with the single word pong.";
const name = `${scenario}${flags.has("--image") ? "-image" : ""}`;
const REPO = process.env.SPIKE_REPO ?? resolve(here, "../../../../../crt-gemini-spike-repo");
const jsonl = join(OUT, `${name}.jsonl`);
const logFile = join(OUT, `${name}.log`);
const probeLog = join(OUT, `${name}.mcp.log`);
writeFileSync(jsonl, "");
writeFileSync(logFile, "");
writeFileSync(probeLog, "");

const t0 = Date.now();
const log = (line) => {
  const s = `[${String(Date.now() - t0).padStart(6)}ms] ${line}`;
  console.log(s);
  appendFileSync(logFile, s + "\n");
};
const record = (dir, line) => appendFileSync(jsonl, JSON.stringify({ t: Date.now() - t0, dir, msg: JSON.parse(line) }) + "\n");

let command, cmdArgs;
if (dash !== -1) {
  [command, ...cmdArgs] = args.slice(dash + 1);
} else {
  const exe = resolveExecutable("gemini");
  if (!exe) throw new Error("gemini not found on PATH");
  command = exe.command;
  cmdArgs = [...exe.args, flags.has("--experimental") ? "--experimental-acp" : "--acp"];
  log(`resolved gemini via ${exe.via}: ${exe.found}`);
}
const env = { ...process.env };
if (scenario === "noauth") {
  const empty = join(OUT, "empty-home");
  mkdirSync(empty, { recursive: true });
  env.HOME = empty;
  env.USERPROFILE = empty;
  env.APPDATA = empty;
  env.LOCALAPPDATA = empty;
  delete env.GEMINI_API_KEY;
  delete env.GOOGLE_API_KEY;
  delete env.GOOGLE_APPLICATION_CREDENTIALS;
}
log(`spawn: ${command} ${cmdArgs.join(" ")}  (cwd ${REPO})`);
const child = spawn(command, cmdArgs, { cwd: REPO, env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
child.on("exit", (code, signal) => log(`agent exited code=${code} signal=${signal}`));
child.stderr.setEncoding("utf8");
child.stderr.on("data", (c) => c.split(/\r?\n/).filter(Boolean).forEach((l) => log(`stderr: ${l}`)));

let nextId = 1;
const pending = new Map();
const send = (msg) => {
  const line = JSON.stringify(msg);
  record("out", line);
  log(`→ ${line.length > 600 ? line.slice(0, 600) + "…" : line}`);
  child.stdin.write(line + "\n");
};
const request = (method, params) =>
  new Promise((res, rej) => {
    const id = nextId++;
    pending.set(id, { res, rej, method });
    send({ jsonrpc: "2.0", id, method, params });
  });
const notify = (method, params) => send({ jsonrpc: "2.0", method, params });

let permissionCount = 0;
let buf = "";
child.stdout.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (!line) continue;
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      log(`stdout (not JSON): ${line}`);
      continue;
    }
    record("in", line);
    log(`← ${line.length > 600 ? line.slice(0, 600) + "…" : line}`);
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined) && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.rej(Object.assign(new Error(`${p.method}: ${msg.error.message}`), { rpc: msg.error }));
      else p.res(msg.result);
      continue;
    }
    if (msg.method === "session/request_permission") {
      permissionCount += 1;
      const options = msg.params.options ?? [];
      const want = permissionCount === 1 ? "allow_once" : "reject_once";
      const pick = options.find((o) => o.kind === want) ?? options.find((o) => o.kind.startsWith(permissionCount === 1 ? "allow" : "reject"));
      log(`permission #${permissionCount}: kind=${msg.params.toolCall?.kind} title=${JSON.stringify(msg.params.toolCall?.title)} options=${options.map((o) => `${o.optionId}:${o.kind}`).join(",")} → ${pick ? pick.optionId : "cancelled"}`);
      setTimeout(() => send({ jsonrpc: "2.0", id: msg.id, result: pick ? { outcome: { outcome: "selected", optionId: pick.optionId } } : { outcome: { outcome: "cancelled" } } }), 200);
      continue;
    }
    if (msg.id !== undefined && msg.method) {
      // Any other agent→client request: we advertised no fs/terminal, so refuse.
      send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: `client does not implement ${msg.method}` } });
    }
  }
});

const closeAgent = async () => {
  log("closing: end stdin, wait 2 s, kill");
  const t = Date.now();
  const exited = new Promise((res) => child.once("exit", () => res(true)));
  child.stdin.end();
  const done = await Promise.race([exited, new Promise((res) => setTimeout(() => res(false), 2000))]);
  log(done ? `agent exited on stdin end after ${Date.now() - t} ms` : "agent still running 2 s after stdin end → kill");
  if (!done) child.kill();
};

const mcpServer = {
  name: "crt",
  command: process.execPath,
  args: [join(here, "mcp-probe.mjs")],
  env: [
    { name: "PROBE_LOG", value: probeLog },
    { name: "CRT_MCP_TOKEN", value: "probe-token-not-secret" },
    { name: "CRT_MCP_PORT", value: "4400" },
  ],
};

async function main() {
  const init = await request("initialize", {
    protocolVersion: scenario === "badver" ? 999 : 1,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: "crt-probe", version: "0.0.0" },
  });
  log(`initialize → ${JSON.stringify(init)}`);
  if (scenario === "init" || scenario === "badver") return;

  const sess = await request("session/new", { cwd: REPO, mcpServers: [mcpServer] });
  log(`session/new → ${JSON.stringify(sess)}`);
  if (scenario === "new") return;

  const prompt = [{ type: "text", text }];
  if (flags.has("--image")) {
    const png = readFileSync(join(here, "../../codex-2026-09/probe/red.png")).toString("base64");
    prompt.push({ type: "image", mimeType: "image/png", data: png });
  }
  const turn = request("session/prompt", { sessionId: sess.sessionId, prompt });
  if (scenario === "cancel") {
    setTimeout(() => {
      log("session/cancel");
      notify("session/cancel", { sessionId: sess.sessionId });
    }, 1500);
  }
  try {
    const r = await turn;
    log(`session/prompt → ${JSON.stringify(r)}`);
  } catch (err) {
    log(`session/prompt failed: ${err.message} ${JSON.stringify(err.rpc ?? null)}`);
  }
  if (scenario === "cancel") {
    // A second prompt after cancel: does the session still work?
    const r2 = await request("session/prompt", { sessionId: sess.sessionId, prompt: [{ type: "text", text: "Reply with the single word pong." }] });
    log(`second session/prompt → ${JSON.stringify(r2)}`);
  }
}

main()
  .catch((err) => log(`FAILED: ${err.message} ${JSON.stringify(err.rpc ?? null)}`))
  .then(closeAgent)
  .then(() => log(`done; ${jsonl}`));
