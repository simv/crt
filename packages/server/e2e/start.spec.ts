import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// PRD-setup F-69, F-72, F-73, F-78, F-79 (the M12 half of F-90): the guided start driven through
// `dist/cli.js` with argv — under `crt proxy`, the v0.3 flow verbatim (PRD-embedded F-92, N-21; embedded.spec.ts
// covers the embedded ready line) —, from scratch projects of their own (never the shared e2e/.project root,
// whose crt.mjs log a second server would truncate), each spec spawning its own servers with
// `CRT_SESSION_STUB=1` and stdout captured. Ports 4480–4489 are this file's; the Playwright web
// servers hold 4497–4499. Nothing here needs a browser.

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, "..", "dist", "cli.js");
const FIXTURE = "http://localhost:3999";
const PKG = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as { version: string; dependencies: Record<string, string> };
const VERSION = PKG.version;
const SDK_VERSION = PKG.dependencies["@anthropic-ai/claude-agent-sdk"]!;

interface Crt {
  child: ChildProcess;
  lines: string[];
  exited: Promise<number | null>;
  /** Resolves with the first stdout line matching `re`, or rejects after `timeoutMs`. */
  waitFor(re: RegExp, timeoutMs?: number): Promise<string>;
}

const running: ChildProcess[] = [];

/** A scratch project with a `.git` marker (so findProjectRoot stops there) and `port` in .crt/config.json. */
function scratch(name: string, port: number): string {
  const root = join(here, ".project", `start-${name}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, ".git"), { recursive: true });
  mkdirSync(join(root, ".crt"), { recursive: true });
  writeFileSync(join(root, ".crt", "config.json"), JSON.stringify({ tasksDir: ".crt/tasks", target: null, port }, null, 2) + "\n");
  return root;
}

function startCrt(cwd: string, args: string[], env: NodeJS.ProcessEnv = {}): Crt {
  const child = spawn(process.execPath, [CLI, ...args], { cwd, env: { ...process.env, CRT_SESSION_STUB: "1", ...env }, stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true });
  running.push(child);
  const lines: string[] = [];
  const waiters: Array<{ re: RegExp; resolve: (line: string) => void }> = [];
  const push = (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (!line) continue;
      lines.push(line);
      for (const w of [...waiters]) {
        if (w.re.test(line)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(line);
        }
      }
    }
  };
  child.stdout!.on("data", push);
  child.stderr!.on("data", push);
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  return {
    child,
    lines,
    exited,
    waitFor: (re, timeoutMs = 20_000) =>
      new Promise<string>((resolve, reject) => {
        const hit = lines.find((l) => re.test(l));
        if (hit) return resolve(hit);
        const timer = setTimeout(() => reject(new Error(`no line matching ${re} within ${timeoutMs} ms; got:\n${lines.join("\n")}`)), timeoutMs);
        waiters.push({
          re,
          resolve: (line) => {
            clearTimeout(timer);
            resolve(line);
          },
        });
      }),
  };
}

async function health(port: number): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`http://localhost:${port}/__crt/health`);
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function listenPlain(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const s = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("not crt");
    });
    s.once("error", reject);
    s.listen(port, "127.0.0.1", () => resolve(s));
  });
}

test.afterEach(async () => {
  for (const c of running.splice(0)) {
    if (c.exitCode === null) c.kill();
  }
  // Give the OS a moment to release the ports before the next spec binds them.
  await new Promise((r) => setTimeout(r, 300));
});

