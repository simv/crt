/**
 * The CRT browser (PRD-zero §5.1; F-125, F-126, F-128; N-31, N-32): CRT starts a Chromium-family
 * browser itself, holds a DevTools-protocol connection to it for as long as the server runs, and
 * puts the loader into every loopback page before the page's own scripts — so the CRT button is on
 * the app's own URL with nothing in the app.
 *
 *   • Discovery (F-125): `browser.command` from the config, else the known install locations,
 *     Chrome before Edge before Chromium, over an injected filesystem and environment.
 *   • Launch (F-125): `--remote-debugging-pipe` and a per-project `--user-data-dir` under the CRT
 *     home, spawned without a shell. The protocol runs over two extra stdio handles (the child
 *     reads fd 3 and writes fd 4) as NUL-terminated JSON; no port is ever opened (N-31), so
 *     `--remote-debugging-port` appears nowhere in this file's arguments.
 *   • Injection (F-126): `Target.setAutoAttach` with `waitForDebuggerOnStart` and `flatten`, so
 *     every page target is prepared before its first document runs — `Page.enable`,
 *     `Page.addScriptToEvaluateOnNewDocument` (the loader bound to this server's origin),
 *     `Fetch.enable` for documents (below), then `Runtime.runIfWaitingForDebugger`. The browser
 *     starts on `about:blank` and is navigated to the app only after that, so the first document
 *     is never missed. A tab the page opens with `window.open` reuses its initial window for the
 *     first page, where the registered script does not run again: the loader is evaluated once
 *     in that document instead (`onNavigated`), after the page's first scripts. A tab the browser
 *     restored from its last session is already on its page when CRT attaches: it is reloaded once.
 *   • Loopback only (N-32): the app's Content-Security-Policy is lifted for exactly the documents
 *     the loader acts on — main-frame documents on a loopback host. Every document response is
 *     paused in the browser process (`Fetch.requestPaused`, resource type Document, response
 *     stage); a main-frame loopback document that carries a `Content-Security-Policy` header is
 *     served to the page with the same status and body and without that header
 *     (`Fetch.getResponseBody` + `Fetch.fulfillRequest`), everything else continues untouched.
 *     The decision is per document and made before it commits, so there is no per-tab state to
 *     lag behind a navigation. A document served that way has no network address, so the
 *     browser's local-network-access check would refuse its requests to the CRT server; the
 *     app's own loopback origin is granted that one permission (`Browser.grantPermissions`). A
 *     policy in a `<meta>` tag and a document served by a service worker are not reached.
 *   • Why not `Page.setBypassCSP`, the first design (PRD-zero §12 rule 1): the renderer handles
 *     it, and a call made while a navigation is held never answers (Chromium 153), so it cannot
 *     be decided per navigation; decided per tab it would stay on for a non-loopback page until a
 *     reload. Why not `Fetch.continueResponse` with the header dropped: the policy the page
 *     enforces is parsed before the override applies, so the page keeps it.
 *   • CRT reads nothing from the browser but target and document URLs and those documents'
 *     responses, evaluates nothing in a page but the loader, and changes nothing of a response
 *     but that one header (N-32). `evaluate` exists for the e2e only.
 *
 * Tested against Chromium 153 (Playwright's build) on Linux by e2e/browser.spec.ts; the Manual
 * row of CRT-0049 records the Chrome and Edge versions tried on Windows.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import type { Readable, Writable } from "node:stream";

// ---- discovery (F-125) ---------------------------------------------------------------------------

export interface FoundBrowser {
  /** The executable. */
  exe: string;
  /** Leading arguments from `browser.command` (none for a discovered browser). */
  args: string[];
  /** `Chrome`, `Edge`, `Chromium`, or `browser.command` for a configured one. */
  name: string;
}

export interface FindBrowserInput {
  /** `browser.command` from the config (command + args), or null. */
  command: string[] | null;
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  /** Injected for tests; `existsSync` by default. */
  exists?: (path: string) => boolean;
}

