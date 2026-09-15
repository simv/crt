/**
 * `crt serve` (PRD F-1, F-4, F-5, F-23, F-24, N-6; PRD-providers F-43, F-44): run `init`, prune
 * stale captures, resolve the target, preflight the providers and pick one, wire the session
 * registry, bind the proxy to 127.0.0.1, print the one-line status (ending with the provider and
 * why), and optionally open the browser. Every failure surfaces as a CrtError with a single
 * actionable line.
 *
 * `CRT_SESSION_STUB=1` selects the `stub` provider ahead of every other resolution step (tests only).
 */
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import type { Server } from "node:http";
import { resolve } from "node:path";
import { pruneCaptures } from "./captures.js";
import { CrtError } from "./errors.js";
import { initProject, readConfig } from "./init.js";
import { findProjectRoot } from "./project.js";
import { createProxyServer } from "./proxy.js";
import { describeResolution, ProviderRegistry } from "./session.js";
import { SessionRegistry } from "./sessions.js";
import { parseFrontmatter } from "./tasks.js";
import { resolveTarget } from "./target.js";

export interface ServeOptions {
  /** Launch directory; the project root is found from here. */
  cwd?: string;
  /** `--target` value, if given. */
  target?: string | undefined;
  /** `--port` value; falls back to `.crt/config.json` then 4400. */
  port?: number | undefined;
  /** `--open`: launch the default browser on the CRT URL. */
  open?: boolean;
  /** `--provider <id>`: the active provider (F-43 step 2); else `CRT_PROVIDER`, config, detection. */
  provider?: string | undefined;
  /** Absolute path of dist/overlay.js. */
  overlayPath: string;
  /** Absolute path of the intake instructions (a copy of plugin/skills/intake/SKILL.md). */
  intakePromptPath: string;
  /** Where status lines go (stdout by default). */
  log?: (line: string) => void;
}

export interface ServeHandle {
  server: Server;
  url: string;
  target: string;
  projectRoot: string;
  /** The provider new sessions use, as printed on the ready line. */
  provider: string;
  providers: ProviderRegistry;
  close(): Promise<void>;
}

export async function serve(opts: ServeOptions): Promise<ServeHandle> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const projectRoot = findProjectRoot(opts.cwd ?? process.cwd());

  const init = initProject(projectRoot);
  if (init.created.length) log(`crt init: created ${init.created.join(", ")}`);
  const pruned = pruneCaptures(projectRoot);
  if (pruned.length) log(`crt: pruned ${pruned.length} capture${pruned.length === 1 ? "" : "s"} older than 7 days`);

  const config = readConfig(projectRoot);
  const port = opts.port ?? config.port;
  const target = await resolveTarget({ flag: opts.target, configTarget: config.target });

  // F-43/F-44: preflight every provider once, detect, and validate an explicit --provider / CRT_PROVIDER.
  const providers = new ProviderRegistry({ root: projectRoot, config, flag: opts.provider ?? null, log });
  const named = opts.provider ?? process.env.CRT_PROVIDER?.trim();
  if (named && !providers.ids().includes(named)) {
    throw new CrtError(`${opts.provider ? "--provider" : "CRT_PROVIDER"} must be one of ${providers.ids().join(", ")} (got "${named}")`);
  }
  await providers.refresh();
  const resolution = providers.resolve(null);

  const tasksDir = resolve(projectRoot, config.tasksDir);
  const sessions = new SessionRegistry({
    projectRoot,
    tasksDir,
    intakePrompt: loadIntakePrompt(opts.intakePromptPath),
    providers,
    log,
  });
  const server = createProxyServer({ target: target.origin, projectRoot, overlayPath: opts.overlayPath, sessions });
  await listen(server, port);

  const url = `http://localhost:${port}`;
  const tasks = countTasks(init.tasksDir);
  log(`CRT ready at ${url} → ${target.origin} (project: ${projectRoot}, ${tasks} task${tasks === 1 ? "" : "s"}, provider: ${describeResolution(resolution)})`);
  if (opts.open) openBrowser(url, log);

  return {
    server,
    url,
    target: target.origin,
    projectRoot,
    provider: resolution.provider,
    providers,
    close: () =>
      new Promise<void>((done) => {
        sessions.closeAll();
        server.closeAllConnections();
        server.close(() => done());
      }),
  };
}

/**
 * F-24/F-39: the intake instructions are the body of `plugin/skills/intake/SKILL.md` (below its
 * frontmatter), copied into dist/ at build time so the published package carries them.
 */
export function loadIntakePrompt(path: string): string {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new CrtError(`intake instructions missing at ${path} — run npm run build`);
  }
  const fm = parseFrontmatter(text);
  return (fm ? fm.body : text).trim();
}

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener("listening", onListening);
      if (err.code === "EADDRINUSE") {
        reject(new CrtError(`port ${port} is already in use — stop the other process or pass --port <n>`));
      } else {
        reject(new CrtError(`cannot listen on 127.0.0.1:${port} (${err.code ?? err.message})`));
      }
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

function countTasks(tasksDir: string): number {
  try {
    return readdirSync(tasksDir).filter((f) => /^CRT-\d{4}-.*\.md$/.test(f)).length;
  } catch {
    return 0;
  }
}

/** Open `url` in the default browser via the platform opener, spawned without a shell. */
export function openBrowser(url: string, log: (line: string) => void): void {
  const [cmd, args]: [string, string[]] =
    process.platform === "win32"
      ? ["cmd.exe", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  const child = spawn(cmd, args, { shell: false, stdio: "ignore", detached: true, windowsHide: true });
  child.on("error", (err) => log(`crt: could not open browser (${err.message}); open ${url} yourself`));
  child.unref();
}
