/**
 * `crt [target]` / `crt serve [target]` / `crt proxy [target]` / `crt browse [target]` (PRD F-1, F-4, F-5, F-23, F-24,
 * N-6; PRD-providers F-43, F-44; PRD-setup F-70…F-75, F-78, F-79; PRD-embedded F-91…F-94, F-99):
 * open the store (store.ts, PRD-zero F-129: the project's `.crt/` when it is set up, else — or
 * under `--review` / `"store": "review"` — the current review under the CRT home; a guest start
 * says so in one line and writes nothing into the project, N-33; nothing here creates `.crt/`,
 * N-19, and nothing asks to), preflight the providers and pick one, prune stale captures, resolve the mode
 * (config.ts `resolveMode`: `crt proxy` / `--mode` / config, default embedded), choose the target
 * (start.ts `chooseTarget` — in proxy mode found, remembered, asked for, or waited on; in
 * embedded mode the soft form: the app URL CRT opens, never waited for), wire the session
 * registry, bind the server to 127.0.0.1 (start.ts `bindPort` — reusing or stepping around a
 * stale CRT), print the ready line (F-93: mode, app, project, tasks, provider, login), and
 * optionally open the browser — the app's own URL in embedded mode (then arm the F-94 timer),
 * the CRT URL in proxy mode. Every failure surfaces as a CrtError with a single actionable line.
 *
 * `crt browse` (PRD-zero F-128) is the embedded start with the CRT browser forced: instead of the
 * default browser, CRT launches Chrome or Edge itself and injects the loader over the DevTools
 * protocol (browser.ts), so the app needs no integration. The browser belongs to this process —
 * one per server, closed with it — and a CRT that already serves the project is asked to open
 * it (`POST /__crt/internal/browse`). The F-94 timer is not armed: no loader request is expected.
 *
 * The two guided steps are pure over `StartDeps`; this module supplies the real probes
 * (target.ts, probes.ts) and the prompter cli.ts chose (prompt.ts on a terminal, none otherwise).
 *
 * `CRT_SESSION_STUB=1` selects the `stub` provider ahead of every other resolution step (tests
 * only). `CRT_BROWSER=<command>` replaces the platform opener (tests only: the e2e "opens" the app
 * with a command that does nothing, so the F-94 timer can be observed without a real browser).
 */
import { spawn } from "node:child_process";
import { BrowserController, findBrowser, readLoaderBundle } from "./browser.js";
import { readFileSync } from "node:fs";
import type { Server } from "node:http";
import { homedir } from "node:os";
import { type CrtMode, resolveMode } from "./config.js";
import { collectDoctorFacts, doctorRows, hasDevScript, integrationFact, renderRow } from "./doctor.js";
import { CrtError } from "./errors.js";
import { announceOnce, browserProfileDir } from "./home.js";
import { fetchHealth, isPortFree, requestBrowse, requestShutdown } from "./probes.js";
import { findProjectRoot } from "./project.js";
import { sdkVersion } from "./providers/claude.js";
import { createProxyServer, type CrtServer } from "./proxy.js";
import { describeResolution, loginField, ProviderRegistry } from "./session.js";
import { SessionRegistry } from "./sessions.js";
import { extensionSeen } from "./extension.js";
import { bindPort, chooseTarget, type CrtHealth, NO_WAY_LINE, type OpenChoice, openDecision, PORT_STEPS, type Prompter, sameProject, type StartDeps } from "./start.js";
import { guestLine, openStore, type Store } from "./store.js";
import { parseFrontmatter } from "./tasks.js";
import { isReachable, PROBE_PORTS, probeAll, safeOrigin } from "./target.js";
import { packageVersion } from "./version.js";

