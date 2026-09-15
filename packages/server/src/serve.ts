/**
 * `crt serve` (PRD F-1, F-4, F-5, N-6): run `init`, resolve the target, bind the proxy
 * to 127.0.0.1, print the one-line status, and optionally open the browser.
 * Every failure surfaces as a CrtError with a single actionable line.
 */
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import type { Server } from "node:http";
import { CrtError } from "./errors.js";
import { initProject, readConfig } from "./init.js";
import { findProjectRoot } from "./project.js";
import { createProxyServer } from "./proxy.js";
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
  /** Absolute path of dist/overlay.js. */
  overlayPath: string;
  /** Where status lines go (stdout by default). */
  log?: (line: string) => void;
}

export interface ServeHandle {
  server: Server;
  url: string;
  target: string;
  projectRoot: string;
  close(): Promise<void>;
}

export async function serve(opts: ServeOptions): Promise<ServeHandle> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const projectRoot = findProjectRoot(opts.cwd ?? process.cwd());

  const init = initProject(projectRoot);
  if (init.created.length) log(`crt init: created ${init.created.join(", ")}`);

  const config = readConfig(projectRoot);
  const port = opts.port ?? config.port;
  const target = await resolveTarget({ flag: opts.target, configTarget: config.target });

  const server = createProxyServer({ target: target.origin, projectRoot, overlayPath: opts.overlayPath });
  await listen(server, port);

  const url = `http://localhost:${port}`;
  const tasks = countTasks(init.tasksDir);
  log(`CRT ready at ${url} → ${target.origin} (project: ${projectRoot}, ${tasks} task${tasks === 1 ? "" : "s"})`);
  if (opts.open) openBrowser(url, log);

  return {
    server,
    url,
    target: target.origin,
    projectRoot,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
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
