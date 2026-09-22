import { build } from "esbuild";
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import type { SessionEvent } from "../src/session-events.js";
import { validateTaskText, writeIndex } from "../src/tasks.js";
import { CRT_ORIGIN, FIXTURE_ORIGIN } from "../playwright.config.js";

// PRD-embedded M15 (the server/overlay half of F-110): embedded mode end to end.
//   1. The cross-origin loop on the shared embedded server (CRT_ORIGIN; since M18 every browser
//      spec runs this way on the app origin, baseURL): the fixture's /embedded page loads the
//      loader from CRT, the loader's hooks catch a console.error fired before the overlay script
//      executes, the launcher shows on the app's own origin, a full Send streams the chat and
//      writes a task file, and a reload re-attaches the thread (F-95, F-96). The plain overlay tag
//      (F-6, the pre-loader script-tag form, still documented) is covered here too — this block
//      absorbed script-tag.spec.ts in M18.
//   2. A server of its own (the start.spec.ts pattern: `dist/cli.js serve --yes` from a scratch
//      project, CRT_SESSION_STUB=1, stdout captured): health `mode: "embedded"`, the landing page at
//      /, the F-93 ready and reuse lines, the F-94 line when CRT "opened" (CRT_BROWSER, a no-op
//      opener) an app page that never loads the loader; and, with the ES module loader bundled
//      into a fixture page by esbuild here (what an app's bundler does), the pill after the server
//      stops and the overlay back on focus once it runs again (F-96 step 6). Ports 4460–4469 are this file's.

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, "..", "dist", "cli.js");
const LOADER_SRC = join(here, "..", "..", "overlay", "src", "loader.ts");
const FIXTURE = FIXTURE_ORIGIN;
const NEVER_LOADED = "crt: opened http://localhost:3999 but the page never loaded the CRT loader — add the integration (`crt init` prints the snippet, /crt:init applies it), or run `crt proxy`";

type Snapshot = { sessionId: string | null; state: string | null; taskId: string | null; events: SessionEvent[] };
type Hooks = {
  embeddedMode(): boolean;
  crtOrigin(): string;
  addSelect(sel: string): number;
  setNote(n: number, note: string): void;
  send(opts?: { n?: number }): Promise<{ id: string; dir: string; files: string[] }>;
  consoleEntries(): Array<{ level: string; message: string }>;
  threads(): Array<{ sessionId: string | null; state: string }>;
  loader?: { origin: string; retry(): void };
  chat: { snapshot(): Snapshot; discard(): Promise<void> };
};
declare global {
  interface Window {
    __crt: Hooks;
  }
}

const shadow = (page: Page, sel: string) => page.locator("#crt-host").locator(sel);

interface Crt {
  child: ChildProcess;
  lines: string[];
  exited: Promise<number | null>;
  waitFor(re: RegExp, timeoutMs?: number): Promise<string>;
}

const running: ChildProcess[] = [];