export interface ServeOptions {
  /** Launch directory; the project root is found from here. */
  cwd?: string;
  /** `crt proxy` is `--mode proxy` (F-92); `crt browse` is embedded with the CRT browser forced (PRD-zero F-128); default `serve`. */
  command?: "serve" | "proxy" | "browse";
  /** `--mode <embedded|proxy>`: outranks the config files (F-91). */
  mode?: string | undefined;
  /** `--target` value, if given — the scripting form, never remembered (F-72). */
  target?: string | undefined;
  /** The positional target (`crt 3100`), remembered once it responds (F-69, F-72). */
  positional?: string | undefined;
  /** `--port` value; falls back to config (local over project) then 4400. Never stepped around (F-73). */
  port?: number | undefined;
  /** `--open`: launch the default browser on the CRT URL. */
  open?: boolean;
  /** `crt review` (PRD-zero F-135): what `open` opens is this path on the CRT server — its own page — in place of the app. */
  openPath?: string | undefined;
  /** `--provider <id>`: the active provider (F-43 step 2); else `CRT_PROVIDER`, config, detection. */
  provider?: string | undefined;
  /** `--replace`: stop a CRT holding the port (F-79). */
  replace?: boolean;
  /** `--yes`: never ask (cli.ts turns it into a non-interactive run). It no longer runs `crt init` (PRD-zero F-129). */
  yes?: boolean;
  /** `--review [name]`: collect into a review under the CRT home even in a set-up project (PRD-zero F-129). */
  review?: boolean | string | undefined;
  /** PRD-setup §5.2: may ask on the terminal; requires `prompt`. Default false. */
  interactive?: boolean;
  prompt?: Prompter;
  /** Absolute path of dist/overlay.js. */
  overlayPath: string;
  /** Absolute path of the intake instructions (a copy of plugin/skills/intake/SKILL.md). */
  intakePromptPath: string;
  /** Where status lines go (stdout by default). */
  log?: (line: string) => void;
  /** This package's version (health, reuse comparison); read from package.json by default. */
  version?: string;
  /** Probe overrides (tests). */
  deps?: Partial<StartDeps>;
}

export interface ServeHandle {
  server: Server;
  url: string;
  mode: CrtMode;
  /** The app URL; null in embedded mode when none was found (F-91). */
  target: string | null;
  projectRoot: string;
  /** The provider new sessions use, as printed on the ready line. */
  provider: string;
  providers: ProviderRegistry;
  /** PRD-zero F-129: where this server writes — the project's `.crt/`, or a review under the CRT home. */
  store: Store;
  /** Intake sessions still open (the F-77 stop line counts them). */
  openSessions(): number;
  /** PRD-zero F-128: the CRT browser, when this server has one (`isOpen` words the stop line). */
  browser: BrowserController | null;
  close(): Promise<void>;
}

/** `serving` holds the server; `reused` means another CRT already serves this project in this mode (F-73, F-93) — exit 0. */
export type ServeResult = { kind: "serving"; handle: ServeHandle } | { kind: "reused"; url: string; target: string | null; projectRoot: string; health: CrtHealth };

const NO_PROMPT: Prompter = {
  ask: () => Promise.reject(new Error("prompted on a non-interactive run")),
  waitFor: () => Promise.reject(new Error("prompted on a non-interactive run")),
};