/** F-125: the known install locations, Chrome before Edge before Chromium. */
export function browserCandidates(input: Pick<FindBrowserInput, "platform" | "env" | "home">): Array<{ name: string; path: string }> {
  const { platform, env, home } = input;
  const out: Array<{ name: string; path: string }> = [];
  if (platform === "win32") {
    const roots = [env.ProgramFiles, env["ProgramFiles(x86)"], env.LocalAppData ?? env.LOCALAPPDATA].filter((r): r is string => !!r && r.trim() !== "");
    for (const [name, tail] of [
      ["Chrome", ["Google", "Chrome", "Application", "chrome.exe"]],
      ["Edge", ["Microsoft", "Edge", "Application", "msedge.exe"]],
      ["Chromium", ["Chromium", "Application", "chrome.exe"]],
    ] as const) {
      for (const root of roots) out.push({ name, path: join(root, ...tail) });
    }
  } else if (platform === "darwin") {
    for (const [name, app, bin] of [
      ["Chrome", "Google Chrome.app", "Google Chrome"],
      ["Edge", "Microsoft Edge.app", "Microsoft Edge"],
      ["Chromium", "Chromium.app", "Chromium"],
    ] as const) {
      for (const root of ["/Applications", join(home, "Applications")]) out.push({ name, path: join(root, app, "Contents", "MacOS", bin) });
    }
  } else {
    const dirs = (env.PATH ?? "").split(delimiter).filter((d) => d !== "");
    for (const [name, bins] of [
      ["Chrome", ["google-chrome", "google-chrome-stable"]],
      ["Edge", ["microsoft-edge", "microsoft-edge-stable"]],
      ["Chromium", ["chromium", "chromium-browser"]],
    ] as const) {
      for (const bin of bins) for (const dir of dirs) out.push({ name, path: join(dir, bin) });
    }
  }
  return out;
}

/** F-125: `browser.command` first (taken as given — a wrong path surfaces as the launch failure line), then the first candidate that exists. */
export function findBrowser(input: FindBrowserInput): FoundBrowser | null {
  if (input.command && input.command.length) return { exe: input.command[0]!, args: input.command.slice(1), name: "browser.command" };
  const exists = input.exists ?? existsSync;
  for (const c of browserCandidates(input)) if (exists(c.path)) return { exe: c.path, args: [], name: c.name };
  return null;
}

/** F-125: the launch arguments. The browser starts on `about:blank`; the app URL follows once the tab is prepared (F-126). */
export function launchArgs(profileDir: string, extra: string[] = []): string[] {
  return ["--remote-debugging-pipe", `--user-data-dir=${profileDir}`, "--no-first-run", "--no-default-browser-check", ...extra, "about:blank"];
}

// ---- the loader source and the policy decision (F-126, N-32) -------------------------------------

/** The placeholder packages/overlay/src/loader-inject.ts carries in place of an origin. */
export const INJECT_ORIGIN_PLACEHOLDER = "__CRT_INJECT_ORIGIN__";

/** F-126: `dist/loader-inject.js` bound to this server's origin. */
export function loaderSource(bundle: string, origin: string): string {
  if (!bundle.includes(INJECT_ORIGIN_PLACEHOLDER)) throw new Error("loader-inject.js carries no origin placeholder — run npm run build");
  return bundle.split(INJECT_ORIGIN_PLACEHOLDER).join(origin);
}

/** F-96 step 1 / N-32: `localhost`, `*.localhost`, `127.0.0.1`, `[::1]` over http(s) — the only documents whose policy is lifted. */
export function isLoopbackUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const h = u.hostname.toLowerCase();
    return h === "localhost" || h.endsWith(".localhost") || h === "127.0.0.1" || h === "[::1]" || h === "::1";
  } catch {
    return false;
  }
}

export interface HeaderEntry {
  name: string;
  value: string;
}

/** Headers that describe the body as it travelled, not as `Fetch.getResponseBody` returns it (decoded, whole). */
const TRANSPORT_HEADERS = new Set(["content-encoding", "content-length", "transfer-encoding"]);

/**
 * N-32: what to do with a paused document response. `null` → continue it untouched; a header list
 * → serve it with exactly these headers (the originals minus `Content-Security-Policy` and the
 * transport headers the re-served body no longer matches). Only a main-frame document on a
 * loopback host that carries the policy header is ever changed.
 */
