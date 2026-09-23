import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { HOLD_PHRASE } from "../src/providers/stub.js";
import { SCREENSHOTS_CRT_ORIGIN } from "../playwright.screenshots.config.js";

// PRD-polish F-116 / N-27 (M22, task CRT-0026): the five README screenshots, written to
// docs/images/ by `npm run screenshots` (playwright.screenshots.config.ts — not part of `npm run
// e2e`, never in CI). The page is the e2e fixture's /shop — the trial app's shop (tool-validation), ported
// into the fixture so the images are reproducible from this repo alone (CRT-0029) — on its own origin with the
// loader tag pointing at one embedded `crt serve` on the stub (CRT_SESSION_STUB=1), so every state
// the overlay is driven to here is the real overlay talking to the real server over the real
// routes; only the agent is scripted (src/providers/stub.ts).
//
// Determinism (N-27): the config pins the viewport (800 × 600 CSS px), DPR 2, the light scheme,
// the locale and time zone and one worker in file order; every test gets a fresh browser context
// (no storage carried over) and a fixed clock; the scratch project's tasks and captures are reset
// before the first image (six placeholder tasks, so the one the stub writes is CRT-0007); every
// capture is taken with `animations: "disabled"`, after a wait on the overlay's own signals
// (`data-health`, the marker's `data-state` / text, the popover's elements) — never a fixed sleep.
// What is left is the server's own state — the session id in the chat footer, the capture id in the
// first message, the landing page's `checked at`, uptime, Node version, project path and plugin
// row — which the script cannot pin; a second run differs in those and in font rasterisation only
// (docs/images/README.md lists them).

type Hooks = {
  welcome(): Promise<void>;
  setTool(tool: "select" | "box" | "pin" | null): void;
  hoverAt(x: number, y: number): unknown;
  addSelect(sel: string): number;
  setNote(n: number, note: string): void;
  togglePop(n: number, force?: boolean): void;
  send(opts?: { n?: number }): Promise<{ id: string }>;
  threads(): Array<{ sessionId: string; ns: number[]; state: string | null; taskId: string | null; open: boolean }>;
};
declare global {
  interface Window {
    __crt: Hooks;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
/** Where the PNGs land: docs/images/ at the repo root (the README embeds them from there, M23). */
const IMAGES = join(here, "..", "..", "..", "docs", "images");
/** The browser's clock starts here on every page (`page.clock.install`), so what the overlay stamps never moves between runs. */
const FIXED_TIME = new Date("2026-09-22T02:00:00.000Z");
/** ui.ts hides the "Capture saved: <path>" status bar this long after a Send; the clock jumps past it (the path holds the capture id). */
const STATUS_AUTOHIDE_MS = 15_000;
/** The placeholder tasks seeded into the scratch project, so the task the stub writes is this one. */
const SEEDED = 6;
const WRITTEN_TASK_ID = `CRT-${String(SEEDED + 1).padStart(4, "0")}`;

const shadow = (page: Page, sel: string) => page.locator("#crt-host").locator(sel);

/** One capture: the whole viewport, animations disabled, caret hidden (N-27). */
async function shoot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(IMAGES, name), type: "png", animations: "disabled", caret: "hide", fullPage: false });
}

/** Open the fixture's shop page with the fixed clock and wait for the overlay to report its server. */
async function openApp(page: Page): Promise<void> {
  await page.clock.install({ time: FIXED_TIME });
  await page.goto("/shop");
  await expect(page.locator("[data-testid=cart-total]")).toHaveText("$9.00"); // React has rendered the shop
  await expect(shadow(page, ".launcher")).toHaveAttribute("data-health", "connected");
}

/** After a Send: jump the clock past the status bar's auto-hide, so the capture path (random id) is not in the image. */
async function settle(page: Page): Promise<void> {
  await page.clock.fastForward(STATUS_AUTOHIDE_MS);
  await expect(shadow(page, ".status")).toBeHidden();
  await expect(shadow(page, ".launcher")).toHaveAttribute("data-health", "connected");
}

/**
 * The transcript scrolls to its end smoothly on every append (chat.ts); at 600 px the log overflows enough that the
 * animation lands short under the fake clock, so land it at its end outright, then wait until it is there — every
 * run shows the same lines.
 */
async function scrolledToEnd(page: Page, pop: ReturnType<typeof shadow>): Promise<void> {
  const log = pop.locator(".chat-log");
  await log.evaluate((el) => el.scrollTo({ top: el.scrollHeight, behavior: "instant" }));
  await expect.poll(() => log.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1)).toBe(true);
}