export async function serve(opts: ServeOptions): Promise<ServeResult> {
  const log = opts.log ?? ((line: string) => console.log(line));
  const interactive = opts.interactive === true;
  const version = opts.version ?? packageVersion();
  const projectRoot = findProjectRoot(opts.cwd ?? process.cwd());
  const prompt = opts.prompt ?? NO_PROMPT;

  // PRD-zero F-129: set up → `.crt/`; not set up (a guest), `--review` or `"store": "review"` → a review under the CRT home.
  // No question and no refusal either way, and nothing here writes into the project (N-33).
  // N-34: one `crt: created <path>` per run, shared by the store and the CRT browser's profile.
  const onCreate = announceOnce(log);
  const store = openStore({ root: projectRoot, review: opts.review, log, onCreate });
  if (store.guest) log(guestLine(projectRoot));
  // F-130: a review's machine-local file (under the home) over the project's two; `readConfig` tolerates an absent `.crt/`.
  const config = store.readConfig();
  const port = opts.port ?? config.port;
  // F-91/F-92: `crt proxy` > `--mode` > config.local.json > config.json > embedded.
  const browse = opts.command === "browse";
  // PRD-zero F-128: the CRT browser is the embedded start; a proxy there would be a second way into the same page.
  if (browse && opts.mode !== undefined && opts.mode !== "embedded") throw new CrtError("`crt browse` is embedded — drop --mode, or run `crt proxy`");
  const mode = browse ? "embedded" : resolveMode({ command: opts.command === "proxy" ? "proxy" : "serve", flag: opts.mode, config });

  // F-43/F-44: preflight every provider once, detect, and validate an explicit --provider / CRT_PROVIDER.
  // Before the target step, so the F-76 rows before a prompt can name a provider's problem.
  const providers = new ProviderRegistry({ root: projectRoot, config, flag: opts.provider ?? null, log });
  const named = opts.provider ?? process.env.CRT_PROVIDER?.trim();
  if (named && !providers.ids().includes(named)) {
    throw new CrtError(`${opts.provider ? "--provider" : "CRT_PROVIDER"} must be one of ${providers.ids().join(", ")} (got "${named}")`);
  }
  await providers.refresh();
  const resolution = providers.resolve(null);

  // F-23 / PRD-zero F-130: captures older than 7 days — the project's, or the current review's.
  const pruned = store.pruneCaptures();
  if (pruned.length) log(`crt: pruned ${pruned.length} capture${pruned.length === 1 ? "" : "s"} older than 7 days`);

  let server: CrtServer | null = null;
  let warned = false;
  const deps: StartDeps = {
    interactive,
    log,
    prompt,
    isReachable: (origin) => isReachable(origin),
    probeAll: () => probeAll(),
    health: (p) => fetchHealth(p),
    isFree: (p) => isPortFree(p),
    listen: (p) => {
      if (!server) throw new Error("listen before the server exists");
      return listen(server, p);
    },
    replace: (p) => requestShutdown(p),
    browse: (p, u) => requestBrowse(p, u),
    beforePrompt: async () => {
      // F-76: only FAIL/warn rows, once, before the first question (no target row — that is the question; no plugin row — never spawn `claude` here).
      if (warned) return;
      warned = true;
      const report = doctorRows(await collectDoctorFacts({ cwd: projectRoot, version, target: false, plugin: false, browser: false, providers, mode }));
      for (const row of report.rows) if (row.status === "FAIL" || row.status === "warn") log(renderRow(row));
    },
    ...opts.deps,
  };

  const chosen = await chooseTarget(
    {
      positional: opts.positional ?? null,
      flag: opts.target ?? null,
      config: { target: config.target, source: config.targetSource },
      hasDevScript: hasDevScript(projectRoot),
      ports: PROBE_PORTS,
      required: mode === "proxy", // F-91: embedded mode never waits and never fails
    },
    deps,
  );
  const target = chosen.origin;
  if (mode === "proxy" && target === null) throw new Error("proxy mode resolved no target"); // unreachable: the required form always answers or throws
  if (target && chosen.remember && !(config.targetSource === "local" && safeOrigin(config.target) === target)) {
    // F-72: typed, picked or positional targets are remembered per machine once they responded.
    // PRD-zero F-130: in a review that file is the project's under the CRT home.
    store.writeLocalConfig({ target });
    log(`Remembered ${target} in ${store.localConfigLabel()} — \`crt <port>\` switches.`);
  }
  /** F-91: the app URL to open — known and responding. */
  const app = chosen.down ? null : target;

  const sessions = new SessionRegistry({
    projectRoot,
    tasksDir: store.tasksDir() ?? "",
    store,
    intakePrompt: loadIntakePrompt(opts.intakePromptPath),
    providers,
    port, // F-49: where `crt mcp` posts write_task back to; corrected below if the port was stepped
    log,
  });
  // PRD-zero F-125/F-128: this server's one CRT browser, launched on the first request for it. The origin
  // is the port actually bound (a 4401…4409 fallback included), known by the time anything can ask.
  let boundUrl = `http://localhost:${port}`;
  const browser = new BrowserController({
    command: config.browserCommand,
    profileDir: browserProfileDir(projectRoot),
    onCreate,
    origin: () => boundUrl,
    loaderBundle: () => readLoaderBundle(opts.overlayPath),
    log,
  });
  const close = async (): Promise<void> => {
    sessions.closeAll();
    await browser.close();
    await new Promise<void>((done) => {
      if (!server) return done();
      server.closeAllConnections();
      server.close(() => done());
    });
  };
  server = createProxyServer({
    target,
    mode,
    projectRoot,
    overlayPath: opts.overlayPath,
    sessions,
    providers,
    version,
    startedAt: new Date().toISOString(),
    // PRD-polish F-114: the landing page's This server card and its Cmd/Ctrl hints.
    sdkVersion: sdkVersion(),
    platform: process.platform,
    store,
    shutdown: close,
    // F-128: a later `crt browse` in this project; proxy mode has its own way into the page.
    ...(mode === "embedded" ? { browse: (asked: string | null) => browser.open(asked ?? app ?? boundUrl) } : {}),
    log,
  });

  // PRD-zero F-132: what this start opens — the default browser when the app carries the integration (N-36: as in
  // 0.7.2), else the CRT browser, else nothing and one line. CRT's own page (`openPath`) is the default browser's.
  const wantsOpen = opts.open === true;
  const choice: OpenChoice =
    opts.openPath !== undefined
      ? wantsOpen
        ? "default"
        : "none"
      : openDecision({
          open: wantsOpen,
          mode,
          forced: browse,
          integration: wantsOpen && mode === "embedded" && !browse && integrationFact(projectRoot).found !== null,
          extension: wantsOpen && mode === "embedded" && !browse && extensionSeen(projectRoot),
          browser: wantsOpen && mode === "embedded" && findBrowser({ command: config.browserCommand, platform: process.platform, env: process.env, home: homedir() }) !== null,
        });
  /** F-128: `crt browse` asks for the CRT browser by name; F-132: plain `crt` picked it. `--no-open` never launches it. */
  const launch = choice === "crt-browser";
  const bound = await bindPort(
    { port, explicit: opts.port !== undefined, replace: opts.replace === true, projectRoot, target: browse ? app : target, version, open: wantsOpen, mode, browser: browse || launch },
    deps,
  );
  if (bound.kind === "reused") {
    // F-93: embedded mode opens the app (this run's, else the running server's); proxy mode opens the CRT URL.
    const toOpen = opts.openPath !== undefined ? bound.url + opts.openPath : mode === "embedded" ? (app ?? bound.health.target) : bound.url;
    if (choice === "no-way") log(NO_WAY_LINE);
    else if (choice === "default" && toOpen) openBrowser(toOpen, log); // the CRT browser: bindPort asked that server (F-128)
    return { kind: "reused", url: bound.url, target, projectRoot, health: bound.health };
  }
  sessions.mcpPort = bound.port;

  const url = `http://localhost:${bound.port}`;
  boundUrl = url;
  const tasks = store.taskCount();
  const login = loginField(resolution, providers);
  // PRD-zero F-129: `review 2026-11-16: 0 items` where a project store says `0 tasks in .crt/tasks`.
  const where = store.kind === "review" ? `review ${store.review()}: ${tasks} item${tasks === 1 ? "" : "s"}` : `${tasks} task${tasks === 1 ? "" : "s"} in ${store.tasksLabel()}`;
  const details = `project: ${projectRoot}, ${where}, provider: ${describeResolution(resolution)}, login: ${login}`;
  // F-93: `CRT ready at <url> for <app> (embedded; …)` / `CRT ready at <url> → <target> (proxy; …)`.
  // PRD-zero F-132: `(embedded, CRT browser; …)` when the CRT browser is what opens; F-129: `, guest` when the project is not set up.
  const how = `${mode}${launch ? ", CRT browser" : ""}${store.guest ? ", guest" : ""}`;
  log(mode === "embedded" ? `CRT ready at ${url}${target ? ` for ${target}` : ""} (${how}; ${details})` : `CRT ready at ${url} → ${target} (${how}; ${details})`);
  if (mode === "embedded" && bound.port !== port && !launch) {
    // F-93: a stepped port (F-73) leaves the app's loader pointing at the configured one.
    log(`crt: your app's CRT loader expects :${port} — run \`crt --replace\`, or set port in .crt/config.json and in the snippet`);
  }
  if (login === "missing") {
    // F-74: the N-6 line at start, before anyone writes a note.
    const problem = providers.preflight(resolution.provider).problem;
    if (problem) log(`crt: ${problem}`);
  } else if (opts.openPath !== undefined) {
    log(`${opts.open ? "Opening" : "Open"} ${url}${opts.openPath} — Ctrl+C stops CRT.`);
  } else if (interactive) {
    const open = launch ? "In the CRT browser window" : mode === "embedded" ? (app ? `Open ${app}` : "Open your dev server in the browser") : `Open ${url}`;
    log(`${open} → CRT button bottom-right (Ctrl/Cmd+Shift+.) → Select · note · Send. Ctrl+C stops CRT; your dev server keeps running.`);
  }
  if (opts.openPath !== undefined) {
    // F-135: CRT's own page; the app is not opened and no loader request is expected (no F-94 timer).
    if (opts.open) openBrowser(url + opts.openPath, log);
  } else if (choice === "no-way") {
    // F-132: CRT stays up for a page that loads the loader later.
    log(NO_WAY_LINE);
  } else if (launch) {
    // F-125/F-128: the app when one answers, else CRT's own page (the browser is then ready for the app's URL).
    // A failure is one line and CRT stays up; no F-94 timer — nothing in the app asks for the loader.
    await browser.open(app ?? url);
  } else if (choice === "default") {
    // The integration was found (F-132), so a page that never asks for the loader is worth the F-94 line.
    if (mode === "proxy") openBrowser(url, log);
    else if (app) {
      // F-91: embedded mode opens the app's own URL (nothing when none is known); F-94 watches for the loader.
      openBrowser(app, log);
      server.browserOpened(app);
    }
  }

  return {
    kind: "serving",
    handle: {
      server,
      url,
      mode,
      target,
      projectRoot,
      provider: resolution.provider,
      providers,
      store,
      openSessions: () => sessions.openCount(),
      browser: mode === "embedded" ? browser : null,
      close,
    },
  };
}

