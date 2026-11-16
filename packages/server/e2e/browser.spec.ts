import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, test } from "@playwright/test";
import type { CrtBrowser } from "../src/browser.js";
import { projectKey } from "../src/home.js";
import { serve, type ServeHandle } from "../src/serve.js";
import { packageVersion } from "../src/version.js";
import { UNTOUCHED_CSP } from "./fixture/server.mjs";
import { E2E_HOME, FIXTURE_ORIGIN, health, PORTS, scratch, startCrt, stopCrts } from "./helpers.js";

// PRD-zero M28 (F-125, F-126, F-127, F-128, N-31, N-32): the CRT browser against a real Chromium.
// CRT itself launches the browser — Playwright's Chromium as `browser.command`, headless through
// its arguments — over the DevTools pipe and injects the loader; Playwright drives nothing here.
//   1. In this process (`serve()` from src with the built bundles), so the test can reach the
//      browser module's `evaluate` seam: the fixture's /untouched page — no loader tag, the strict
//      policy of PRD-zero §5.1, gzip on the wire — gets the overlay on its own URL, the page's
//      first-script console.error is in the capture of a Send, a second tab and a tab the page
//      opened get the overlay too, and a non-loopback page keeps its policy and gets no CRT.
//   2. From the CLI (`dist/cli.js browse`, the start.spec.ts pattern): the ready line, the reuse
//      through /__crt/internal/browse, the stop line, `--no-open`.
// The ports are PORTS.browser (e2e/helpers.ts); the profiles land under the e2e CRT home.

const here = dirname(fileURLToPath(import.meta.url));
const DIST = join(here, "..", "dist");
const FIXTURE = FIXTURE_ORIGIN;
const FIXTURE_PORT = PORTS.fixture;
const VERSION = packageVersion();
/** A hostname that is not loopback but resolves to this machine (the resolver rule below): the N-32 rows. */
const OUTSIDE = `http://outside.test:${FIXTURE_PORT}`;

/** `browser.command`: Playwright's Chromium, headless; no proxy so `outside.test` reaches the fixture. */
const BROWSER_COMMAND = [
  chromium.executablePath(),
  "--headless=new",
  // Playwright launches its Chromium without the sandbox on Linux too (root in containers, CI images).
  ...(process.platform === "linux" ? ["--no-sandbox"] : []),
  "--no-proxy-server",
  "--host-resolver-rules=MAP outside.test 127.0.0.1",
];

/** A scratch project whose config names the browser, with no profile left over from an earlier run (its tabs would come back). */
function project(name: string, port: number): string {
  const root = scratch("browser", name, port);
  rmSync(join(E2E_HOME, "browser", projectKey(root)), { recursive: true, force: true });
  writeFileSync(join(root, ".crt", "config.json"), JSON.stringify({ tasksDir: ".crt/tasks", target: null, port, browser: { command: BROWSER_COMMAND } }, null, 2) + "\n");
  return root;
}

test.afterEach(stopCrts);