/** The centre of an element on the page, for the Select tool's hover. */
async function centre(page: Page, sel: string): Promise<{ x: number; y: number }> {
  const box = (await page.locator(sel).boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.beforeAll(async ({ request }) => {
  // The scratch project (e2e/.project/screenshots) starts every run from the same state: no
  // captures, and exactly SEEDED tasks so the id the stub allocates (F-31: highest + 1) is fixed.
  const health = (await (await request.get(`${SCREENSHOTS_CRT_ORIGIN}/__crt/health`)).json()) as { projectRoot: string };
  const crt = join(health.projectRoot, ".crt");
  rmSync(join(crt, "captures"), { recursive: true, force: true });
  rmSync(join(crt, "tasks"), { recursive: true, force: true });
  mkdirSync(join(crt, "tasks"), { recursive: true });
  for (let i = 1; i <= SEEDED; i++) {
    const id = `CRT-${String(i).padStart(4, "0")}`;
    writeFileSync(
      join(crt, "tasks", `${id}-placeholder.md`),
      ["---", `id: ${id}`, `title: Placeholder ${i} (npm run screenshots)`, "status: done", "priority: normal", "updated: 2026-09-22T10:00:00+08:00", "---", "", "## Summary", "Seeded by e2e/screenshots.spec.ts so the task the stub writes is a fixed id.", ""].join("\n"),
    );
  }
  mkdirSync(IMAGES, { recursive: true });
});

test.afterEach(async ({ page, request }) => {
  // End every session this image started, so the next one begins on a quiet server.
  const threads = await page.evaluate(() => window.__crt.threads()).catch(() => []);
  for (const t of threads) await request.delete(`${SCREENSHOTS_CRT_ORIGIN}/__crt/sessions/${t.sessionId}`).catch(() => undefined);
});

test("arrival.png — the shop page, the CRT pill bottom-right, the welcome card open (F-82, F-116)", async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.__crt.welcome());
  const card = shadow(page, ".welcome");
  await expect(card).toBeVisible();
  await expect(card.locator("h2")).toHaveText("CRT is on this page");
  await expect(card.locator("p.agent")).toContainText("Agent: Claude");
  await shoot(page, "arrival.png");
});

test("select.png — Select armed, the hover outline and label on a price, one pinned marker with its popover and a typed note (F-8, F-65, F-116)", async ({ page }) => {
  await openApp(page);
  // The marker: pin the notebook's sale price and type its note into the popover (which opens beside it).
  await page.evaluate(() => window.__crt.addSelect("[data-testid=card-notebook] .price"));
  await page.evaluate(() => window.__crt.togglePop(1, true));
  const pop = shadow(page, '.pop[data-n="1"]');
  await expect(pop).toBeVisible();
  await expect(pop.locator("textarea")).toBeFocused();
  await page.keyboard.type("Sale price shows here but the cart total ignores it");
  await expect(pop.locator("textarea")).toHaveValue("Sale price shows here but the cart total ignores it");
  // Select armed (which closes the popover, F-65), the popover back beside its marker, then the
  // hover on the mug's price to its left: outline and label (the component name first, F-18), clear of the popover.
  await page.evaluate(() => window.__crt.setTool("select"));
  await expect(shadow(page, ".layer")).toBeVisible();
  await expect(shadow(page, "[data-tool=select]")).toHaveClass(/active/);
  await page.evaluate(() => window.__crt.togglePop(1, true));
  await expect(pop).toBeVisible();
  const at = await centre(page, "[data-testid=card-mug] .price");
  await page.mouse.move(at.x, at.y, { steps: 2 });
  await expect(shadow(page, ".hover")).toBeVisible();
  await expect(shadow(page, ".hover-label")).toHaveText("ProductCard div.price");
  await expect(shadow(page, ".hover-label b")).toHaveText("ProductCard");
  await expect(shadow(page, ".num-badge")).toHaveText("1");
  await shoot(page, "select.png");
});