/**
 * PRD-zero F-135: the CRT already serving `projectRoot`, in either mode, on `port` or one of the
 * ports a start steps to (F-73) — where `crt review` opens its page without starting a second server.
 */
export async function findCrtFor(projectRoot: string, port: number, health: (port: number) => Promise<CrtHealth | null> = (p) => fetchHealth(p)): Promise<{ port: number; url: string; health: CrtHealth } | null> {
  for (let p = port; p <= port + PORT_STEPS; p++) {
    const h = await health(p);
    if (h && sameProject(h.projectRoot, projectRoot)) return { port: p, url: `http://localhost:${p}`, health: h };
  }
  return null;
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

/** Bind on 127.0.0.1; `in-use` lets start.ts diagnose the port (F-73), any other error is fatal. */
function listen(server: Server, port: number): Promise<"ok" | "in-use"> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener("listening", onListening);
      if (err.code === "EADDRINUSE") resolve("in-use");
      else reject(new CrtError(`cannot listen on 127.0.0.1:${port} (${err.code ?? err.message})`));
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve("ok");
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

/** Open `url` in the default browser via the platform opener (or `CRT_BROWSER`, a test seam), spawned without a shell. */
export function openBrowser(url: string, log: (line: string) => void): void {
  const custom = process.env.CRT_BROWSER?.trim();
  const [cmd, args]: [string, string[]] = custom
    ? [custom, [url]]
    : process.platform === "win32"
      ? ["cmd.exe", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  const child = spawn(cmd, args, { shell: false, stdio: "ignore", detached: true, windowsHide: true });
  child.on("error", (err) => log(`crt: could not open browser (${err.message}); open ${url} yourself`));
  child.unref();
}