/** A scratch project with a `.git` marker and `port` in .crt/config.json (no `mode`: embedded is the default, F-91). */
function scratch(name: string, port: number): string {
  const root = join(here, ".project", `embedded-${name}`);
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

test.afterEach(async () => {
  for (const c of running.splice(0)) {
    if (c.exitCode === null) c.kill();
  }
  await new Promise((r) => setTimeout(r, 300));
});

test.describe("embedded mode on the shared server (F-95, F-96)", () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => window.__crt.chat.discard()).catch(() => undefined);
  });

  test("the loader is fetched, a console.error fired before the overlay ran is captured, the launcher shows on the app origin, Send streams and writes a task, a reload re-attaches (F-95, F-96)", async ({ page, request }) => {
    const loaderBefore = ((await (await request.get(`${CRT_ORIGIN}/__crt/health`)).json()) as { overlay: { loader: number } }).overlay.loader;
    await page.goto(`${FIXTURE}/embedded?crt=${CRT_ORIGIN}`);
    await expect(page.locator("#crt-host")).toBeAttached();
    expect(await page.evaluate(() => window.__crt.embeddedMode())).toBe(true);
    expect(await page.evaluate(() => window.__crt.crtOrigin())).toBe(CRT_ORIGIN);
    expect(await page.evaluate(() => window.__crt.loader?.origin)).toBe(CRT_ORIGIN);
    await expect(shadow(page, ".launcher")).toBeVisible();
    await expect(shadow(page, ".launcher")).toHaveAttribute("data-health", "connected");
    // F-93: health counts the loader request; nothing was injected (no proxy).
    const h = (await (await request.get(`${CRT_ORIGIN}/__crt/health`)).json()) as { overlay: { loader: number; injected: number } };
    expect(h.overlay.loader).toBeGreaterThan(loaderBefore);
    // F-96 step 3: the loader's hooks caught what the page logged after the loader tag and before the deferred
    // overlay executed (the head inline error and /app's body inline error); what ran before the loader tag
    // is missed by design (F-95: put the snippet first).
    const messages = (await page.evaluate(() => window.__crt.consoleEntries())).map((e) => e.message);
    expect(messages).toContain("fixture: after the loader, before the overlay");
    expect(messages).toContain("fixture: something went wrong at load");
    expect(messages).not.toContain("fixture: before the loader");
    // No pill: the server is up.
    await expect(page.locator("#crt-loader-pill")).toHaveCount(0);

    // A full Send, cross-origin: the capture POST, the session, the SSE stream.
    await page.evaluate(() => {
      window.__crt.addSelect("[data-testid=card-1] .price");
      window.__crt.setNote(1, "total excludes discount (embedded)");
    });
    const sent = await page.evaluate(() => window.__crt.send());
    expect(sent.id).toMatch(/^\d{8}-\d{6}-[a-f0-9]{4}$/);
    await expect(shadow(page, '.pop[data-n="1"] .chat')).toBeVisible();
    await expect(shadow(page, ".msg.user").first()).toContainText(`Page: ${FIXTURE}/embedded`);
    await expect(shadow(page, ".perm")).toBeVisible();
    const sessionId = (await page.evaluate(() => window.__crt.chat.snapshot())).sessionId;

    // F-95: a reload re-attaches the thread on the app's own origin (sessionStorage is per app origin now).
    await page.reload();
    await expect(shadow(page, ".num-badge")).toHaveCount(1);
    await expect(shadow(page, '.mark-state[data-n="1"]')).toHaveText("needs permission");
    await expect(shadow(page, '.pop[data-n="1"] .chat')).toBeVisible();
    expect((await page.evaluate(() => window.__crt.threads())).map((t) => t.sessionId)).toEqual([sessionId]);

    // Allow, then `write`: the task lands in the scratch project (chat.spec.ts does the same behind the proxy).
    await shadow(page, ".perm button.allow").click();
    await expect(shadow(page, ".chat-head .state")).toHaveAttribute("data-state", "idle");
    const input = shadow(page, ".chat-input textarea");
    await input.fill("write");
    await input.press("Enter");
    await expect(shadow(page, ".chat-task b")).toHaveText(/^CRT-\d{4}$/);
    const snap = await page.evaluate(() => window.__crt.chat.snapshot());
    const written = snap.events.find((e) => e.type === "task_written") as Extract<SessionEvent, { type: "task_written" }>;
    expect(written.path).toMatch(/^\.crt\/tasks\/CRT-\d{4}-.*\.md$/);
    const root = ((await (await request.get(`${CRT_ORIGIN}/__crt/health`)).json()) as { projectRoot: string }).projectRoot;
    const tasksDir = join(root, ".crt", "tasks");
    const file = join(root, written.path);
    try {
      expect(existsSync(file)).toBe(true);
      expect(validateTaskText(readFileSync(file, "utf8"), written.path.split("/").pop()!)).toEqual([]);
    } finally {
      rmSync(file, { force: true });
      rmSync(join(tasksDir, "assets", written.id), { recursive: true, force: true });
      writeIndex(tasksDir);
    }
  });

  test("the plain overlay tag still loads the overlay from another local origin and runs a full Send cross-origin (F-6)", async ({ page }) => {
    // The pre-loader script-tag form: <script src="<crt>/__crt/overlay.js" defer>, no loader, no pill.
    await page.goto(`${FIXTURE}/script-tag?crt=${CRT_ORIGIN}`);
    await expect(page.locator("#crt-host")).toBeAttached();
    expect(await page.evaluate(() => window.__crt.embeddedMode())).toBe(true);
    expect(await page.evaluate(() => window.__crt.crtOrigin())).toBe(CRT_ORIGIN);
    expect(await page.evaluate(() => window.__crt.loader)).toBeUndefined();
    await expect(shadow(page, ".launcher")).toBeVisible();

    await page.evaluate(() => {
      window.__crt.addSelect("#heading");
      window.__crt.setNote(1, "loaded by a script tag");
    });
    const sent = await page.evaluate(() => window.__crt.send());
    expect(sent.id).toMatch(/^\d{8}-\d{6}-[a-f0-9]{4}$/);
    await expect(shadow(page, ".chat")).toBeVisible();
    // The SSE stream and the first message arrive cross-origin; the page URL is the app's own origin.
    await expect(shadow(page, ".msg.user").first()).toContainText(`CRT intake for capture ${sent.id}`);
    await expect(shadow(page, ".msg.user").first()).toContainText(`Page: ${FIXTURE}/script-tag`);
    await expect(shadow(page, ".perm")).toBeVisible();
    // Nothing the overlay did leaked into the page's console as an error (a CORS failure would).
    expect((await page.evaluate(() => window.__crt.consoleEntries())).filter((e) => e.level === "error")).toEqual([]);
  });
});

