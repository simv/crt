// Drive the real CRT ACP driver (dist) against the real `gemini --acp` with a throwaway MCP probe
// as the `crt mcp` server: prints every SessionEvent. `node driver-run.mjs [message]`.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { geminiProfile } from "../../../../packages/server/dist/providers/gemini.js";

const here = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.SPIKE_REPO ?? resolve(here, "../../../../../crt-gemini-spike-repo");
const text = process.argv[2] ?? "Reply with the single word pong.";
const t0 = Date.now();
const driver = geminiProfile.start({
  id: "00000000-0000-4000-8000-000000000000",
  cwd: REPO,
  systemPromptAppend: "",
  first: { text, images: [] },
  decide: () => ({ kind: "ask" }),
  writeTask: async () => ({ id: "CRT-9999", path: ".crt/tasks/CRT-9999.md" }),
  mcp: { command: process.execPath, args: [join(here, "mcp-probe.mjs")], env: { PROBE_LOG: join(here, "out", "driver-run.mcp.log"), CRT_MCP_TOKEN: "probe-token", CRT_MCP_PORT: "4400" } },
  model: null,
  agentVersion: "0.60.0",
  permissionTimeoutMs: 20_000,
  log: (l) => console.log(`[log] ${l}`),
});
driver.onEvent((e) => {
  console.log(`[${String(Date.now() - t0).padStart(6)}ms]`, JSON.stringify(e).slice(0, 400));
  if (e.type === "permission") setTimeout(() => driver.respondPermission(e.id, "allow"), 100);
  if (e.type === "state" && (e.state === "idle" || e.state === "error")) {
    setTimeout(() => {
      driver.close();
      setTimeout(() => process.exit(0), 2500);
    }, 200);
  }
});
