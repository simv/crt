// Turn the recorded runs under out/ into test/providers/fixtures/antigravity/*.jsonl: a `#`
// header (version, command, cwd, stdin messages, exit code, what the run shows), then the
// stdout lines verbatim. usage: node fixtures.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "out");
const dest = join(here, "..", "..", "..", "..", "packages", "server", "test", "providers", "fixtures", "antigravity");
mkdirSync(dest, { recursive: true });

const RUNS = [
  ["t10-skip-denyhook", "first-turn.jsonl", "one process, first turn: view_file (allowed by the CRT hook), call_mcp_tool crt_crt/crt_ping (allowed), run_command and write_to_file refused by the CRT PreToolUse hook, streamed text, result"],
  ["t4-loop", "loop.jsonl", "two turns over stdin in one process (--input-format stream-json): the same conversation_id, step indexes continue, num_turns counts up; text arrives as text_delta"],
  ["t12-resumed", "resume.jsonl", "--conversation <id> after the turn below was killed: init re-emits the same conversation_id, a system_message step, the model remembers the killed turn's message"],
  ["t12-killed", "killed.jsonl", "taskkill /T /F 9 s into the first turn: only init and the user_input step were printed; exit code 1"],
  ["t5b-resume-bogus", "resume-unknown-id.jsonl", "--conversation with an unknown id: stderr `warning: conversation \"…\" not found`, then init with a NEW conversation_id (the resume assertion catches this)"],
  ["t11-preinvoke-image", "image-by-path.jsonl", "a PNG path in the message text: the model reads it with view_file and answers `Red` (images travel by path)"],
  ["t6-mcp-adddir", "mcp-denied-headless.jsonl", "headless without --dangerously-skip-permissions: the MCP call is auto-denied (`user denied permission for mcp(crt_crt/crt_ping)`), result carries denied_actions — why the driver passes the flag and enforces its own allowlist through a PreToolUse hook"],
  ["t18-image-block", "input-error-image-block.jsonl", "an `image` content block on stdin: `stream input content block type \"image\" is not supported (only \"text\")`, result status ERROR, exit 1 — images cannot travel inline"],
];

for (const [run, name, note] of RUNS) {
  const stdout = join(out, `${run}.jsonl`);
  const meta = JSON.parse(readFileSync(join(out, `${run}.meta.json`), "utf8"));
  const stderr = existsSync(join(out, `${run}.stderr.txt`)) ? readFileSync(join(out, `${run}.stderr.txt`), "utf8").trim() : "";
  const lines = readFileSync(stdout, "utf8").split("\n").filter((l) => l.trim());
  const header = [
    `# agy 1.2.7 (Antigravity CLI, Windows 11, 2026-09-21) — CRT-0023 spike, docs/spikes/antigravity-2026-09.md`,
    `# command: agy.exe ${meta.cmd.slice(1).map((a) => (a === "" ? '""' : a)).join(" ")}`,
    `# cwd: ${meta.cwd}`,
    ...(meta.messages ?? (meta.stdin ? [meta.stdin] : [])).map((m) => `# stdin: ${m}`),
    `# exit: ${meta.code}${meta.signal ? ` signal ${meta.signal}` : ""} after ${meta.ms} ms`,
    ...(stderr ? stderr.split(/\r?\n/).map((l) => `# stderr: ${l}`) : []),
    ...(note ? [`# shows: ${note}`] : []),
  ];
  writeFileSync(join(dest, name), `${[...header, ...lines].join("\n")}\n`);
  console.log(`${name}: ${lines.length} events`);
}
