import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { CRT_PROXY_ORIGIN } from "../playwright.config.js";
import { shadow } from "./helpers.js";

// Everything here goes through `crt proxy` in front of the fixture — the dedicated proxy-mode
// server in playwright.config.ts (PRD-embedded F-92, N-21: the v0.3 shape, unchanged). The primary
// servers run embedded since M18 (F-110), so this file sets its own baseURL.

test.use({ baseURL: CRT_PROXY_ORIGIN });

test("page served through CRT has the overlay launcher in a shadow root (F-2, F-7)", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#heading")).toHaveText("CRT fixture app");
  // The host page's own script still ran.
  expect(await page.evaluate(() => (window as unknown as { __fixture: string }).__fixture)).toBe("ok");

  const host = page.locator("#crt-host");
  await expect(host).toHaveCount(1);
  const root = await host.evaluate((el) => ({
    hasShadow: el.shadowRoot !== null,
    launcher: el.shadowRoot?.querySelector(".launcher")?.textContent?.trim().split(/\s/)[0] ?? null,
  }));
  expect(root).toEqual({ hasShadow: true, launcher: "CRT" });
  await expect(host.locator(".launcher")).toBeVisible();
});

test("launcher is present on every page, including gzip and brotli-encoded ones (F-2)", async ({ page }) => {
  for (const path of ["/gzip", "/br", "/chunked", "/nohead"]) {
    await page.goto(path);
    await expect(page.locator("#crt-host .launcher"), path).toBeVisible();
  }
});

test("gzip HTML arrives injected, uncompressed, with a correct Content-Length (F-2)", async ({ request }) => {
  const res = await request.get("/gzip", { headers: { "accept-encoding": "gzip" } });
  expect(res.status()).toBe(200);
  const headers = res.headers();
  expect(headers["content-encoding"]).toBeUndefined();
  const body = await res.body();
  expect(headers["content-length"]).toBe(String(body.length));
  expect(body.toString()).toContain('<script src="/__crt/overlay.js" defer></script></head>');
});

