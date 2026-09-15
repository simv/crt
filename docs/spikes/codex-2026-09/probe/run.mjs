// Spawns codex.exe the way the CRT Codex driver will (PRD-providers F-53, N-10): the real
// executable, shell:false, prompt on stdin. Writes a fixture-shaped <out>.jsonl (# header lines
// naming version, command and exit code, then stdout verbatim), <out>.stderr.txt and <out>.pid.
// usage: node run.mjs <out-basename> <prompt> -- <codex args...>
//   env: CODEX_EXE (required), OUT_DIR (default: ./out), RUN_CWD (cwd for codex; resume needs it)
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const CODEX = process.env.CODEX_EXE;
if (!CODEX) throw new Error("set CODEX_EXE to the codex executable (see spike.mjs)");
const [outName, prompt, dashdash, ...args] = process.argv.slice(2);
if (dashdash !== "--") throw new Error("usage: node run.mjs <out> <prompt> -- <args>");
const outDir = process.env.OUT_DIR || join(process.cwd(), "out");
mkdirSync(outDir, { recursive: true });
const jsonl = join(outDir, outName + ".jsonl");
const errf = join(outDir, outName + ".stderr.txt");

const probe = spawnSync(CODEX, ["--version"], { encoding: "utf8", shell: false });
if (probe.error) throw new Error(`cannot run ${CODEX}: ${probe.error.message}`);
const version = probe.stdout.trim();
const cmdLine = ["codex.exe", ...args].join(" ");
writeFileSync(jsonl, `# ${version} — recorded ${new Date().toISOString().slice(0, 10)} on ${process.platform} (CRT-0009 spike, docs/spikes/codex-2026-09.md)\n# command: ${cmdLine}   (prompt on stdin${process.env.RUN_CWD ? `; cwd = ${process.env.RUN_CWD}` : ""})\n`);
writeFileSync(errf, "");

const started = Date.now();
console.error(`> ${CODEX} ${args.join(" ")}`);
const child = spawn(CODEX, args, { stdio: ["pipe", "pipe", "pipe"], shell: false, windowsHide: true, cwd: process.env.RUN_CWD || undefined });
writeFileSync(join(outDir, outName + ".pid"), String(child.pid));
child.stdout.on("data", (c) => { appendFileSync(jsonl, c); process.stdout.write(c); });
child.stderr.on("data", (c) => { appendFileSync(errf, c); process.stderr.write(c); });
child.on("close", (code, signal) => { // close, not exit: stdout is fully drained by then
  const ms = Date.now() - started;
  console.error(`< exit code=${code} signal=${signal} after ${ms}ms`);
  // The exit line goes at the end so the header stays "version, command" first; the
  // fixture test only requires those two.
  appendFileSync(jsonl, `# exit code ${code} (signal ${signal}) after ${ms} ms\n`);
});
child.stdin.end(prompt);
