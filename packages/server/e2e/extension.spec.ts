import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type BrowserContext, chromium, expect, type Page, test, type Worker } from "@playwright/test";
import type { CaptureBundle } from "../src/capture-schema.js";
import type { SessionEvent } from "../src/session-events.js";
import { packageVersion } from "../src/version.js";
import { UNTOUCHED_CSP } from "./fixture/server.mjs";
import { type CrtHooks, FIXTURE_ORIGIN, health, PORTS, scratch, startCrt, stopCrts } from "./helpers.js";

// PRD-extension M38 (F-154…F-160, N-42, N-43, N-44): the extension, loaded unpacked into
// Playwright's Chromium, against the fixture app on its own URL — no loader tag in the page, the
// /untouched policy (`'self'` and nothing else), a real embedded `crt serve` with the stub agent.
//
// What Playwright cannot do, and what stands in for it:
//   • Press the toolbar button. The worker exposes the function the click calls (`crtToggle`), and
//     the spec calls it with the tab (F-155).
//   • Answer Chrome's permission prompt. Loopback is the extension's own permission; for the host
//     name that is not loopback, the spec loads a copy of the built extension whose manifest lists
//     that one host (PRD-extension §12 rule 3: never `<all_urls>`).
//   • Reach into the overlay. It is in an isolated world behind a closed shadow root — the point
//     of F-156 — so the spec drives the overlay's own `window.__crt` hooks in that world over the
//     DevTools protocol (`inOverlay`).
//   • Grant `activeTab`. So a Send here gets the fallback's screenshot (F-158). The last test
//     stands in for the click with a second copy of the extension that holds the all-sites
//     permission — the other way Chrome allows a tab capture — to run the capture path itself;
//     the capture under a real click is the Manual row of CRT-0059. The shipped manifest never
//     asks for all sites (the manifest row in test/extension.test.ts).

const here = dirname(fileURLToPath(import.meta.url));
const DIST = join(here, "..", "dist", "extension");
const WORK = join(here, ".project", "extension-browser");
/** A host name that is not loopback but resolves to this machine: the F-160 rows. */
const OUTSIDE_HOST = "outside.test";
const OUTSIDE = `http://${OUTSIDE_HOST}:${PORTS.fixture}`;
/** The same fixture on another loopback origin: a site that is never turned on. */
const OTHER = `http://127.0.0.1:${PORTS.fixture}`;

declare const chrome: {
  storage: { local: { set(items: Record<string, unknown>): Promise<void>; get(key: string): Promise<Record<string, unknown>> } };
  tabs: { query(q: object): Promise<Array<{ id?: number; url?: string }>> };
  scripting: { getRegisteredContentScripts(): Promise<Array<{ id: string }>> };
  runtime?: { id?: string };
};

interface Ext {
  context: BrowserContext;
  worker: Worker;
  /** F-155: what the toolbar button does on the tab showing `url`. */
  toggle(page: Page): Promise<string>;
  registered(): Promise<string[]>;
}

let ext: Ext;
let port = PORTS.extension.from;

/** A copy of the built extension whose manifest also holds `hosts` (see the header). */
function extensionCopy(name: string, hosts: string[]): string {
  const dir = join(WORK, name, "extension");
  rmSync(join(WORK, name), { recursive: true, force: true });
  mkdirSync(join(WORK, name), { recursive: true });
  cpSync(DIST, dir, { recursive: true });
  const file = join(dir, "manifest.json");
  const manifest = JSON.parse(readFileSync(file, "utf8")) as { host_permissions: string[] };
  manifest.host_permissions.push(...hosts);
  writeFileSync(file, JSON.stringify(manifest, null, 2) + "\n");
  return dir;
}

async function launch(name = "main", hosts = [`http://${OUTSIDE_HOST}/*`]): Promise<Ext> {
  const dir = extensionCopy(name, hosts);
  const context = await chromium.launchPersistentContext(join(WORK, name, "profile"), {
    channel: "chromium", // the full browser: the headless shell does not load extensions
    headless: true,
    args: [`--disable-extensions-except=${dir}`, `--load-extension=${dir}`, "--no-proxy-server", `--host-resolver-rules=MAP ${OUTSIDE_HOST} 127.0.0.1`],
  });
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  return {
    context,
    worker,
    toggle: (page) =>
      worker.evaluate(async (url) => {
        const tab = (await chrome.tabs.query({})).find((t) => t.url === url);
        if (!tab) throw new Error(`no tab on ${url}`);
        return (globalThis as unknown as { crtToggle(tab: object): Promise<string> }).crtToggle(tab);
      }, page.url()),
    registered: () => worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id).sort()),
  };
}