export function liftedHeaders(input: { mainFrame: boolean; url: string; headers: HeaderEntry[] | undefined }): HeaderEntry[] | null {
  if (!input.mainFrame || !isLoopbackUrl(input.url) || !input.headers) return null;
  if (!input.headers.some((h) => h.name.toLowerCase() === "content-security-policy")) return null;
  return input.headers.filter((h) => {
    const name = h.name.toLowerCase();
    return name !== "content-security-policy" && !TRANSPORT_HEADERS.has(name);
  });
}

// ---- the pipe transport --------------------------------------------------------------------------

/** NUL-terminated messages out of arbitrary chunks: a message may span chunks and a chunk may hold several. */
export class NulFramer {
  private pending: Buffer[] = [];
  push(chunk: Buffer): string[] {
    const out: string[] = [];
    let start = 0;
    for (let i = chunk.indexOf(0, start); i !== -1; i = chunk.indexOf(0, start)) {
      this.pending.push(chunk.subarray(start, i));
      out.push(Buffer.concat(this.pending).toString("utf8"));
      this.pending = [];
      start = i + 1;
    }
    if (start < chunk.length) this.pending.push(chunk.subarray(start));
    return out;
  }
}

interface CdpMessage {
  id?: number;
  method?: string;
  params?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: { message?: string };
  sessionId?: string;
}

/** A minimal DevTools-protocol client over two streams (flattened sessions: `sessionId` rides on the message). */
export class CdpConnection {
  private nextId = 1;
  private readonly waiting = new Map<number, { resolve: (r: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  private readonly framer = new NulFramer();
  private closed = false;
  onEvent: (method: string, params: Record<string, unknown>, sessionId: string | undefined) => void = () => undefined;

  constructor(
    private readonly out: Writable,
    input: Readable,
  ) {
    input.on("data", (chunk: Buffer) => {
      for (const text of this.framer.push(chunk)) this.receive(text);
    });
    const end = () => this.close();
    input.on("end", end);
    input.on("error", end);
    out.on("error", end);
  }

  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<Record<string, unknown>> {
    if (this.closed) return Promise.reject(new Error("the browser connection is closed"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.out.write(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }) + "\0");
    });
  }

  /** Fire and forget: a call whose failure changes nothing (the target went away meanwhile). */
  post(method: string, params: Record<string, unknown> = {}, sessionId?: string): void {
    this.send(method, params, sessionId).catch(() => undefined);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const w of this.waiting.values()) w.reject(new Error("the browser connection closed"));
    this.waiting.clear();
  }

  private receive(text: string): void {
    let msg: CdpMessage;
    try {
      msg = JSON.parse(text) as CdpMessage;
    } catch {
      return;
    }
    if (typeof msg.id === "number") {
      const w = this.waiting.get(msg.id);
      if (!w) return;
      this.waiting.delete(msg.id);
      if (msg.error) w.reject(new Error(msg.error.message ?? "protocol error"));
      else w.resolve(msg.result ?? {});
    } else if (typeof msg.method === "string") {
      this.onEvent(msg.method, msg.params ?? {}, msg.sessionId);
    }
  }
}

// ---- the browser ---------------------------------------------------------------------------------

/**
 * F-125: how long the first protocol call may take. A browser that exits before it answers — the
 * "exits within 3 s" case, whenever it happens — fails the launch at once with its stderr tail.
 */
export const FIRST_ANSWER_MS = 10_000;

export interface LaunchOptions {
  browser: FoundBrowser;
  profileDir: string;
  /** N-34: told when the profile directory had to be created. */
  onCreate?: (path: string) => void;
  /** This server's origin, e.g. `http://localhost:4400`: what the injected loader loads the overlay from. */
  origin: string;
  /** The text of `dist/loader-inject.js`. */
  loaderBundle: string;
  /** The first page to open (the app, or CRT's landing page when no app is known). */
  url: string;
  log: (line: string) => void;
  /** Called once when the browser goes away without `close()` (the window was closed, F-128). */
  onExit?: () => void;
  /** Test seams. */
  spawn?: typeof spawn;
  firstAnswerMs?: number;
}

