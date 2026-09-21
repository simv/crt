// Generic runner for the CRT-0023 spike: spawn agy.exe (shell: false) from the scratch repo,
// record stdout / stderr / exit code / timing under out/<name>.*, optionally feed stdin.
//
//   node run.mjs <name> [--stdin <text | @file>] [--cwd <dir>] [--env K=V]... [--kill-after <ms>] -- <agy args...>
//
// AGY defaults to %LOCALAPPDATA%\agy\bin\agy.exe; SPIKE_REPO to ..\..\..\..\..\crt-agy-spike-repo.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "out");
mkdirSync(out, { recursive: true });
const AGY = process.env.AGY || join(process.env.LOCALAPPDATA || "", "agy", "bin", "agy.exe");
const REPO = process.env.SPIKE_REPO || join(here, "..", "..", "..", "..", "..", "crt-agy-spike-repo");

const argv = process.argv.slice(2);
const name = argv.shift();
if (!name) {
  console.error("usage: node run.mjs <name> [--stdin <text|@file>] [--cwd <dir>] [--env K=V]... [--kill-after <ms>] -- <agy args...>");
  process.exit(2);
}
let stdin = null;
let cwd = REPO;
let killAfter = 0;
const env = { ...process.env };
while (argv.length && argv[0] !== "--") {
  const a = argv.shift();
  if (a === "--stdin") {
    const v = argv.shift();
    stdin = v.startsWith("@") ? readFileSync(v.slice(1), "utf8") : v;
  } else if (a === "--cwd") cwd = argv.shift();
  else if (a === "--env") {
    const kv = argv.shift();
    const eq = kv.indexOf("=");
    env[kv.slice(0, eq)] = kv.slice(eq + 1);
  } else if (a === "--kill-after") killAfter = Number(argv.shift());
  else {
    console.error(`unknown option ${a}`);
    process.exit(2);
  }
}
argv.shift(); // --
const args = argv;

const started = Date.now();
console.log(`> ${AGY} ${args.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(" ")}\n  cwd=${cwd}${stdin !== null ? `  stdin=${JSON.stringify(stdin.slice(0, 200))}` : ""}`);
const child = spawn(AGY, args, { cwd, env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
writeFileSync(join(out, `${name}.pid`), String(child.pid));
let so = "";
let se = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (c) => {
  so += c;
  process.stdout.write(c);
});
child.stderr.on("data", (c) => {
  se += c;
  process.stderr.write(`[stderr] ${c}`);
});
child.on("error", (e) => console.error(`spawn error: ${e.message}`));
if (stdin !== null) {
  child.stdin.on("error", () => undefined);
  child.stdin.end(stdin);
}
if (killAfter > 0) {
  setTimeout(() => {
    const r = spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { shell: false, windowsHide: true, encoding: "utf8" });
    console.log(`[kill] taskkill /T /F /PID ${child.pid} → exit ${r.status}\n${r.stdout}${r.stderr}`);
  }, killAfter);
}
child.on("exit", (code, signal) => {
  const ms = Date.now() - started;
  console.log(`< exit code=${code} signal=${signal} after ${ms}ms`);
  writeFileSync(join(out, `${name}.jsonl`), so);
  writeFileSync(join(out, `${name}.stderr.txt`), se);
  writeFileSync(join(out, `${name}.meta.json`), JSON.stringify({ cmd: [AGY, ...args], cwd, code, signal, ms, stdin }, null, 2));
});