test("`crt 3999` starts with no prompt and remembers the target; the second run asks nothing and still names 3999 (F-69, F-72, N-15)", async () => {
  const root = scratch("remember", 4485);
  const first = startCrt(root, ["proxy", "3999", "--yes"]);
  const ready = await first.waitFor(/^CRT ready at /);
  // PRD-embedded F-93: the proxy-mode ready line reads `→ <target> (proxy; …)`.
  expect(ready).toMatch(/^CRT ready at http:\/\/localhost:4485 → http:\/\/localhost:3999 \(proxy; project: .*, 0 tasks in \.crt[\\/]tasks, provider: stub \(CRT_SESSION_STUB\), login: unchecked\)$/);
  expect(first.lines).toContain("Remembered http://localhost:3999 in .crt/config.local.json — `crt <port>` switches.");
  expect(first.lines.some((l) => /Dev server URL|Which one\?/.test(l))).toBe(false);
  expect(JSON.parse(readFileSync(join(root, ".crt", "config.local.json"), "utf8"))).toEqual({ target: FIXTURE });
  // PRD-embedded F-99/F-100 (retiring the F-75 line): under --yes the plan comes first (only what is not in
  // place — scratch() wrote config.json already), then one line per write; the stub provider gets AGENTS.md.
  expect(first.lines[0]).toBe(`crt init will, in ${root}:`);
  expect(first.lines.slice(1, 5)).toEqual(["  create .crt/README.md", "  create .crt/tasks/", "  add .crt/captures/ and .crt/config.local.json to .gitignore", "  create AGENTS.md with a CRT section"]);
  expect(first.lines.slice(5, 9)).toEqual([
    "crt init: created .crt/README.md",
    "crt init: created .crt/tasks/",
    "crt init: added .crt/captures/ and .crt/config.local.json to .gitignore",
    "crt init: created AGENTS.md with the CRT section",
  ]);
  // F-78: health tells the whole story.
  const h = await health(4485);
  expect(h).toMatchObject({ ok: true, version: VERSION, target: FIXTURE, tasks: 0, provider: "stub", login: "unchecked", sessions: 0, overlay: { injected: 0, fetched: 0 } });
  expect(typeof h!.startedAt).toBe("string");
  expect(typeof h!.tasksDir).toBe("string");
  first.child.kill();
  await first.exited;

  const second = startCrt(root, ["proxy", "--yes"]);
  const started = Date.now();
  const again = await second.waitFor(/^CRT ready at /);
  expect(again).toContain("CRT ready at http://localhost:4485 → http://localhost:3999 (proxy; ");
  expect(Date.now() - started).toBeLessThan(15_000);
  expect(second.lines.some((l) => l.startsWith("Remembered "))).toBe(false);
  expect(second.lines.some((l) => l.startsWith("crt init:"))).toBe(false);
});

test("a second start on the same target and project exits 0 with the reuse line while the first keeps serving (F-73)", async () => {
  const root = scratch("reuse", 4489);
  const first = startCrt(root, ["proxy", "--target", FIXTURE, "--yes"]);
  await first.waitFor(/^CRT ready at http:\/\/localhost:4489 /);
  const before = await health(4489);
  // --target is the scripting form: never remembered (the chat spec relies on this too).
  expect(existsSync(join(root, ".crt", "config.local.json"))).toBe(false);

  const second = startCrt(root, ["proxy", "--target", FIXTURE, "--yes"]);
  expect(await second.exited).toBe(0);
  const reuse = second.lines.find((l) => l.startsWith("CRT "));
  expect(reuse).toContain(`CRT ${VERSION} is already serving http://localhost:3999 for this project at http://localhost:4489 (since `);
  expect(reuse).toMatch(/ \(since \d\d:\d\d\) — open it in your browser\.$/);
  expect(second.lines.some((l) => l.startsWith("CRT ready"))).toBe(false);

  const after = await health(4489);
  expect(after).not.toBeNull();
  expect(after!.startedAt).toBe(before!.startedAt);
  expect(first.child.exitCode).toBeNull();

  if (process.platform !== "win32") {
    // F-77: SIGINT/SIGTERM close cleanly, say so, and exit 0 (Windows has no signals to send).
    first.child.kill("SIGTERM");
    expect(await first.exited).toBe(0);
    expect(first.lines).toContain("Stopping CRT … 0 sessions ended; written task files are kept.");
  }
});

test("a non-CRT listener on the port makes the next start take the next port and say so (F-73)", async () => {
  const root = scratch("busy", 4487);
  const plain = await listenPlain(4487);
  try {
    const crt = startCrt(root, ["proxy", "--target", FIXTURE, "--yes"]);
    const ready = await crt.waitFor(/^CRT ready at /);
    expect(ready).toContain("CRT ready at http://localhost:4488 → http://localhost:3999 (proxy; ");
    expect(crt.lines).toContain("crt: port 4487 is in use by a process that is not CRT; using 4488");
    expect(await health(4488)).toMatchObject({ ok: true, target: FIXTURE });
    expect(await health(4487)).toBeNull();
  } finally {
    await new Promise<void>((r) => plain.close(() => r()));
  }
});