interface PageState {
  sessionId: string;
  targetId: string;
  /** Opened by a page and not yet navigated: its first document needs the loader evaluated (onNavigated). */
  opened: boolean;
}

/** F-125: the one-line failure, CRT stays up. */
export function launchFailureLine(exe: string, why: string): string {
  return `crt: ${exe} did not accept a DevTools connection (${why}) — set browser.command in .crt/config.local.json, or run \`crt proxy\``;
}

export class CrtBrowser {
  private readonly pages = new Map<string, PageState>();
  /** Target ids whose preparation (F-126) has been answered. */
  private readonly ready = new Set<string>();
  /** Loopback origins granted the local-network permission (allowLoopback). */
  private readonly allowed = new Set<string>();
  private closing = false;
  private exited = false;

  private constructor(
    private readonly child: ChildProcess,
    private readonly cdp: CdpConnection,
    private readonly source: string,
  ) {}

  /** F-125/F-126: launch, prepare every tab, then open `url`. Rejects with the F-125 line's text as its message. */
  static async launch(opts: LaunchOptions): Promise<CrtBrowser> {
    const source = loaderSource(opts.loaderBundle, opts.origin);
    // N-34: the profile is under the CRT home; the first creation there in a run is announced by the caller.
    if (!existsSync(opts.profileDir)) {
      mkdirSync(opts.profileDir, { recursive: true });
      opts.onCreate?.(opts.profileDir);
    }
    const { exe, args } = opts.browser;
    const child = (opts.spawn ?? spawn)(exe, launchArgs(opts.profileDir, args), {
      shell: false,
      windowsHide: false,
      stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (d: Buffer) => {
      stderr = (stderr + d.toString("utf8")).slice(-2000);
    });
    const tail = () => stderr.trim().split(/\r?\n/).filter(Boolean).pop() ?? "no answer";
    const toBrowser = child.stdio[3] as Writable | null | undefined;
    const fromBrowser = child.stdio[4] as Readable | null | undefined;
    const fail = (why: string): Error => {
      child.kill();
      return new Error(launchFailureLine(exe, why));
    };
    if (!toBrowser || !fromBrowser) throw fail("no protocol pipe");

    const cdp = new CdpConnection(toBrowser, fromBrowser);
    const browser = new CrtBrowser(child, cdp, source);
    cdp.onEvent = (method, params, sessionId) => browser.onEvent(method, params, sessionId);

    let settled = false;
    const gone = new Promise<never>((_, reject) => {
      child.once("error", (err) => reject(fail(err.message)));
      child.once("exit", (code) => {
        browser.exited = true;
        cdp.close();
        if (!settled) reject(fail(code === null ? tail() : `exit ${code}${stderr.trim() ? `: ${tail()}` : ""}`));
        else if (!browser.closing) opts.onExit?.();
      });
    });
    gone.catch(() => undefined);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(fail(tail())), opts.firstAnswerMs ?? FIRST_ANSWER_MS);
    });
    try {
      // Existing targets (the about:blank tab) and every later one arrive as Target.attachedToTarget, paused.
      const first = cdp.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }).catch(
        // The pipe closed under the call: the exit (and its code) follows at once, and words the line better.
        () => new Promise<never>((_, reject) => setTimeout(() => reject(fail(tail())), 1_000).unref()),
      );
      await Promise.race([first, gone, timeout]);
      settled = true;
    } finally {
      clearTimeout(timer);
    }
    await browser.open(opts.url);
    return browser;
  }

  /** Whether the browser is still there. */
  get alive(): boolean {
    return !this.exited && !this.closing;
  }

  /** F-128: open `url` — in the first blank tab when there is one, else in a new tab. */
  async open(url: string): Promise<void> {
    let page = await this.blankPage();
    if (!page) {
      // A new tab starts blank and is navigated once it is prepared: a tab created on a URL starts
      // loading before the document gate (Fetch.enable) is in place.
      const { targetId } = (await this.cdp.send("Target.createTarget", { url: "about:blank" })) as { targetId: string };
      for (let i = 0; i < 40 && !this.ready.has(targetId); i++) await new Promise((r) => setTimeout(r, 50));
      page = this.pages.get(targetId) ?? null;
      if (!page) throw new Error("the new tab did not attach");
    }
    await this.cdp.send("Page.navigate", { url }, page.sessionId);
  }

  /** F-128: CRT is stopping — close the browser (it also exits by itself when the pipe closes). */
  async close(): Promise<void> {
    if (this.exited || this.closing) return;
    this.closing = true;
    const done = new Promise<void>((resolve) => this.child.once("exit", () => resolve()));
    this.cdp.post("Browser.close");
    const timer = setTimeout(() => this.child.kill(), 2_000);
    await done;
    clearTimeout(timer);
  }

  /**
   * Test seam (F-126's e2e): evaluate an expression in the page showing `urlPrefix`. Never called
   * by the CLI — N-32: CRT evaluates nothing in a page but the loader.
   */
  async evaluate(urlPrefix: string, expression: string): Promise<unknown> {
    const { targetInfos } = (await this.cdp.send("Target.getTargets")) as { targetInfos?: Array<{ targetId: string; type: string; url: string }> };
    const info = (targetInfos ?? []).find((t) => t.type === "page" && t.url.startsWith(urlPrefix));
    const page = info ? this.pages.get(info.targetId) : undefined;
    if (!page) throw new Error(`no page at ${urlPrefix}`);
    const r = (await this.cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }, page.sessionId)) as {
      result?: { value?: unknown };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    };
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? "evaluation failed");
    return r.result?.value;
  }

  /** Test seam: the URLs of the tabs CRT prepared. */
  async tabs(): Promise<string[]> {
    const { targetInfos } = (await this.cdp.send("Target.getTargets")) as { targetInfos?: Array<{ targetId: string; type: string; url: string }> };
    return (targetInfos ?? []).filter((t) => t.type === "page" && this.pages.has(t.targetId)).map((t) => t.url);
  }

  private async blankPage(): Promise<PageState | null> {
    // At launch the first tab attaches after setAutoAttach answers; give a prepared blank tab a moment to appear.
    const launching = this.ready.size === 0;
    for (let i = 0; i < 40; i++) {
      const { targetInfos } = (await this.cdp.send("Target.getTargets")) as { targetInfos?: Array<{ targetId: string; type: string; url: string }> };
      for (const t of targetInfos ?? []) {
        if (t.type === "page" && t.url === "about:blank" && this.ready.has(t.targetId)) return this.pages.get(t.targetId) ?? null;
      }
      if (!launching) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  }

  private onEvent(method: string, params: Record<string, unknown>, sessionId: string | undefined): void {
    if (method === "Target.attachedToTarget") {
      const info = params.targetInfo as { targetId: string; type: string; url: string; openerId?: string } | undefined;
      const session = params.sessionId as string | undefined;
      if (!info || !session) return;
      if (info.type === "page") void this.preparePage(session, info);
      else {
        // Workers and the like: nothing to inject; let them run and let go of them.
        this.cdp.post("Runtime.runIfWaitingForDebugger", {}, session);
        this.cdp.post("Target.detachFromTarget", { sessionId: session });
      }
      return;
    }
    if (method === "Target.detachedFromTarget") {
      const session = params.sessionId as string | undefined;
      for (const [id, p] of this.pages) {
        if (p.sessionId !== session) continue;
        this.pages.delete(id);
        this.ready.delete(id);
      }
      return;
    }
    const page = sessionId ? [...this.pages.values()].find((p) => p.sessionId === sessionId) : undefined;
    if (!page) return;
    if (method === "Fetch.requestPaused") this.onDocument(page, params);
    else if (method === "Page.frameNavigated") this.onNavigated(page, params);
  }

  /**
   * F-126: everything a tab needs before its first document runs. The four calls go out together
   * and in order — the browser holds a tab it started paused until the last one, and a tab the
   * page opened itself answers the renderer calls only once it is released, so nothing here may
   * wait for an answer before releasing it.
   */
  private async preparePage(sessionId: string, info: { targetId: string; url?: string; openerId?: string }): Promise<void> {
    this.pages.set(info.targetId, { sessionId, targetId: info.targetId, opened: !!info.openerId });
    const calls = [
      this.cdp.send("Page.enable", {}, sessionId),
      this.cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: this.source }, sessionId),
      // N-32: document responses only, held in the browser process until onDocument answers.
      this.cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*", resourceType: "Document", requestStage: "Response" }] }, sessionId),
    ];
    this.cdp.post("Runtime.runIfWaitingForDebugger", {}, sessionId);
    try {
      await Promise.all(calls);
    } catch {
      // The tab closed while it was being prepared.
    }
    if (!this.pages.has(info.targetId)) return;
    this.ready.add(info.targetId);
    // A tab that was already on a loopback page when CRT attached — one the browser restored from
    // its last session at launch — loaded without the loader and with its policy: load it again.
    if (isLoopbackUrl(info.url ?? "")) this.cdp.post("Page.reload", {}, sessionId);
  }

  /**
   * F-126: a tab the page opened with a reference to it (`window.open`) keeps the window of its
   * initial empty document for the first page it loads, so the registered script has already run
   * — on `about:blank`, where the loader does nothing — and does not run again. Evaluate the
   * loader once in that first document; `mountCrt` is idempotent, so a browser that did run it
   * loses nothing. Its console and network hooks then start after the page's first scripts.
   */
  private onNavigated(page: PageState, params: Record<string, unknown>): void {
    const frame = params.frame as { id?: string; parentId?: string; url?: string } | undefined;
    if (!page.opened || !frame || frame.parentId || frame.id !== page.targetId) return;
    if (!frame.url || frame.url === "about:blank") return;
    page.opened = false;
    if (isLoopbackUrl(frame.url)) this.cdp.post("Runtime.evaluate", { expression: this.source }, page.sessionId);
  }

  /** N-32: a document response is waiting — lift the policy of a main-frame loopback document, pass everything else through untouched. */
  private onDocument(page: PageState, params: Record<string, unknown>): void {
    const requestId = params.requestId as string;
    const request = params.request as { url?: string } | undefined;
    const status = params.responseStatusCode as number | undefined;
    // A redirect or a failed request has no policy to lift. A top-level page target's main frame id is its target id.
    const final = status !== undefined && (status < 300 || status >= 400);
    const headers = final ? liftedHeaders({ mainFrame: params.frameId === page.targetId, url: request?.url ?? "", headers: params.responseHeaders as HeaderEntry[] | undefined }) : null;
    const untouched = () => this.cdp.post("Fetch.continueRequest", { requestId }, page.sessionId);
    if (!headers) return untouched();
    this.allowLoopback(new URL(request!.url!).origin)
      .then(() => this.cdp.send("Fetch.getResponseBody", { requestId }, page.sessionId))
      .then((r) => {
        const body = r.base64Encoded === true ? (r.body as string) : Buffer.from((r.body as string | undefined) ?? "", "utf8").toString("base64");
        return this.cdp.send("Fetch.fulfillRequest", { requestId, responseCode: status, responseHeaders: headers, body }, page.sessionId);
      })
      .catch(untouched);
  }

  /**
   * A document served through `Fetch.fulfillRequest` has no network address, so the browser's
   * local-network-access check treats it as a public page and refuses its requests to the CRT
   * server on loopback. Grant the app's own (loopback) origin that one permission, once. The name
   * changed across Chrome versions; a browser that knows neither has no such check.
   */
  private async allowLoopback(origin: string): Promise<void> {
    if (this.allowed.has(origin)) return;
    this.allowed.add(origin);
    for (const permission of ["loopbackNetwork", "localNetworkAccess"]) {
      try {
        await this.cdp.send("Browser.grantPermissions", { origin, permissions: [permission] });
        return;
      } catch {
        // Not a permission this browser knows; try the older name.
      }
    }
  }
}

