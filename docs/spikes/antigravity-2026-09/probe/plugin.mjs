// Writes the per-session Antigravity plugin the spike used, under <repo>/.crt/agy (the directory
// handed to `agy --add-dir`): plugin.json, mcp_config.json (the crt_ping probe server, logging to
// PROBE_LOG), hooks.json with a PreToolUse allowlist hook and a PreInvocation marker hook, the
// hook scripts and their .cmd wrappers (agy runs hook commands through `cmd /c`, which mangles a
// quoted "C:\Program Files\nodejs\node.exe", so the command is the absolute path of a .cmd).
// usage: node plugin.mjs [--no-hooks] [--allow crt_crt]
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = process.env.SPIKE_REPO || join(here, "..", "..", "..", "..", "..", "crt-agy-spike-repo");
const addDir = join(repo, ".crt", "agy");
const plugin = join(addDir, ".agents", "plugins", "crt");
mkdirSync(plugin, { recursive: true });
const noHooks = process.argv.includes("--no-hooks");

writeFileSync(join(plugin, "plugin.json"), '{ "name": "crt" }\n');
writeFileSync(
  join(plugin, "mcp_config.json"),
  `${JSON.stringify({ mcpServers: { crt: { command: process.execPath, args: [join(here, "mcp-probe.mjs")], env: { PROBE_LOG: resolve(here, "out", "probe.log"), PROBE_PORT: "47124" } } } }, null, 2)}\n`,
);

// PreToolUse: read-only tools and the crt MCP server pass; everything else is denied (the CRT sandbox).
writeFileSync(
  join(plugin, "hook.mjs"),
  `import { appendFileSync } from "node:fs";
const READ_ONLY = new Set(["view_file", "list_dir", "grep_search", "find_by_name", "read_resource", "list_resources", "finish"]);
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  if (process.env.HOOK_LOG) appendFileSync(process.env.HOOK_LOG, JSON.stringify({ t: new Date().toISOString(), cwd: process.cwd(), input: input.trim() }) + "\\n");
  let payload = {};
  try { payload = JSON.parse(input); } catch {}
  const call = payload.toolCall || {};
  const args = call.args || {};
  const name = String(call.name || "");
  const allow = READ_ONLY.has(name) || (name === "call_mcp_tool" && String(args.ServerName || "") === "crt_crt");
  process.stdout.write(JSON.stringify(allow ? { decision: "allow" } : { decision: "deny", reason: \`CRT intake session: \${name} is not allowed here; only reading files and the crt MCP server are.\` }));
});
`,
);
// PreInvocation: prove the hooks are loaded before the model is called (a marker file per process).
writeFileSync(
  join(plugin, "preinvocation.mjs"),
  `import { appendFileSync, writeFileSync } from "node:fs";
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  if (process.env.HOOK_LOG) appendFileSync(process.env.HOOK_LOG, JSON.stringify({ t: new Date().toISOString(), hook: "PreInvocation", input: input.trim() }) + "\\n");
  writeFileSync(new URL("./preinvocation.marker", import.meta.url), new Date().toISOString());
  process.stdout.write("{}");
});
`,
);
writeFileSync(join(plugin, "hook.cmd"), `@"${process.execPath}" "%~dp0hook.mjs"\r\n`);
writeFileSync(join(plugin, "preinvoke.cmd"), `@"${process.execPath}" "%~dp0preinvocation.mjs"\r\n`);
if (!noHooks) {
  writeFileSync(
    join(plugin, "hooks.json"),
    `${JSON.stringify(
      {
        "crt-permissions": {
          PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: join(plugin, "hook.cmd"), timeout: 10 }] }],
          PreInvocation: [{ type: "command", command: join(plugin, "preinvoke.cmd"), timeout: 10 }],
        },
      },
      null,
      2,
    )}\n`,
  );
}
console.log(`plugin written under ${plugin}\n--add-dir ${addDir}`);
