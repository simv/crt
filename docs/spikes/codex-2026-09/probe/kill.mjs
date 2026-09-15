// Kill-mid-turn probe (F-53 interrupt): start a turn via spike.mjs, wait for thread.started,
// `taskkill /T /F` the codex.exe pid (POSIX: kill the process group), then resume that thread.
// usage: node kill.mjs <run-name> [delay-ms after thread.started, default 0]
import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.OUT_DIR || join(here, "out");
const [name, delayArg = "0"] = process.argv.slice(2);
if (!name) throw new Error("usage: node kill.mjs <run-name> [delay-ms]");

const child = spawn(process.execPath, [join(here, "spike.mjs"), `${name}-killed`, "turn1"], { stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, OUT_DIR: outDir } });
let out = "";
let threadId;
child.stdout.on("data", (c) => {
  out += c;
  process.stdout.write(c);
  const m = /"thread\.started","thread_id":"([^"]+)"/.exec(out);
  if (m && !threadId) {
    threadId = m[1];
    setTimeout(() => {
      const pid = readFileSync(join(outDir, `${name}-killed.pid`), "utf8").trim();
      console.error(`\n[kill] thread ${threadId}; killing codex pid ${pid}`);
      const k = process.platform === "win32"
        ? spawnSync("taskkill", ["/T", "/F", "/PID", pid], { encoding: "utf8" })
        : spawnSync("kill", ["-9", `-${pid}`], { encoding: "utf8" });
      console.error(`[kill] exit=${k.status}\n${k.stdout}${k.stderr}`);
    }, Number(delayArg));
  }
});
child.on("exit", (code) => {
  console.error(`[kill] first turn exited code=${code}; resuming ${threadId}`);
  const r = spawnSync(process.execPath, [join(here, "spike.mjs"), `${name}-resumed`, "resume", threadId, "Short reply please: what did I ask you to do before?"], {
    stdio: "inherit",
    env: { ...process.env, OUT_DIR: outDir },
  });
  console.error(`[kill] resume exit=${r.status}`);
});
