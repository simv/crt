import { expect, test } from "@playwright/test";

// Everything here goes through `crt serve` in front of the fixture (see playwright.config.ts).

test("page served through CRT has the overlay launcher in a shadow root (F-2, F-7)", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("#heading")).toHaveText("CRT fixture app");
  // The host page's own script still ran.
  expect(await page.evaluate(() => (window as unknown as { __fixture: string }).__fixture)).toBe("ok");

  const host = page.locator("#crt-host");
  await expect(host).toHaveCount(1);
  const shadow = await host.evaluate((el) => ({
    hasShadow: el.shadowRoot !== null,
    button: el.shadowRoot?.querySelector("button")?.textContent?.trim() ?? null,
  }));
  expect(shadow).toEqual({ hasShadow: true, button: "CRT" });
  await expect(host.locator("button")).toBeVisible();
});

test("launcher is present on every page, including gzip and brotli-encoded ones (F-2)", async ({ page }) => {
  for (const path of ["/gzip", "/br", "/chunked", "/nohead"]) {
    await page.goto(path);
    await expect(page.locator("#crt-host button"), path).toBeVisible();
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

test("/__crt/health reports target and project root (F-4)", async ({ request }) => {
  const res = await request.get("/__crt/health");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { ok: boolean; target: string; projectRoot: string };
  expect(body.ok).toBe(true);
  expect(body.target).toBe("http://localhost:3999");
  expect(body.projectRoot.length).toBeGreaterThan(0);
});

test("absolute redirects to the target are rewritten to the CRT origin (F-4)", async ({ page }) => {
  await page.goto("/redirect");
  expect(new URL(page.url()).origin).toBe("http://localhost:4499");
  expect(new URL(page.url()).search).toBe("?from=redirect");
  await expect(page.locator("#crt-host button")).toBeVisible();
});