test.describe("the CRT browser, in this process (F-125, F-126, F-127, N-32)", () => {
  const saved = { stub: process.env.CRT_SESSION_STUB, home: process.env.CRT_HOME };
  let handle: ServeHandle | null = null;
  test.beforeAll(() => {
    process.env.CRT_SESSION_STUB = "1";
    process.env.CRT_HOME = E2E_HOME;
  });
  test.afterAll(() => {
    for (const [key, value] of [["CRT_SESSION_STUB", saved.stub], ["CRT_HOME", saved.home]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  test.afterEach(async () => {
    await handle?.close();
    handle = null;
  });

  test("an app with no CRT in it and a strict policy gets the overlay on its own URL; a Send carries its first script's error; a second tab, a tab the page opened and a return from a non-loopback page work, and that page keeps its policy (F-126, F-127, N-32)", async () => {
    const port = PORTS.browser.from;
    const root = project("inject", port);
    const lines: string[] = [];
    const result = await serve({
      cwd: root,
      command: "browse",
      positional: FIXTURE,
      open: true,
      yes: true,
      overlayPath: join(DIST, "overlay.js"),
      intakePromptPath: join(DIST, "intake.md"),
      log: (line) => lines.push(line),
    });
    if (result.kind !== "serving") throw new Error("expected a server of this test's own");
    handle = result.handle;
    expect(lines.find((l) => l.startsWith("CRT ready"))).toContain(`CRT ready at http://localhost:${port} for ${FIXTURE} (embedded, CRT browser; `);
    expect(handle.browser!.isOpen).toBe(true);
    const browser: CrtBrowser = handle.browser!.current!;
    const at = (prefix: string, expression: string) => browser.evaluate(prefix, expression).catch((err: Error) => `not yet: ${err.message}`);
    const overlayAt = (prefix: string) => expect.poll(() => at(prefix, "typeof window.__crt?.send"), { timeout: 15_000 });

    // F-128: the server's one browser; a second request is a second tab in it.
    const untouched = `${FIXTURE}/untouched`;
    expect(await handle.browser!.open(untouched)).toEqual({ ok: true, url: untouched });
    await overlayAt(untouched).toBe("function");
    expect(await browser.tabs()).toEqual(expect.arrayContaining([untouched]));
    expect((await browser.tabs()).length).toBe(2);

    // F-126: the overlay came from this server, on the app's own URL, with nothing in the app.
    expect(await at(untouched, "window.__crt.crtOrigin()")).toBe(`http://localhost:${port}`);
    expect(await at(untouched, "window.__crt.embeddedMode()")).toBe(true);
    expect(await at(untouched, "[...document.scripts].map((s) => s.getAttribute('src'))")).toEqual(["/untouched.js", `http://localhost:${port}/__crt/overlay.js`, null]);
    expect(lines).toContain(`crt: overlay loaded in the browser (from ${FIXTURE})`);
    expect(((await health(port))!.overlay as { fetched: number }).fetched).toBeGreaterThanOrEqual(1);
    // N-32: the policy is not enforced on this loopback document — the page's own inline script ran, nothing was refused.
    expect(await at(untouched, "window.__inline")).toBe("ran");
    // F-127: the hooks were in before the page's first script.
    expect(await at(untouched, "window.__crt.consoleEntries().map((e) => e.message)")).toContain("fixture: the first script of an untouched app");

    // A Send from that page: the capture on disk carries the first script's error.
    const sent = (await at(untouched, "(async () => { window.__crt.addSelect('#heading'); window.__crt.setNote(1, 'heading is off (CRT browser)'); return window.__crt.send(); })()")) as { id: string; dir: string };
    expect(sent.id).toMatch(/^\d{8}-\d{6}-[a-f0-9]{4}$/);
    const capture = readFileSync(join(sent.dir, "capture.json"), "utf8");
    expect(capture).toContain("fixture: the first script of an untouched app");
    expect(capture).toContain(`${FIXTURE}/untouched`);
    await at(untouched, "window.__crt.chat.discard()");

    // N-32: the same tab on a non-loopback host — the page's policy is enforced again and there is no CRT.
    await at(untouched, `location.href = ${JSON.stringify(`${OUTSIDE}/untouched`)}`);
    await expect.poll(() => at(`${OUTSIDE}/untouched`, "window.__fixture"), { timeout: 15_000 }).toBe("untouched");
    expect(await at(`${OUTSIDE}/untouched`, "[typeof window.__crt, typeof window.__inline]")).toEqual(["undefined", "undefined"]);
    // … and back on a loopback host, in the same tab: lifted before that document is used, no reload needed.
    const back = `http://127.0.0.1:${FIXTURE_PORT}/untouched`;
    await at(`${OUTSIDE}/untouched`, `location.href = ${JSON.stringify(back)}`);
    await overlayAt(back).toBe("function");
    expect(await at(back, "window.__inline")).toBe("ran");

    // A tab the page opened itself (window.open) gets the overlay too.
    const popup = `${FIXTURE}/untouched?popup`;
    await at(back, `window.open(${JSON.stringify(popup)}); 1`);
    await overlayAt(popup).toBe("function");
    expect(await at(popup, "window.__inline")).toBe("ran");

    // CRT's own landing page is not the app: no overlay there.
    const own = `http://localhost:${port}/`;
    await handle.browser!.open(own);
    await expect.poll(() => at(own, "document.readyState"), { timeout: 15_000 }).toBe("complete");
    expect(await at(own, "typeof window.__crt")).toBe("undefined");

    // F-125: the profile is this project's, under the CRT home. F-128: stopping CRT closes the browser.
    expect(existsSync(join(E2E_HOME, "browser", projectKey(root)))).toBe(true);
    await handle.close();
    expect(handle.browser!.isOpen).toBe(false);
    handle = null;
    expect(UNTOUCHED_CSP).toContain("script-src 'self'");
  });
});

test.describe("crt browse from the command line (F-128)", () => {
  test("crt browse says so on the ready line and loads the overlay; a second one asks the running server; a page cannot; stopping closes the browser (F-128)", async () => {
    const port = PORTS.browser.from + 1;
    const root = project("cli", port);
    const first = startCrt(root, ["browse", FIXTURE, "--yes"]);
    expect(await first.waitFor(/^CRT ready at /)).toContain(`CRT ready at http://localhost:${port} for ${FIXTURE} (embedded, CRT browser; `);
    // The fixture's / carries a loader tag for the shared server; the injected loader ran first, so the overlay is this server's.
    await first.waitFor(/^crt: overlay loaded in the browser \(from http:\/\/localhost:3999\)$/);
    const before = ((await health(port))!.overlay as { fetched: number }).fetched;
    expect(before).toBeGreaterThanOrEqual(1);
    // No F-94 line is armed: nothing in the app is expected to ask for the loader.
    expect(first.lines.some((l) => l.includes("never loaded the CRT loader"))).toBe(false);

    // A second `crt browse` in the project: the running server opens a tab, this one exits 0.
    const second = startCrt(root, ["browse"]);
    expect(await second.exited).toBe(0);
    const reuse = second.lines.find((l) => l.startsWith("CRT "));
    expect(reuse).toContain(`CRT ${VERSION} is already serving this project at http://localhost:${port} (since `);
    expect(reuse).toMatch(/ — opened the CRT browser on http:\/\/localhost:3999\.$/);
    await expect.poll(async () => ((await health(port))!.overlay as { fetched: number }).fetched).toBeGreaterThan(before);

    // N-8: the route is for local processes; a page's request (it always carries Origin) is refused.
    const refused = await fetch(`http://localhost:${port}/__crt/internal/browse`, { method: "POST", headers: { origin: FIXTURE } });
    expect(refused.status).toBe(403);

    if (process.platform !== "win32") {
      // F-128: the stop line says the browser went with it (Windows has no signals to send).
      first.child.kill("SIGTERM");
      expect(await first.exited).toBe(0);
      expect(first.lines).toContain("Stopping CRT … 0 sessions ended; the CRT browser was closed; written task files are kept.");
    }
  });

  test("crt browse --no-open never launches the browser (F-128)", async () => {
    const port = PORTS.browser.from + 2;
    const root = project("no-open", port);
    const crt = startCrt(root, ["browse", FIXTURE, "--yes", "--no-open"]);
    expect(await crt.waitFor(/^CRT ready at /)).toContain(`CRT ready at http://localhost:${port} for ${FIXTURE} (embedded; `);
    await new Promise((r) => setTimeout(r, 1_000));
    expect(existsSync(join(E2E_HOME, "browser", projectKey(root)))).toBe(false);
    expect(((await health(port))!.overlay as { fetched: number }).fetched).toBe(0);
  });

  test("a browser that cannot start is one line, and CRT keeps serving (F-125)", async () => {
    const port = PORTS.browser.from + 3;
    const root = scratch("browser", "broken", port);
    const missing = join(root, "no-such-browser");
    writeFileSync(join(root, ".crt", "config.json"), JSON.stringify({ tasksDir: ".crt/tasks", target: null, port, browser: { command: [missing] } }, null, 2) + "\n");
    const crt = startCrt(root, ["browse", FIXTURE, "--yes"]);
    const line = await crt.waitFor(/did not accept a DevTools connection/);
    expect(line.startsWith(`crt: ${missing} did not accept a DevTools connection (`)).toBe(true);
    expect(line.endsWith(") — set browser.command in .crt/config.local.json, or run `crt proxy`")).toBe(true);
    expect((await health(port))?.ok).toBe(true);
    expect(crt.child.exitCode).toBeNull();
  });
});