test("an explicit --port is never stepped around, and --replace stops the CRT on the port through the shutdown route (F-73, F-79)", async () => {
  const root = scratch("replace", 4483);
  const first = startCrt(root, ["proxy", "--target", FIXTURE, "--yes"]);
  await first.waitFor(/^CRT ready at http:\/\/localhost:4483 /);

  const other = scratch("replace-other", 4483);
  const refused = startCrt(other, ["proxy", "--target", FIXTURE, "--yes", "--port", "4483"]);
  expect(await refused.exited).toBe(1);
  expect(refused.lines.find((l) => l.startsWith("crt: port 4483"))).toMatch(/^crt: port 4483 is already in use by CRT .* \(→ http:\/\/localhost:3999, project .*\) — stop the other process, run `crt --replace`, or pass --port <n>$/);

  const stepped = startCrt(other, ["proxy", "--target", FIXTURE, "--yes"]);
  const ready = await stepped.waitFor(/^CRT ready at /);
  expect(ready).toContain("CRT ready at http://localhost:4484 →");
  expect(stepped.lines.find((l) => l.startsWith("crt: port 4483"))).toMatch(/^crt: port 4483 is held by another CRT \(→ http:\/\/localhost:3999, project .*\); using 4484$/);
  stepped.child.kill();
  await stepped.exited;

  const replacing = startCrt(root, ["proxy", "--target", FIXTURE, "--yes", "--replace"]);
  await replacing.waitFor(/^CRT ready at http:\/\/localhost:4483 /);
  expect(replacing.lines).toContain(`Stopped CRT ${VERSION} on port 4483.`);
  expect(await first.exited).toBe(0);
  expect((await health(4483))!.startedAt).not.toBe(undefined);
});

test("crt --version, crt help and an unknown command (F-69)", async () => {
  const root = scratch("grammar", 4481);
  const version = startCrt(root, ["--version"]);
  expect(await version.exited).toBe(0);
  expect(version.lines).toEqual([`crt ${VERSION} (agent sdk ${SDK_VERSION})`]);
  const help = startCrt(root, ["help"]);
  expect(await help.exited).toBe(0);
  expect(help.lines[0]).toBe("crt — Claude Review Tool");
  const bogus = startCrt(root, ["bogus"]);
  expect(await bogus.exited).toBe(2);
  expect(bogus.lines).toEqual(['crt: unknown command "bogus" — a target is a port, host:port or URL; `crt help` lists commands']);
  // A bad positional target is a usage error, not a probe.
  const down = startCrt(root, ["proxy", "--yes", "3998"]);
  expect(await down.exited).toBe(1);
  expect(down.lines).toContain("crt: target http://localhost:3998 is not responding — start your dev server there, or run `crt <port>`");
});

test("an un-initialised project: `crt` off a terminal refuses with the F-99 line, `crt tasks` is not an error, `crt --yes` sets it up and starts (F-99, F-100)", async () => {
  const root = scratch("uninit", 4480);
  rmSync(join(root, ".crt"), { recursive: true, force: true });
  const refused = startCrt(root, ["--no-open", "--port", "4480"]);
  expect(await refused.exited).toBe(1);
  expect(refused.lines).toEqual([`crt: ${root} is not set up for CRT — run \`crt init\` (or \`crt --yes\`)`]);
  expect(existsSync(join(root, ".crt"))).toBe(false);
  const tasks = startCrt(root, ["tasks"]);
  expect(await tasks.exited).toBe(0);
  expect(tasks.lines).toEqual(["no tasks (CRT is not set up here — run crt init)"]);
  const json = startCrt(root, ["tasks", "--json"]);
  expect(await json.exited).toBe(0);
  expect(JSON.parse(json.lines.join("\n"))).toEqual({ tasksDir: null, tasks: [] });
  expect(existsSync(join(root, ".crt"))).toBe(false);
  const yes = startCrt(root, ["--yes", "--no-open", "--port", "4480"]);
  await yes.waitFor(/^CRT ready at http:\/\/localhost:4480 /);
  expect(yes.lines.slice(0, 6)).toEqual([`crt init will, in ${root}:`, "  create .crt/README.md", "  create .crt/tasks/", "  create .crt/config.json", "  add .crt/captures/ and .crt/config.local.json to .gitignore", "  create AGENTS.md with a CRT section"]);
  expect(yes.lines).toContain("crt init: created .crt/config.json");
  expect(yes.lines).toContain("crt init: created AGENTS.md with the CRT section");
  expect(existsSync(join(root, ".crt", "README.md"))).toBe(true);
  expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toContain("<!-- BEGIN:crt v");
  yes.child.kill();
  await yes.exited;
});
