// Prints env vars starting with CODEX/OPENAI and probes 127.0.0.1:47123 from inside the sandbox.
import { request } from "node:http";
const picked = Object.fromEntries(Object.entries(process.env).filter(([k]) => /^(CODEX|OPENAI)/i.test(k)));
console.log("env-count", Object.keys(process.env).length);
console.log("codex-env", JSON.stringify(picked));
const req = request({ host: "127.0.0.1", port: 47123, path: "/ping", method: "POST" }, (res) => {
  let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => console.log("ping", res.statusCode, t));
});
req.on("error", (e) => console.log("ping-error", e.code || String(e)));
req.setTimeout(4000, () => req.destroy(new Error("timeout")));
req.end(JSON.stringify({ from: "codex sandbox" }));