/** Read `dist/loader-inject.js` next to the overlay bundle. */
export function readLoaderBundle(overlayPath: string): string {
  return readFileSync(join(overlayPath, "..", "loader-inject.js"), "utf8");
}

// ---- one browser per server (F-128) --------------------------------------------------------------

/** F-125/F-132: no `browser.command` and none of the known browsers is installed. */
export const NO_BROWSER_LINE = "crt: no Chrome, Edge or Chromium found — set browser.command in .crt/config.local.json, or run `crt proxy`";
/** F-128 / §5.1: the window was closed; CRT keeps serving. */
export const BROWSER_CLOSED_LINE = "crt: the CRT browser was closed — `crt browse` opens it again";

export type BrowseResult = { ok: true; url: string } | { ok: false; reason: string };

export interface BrowserControllerOptions {
  /** `browser.command` from the config, or null. */
  command: string[] | null;
  profileDir: string;
  /** N-34: told when the profile directory had to be created. */
  onCreate?: (path: string) => void;
  /** This server's origin — asked for at launch, once the port is bound. */
  origin: () => string;
  /** The text of `dist/loader-inject.js`, read at launch. */
  loaderBundle: () => string;
  log: (line: string) => void;
  /** Test seams. */
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
  exists?: (path: string) => boolean;
  spawn?: typeof spawn;
  firstAnswerMs?: number;
}

