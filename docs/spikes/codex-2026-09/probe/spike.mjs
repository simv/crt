// CRT-0009 spike runner: builds the argv the CRT Codex driver (PRD-providers F-53) would pass
// and hands it to run.mjs. Run from this directory with the listener up (see ../../codex-2026-09.md).
//   node spike.mjs <run-name> turn1  [prompt] [extra codex args...]
//   node spike.mjs <run-name> resume <threadId> [prompt] [extra codex args...]
//   node spike.mjs <run-name> raw    <codex args...>          (prompt from $PROMPT, default "")
// env: CODEX_EXE (default: resolved from `npm root -g`), PROBE_PORT (default 47123),
//      RUN_CWD (set automatically to the scratch repo for resume), OUT_DIR (default ./out)
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = process.env.SPIKE_REPO || join(here, "..", "..", "..", "..", "..", "crt-codex-spike-repo");
const NODE = process.execPath;
const PORT = process.env.PROBE_PORT || "47123";

function resolveCodexExe() {
  if (process.env.CODEX_EXE) return process.env.CODEX_EXE;
  // npm layout observed for @openai/codex 0.154.0: the .cmd shim runs bin/codex.js, which
  // spawns the platform package's vendor/<triple>/bin/codex.exe. Spawn that directly (N-10).
  const root = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["root", "-g"], { encoding: "utf8", shell: process.platform === "win32" }).stdout.trim();
  const triple = process.platform === "win32" ? "x86_64-pc-windows-msvc" : process.platform === "darwin" ? `${process.arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin` : `${process.arch === "arm64" ? "aarch64" : "x86_64"}-unknown-linux-musl`;
  const pkg = `codex-${process.platform === "win32" ? "win32" : process.platform}-${process.arch}`;
  const exe = join(root, "@openai", "codex", "node_modules", "@openai", pkg, "vendor", triple, "bin", process.platform === "win32" ? "codex.exe" : "codex");
  if (!existsSync(exe)) throw new Error(`codex executable not found at ${exe}; set CODEX_EXE`);
  return exe;
}
const CODEX_EXE = resolveCodexExe();

const [runName, mode, ...rest] = process.argv.slice(2);
if (!runName || !mode) throw new Error("usage: node spike.mjs <run-name> <turn1|resume|raw> …");
const outDir = process.env.OUT_DIR || join(here, "out");
const probeLog = join(outDir, `${runName}.probe.log`);

// TOML literal strings ('…') so Windows backslashes need no escaping (observed to work, 0.154.0).
const mcpFlags = [
  "-c", `mcp_servers.crt.command='${NODE}'`,
  "-c", `mcp_servers.crt.args=['${join(here, "mcp-probe.mjs")}']`,
  "-c", `mcp_servers.crt.env={PROBE_LOG='${probeLog}', PROBE_PORT='${PORT}'}`,
];
const common = [
  "--json",
  "-c", `approval_policy="never"`, // `codex exec --ask-for-approval` is rejected (exit 2) on 0.154.0
  // Without this, every MCP tool call fails under approval_policy=never:
  // "MCP tool call requires approval, but approval policy is never" (observed 0.154.0).
  "-c", `mcp_servers.crt.default_tools_approval_mode="approve"`,
  "-c", `model_reasoning_effort="low"`, // spike only: Simon's config.toml says xhigh
  ...mcpFlags,
  "--image", join(here, "red.png"),
];

let args;
let prompt;
let cwd;
if (mode === "turn1") {
  prompt = rest[0] || "Ping the CRT server with the message 'turn one' using the crt_ping tool and report the reply verbatim. Then run one shell command that prints every environment variable whose name starts with CODEX (PowerShell: Get-ChildItem Env:CODEX*) and quote its output. Reply in at most three short lines.";
  args = ["exec", ...common, "--sandbox", "read-only", "-C", repo, ...rest.slice(1), "-"];
} else if (mode === "resume") {
  const threadId = rest[0];
  if (!threadId) throw new Error("resume needs a thread id");
  prompt = rest[1] || "Ping the CRT server again with the message 'turn two' using crt_ping and report the reply verbatim, then tell me what message you pinged with in the previous turn.";
  // exec resume has no --sandbox / -C on 0.154.0: sandbox via -c, project via cwd.
  args = ["exec", "resume", threadId, ...common, "-c", `sandbox_mode="read-only"`, ...rest.slice(2), "-"];
  cwd = repo;
} else if (mode === "raw") {
  prompt = process.env.PROMPT ?? "";
  args = rest;
} else {
  throw new Error(`unknown mode ${mode}`);
}

const r = spawnSync(NODE, [join(here, "run.mjs"), runName, prompt, "--", ...args], {
  stdio: "inherit",
  env: { ...process.env, CODEX_EXE, OUT_DIR: outDir, ...(cwd ? { RUN_CWD: cwd } : {}) },
});
process.exit(r.status ?? 1);