test("chat.png — the popover as the chat: the folded capture bubble, streamed text, a collapsed tool line, the Allow / Deny card (F-25, F-26, F-66, F-116, F-119)", async ({ page }) => {
  await openApp(page);
  // The mug's price: the stub names the component and the source file the page reports (ProductCard).
  await page.evaluate(() => {
    window.__crt.addSelect("[data-testid=card-mug] .price");
    window.__crt.setNote(1, "Price ignores the SAVE10 promo the cart says is applied");
  });
  await page.evaluate(() => window.__crt.send({ n: 1 }));
  const pop = shadow(page, '.pop[data-n="1"]');
  await expect(pop.locator(".chat")).toBeVisible();
  // F-119: the first bubble is the developer's words; the capture message sits folded behind its pill.
  await expect(pop.locator(".msg.user .words")).toHaveText("Price ignores the SAVE10 promo the cart says is applied");
  await expect(pop.locator(".msg.user .fold-pill")).toHaveText("▸ Capture · 2 images");
  await expect(pop.locator(".msg.user .fold-body")).toBeHidden();
  await expect(pop.locator(".msg.assistant").first()).toContainText("let me look at the source");
  await expect(pop.locator(".msg.assistant strong").first()).toHaveText("ProductCard");
  await expect(pop.locator(".tool summary").first()).toHaveText("Read components/ProductCard.tsx");
  await expect(pop.locator(".tool").first()).toHaveClass(/done/);
  await expect(pop.locator(".perm .t")).toHaveText("Bash npm test");
  await expect(pop.locator(".perm button.allow")).toBeVisible();
  await expect(pop.locator(".perm button.deny")).toBeVisible();
  await expect(shadow(page, '.mark-state[data-n="1"]')).toHaveText("needs permission");
  await settle(page);
  await scrolledToEnd(page, pop);
  // F-65 (CRT-0029): at 600 px the chat popover sits above the dock, never under it.
  const [popBox, dockBox] = await Promise.all([pop.boundingBox(), shadow(page, ".dock").boundingBox()]);
  expect(popBox!.y + popBox!.height).toBeLessThanOrEqual(dockBox!.y);
  await shoot(page, "chat.png");
});

test(`marker-states.png — three markers on one page: thinking…, your turn, ${WRITTEN_TASK_ID} (F-67, F-116)`, async ({ page }) => {
  await openApp(page);
  // #1 the heading: the stub keeps thinking (its note carries the hold phrase, §12 rule 4).
  await page.evaluate((hold) => {
    window.__crt.addSelect("#heading");
    window.__crt.setNote(1, `Heading reads like a placeholder — ${hold}`);
  }, HOLD_PHRASE);
  await page.evaluate(() => window.__crt.send({ n: 1 }));
  await expect(shadow(page, '.pop[data-n="1"] .msg.assistant').first()).toContainText("let me look at the source");
  await expect(shadow(page, '.mark-state[data-n="1"]')).toHaveText("thinking…");
  // #2 the mug's price: Deny the test run, the stub proposes a definition of done and waits (idle).
  await page.evaluate(() => {
    window.__crt.addSelect("[data-testid=card-mug] .price");
    window.__crt.setNote(2, "Cart total ignores the SAVE10 promo the page says is applied");
  });
  await page.evaluate(() => window.__crt.send({ n: 2 }));
  await expect(shadow(page, '.pop[data-n="2"] .perm button.deny')).toBeVisible();
  await shadow(page, '.pop[data-n="2"] .perm button.deny').click();
  await expect(shadow(page, '.mark-state[data-n="2"]')).toHaveText("your turn");
  // #3 the notebook's name (clear of the dock, unlike its price): Allow, Accept the proposal, the task is written — its id on the marker.
  await page.evaluate(() => {
    window.__crt.addSelect("[data-testid=card-notebook] h3");
    window.__crt.setNote(3, "Product name should link to the product page");
  });
  await page.evaluate(() => window.__crt.send({ n: 3 }));
  await expect(shadow(page, '.pop[data-n="3"] .perm button.allow')).toBeVisible();
  await shadow(page, '.pop[data-n="3"] .perm button.allow').click();
  await expect(shadow(page, '.pop[data-n="3"] .chat-accept button')).toBeVisible();
  await shadow(page, '.pop[data-n="3"] .chat-accept button').click();
  await expect(shadow(page, '.mark-state[data-n="3"]')).toHaveText(WRITTEN_TASK_ID);
  await expect(shadow(page, '.num-badge[data-n="3"]')).toHaveAttribute("data-state", "task");
  // The three markers alone: close the popover the last send opened.
  await page.evaluate(() => window.__crt.togglePop(3, false));
  await expect(shadow(page, '.pop[data-n="3"]')).toBeHidden();
  await expect(shadow(page, '.mark-state[data-n="1"]')).toHaveText("thinking…");
  await expect(shadow(page, '.mark-state[data-n="2"]')).toHaveText("your turn");
  await settle(page);
  await shoot(page, "marker-states.png");
});

test("landing.png — the landing page on the stub server, light (F-114, F-116)", async ({ page }) => {
  await page.clock.install({ time: FIXED_TIME });
  await page.goto(`${SCREENSHOTS_CRT_ORIGIN}/`);
  await expect(page.locator("h1")).toHaveText(/^Your app is at /);
  // The script's rounds: the fast rows, then the plugin row (`claude plugin list --json`, the slow one).
  await expect(page.locator("#checked")).toHaveText(/^checked at \d\d:\d\d/);
  await expect(page.locator("#rows tr.row td.nm", { hasText: /^plugin$/ })).toHaveCount(1, { timeout: 20_000 });
  await expect(page.locator("#recheck")).toBeEnabled();
  await shoot(page, "landing.png");
});
