import { join, resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_CLOSED_LINE,
  browserCandidates,
  BrowserController,
  CdpConnection,
  findBrowser,
  INJECT_ORIGIN_PLACEHOLDER,
  isLoopbackUrl,
  launchArgs,
  launchFailureLine,
  liftedHeaders,
  NO_BROWSER_LINE,
  NulFramer,
} from "../src/browser.js";
import { browserProfileDir, crtHome, projectKey } from "../src/home.js";
import { PassThrough } from "node:stream";
import { fakeBrowser } from "./helpers/fake-cli.js";

// PRD-zero M28: the CRT browser's pure parts (discovery, launch arguments, the pipe framing, the
// policy decision) and its lifecycle against a fake browser that speaks the DevTools pipe
// (helpers/fake-browser.mjs) — a real Chromium is e2e/browser.spec.ts.

const ORIGIN = "http://localhost:4400";
const BUNDLE = `mount("${INJECT_ORIGIN_PLACEHOLDER}")`;

describe("finding the browser (F-125)", () => {
  const WIN = { ProgramFiles: "C:\\Program Files", "ProgramFiles(x86)": "C:\\Program Files (x86)", LocalAppData: "C:\\Users\\dev\\AppData\\Local" };
  const find = (platform: NodeJS.Platform, env: NodeJS.ProcessEnv, installed: string[], command: string[] | null = null) =>
    findBrowser({ command, platform, env, home: platform === "win32" ? "C:\\Users\\dev" : "/home/dev", exists: (p) => installed.includes(p) });

  it("browser.command wins over every installed browser, taken as given: executable first, then its arguments (F-125)", () => {
    const chrome = join(WIN.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe");
    expect(find("win32", WIN, [chrome], ["D:\\tools\\brave.exe", "--incognito"])).toEqual({ exe: "D:\\tools\\brave.exe", args: ["--incognito"], name: "browser.command" });
    expect(find("win32", WIN, [chrome], [])).toMatchObject({ exe: chrome, name: "Chrome" });
  });

  it("Windows: Chrome before Edge before Chromium, under %ProgramFiles%, %ProgramFiles(x86)% and %LocalAppData% (F-125)", () => {
    const chromeUser = join(WIN.LocalAppData, "Google", "Chrome", "Application", "chrome.exe");
    const edge = join(WIN["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe");
    const chromium = join(WIN.LocalAppData, "Chromium", "Application", "chrome.exe");
    expect(find("win32", WIN, [edge, chromeUser, chromium])).toEqual({ exe: chromeUser, args: [], name: "Chrome" });
    expect(find("win32", WIN, [chromium, edge])).toEqual({ exe: edge, args: [], name: "Edge" });
    expect(find("win32", WIN, [chromium])).toEqual({ exe: chromium, args: [], name: "Chromium" });
    expect(find("win32", WIN, [])).toBeNull();
    // An unset root is skipped, never joined as "undefined".
    expect(browserCandidates({ platform: "win32", env: { ProgramFiles: WIN.ProgramFiles }, home: "C:\\Users\\dev" }).map((c) => c.path)).toEqual([
      join(WIN.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe"),
      join(WIN.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
      join(WIN.ProgramFiles, "Chromium", "Application", "chrome.exe"),
    ]);
  });

  it("macOS: the Chrome, Edge and Chromium apps under /Applications and ~/Applications (F-125)", () => {
    const edge = join("/Applications", "Microsoft Edge.app", "Contents", "MacOS", "Microsoft Edge");
    const chromeHome = join("/home/dev", "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome");
    const chromium = join("/Applications", "Chromium.app", "Contents", "MacOS", "Chromium");
    expect(find("darwin", {}, [edge, chromeHome])).toEqual({ exe: chromeHome, args: [], name: "Chrome" });
    expect(find("darwin", {}, [chromium, edge])).toEqual({ exe: edge, args: [], name: "Edge" });
    expect(find("darwin", {}, [chromium])).toMatchObject({ name: "Chromium" });
    expect(find("darwin", {}, [])).toBeNull();
  });

  it("Linux: google-chrome, google-chrome-stable, microsoft-edge, chromium and chromium-browser on PATH (F-125)", () => {
    const env = { PATH: ["/usr/local/bin", "/usr/bin"].join(process.platform === "win32" ? ";" : ":") };
    expect(find("linux", env, [join("/usr/bin", "chromium"), join("/usr/bin", "microsoft-edge")])).toEqual({ exe: join("/usr/bin", "microsoft-edge"), args: [], name: "Edge" });
    expect(find("linux", env, [join("/usr/bin", "chromium-browser"), join("/usr/local/bin", "google-chrome-stable")])).toEqual({ exe: join("/usr/local/bin", "google-chrome-stable"), args: [], name: "Chrome" });
    expect(find("linux", env, [join("/usr/bin", "chromium-browser")])).toMatchObject({ name: "Chromium" });
    expect(find("linux", {}, [join("/usr/bin", "chromium")])).toBeNull();
  });

  it("the launch arguments: the pipe, the per-project profile, no first-run pages, browser.command's own arguments — and never a debug port (F-125, N-31)", () => {
    const args = launchArgs("/home/dev/.crt/browser/app-abc123", ["--headless=new"]);
    expect(args).toEqual(["--remote-debugging-pipe", "--user-data-dir=/home/dev/.crt/browser/app-abc123", "--no-first-run", "--no-default-browser-check", "--headless=new", "about:blank"]);
    expect(args.join(" ")).not.toMatch(/remote-debugging-port|enable-automation|disable-web-security/);
    expect(launchArgs("p")).toEqual(["--remote-debugging-pipe", "--user-data-dir=p", "--no-first-run", "--no-default-browser-check", "about:blank"]);
  });

  it("the profile lives under the CRT home, keyed by folder name plus a hash of the absolute root (F-125, F-130)", () => {
    // `CRT_HOME` is made absolute (on Windows a rooted path gains the current drive).
    const home = resolve("/tmp", "crt-home");
    expect(crtHome({ CRT_HOME: join("/tmp", "crt-home") })).toBe(home);
    expect(crtHome({})).toMatch(/\.crt$/);
    const key = projectKey(join("/work", "My App!"), "linux");
    expect(key).toMatch(/^my-app-[0-9a-f]{6}$/);
    expect(projectKey(join("/other", "My App!"), "linux")).not.toBe(key);
    // Windows paths compare case-insensitively, so one checkout has one key however it was typed.
    expect(projectKey("C:\\Work\\App", "win32")).toBe(projectKey("c:\\work\\app", "win32"));
    expect(browserProfileDir(join("/work", "app"), { CRT_HOME: home })).toBe(join(home, "browser", projectKey(join("/work", "app"))));
  });
});

describe("the pipe transport (F-126)", () => {
  it("frames NUL-terminated messages whether a chunk holds part of one, exactly one, or several (F-126)", () => {
    const framer = new NulFramer();
    expect(framer.push(Buffer.from('{"a":'))).toEqual([]);
    expect(framer.push(Buffer.from("1}\0"))).toEqual(['{"a":1}']);
    expect(framer.push(Buffer.from('{"b":2}\0{"c":3}\0{"d"'))).toEqual(['{"b":2}', '{"c":3}']);
    expect(framer.push(Buffer.from(":4}"))).toEqual([]);
    expect(framer.push(Buffer.from("\0"))).toEqual(['{"d":4}']);
    // A multi-byte character split across chunks survives.
    const euro = Buffer.from('"€"\0');
    expect([...framer.push(euro.subarray(0, 2)), ...framer.push(euro.subarray(2))]).toEqual(['"€"']);
  });

  it("matches answers to calls by id, carries the session on the message, hands events on, and rejects what is pending when the pipe closes (F-126)", async () => {
    const toBrowser = new PassThrough();
    const fromBrowser = new PassThrough();
    const sent: string[] = [];
    toBrowser.on("data", (d: Buffer) => sent.push(d.toString("utf8")));
    const cdp = new CdpConnection(toBrowser, fromBrowser);
    const events: unknown[] = [];
    cdp.onEvent = (method, params, sessionId) => events.push({ method, params, sessionId });
    const first = cdp.send("Target.getTargets");
    const second = cdp.send("Page.enable", {}, "S1");
    const third = cdp.send("Never.answered");
    await vi.waitFor(() => expect(sent).toHaveLength(3));
    expect(sent[0]).toBe('{"id":1,"method":"Target.getTargets","params":{}}\0');
    expect(JSON.parse(sent[1]!.slice(0, -1))).toEqual({ id: 2, method: "Page.enable", params: {}, sessionId: "S1" });
    fromBrowser.write('{"id":2,"error":{"message":"no such session"}}\0{"method":"Target.attachedToTarget","params":{"x":1},"sessionId":"S9"}\0not json\0{"id":1,"result":{"targetInfos":[]}}\0');
    await expect(first).resolves.toEqual({ targetInfos: [] });
    await expect(second).rejects.toThrow("no such session");
    expect(events).toEqual([{ method: "Target.attachedToTarget", params: { x: 1 }, sessionId: "S9" }]);
    fromBrowser.end();
    await expect(third).rejects.toThrow(/closed/);
    await expect(cdp.send("Too.late")).rejects.toThrow(/closed/);
  });
});

describe("whose policy is lifted (N-32)", () => {
  it("loopback is localhost, *.localhost, 127.0.0.1 and [::1] over http(s) — one row per host class (N-32)", () => {
    for (const url of ["http://localhost:3000/", "https://LOCALHOST/x", "http://app.localhost:5173/a?b", "http://127.0.0.1:8080/", "http://[::1]:3000/"]) expect(isLoopbackUrl(url), url).toBe(true);
    for (const url of ["https://example.com/", "http://localhost.evil.example/", "http://127.0.0.2/", "http://10.0.0.5:3000/", "http://0.0.0.0:3000/", "file:///C:/x.html", "about:blank", "chrome://settings", "localhost:3000", ""]) {
      expect(isLoopbackUrl(url), url).toBe(false);
    }
  });

  it("only a main-frame loopback document that carries the header is changed, and only that header and the transport ones go (N-32)", () => {
    const headers = [
      { name: "Content-Type", value: "text/html" },
      { name: "content-security-policy", value: "default-src 'self'" },
      { name: "Content-Security-Policy-Report-Only", value: "default-src 'none'" },
      { name: "Content-Encoding", value: "br" },
      { name: "Content-Length", value: "120" },
      { name: "Transfer-Encoding", value: "chunked" },
      { name: "Set-Cookie", value: "a=1" },
      { name: "Set-Cookie", value: "b=2" },
    ];
    expect(liftedHeaders({ mainFrame: true, url: "http://localhost:3000/", headers })).toEqual([
      { name: "Content-Type", value: "text/html" },
      { name: "Content-Security-Policy-Report-Only", value: "default-src 'none'" },
      { name: "Set-Cookie", value: "a=1" },
      { name: "Set-Cookie", value: "b=2" },
    ]);
    // Untouched: a frame, a non-loopback host, a document with no policy, a response without headers.
    expect(liftedHeaders({ mainFrame: false, url: "http://localhost:3000/", headers })).toBeNull();
    expect(liftedHeaders({ mainFrame: true, url: "https://example.com/", headers })).toBeNull();
    expect(liftedHeaders({ mainFrame: true, url: "http://localhost:3000/", headers: [{ name: "Content-Type", value: "text/html" }] })).toBeNull();
    expect(liftedHeaders({ mainFrame: true, url: "http://localhost:3000/", headers: undefined })).toBeNull();
  });
});

describe("the browser's lifecycle against a fake browser (F-125, F-126, F-128)", () => {
  let fake: ReturnType<typeof fakeBrowser> | null = null;
  let controller: BrowserController | null = null;
  afterEach(async () => {
    await controller?.close();
    controller = null;
    fake?.cleanup();
    fake = null;
  });
  const start = (mode: "ok" | "exit" | "silent" | "restored", over: Partial<ConstructorParameters<typeof BrowserController>[0]> = {}) => {
    fake = fakeBrowser(mode);
    const logs: string[] = [];
    controller = new BrowserController({
      command: ["chrome-from-config", "--lang=en"],
      profileDir: join(import.meta.dirname, "..", "node_modules", ".cache", "crt-test-profile"),
      origin: () => ORIGIN,
      loaderBundle: () => BUNDLE,
      log: (line) => logs.push(line),
      spawn: fake.spawn,
      ...over,
    });
    return { fake, controller, logs };
  };
  const methods = (f: ReturnType<typeof fakeBrowser>, sessionId?: string) =>
    f.messages()
      .filter((m) => m.sessionId === sessionId)
      .map((m) => m.method);

  it("a browser that exits at once: one line with its stderr tail, CRT stays up (F-125)", async () => {
    const { controller, logs } = start("exit");
    const line = "crt: chrome-from-config did not accept a DevTools connection (exit 1: fake-browser: cannot open display) — set browser.command in .crt/config.local.json, or run `crt proxy`";
    expect(await controller.open("http://localhost:3000")).toEqual({ ok: false, reason: line.replace("crt: ", "") });
    expect(logs).toEqual([line]);
    expect(controller.isOpen).toBe(false);
    expect(launchFailureLine("C:\\chrome.exe", "no answer")).toBe("crt: C:\\chrome.exe did not accept a DevTools connection (no answer) — set browser.command in .crt/config.local.json, or run `crt proxy`");
  });

  it("a browser that never answers the first protocol call: the same line with \"no answer\", and the process is not left behind (F-125)", async () => {
    const { controller, logs } = start("silent", { firstAnswerMs: 300 });
    expect(await controller.open("http://localhost:3000")).toMatchObject({ ok: false });
    expect(logs).toEqual(["crt: chrome-from-config did not accept a DevTools connection (no answer) — set browser.command in .crt/config.local.json, or run `crt proxy`"]);
    expect(controller.isOpen).toBe(false);
  });

  it("no browser.command and nothing installed: one line naming both ways out, nothing spawned (F-125)", async () => {
    const { controller, fake, logs } = start("ok", { command: null, platform: "linux", env: { PATH: "" }, exists: () => false });
    expect(await controller.open("http://localhost:3000")).toEqual({ ok: false, reason: NO_BROWSER_LINE.replace("crt: ", "") });
    expect(logs).toEqual(["crt: no Chrome, Edge or Chromium found — set browser.command in .crt/config.local.json, or run `crt proxy`"]);
    expect(fake.launches()).toEqual([]);
  });

  it("launch: the pipe and the profile in the arguments, the tab prepared before it is released, then the app opened in it (F-125, F-126, N-31)", async () => {
    const { controller, fake, logs } = start("ok");
    expect(await controller.open("http://localhost:3000/")).toEqual({ ok: true, url: "http://localhost:3000/" });
    expect(controller.isOpen).toBe(true);
    expect(logs).toEqual([]);
    const [argv] = fake.launches();
    expect(argv![0]).toBe("--remote-debugging-pipe");
    expect(argv![1]).toMatch(/^--user-data-dir=.*crt-test-profile$/);
    expect(argv!.slice(2)).toEqual(["--no-first-run", "--no-default-browser-check", "--lang=en", "about:blank"]);
    expect(argv!.join(" ")).not.toContain("remote-debugging-port");
    await vi.waitFor(() => expect(methods(fake, "S1")).toContain("Fetch.fulfillRequest"));
    // Auto-attach first, on the browser session; then the tab: loader and document gate registered before it runs.
    expect(fake.messages()[0]).toMatchObject({ method: "Target.setAutoAttach", params: { autoAttach: true, waitForDebuggerOnStart: true, flatten: true } });
    const tab = methods(fake, "S1");
    expect(tab.slice(0, 4)).toEqual(["Page.enable", "Page.addScriptToEvaluateOnNewDocument", "Fetch.enable", "Runtime.runIfWaitingForDebugger"]);
    expect(tab.indexOf("Page.navigate")).toBeGreaterThan(3);
    const script = fake.messages().find((m) => m.method === "Page.addScriptToEvaluateOnNewDocument")!;
    expect(script.params).toEqual({ source: `mount("${ORIGIN}")` });
    expect(fake.messages().find((m) => m.method === "Fetch.enable")!.params).toEqual({ patterns: [{ urlPattern: "*", resourceType: "Document", requestStage: "Response" }] });
    // Nothing CRT sends switches the policy off for a tab, and nothing is evaluated in a page (N-32).
    const all = fake.messages().map((m) => m.method);
    expect(all).not.toContain("Page.setBypassCSP");
    expect(all).not.toContain("Runtime.evaluate");
  });

  it("a loopback document is served without its policy header and with its other headers; the app's origin may reach CRT (F-126, N-32)", async () => {
    const { controller, fake } = start("ok");
    await controller.open("http://localhost:3000/cart");
    await vi.waitFor(() => expect(methods(fake, "S1")).toContain("Fetch.fulfillRequest"));
    const fulfilled = fake.messages().find((m) => m.method === "Fetch.fulfillRequest")!;
    expect(fulfilled.params).toEqual({
      requestId: "R1",
      responseCode: 200,
      responseHeaders: [
        { name: "Content-Type", value: "text/html" },
        { name: "Set-Cookie", value: "a=1" },
      ],
      body: Buffer.from("<html></html>").toString("base64"),
    });
    expect(fake.messages().find((m) => m.method === "Browser.grantPermissions")!.params).toMatchObject({ origin: "http://localhost:3000" });
    expect(methods(fake, "S1")).not.toContain("Fetch.continueRequest");
  });

  it("one browser per server: a second request opens a new tab in it, and a non-loopback document goes through untouched (F-128, N-32)", async () => {
    const { controller, fake } = start("ok");
    await controller.open("http://localhost:3000/");
    expect(await controller.open("https://example.com/docs")).toEqual({ ok: true, url: "https://example.com/docs" });
    expect(fake.launches()).toHaveLength(1);
    expect(fake.messages().filter((m) => m.method === "Target.createTarget").map((m) => m.params)).toEqual([{ url: "about:blank" }]);
    await vi.waitFor(() => expect(methods(fake, "S2")).toContain("Fetch.continueRequest"));
    const second = methods(fake, "S2");
    expect(second.slice(0, 4)).toEqual(["Page.enable", "Page.addScriptToEvaluateOnNewDocument", "Fetch.enable", "Runtime.runIfWaitingForDebugger"]);
    expect(second).not.toContain("Fetch.fulfillRequest");
    expect(second).not.toContain("Fetch.getResponseBody");
    expect(fake.messages().filter((m) => m.method === "Browser.grantPermissions").map((m) => m.params!.origin)).toEqual(["http://localhost:3000"]);
  });

  it("a tab the browser restored from its last session is prepared and reloaded once, so it gets the loader too; a fresh tab is not reloaded (F-126)", async () => {
    const { controller, fake } = start("restored");
    await controller.open("http://localhost:3000/");
    await vi.waitFor(() => expect(methods(fake, "S9")).toContain("Page.reload"));
    expect(methods(fake, "S9")).toEqual(["Page.enable", "Page.addScriptToEvaluateOnNewDocument", "Fetch.enable", "Runtime.runIfWaitingForDebugger", "Page.reload"]);
    // The app opened in the blank tab, not over the restored one, and that tab was never reloaded.
    expect(fake.messages().filter((m) => m.method === "Page.navigate").map((m) => m.sessionId)).toEqual(["S1"]);
    expect(methods(fake, "S1")).not.toContain("Page.reload");
  });

  it("the window closing says so once and CRT keeps going; the next request launches again (F-128)", async () => {
    const { controller, fake, logs } = start("ok");
    await controller.open("http://localhost:3000/close-window");
    await vi.waitFor(() => expect(logs).toEqual([BROWSER_CLOSED_LINE]));
    expect(BROWSER_CLOSED_LINE).toBe("crt: the CRT browser was closed — `crt browse` opens it again");
    expect(controller.isOpen).toBe(false);
    expect(await controller.open("http://localhost:3000/")).toMatchObject({ ok: true });
    expect(fake.launches()).toHaveLength(2);
    expect(controller.isOpen).toBe(true);
    expect(logs).toEqual([BROWSER_CLOSED_LINE]);
  });

  it("CRT stopping closes the browser, without the window-closed line (F-128)", async () => {
    const { controller, fake, logs } = start("ok");
    await controller.open("http://localhost:3000/");
    await controller.close();
    expect(controller.isOpen).toBe(false);
    expect(fake.messages().map((m) => m.method)).toContain("Browser.close");
    expect(logs).toEqual([]);
    // Two requests at once never start two browsers.
    const again = start("ok");
    await Promise.all([again.controller.open("http://localhost:3000/a"), again.controller.open("http://localhost:3000/b")]);
    expect(again.fake.launches()).toHaveLength(1);
  });
});