test("WebSocket from the page echoes through the proxy (F-3)", async ({ page }) => {
  await page.goto("/");
  const echoed = await page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const ws = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`);
        ws.onopen = () => ws.send("hmr-style message");
        ws.onmessage = (e) => {
          resolve(String(e.data));
          ws.close();
        };
        ws.onerror = () => reject(new Error("websocket error"));
        setTimeout(() => reject(new Error("websocket timeout")), 5000);
      }),
  );
  expect(echoed).toBe("hmr-style message");
});

test("/__crt/health reports target, project root and the rest of the F-78 story (F-4, F-78)", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.locator("#crt-host .launcher")).toBeVisible();
  const res = await request.get("/__crt/health");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { ok: boolean; target: string; projectRoot: string; version: string; startedAt: string; tasksDir: string; tasks: number; provider: string; login: string; sessions: number; overlay: { injected: number; fetched: number } };
  expect(body.ok).toBe(true);
  expect(body.target).toBe("http://localhost:3999");
  expect(body.projectRoot.length).toBeGreaterThan(0);
  expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  expect(Date.parse(body.startedAt)).toBeGreaterThan(0);
  expect(body.tasksDir.length).toBeGreaterThan(0);
  expect(body.tasks).toBeGreaterThanOrEqual(0);
  expect(body.provider).toBe("stub");
  expect(body.login).toBe("unchecked");
  expect(body.sessions).toBeGreaterThanOrEqual(0);
  expect(body.overlay.injected).toBeGreaterThan(0);
  expect(body.overlay.fetched).toBeGreaterThan(0);
  // F-75: the server said so on its first overlay fetch (crt.mjs mirrors stdout into crt-serve.log).
  const log = readFileSync(join(dirname(fileURLToPath(import.meta.url)), ".project", "proxy", "crt-serve.log"), "utf8");
  expect(log).toMatch(/^crt: overlay loaded in the browser \(GET \/.*\)$/m);
});

test("absolute redirects to the target are rewritten to the CRT origin (F-4)", async ({ page }) => {
  await page.goto("/redirect");
  expect(new URL(page.url()).origin).toBe(CRT_PROXY_ORIGIN);
  expect(new URL(page.url()).search).toBe("?from=redirect");
  await expect(page.locator("#crt-host .launcher")).toBeVisible();
});

test("GET /__crt/ is the landing page in proxy mode too, while / stays the app (PRD-polish F-114)", async ({ page, request }) => {
  const res = await request.get("/__crt/");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("text/html; charset=utf-8");
  const html = await res.text();
  expect(html).toContain("This is the CRT server — not your app.");
  expect(html).toContain(`<h1>You are browsing your app through CRT at <code>${new URL(CRT_PROXY_ORIGIN).host}</code>.</h1>`);
  expect(html).toContain(`href="${CRT_PROXY_ORIGIN}/">Open ${CRT_PROXY_ORIGIN}`);
  expect(html).toContain("proxy · ");
  expect(html.match(/<script/gi)).toHaveLength(1);
  await page.goto("/__crt/");
  await expect(page.locator("#crt-host")).toHaveCount(0);
  // The doctor rows arrive here too: the proxy mode row and the port row for this server.
  await expect(page.locator("#rows tr.row", { hasText: /^ok\s*mode\s*proxy/ })).toHaveCount(1);
  await expect(page.locator("#rows tr.row", { hasText: new RegExp(`^ok\\s*port\\s*${new URL(CRT_PROXY_ORIGIN).port} — this server`) })).toHaveCount(1);
  await expect(page.locator("#rows tr.row", { hasText: /^--\s*integration\s*proxy mode/ })).toHaveCount(1);
  // / is still the app, injected.
  await page.goto("/");
  await expect(page.locator("#crt-host .launcher")).toBeVisible();
});

// Here, not in chat.spec.ts: the injected overlay is same-origin, so a promise it leaves rejected
// reaches the page's `unhandledrejection` hook. The loader's cross-origin tag in embedded mode
// mutes its script's rejections, and the browser never reports them there.
test("a Deny or Stop whose request fails says so in the chat and adds no unhandled rejection to the page's console log (F-20, F-26, F-29, CRT-0038)", async ({ page }) => {
  await page.goto("/app");
  await page.evaluate(() => {
    window.__crt.addSelect("#heading");
    window.__crt.setNote(1, "wrong heading");
  });
  await page.evaluate(() => window.__crt.send());
  await expect(shadow(page, ".perm")).toBeVisible();
  const rejections = () => page.evaluate(() => window.__crt.consoleEntries().filter((e) => e.level === "unhandledrejection").map((e) => e.message));
  const before = await rejections(); // the fixture's own "fixture: rejected"
  expect(before).toEqual([expect.stringContaining("fixture: rejected")]);
  const answers = /\/__crt\/sessions\/[^/]+\/(permission|interrupt)$/;
  await page.route(answers, (route) => route.abort());
  try {
    for (const button of [".perm button.deny", "[data-chat=interrupt]"]) {
      const failed = page.waitForEvent("requestfailed", (r) => answers.test(r.url()));
      await shadow(page, button).click();
      await failed;
    }
    // unhandledrejection is dispatched after the task that rejected: give it one more task.
    await page.evaluate(() => new Promise((r) => setTimeout(r, 50)));
    expect(await rejections()).toEqual(before);
    const errors = shadow(page, ".sys.error");
    await expect(errors).toHaveCount(2);
    await expect(errors.nth(0)).toHaveText(/^Could not answer the permission request: /);
    await expect(errors.nth(1)).toHaveText(/^Could not interrupt the turn: /);
  } finally {
    await page.unroute(answers);
    await page.evaluate(() => window.__crt.chat.discard());
  }
});
