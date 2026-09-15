import { expect, type Page, test } from "@playwright/test";

// F-6 script-tag mode: the app serves its own page (straight from the fixture on FIXTURE_PORT,
// not through the proxy) with <script src="http://localhost:<crt>/__crt/overlay.js" defer>. The
// overlay must find the CRT origin from its own script tag and every API call — the capture POST
// (preflighted JSON), the session POSTs and the SSE stream — must succeed cross-origin.
const FIXTURE = "http://localhost:3999"; // FIXTURE_PORT in playwright.config.ts

type Hooks = {
  scriptTagMode(): boolean;
  crtOrigin(): string;
  addSelect(sel: string): number;
  setNote(n: number, note: string): void;
  send(): Promise<{ id: string; dir: string; files: string[] }>;
  consoleEntries(): Array<{ level: string }>;
  chat: { snapshot(): { sessionId: string | null }; discard(): Promise<void> };
};
declare global {
  interface Window {
    __crt: Hooks;
  }
}

const shadow = (page: Page, sel: string) => page.locator("#crt-host").locator(sel);

test.describe("script-tag mode (F-6)", () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => window.__crt.chat.discard()).catch(() => undefined);
  });

  test("the overlay loads from another local origin and runs a full Send cross-origin", async ({ page, baseURL }) => {
    await page.goto(`${FIXTURE}/script-tag?crt=${baseURL}`);
    await expect(page.locator("#crt-host")).toBeAttached();
    expect(await page.evaluate(() => window.__crt.scriptTagMode())).toBe(true);
    expect(await page.evaluate(() => window.__crt.crtOrigin())).toBe(baseURL);
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