/**
 * F-128: the server's one CRT browser. The first `open` launches it; a later one opens a tab in
 * the same window; after the window was closed the next one launches again. A failure is one
 * line on the server's log and a reason for the caller — it never throws and never stops CRT
 * (F-125). Requests are served one at a time, so two at once cannot launch two browsers.
 */
export class BrowserController {
  private browser: CrtBrowser | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: BrowserControllerOptions) {}

  /** Whether a CRT browser is open right now (the F-128 stop line says so). */
  get isOpen(): boolean {
    return this.browser?.alive === true;
  }

  /** Test seam: the running browser, for `evaluate` / `tabs` (N-32: nothing in the CLI calls those). */
  get current(): CrtBrowser | null {
    return this.browser?.alive ? this.browser : null;
  }

  open(url: string): Promise<BrowseResult> {
    const run = this.queue.then(() => this.openNow(url));
    this.queue = run.catch(() => undefined);
    return run;
  }

  async close(): Promise<void> {
    await this.queue;
    const browser = this.browser;
    this.browser = null;
    await browser?.close();
  }

  private async openNow(url: string): Promise<BrowseResult> {
    const { opts } = this;
    const fail = (line: string): BrowseResult => {
      opts.log(line);
      return { ok: false, reason: line.replace(/^crt: /, "") };
    };
    if (this.browser?.alive) {
      try {
        await this.browser.open(url);
        return { ok: true, url };
      } catch (err) {
        return fail(`crt: the CRT browser did not open ${url} (${err instanceof Error ? err.message : String(err)})`);
      }
    }
    const found = findBrowser({
      command: opts.command,
      platform: opts.platform ?? process.platform,
      env: opts.env ?? process.env,
      home: opts.home ?? homedir(),
      ...(opts.exists ? { exists: opts.exists } : {}),
    });
    if (!found) return fail(NO_BROWSER_LINE);
    try {
      this.browser = await CrtBrowser.launch({
        browser: found,
        profileDir: opts.profileDir,
        ...(opts.onCreate ? { onCreate: opts.onCreate } : {}),
        origin: opts.origin(),
        loaderBundle: opts.loaderBundle(),
        url,
        log: opts.log,
        onExit: () => {
          this.browser = null;
          opts.log(BROWSER_CLOSED_LINE);
        },
        ...(opts.spawn ? { spawn: opts.spawn } : {}),
        ...(opts.firstAnswerMs === undefined ? {} : { firstAnswerMs: opts.firstAnswerMs }),
      });
      return { ok: true, url };
    } catch (err) {
      // F-125: the launch failure line as CrtBrowser.launch worded it; anything else (an unbuilt bundle) in the same shape.
      const message = err instanceof Error ? err.message : String(err);
      return fail(message.startsWith("crt: ") ? message : `crt: could not start the CRT browser (${message})`);
    }
  }
}