/** Point the extension at a CRT server (what the options page's port field does). */
const useServer = (p: number, e: Ext = ext) => e.worker.evaluate((server) => chrome.storage.local.set({ server }), `http://localhost:${p}`);

/**
 * Evaluate in the overlay's world: the extension's isolated world on `page`, found by the flag its
 * content script sets there. `fn` gets the overlay's hooks; the result comes back by value.
 */
async function inOverlay<T, A = undefined>(page: Page, fn: (crt: CrtHooks, arg: A) => T | Promise<T>, arg?: A): Promise<T> {
  const cdp = await page.context().newCDPSession(page);
  try {
    const contexts: Array<{ id: number; auxData?: { type?: string; isDefault?: boolean } }> = [];
    cdp.on("Runtime.executionContextCreated", (e) => contexts.push(e.context));
    await cdp.send("Runtime.enable");
    for (const c of contexts.filter((x) => x.auxData?.type === "isolated")) {
      const probe = await cdp.send("Runtime.evaluate", { contextId: c.id, expression: "globalThis.__crtContent === true && typeof globalThis.__crt?.send === 'function'", returnByValue: true }).catch(() => null);
      if (probe?.result.value !== true) continue;
      // The argument travels as a protocol value, never as source text.
      const out = await cdp.send("Runtime.callFunctionOn", {
        executionContextId: c.id,
        functionDeclaration: `async function (arg) { return JSON.stringify((await (${fn.toString()})(globalThis.__crt, arg)) ?? null); }`,
        arguments: [{ value: arg ?? null }],
        awaitPromise: true,
        returnByValue: true,
      });
      if (out.exceptionDetails) throw new Error(`in the overlay's world: ${out.exceptionDetails.exception?.description ?? out.exceptionDetails.text}`);
      return JSON.parse(out.result.value as string) as T;
    }
    throw new Error("the overlay is not mounted in an isolated world on this page");
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

/** The overlay is mounted: its host is in the document and its hooks answer in the isolated world. */
async function mounted(page: Page): Promise<void> {
  await expect(page.locator("#crt-host")).toBeAttached();
  await expect.poll(() => inOverlay(page, (crt) => crt.version).catch(() => null)).toBe(1);
}

/** What the page's own world can see of CRT (F-156, N-44). */
const pageView = (page: Page) =>
  page.evaluate(() => ({
    crtGlobal: typeof (window as unknown as { __crt?: unknown }).__crt,
    chromeRuntime: typeof (globalThis as unknown as { chrome?: { runtime?: { sendMessage?: unknown } } }).chrome?.runtime?.sendMessage,
    shadowRoot: document.getElementById("crt-host")?.shadowRoot ?? null,
    hasHost: document.getElementById("crt-host") !== null,
    storageKeys: [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter((k) => k.startsWith("crt")),
    consoleWrapped: !/\[native code\]/.test(Function.prototype.toString.call(console.error)),
  }));

async function serverFor(name: string): Promise<{ root: string; port: number }> {
  const p = port++;
  const root = scratch("extension", name, p);
  const crt = startCrt(root, ["serve", "--no-open"]);
  await crt.waitFor(/^CRT ready at /);
  await useServer(p);
  return { root, port: p };
}

test.describe.configure({ mode: "serial" }); // one browser, one extension, one set of registrations

test.beforeAll(async () => {
  ext = await launch();
});
test.afterAll(async () => {
  await ext?.context.close();
});
test.afterEach(async () => {
  for (const page of ext.context.pages()) {
    // Leave every site off for the next test.
    const origin = new URL(page.url()).origin;
    if ((await ext.registered()).some((id) => id.endsWith(origin))) await ext.toggle(page);
    await page.close();
  }
  await stopCrts();
});

test.describe("the extension on an app with nothing of CRT in it (F-154…F-160)", () => {
  test("is off everywhere until turned on; then the overlay is on the app's own URL under a 'self'-only policy, with the first script's error and the component name in the capture, and nothing of CRT in the page's world (F-155, F-156, N-44)", async () => {
    const { port: crtPort } = await serverFor("strict");
    const page = await ext.context.newPage();
    const response = await page.goto(`${FIXTURE_ORIGIN}/ext`);
    expect(response!.headers()["content-security-policy"]).toBe(UNTOUCHED_CSP);

    // F-155: installed, and nothing has happened on this site.
    await page.waitForLoadState("load");
    expect(await ext.registered()).toEqual([]);
    expect(await pageView(page)).toMatchObject({ hasHost: false, consoleWrapped: false, crtGlobal: "undefined" });

    expect(await ext.toggle(page)).toBe("on");
    await mounted(page);
    expect(await ext.registered()).toEqual([`crt-overlay:${FIXTURE_ORIGIN}`, `crt-probe:${FIXTURE_ORIGIN}`]);

    // The registration, not the click, is what reaches the next load — before the app's first script.
    await page.reload();
    await mounted(page);
    expect(page.url()).toBe(`${FIXTURE_ORIGIN}/ext`);

    const bundle = await inOverlay(page, async (crt) => {
      crt.addSelect("#heading");
      crt.setNote(1, "the heading is wrong");
      return (await crt.capture()).bundle;
    });
    expect((bundle as CaptureBundle).page.url).toBe(`${FIXTURE_ORIGIN}/ext`);
    expect(bundle.console.map((c) => c.message)).toContain("fixture: the first script of an app reviewed through the extension"); // F-20 across the two worlds
    expect(bundle.annotations[0]!.element!.components).toEqual([{ name: "Cart", kind: "function" }]); // F-18: a property only the page's world holds
    expect(bundle.framework.name).toBe("react");
    expect(await inOverlay(page, (crt) => [crt.crtOrigin(), crt.embeddedMode()])).toEqual([`http://localhost:${crtPort}`, false]);

    // F-156, N-44: no global, no way to the worker, a closed root, nothing in the site's storage —
    // although the annotation above is kept for a reload (F-12), in the extension's own storage.
    expect(await pageView(page)).toEqual({ crtGlobal: "undefined", chromeRuntime: "undefined", shadowRoot: null, hasHost: true, storageKeys: [], consoleWrapped: true });
    await page.reload();
    await mounted(page);
    expect(await inOverlay(page, (crt) => crt.annotations().map((a) => a.note))).toEqual(["the heading is wrong"]);

    // F-162: the server knows this way in — each mount's health call named itself.
    expect(((await health(crtPort))!.overlay as { extension: number }).extension).toBeGreaterThanOrEqual(3);

    // The policy is still the app's: an inline script is refused, as it was before CRT (N-44).
    expect(await page.evaluate(() => { const s = document.createElement("script"); s.textContent = "window.__inline = 1"; document.head.append(s); return (window as unknown as { __inline?: number }).__inline ?? null; })).toBeNull(); // prettier-ignore
  });

  test("takes an intake from Send to a written task through the worker, and keeps a quiet session stream open past the worker's idle limit (F-157)", async () => {
    test.setTimeout(120_000);
    const { root } = await serverFor("intake");
    const page = await ext.context.newPage();
    await page.goto(`${FIXTURE_ORIGIN}/ext`);
    await ext.toggle(page);
    await mounted(page);

    const sent = await inOverlay(page, async (crt) => {
      crt.addSelect("#heading");
      crt.setNote(1, "the heading is wrong");
      return crt.send();
    });
    expect(sent.id).toMatch(/\S/);
    const events = () => inOverlay(page, (crt) => crt.chat.snapshot().events) as Promise<SessionEvent[]>;
    await expect.poll(async () => (await events()).some((e) => e.type === "permission")).toBe(true);

    // A service worker is stopped after 30 s without an event; the stream's port has to keep it (and the stream) alive.
    await page.waitForTimeout(35_000);
    const permission = (await events()).find((e) => e.type === "permission") as Extract<SessionEvent, { type: "permission" }>;
    await inOverlay(page, (crt, id) => crt.chat.respond(id, "allow"), permission.id);
    await expect.poll(async () => (await events()).some((e) => e.type === "permission_resolved")).toBe(true);
    await expect.poll(() => inOverlay(page, (crt) => crt.chat.snapshot().state)).toBe("idle");

    await inOverlay(page, (crt) => crt.chat.send("write"));
    await expect.poll(() => inOverlay(page, (crt) => crt.chat.snapshot().taskId), { timeout: 20_000 }).toMatch(/^CRT-\d{4}$/);
    const id = await inOverlay(page, (crt) => crt.chat.snapshot().taskId);
    const tasks = readdirSync(join(root, ".crt", "tasks"));
    expect(tasks.some((f) => f.startsWith(`${id}-`) && f.endsWith(".md"))).toBe(true);
    // The task names the page by its real URL (F-160).
    const file = tasks.find((f) => f.startsWith(`${id}-`))!;
    expect(readFileSync(join(root, ".crt", "tasks", file), "utf8")).toContain(`${FIXTURE_ORIGIN}/ext`);
  });

  test("a page script cannot drive CRT: no route to the worker, no request to the server, and what it forges on the probe's wire is only data (N-42)", async () => {
    const { port: crtPort } = await serverFor("hostile");
    const page = await ext.context.newPage();
    await page.goto(`${FIXTURE_ORIGIN}/ext`);
    // The probe's wire is open to the page by design. A page script that listens before the probe
    // arrives answers first, and a forged answer is all a page can say on it.
    await page.evaluate(() => {
      const forged = JSON.stringify([{ level: "error", message: "forged", stack: null, timestamp: "x", url: null }, { nonsense: true }, "send()"]);
      window.addEventListener("crt:probe:ask", (e) => (e as CustomEvent<string>).detail === "console" && e.target!.dispatchEvent(new CustomEvent("crt:probe:answer", { detail: forged })), true);
    });
    await ext.toggle(page);
    await mounted(page);
    const before = await health(crtPort);

    const tried = await page.evaluate(async (crt) => {
      const out: Record<string, string> = {};
      const attempt = async (name: string, fn: () => unknown) => {
        try {
          out[name] = `reached: ${JSON.stringify(await fn())}`;
        } catch (err) {
          out[name] = `refused: ${(err as Error).name}`;
        }
      };
      const c = (globalThis as unknown as { chrome?: { runtime?: { sendMessage(m: unknown): Promise<unknown>; connect(i: object): unknown } } }).chrome;
      await attempt("message", () => c!.runtime!.sendMessage({ kind: "json", path: "/__crt/sessions", init: { method: "POST", body: "{}" } }));
      await attempt("port", () => c!.runtime!.connect({ name: "crt-events" }));
      await attempt("session", () => fetch(`${crt}/__crt/sessions`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => r.status));
      await attempt("capture", () => fetch(`${crt}/__crt/captures`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).then((r) => r.status));
      // Synthetic input on CRT's host goes nowhere: the root is closed and the controls are inside it.
      document.getElementById("crt-host")!.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
      return out;
    }, `http://localhost:${crtPort}`);
    expect(tried).toEqual({ message: "refused: TypeError", port: "refused: TypeError", session: "refused: TypeError", capture: "refused: TypeError" });

    // The forged log reaches the overlay as log entries that fit the schema, and as nothing else.
    expect(await inOverlay(page, (crt) => crt.consoleEntries())).toEqual([{ level: "error", message: "forged", stack: null, timestamp: "x", url: null }]);
    expect(await inOverlay(page, (crt) => [crt.isOpen(), crt.annotations().length, crt.threads().length])).toEqual([false, 0, 0]);
    const after = await health(crtPort);
    expect(after!.sessions).toBe(before!.sessions);
    expect(after!.sessions).toBe(0);
  });

  test("turned off, the site is left as it was; a site never turned on is never touched; and where the page already has CRT the extension stands down (F-155, F-156, N-43, N-44)", async () => {
    await serverFor("off");
    const page = await ext.context.newPage();
    await page.goto(`${FIXTURE_ORIGIN}/ext`);
    await ext.toggle(page);
    await mounted(page);
    await inOverlay(page, (crt) => void crt.addPin(40, 40));

    // N-43: the same app on another origin (and port patterns have no say: only the exact origin is on).
    const other = await ext.context.newPage();
    await other.goto(`${OTHER}/ext`);
    await other.waitForLoadState("load");
    expect(await pageView(other)).toMatchObject({ hasHost: false, consoleWrapped: false });

    // F-156: /app carries the loader tag for the suite's own server — CRT is already there, with an open root.
    const integrated = await ext.context.newPage();
    const lines: string[] = [];
    integrated.on("console", (m) => lines.push(m.text()));
    await integrated.goto(`${FIXTURE_ORIGIN}/app`);
    await expect(integrated.locator("#crt-host .launcher")).toBeVisible(); // Playwright sees inside: this one is the integration's
    await expect.poll(() => lines).toContain("CRT: this page already has CRT, so the CRT extension stands down here.");
    expect(await integrated.evaluate(() => document.querySelectorAll("#crt-host").length)).toBe(1);
    await integrated.close();
    await other.close();

    expect(await ext.toggle(page)).toBe("off");
    await expect(page.locator("#crt-host")).toHaveCount(0);
    expect(await ext.registered()).toEqual([]);
    expect((await pageView(page)).storageKeys).toEqual([]);
    await page.reload();
    await page.waitForLoadState("load");
    expect(await pageView(page)).toMatchObject({ hasHost: false, consoleWrapped: false, crtGlobal: "undefined", storageKeys: [] });
    // On again: the pin was the site's and went with it.
    await ext.toggle(page);
    await mounted(page);
    expect(await inOverlay(page, (crt) => crt.annotations().length)).toBe(0);
  });

  test("says what is wrong instead of nothing: no server on the port, then the overlay once one answers (F-159)", async () => {
    const p = port++;
    await useServer(p);
    const page = await ext.context.newPage();
    await page.goto(`${FIXTURE_ORIGIN}/ext`);
    await ext.toggle(page);
    const pill = page.locator("#crt-loader-pill .pill .text");
    await expect(pill).toHaveText(`CRT server not running on :${p} — run \`crt\` in the project, then click here`);
    await expect(page.locator("#crt-host")).toHaveCount(0);

    const crt = startCrt(scratch("extension", "late", p), ["serve", "--no-open"]);
    await crt.waitFor(/^CRT ready at /);
    await pill.click();
    await mounted(page);
    await expect(page.locator("#crt-loader-pill")).toHaveCount(0);
    expect(((await health(p)) as { version: string }).version).toBe(packageVersion());
  });

  test("the options page lists the running servers by project and sends a site's reviews to the one chosen for it (F-164)", async () => {
    const a = await serverFor("route-a"); // the default server
    const pb = port++;
    const rootB = scratch("extension", "route-b", pb);
    await startCrt(rootB, ["serve", "--no-open", "--port", String(pb)]).waitFor(/^CRT ready at /);

    const page = await ext.context.newPage();
    await page.goto(`${FIXTURE_ORIGIN}/ext`);
    await ext.toggle(page);
    await mounted(page);
    expect(await inOverlay(page, (crt) => crt.crtOrigin())).toBe(`http://localhost:${a.port}`);

    // The options page: both servers by their project's folder, and this site with the default chosen.
    const options = await ext.context.newPage();
    await options.goto(new URL("options.html", ext.worker.url()).href);
    const labelA = `${basename(a.root)} — port ${a.port}`;
    const labelB = `${basename(rootB)} — port ${pb}`;
    await expect(options.locator("#servers li")).toContainText([labelA, labelB]);
    const select = options.getByLabel(`Where reviews of ${FIXTURE_ORIGIN} go`);
    await expect(select).toHaveValue("");
    await expect(select.locator("option")).toHaveText([`Default (${labelA})`, labelA, labelB]);

    await select.selectOption({ label: labelB });
    await expect(options.locator("#note")).toHaveText(`Saved. Reviews of ${FIXTURE_ORIGIN} go to http://localhost:${pb} from the page's next load.`);

    // The site now talks to the other project's server; a site with no choice still gets the default.
    const before = ((await health(pb))!.overlay as { extension: number }).extension;
    await page.reload();
    await mounted(page);
    expect(await inOverlay(page, (crt) => crt.crtOrigin())).toBe(`http://localhost:${pb}`);
    expect(((await health(pb))!.overlay as { extension: number }).extension).toBeGreaterThan(before);
    const bundle = await inOverlay(page, async (crt) => {
      crt.addSelect("#heading");
      crt.setNote(1, "for the other project");
      return (await crt.capture()).bundle;
    });
    expect((bundle as CaptureBundle).page.url).toBe(`${FIXTURE_ORIGIN}/ext`);

    // Turned off, the site is forgotten, its route with it.
    await options.close();
    await ext.toggle(page);
    expect((await ext.worker.evaluate(() => chrome.storage.local.get("routes"))).routes).toEqual({});
  });

  test("reviews a site that is not on a loopback host, the server still on loopback (F-160, N-43)", async () => {
    const { root, port: crtPort } = await serverFor("outside");
    const page = await ext.context.newPage();
    await page.goto(`${OUTSIDE}/ext`);
    expect(await ext.toggle(page)).toBe("on");
    await mounted(page);
    await page.reload();
    await mounted(page);

    const sent = await inOverlay(page, async (crt) => {
      crt.addSelect("#heading");
      crt.setNote(1, "reviewed on its real host");
      return crt.send();
    });
    expect(sent.dir.startsWith(join(root, ".crt", "captures"))).toBe(true);
    const capture = JSON.parse(readFileSync(join(sent.dir, "capture.json"), "utf8")) as CaptureBundle;
    expect(capture.page.url).toBe(`${OUTSIDE}/ext`);
    expect(capture.annotations[0]!.element!.components).toEqual([{ name: "Cart", kind: "function" }]);
    expect(capture.console.map((c) => c.message)).toContain("fixture: the first script of an app reviewed through the extension");
    expect(await inOverlay(page, (crt) => crt.crtOrigin())).toBe(`http://localhost:${crtPort}`);
    expect(await pageView(page)).toMatchObject({ crtGlobal: "undefined", storageKeys: [], shadowRoot: null });
  });

  test("when Chrome refuses the tab capture the picture is the in-page rasteriser's, and the capture says so (F-158)", async () => {
    await serverFor("fallback");
    const page = await ext.context.newPage();
    await page.goto(`${FIXTURE_ORIGIN}/ext-plain`); // no policy: the fallback's own limits are F-16's, not this row's
    await ext.toggle(page); // no click, so no `activeTab`: the capture is refused, as after a lapsed grant
    await mounted(page);
    const sent = await inOverlay(page, async (crt) => {
      crt.addSelect("#heading");
      crt.setNote(1, "screenshot please");
      return crt.send();
    });
    const capture = JSON.parse(readFileSync(join(sent.dir, "capture.json"), "utf8")) as CaptureBundle;
    expect(capture.screenshots).toEqual({ viewport: "viewport.png", annotated: "viewport-annotated.png", error: null, via: "page" });
    expect(existsSync(join(sent.dir, "viewport.png"))).toBe(true);
    expect(existsSync(join(sent.dir, "ann-1.png"))).toBe(true);
  });

  test("with the tab capture allowed the picture is the browser's own, under a policy the in-page rasteriser cannot work in, and CRT's own UI is not in it (F-158)", async () => {
    const granted = await launch("capture", ["<all_urls>"]);
    try {
      const p = port++;
      const root = scratch("extension", "capture", p);
      await startCrt(root, ["serve", "--no-open"]).waitFor(/^CRT ready at /);
      await useServer(p, granted);
      const page = await granted.context.newPage();
      await page.goto(`${FIXTURE_ORIGIN}/ext`); // `img-src 'self'`, `frame-src 'none'`: F-16's rasteriser has no way here
      await granted.toggle(page);
      await mounted(page);
      const sent = await inOverlay(page, async (crt) => {
        crt.toggle(true); // the dock is open: it must not be in the picture
        crt.addSelect("#heading");
        crt.setNote(1, "screenshot please");
        return crt.send();
      });
      const capture = JSON.parse(readFileSync(join(sent.dir, "capture.json"), "utf8")) as CaptureBundle;
      expect(capture.screenshots).toEqual({ viewport: "viewport.png", annotated: "viewport-annotated.png", error: null, via: "browser" });
      const png = readFileSync(join(sent.dir, "viewport.png"));
      const size = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
      const view = page.viewportSize()!;
      expect(size.width / size.height).toBeCloseTo(view.width / view.height, 1);
      // The clean picture and the annotated one differ only by the marker CRT drew afterwards: the
      // overlay itself was hidden for the frame, then shown again.
      expect(readFileSync(join(sent.dir, "viewport-annotated.png")).equals(png)).toBe(false);
      await expect(page.locator("#crt-host")).toHaveCSS("visibility", "visible");
      // The bottom-right corner, where the launcher sits, is the page's white in the clean picture.
      const blank = await granted.context.newPage(); // a page with no policy, to read the PNG's pixels in
      const corner = await blank.evaluate(async (b64) => {
        const bitmap = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const c = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = c.getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        const d = ctx.getImageData(bitmap.width - 60, bitmap.height - 40, 40, 20).data;
        let white = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i]! > 250 && d[i + 1]! > 250 && d[i + 2]! > 250) white++;
        return white / (d.length / 4);
      }, png.toString("base64"));
      expect(corner).toBe(1);
    } finally {
      await granted.context.close();
    }
  });
});