test.describe("an embedded server of its own (F-91, F-93, F-94, F-96)", () => {
  test.setTimeout(90_000);

  test("health says embedded, / is the landing page, the ready and reuse lines, and the line once the opened page never loads the loader (F-91, F-93, F-94)", async ({ page }) => {
    const root = scratch("landing", 4461);
    // CRT_BROWSER: "open" the app with a command that does nothing (node exits on a URL argument) — no real browser.
    const crt = startCrt(root, ["--target", FIXTURE, "--yes", "--open"], { CRT_BROWSER: process.execPath });
    const ready = await crt.waitFor(/^CRT ready at /);
    expect(ready).toMatch(/^CRT ready at http:\/\/localhost:4461 for http:\/\/localhost:3999 \(embedded; project: .*, 0 tasks in \.crt[\\/]tasks, provider: stub \(CRT_SESSION_STUB\), login: unchecked\)$/);
    expect(crt.lines.some((l) => l.startsWith("Remembered "))).toBe(false); // --target is never remembered (F-72)
    const h = (await health(4461))!;
    expect(h).toMatchObject({ ok: true, mode: "embedded", app: FIXTURE, target: FIXTURE, provider: "stub", overlay: { injected: 0, fetched: 0, loader: 0 } });

    // F-91 (as PRD-polish F-114 amends it): the landing page, the kicker, the app link, exactly one inline script.
    const res = await fetch("http://localhost:4461/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const html = await res.text();
    expect(html).toContain(`<title>CRT ${h.version as string}</title>`);
    expect(html).toContain("This is the CRT server — not your app.");
    expect(html).toContain(`<span class="path">${h.projectRoot as string}</span>`);
    expect(html).toContain(`Open ${FIXTURE}`);
    expect(html).toContain("Run <code>crt init</code> for the one-line snippet for your framework, or <code>crt proxy</code> to proxy your app instead.");
    expect(html.match(/<script/gi)).toHaveLength(1);
    expect(html).not.toMatch(/<script[^>]*\ssrc=/i);
    expect((await fetch("http://localhost:4461/any/route?x=1")).status).toBe(200);
    // PRD-polish F-112: the favicon the landing page links (M21), served from dist/ in embedded mode.
    const favicon = await fetch("http://localhost:4461/__crt/favicon.svg");
    expect(favicon.status).toBe(200);
    expect(favicon.headers.get("content-type")).toBe("image/svg+xml");
    expect(favicon.headers.get("cache-control")).toBe("max-age=86400");
    expect(await favicon.text()).toMatch(/^<svg /);
    await page.goto("http://localhost:4461/");
    await expect(page).toHaveTitle(`CRT ${h.version as string}`);
    await expect(page.locator("#crt-host")).toHaveCount(0);
    // F-114: the script fills the Checkup from /__crt/doctor; the page never waited on it.
    await expect(page.locator("#rows tr.row td.nm", { hasText: /^port$/ })).toHaveCount(1);
    await expect(page.locator("#rows tr.row", { hasText: /^oks*ports*4461 — this server/ })).toHaveCount(1);

    // F-93: a second start reuses it, naming the app to open.
    const second = startCrt(root, ["--target", FIXTURE, "--yes"]);
    expect(await second.exited).toBe(0);
    expect(second.lines.find((l) => l.startsWith("CRT "))).toMatch(/^CRT .* is already serving this project \(embedded\) at http:\/\/localhost:4461 \(since \d\d:\d\d\) — open http:\/\/localhost:3999 in your browser\.$/);

    // F-94: nothing asked for the loader or the overlay within 15 s of CRT opening the app.
    expect(await crt.waitFor(/^crt: opened /, 30_000)).toBe(NEVER_LOADED);
    expect(crt.lines.filter((l) => l.startsWith("crt: opened "))).toHaveLength(1);
    writeFileSync(join(root, "crt-serve.log"), crt.lines.join("\n") + "\n");
  });

  test("the ES module loader bundled into a page shows the pill once the server is gone and brings the overlay back on focus when it is running again (F-96)", async ({ page }) => {
    // What an app's bundler does in development: the ESM entry, NODE_ENV defined, one call to mountCrt.
    const built = await build({
      stdin: { contents: `import { mountCrt } from ${JSON.stringify(LOADER_SRC)}; mountCrt({ port: 4462 });`, resolveDir: dirname(LOADER_SRC), loader: "ts" },
      bundle: true,
      format: "iife",
      target: "es2020",
      define: { "process.env.NODE_ENV": '"development"' },
      write: false,
    });
    const bundle = built.outputFiles![0]!.text;
    await page.route(`${FIXTURE}/embedded-bundle.js`, (route) => route.fulfill({ status: 200, contentType: "text/javascript; charset=utf-8", body: bundle }));

    const root = scratch("pill", 4462);
    const crt = startCrt(root, ["--yes", "--no-open"]);
    const ready = await crt.waitFor(/^CRT ready at /);
    // No app known (3999 is not a probed port): the F-91 line, no `for <app>`, nothing opened.
    expect(crt.lines).toContain("crt: no dev server on ports 3000, 5173, 8080, 4200, 8000, 3001 — start it and open it in your browser; the CRT button appears when the page loads the CRT loader (crt <port> to have CRT open it next time)");
    expect(ready).toMatch(/^CRT ready at http:\/\/localhost:4462 \(embedded; project: /);
    expect(await health(4462)).toMatchObject({ mode: "embedded", app: null, target: null });

    await page.goto(`${FIXTURE}/embedded-bundled`);
    await expect(shadow(page, ".launcher")).toBeVisible();
    expect(await page.evaluate(() => window.__crt.crtOrigin())).toBe("http://localhost:4462");
    await expect(page.locator("#crt-loader-pill")).toHaveCount(0);
    expect((await health(4462))!.overlay).toMatchObject({ fetched: 1, loader: 0 }); // bundled, not fetched from CRT
    expect(crt.lines).toContain(`crt: overlay loaded in the browser (from ${FIXTURE})`);

    crt.child.kill();
    await crt.exited;
    await expect.poll(() => health(4462)).toBeNull();

    // F-96 step 6: a fresh load with nothing on :4462 shows the pill (its own shadow root) and no overlay.
    await page.reload();
    const pill = page.locator("#crt-loader-pill");
    await expect(pill).toBeAttached();
    await expect(pill.locator(".pill .text")).toHaveText("CRT server not running on :4462 — run `crt` in the project, then click here");
    await expect(page.locator("#crt-host")).toHaveCount(0);

    // Start CRT again; the window regaining focus retries the script — no reload.
    const again = startCrt(root, ["--yes", "--no-open"]);
    await again.waitFor(/^CRT ready at http:\/\/localhost:4462 /);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(shadow(page, ".launcher")).toBeVisible();
    await expect(pill).toHaveCount(0);
    await page.unroute(`${FIXTURE}/embedded-bundle.js`);
  });
});
