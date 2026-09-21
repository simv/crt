// Print a recorded stream-json run as one line per step (deltas collapsed). usage: node summarize.mjs out/<name>.jsonl
import { readFileSync } from "node:fs";

const file = process.argv[2];
const lines = readFileSync(file, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .filter(Boolean);
const clip = (v, n = 300) => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > n ? `${s.slice(0, n)}…` : s;
};
let text = "";
let textStep = -1;
const flushText = () => {
  if (textStep >= 0) console.log(`${textStep} TEXT ${clip(text, 400)}`);
  text = "";
  textStep = -1;
};
for (const e of lines) {
  if (e.event === "init") {
    console.log(`init conversation=${e.conversation_id} tools=${e.init.tools.length} permission_mode=${e.init.permission_mode} cwd=${e.init.cwd}`);
    continue;
  }
  if (e.event === "step_update") {
    const s = e.step_update;
    if (s.step_type === "agent_response") {
      if (textStep !== s.step_index) flushText();
      textStep = s.step_index;
      text += s.text_delta ?? "";
      if (s.state === "DONE") {
        flushText();
        console.log(`${s.step_index} DONE agent_response usage=${JSON.stringify(s.usage)}`);
      }
      continue;
    }
    flushText();
    const ti = s.tool_info ?? {};
    const parts = [s.step_index, s.state, s.step_type, s.tool_name ?? ""];
    if (ti.parameters) parts.push(`params=${clip(ti.parameters, 220)}`);
    if (ti.output !== undefined) parts.push(`output=${clip(ti.output)}`);
    if (ti.error) parts.push(`error=${clip(ti.error)}`);
    const rest = Object.keys(s).filter((k) => !["conversation_id", "step_index", "state", "step_type", "tool_name", "tool_info", "duration_seconds", "usage"].includes(k));
    if (rest.length) parts.push(`+${rest.map((k) => `${k}=${clip(s[k], 120)}`).join(" ")}`);
    console.log(parts.join(" "));
    continue;
  }
  flushText();
  console.log(`${e.event.toUpperCase()} ${clip(e[e.event] ?? e, 1200)}`);
}
flushText();
