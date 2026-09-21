// The stream-json loop probe for CRT-0023: one agy process, several turns over stdin, each
// written only after the previous `result` event. Records out/<name>.jsonl (stdout as printed),
// out/<name>.stderr.txt and out/<name>.meta.json.
//
//   node loop.mjs <name> [--cwd <dir>] [--env K=V]... [--kill-on <regex>] [--kill-after <ms>] -- <agy args...> -- <message json>...
//
// Each <message json> is one NDJSON line; the literal `@sleep:<ms>` waits instead of sending.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "out");
mkdirSync(out, { recursive: true });
const AGY = process.env.AGY || join(process.env.LOCALAPPDATA || "", "agy", "bin", "agy.exe");
const REPO = process.env.SPIKE_REPO || join(here, "..", "..", "..", "..", "..", "crt-agy-spike-repo");

const argv = process.argv.slice(2);
const name = argv.shift();
let cwd = REPO;
let killOn = null;
let killAfter = 0;
const env = { ...process.env };
while (argv.length && argv[0] !== "--") {
  const a = argv.shift();
  if (a === "--cwd") cwd = argv.shift();
  else if (a === "--env") {
    const kv = argv.shift();
    const eq = kv.indexOf("=");
    env[kv.slice(0, eq)] = kv.slice(eq + 1);
  } else if (a === "--kill-on") killOn = new RegExp(argv.shift());
  else if (a === "--kill-after") killAfter = Number(argv.shift());
  else throw new Error(`unknown option ${a}`);
}
argv.shift();
const sep = argv.indexOf("--");
const args = argv.slice(0, sep);
const messages = argv.slice(sep + 1);

const started = Date.now();
console.log(`> ${AGY} ${args.join(" ")}\n  cwd=${cwd}`);
const child = spawn(AGY, args, { cwd, env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
writeFileSync(join(out, `${name}.pid`), String(child.pid));
let so = "";
let se = "";
let buffer = "";
let killed = false;
const times = [];
const kill = (why) => {
  if (killed) return;
  killed = true;
  const r = spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { shell: false, windowsHide: true, encoding: "utf8" });
  console.log(`[kill:${why}] taskkill /T /F /PID ${child.pid} → exit ${r.status}\n${r.stdout}${r.stderr}`);
};
let resolveResult = null;
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (c) => {
  so += c;
  process.stdout.write(c);
  buffer += c;
  let idx;
  while ((idx = buffer.indexOf("\n")) !== -1) {
    const line = buffer.slice(0, idx);
    buffer = buffer.slice(idx + 1);
    times.push(`${new Date().toISOString()} ${line.slice(0, 160)}`);
    if (killOn && killOn.test(line)) kill(`matched ${killOn}`);
    try {
      const ev = JSON.parse(line);
      if (ev.event === "result" && resolveResult) resolveResult(ev);
    } catch {
      // not JSON
    }
  }
});
child.stderr.on("data", (c) => {
  se += c;
  process.stderr.write(`[stderr] ${c}`);
});
child.stdin.on("error", () => undefined);
const waitResult = () =>
  new Promise((resolve) => {
    resolveResult = resolve;
  });
if (killAfter > 0) setTimeout(() => kill(`after ${killAfter}ms`), killAfter);
const exited = new Promise((resolve) => {
  child.on("exit", (code, signal) => {
    const ms = Date.now() - started;
    console.log(`< exit code=${code} signal=${signal} after ${ms}ms`);
    writeFileSync(join(out, `${name}.jsonl`), so);
    writeFileSync(join(out, `${name}.stderr.txt`), se);
    writeFileSync(join(out, `${name}.times.txt`), `${times.join("\n")}\n`);
    writeFileSync(join(out, `${name}.meta.json`), JSON.stringify({ cmd: [AGY, ...args], cwd, code, signal, ms, messages }, null, 2));
    resolve();
  });
});
for (const m of messages) {
  if (m.startsWith("@sleep:")) {
    await new Promise((r) => setTimeout(r, Number(m.slice(7))));
    continue;
  }
  const p = waitResult();
  console.log(`>> ${m.slice(0, 200)}`);
  child.stdin.write(`${m}\n`);
  await Promise.race([p, exited]);
}
console.log(">> (stdin end)");
child.stdin.end();
await exited;
