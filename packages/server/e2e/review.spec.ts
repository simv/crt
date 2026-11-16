import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { projectKey } from "../src/home.js";
import { samplePost } from "../test/helpers/sample-capture.js";
import { E2E_HOME, FIXTURE_ORIGIN, scratch, startCrt, stopCrts } from "./helpers.js";

// PRD-zero F-135 (M30): the review page in a real browser. A guest project's review is seeded with
// stub Sends over the routes the overlay uses; the page then keeps, drops, prioritises and orders
// the items by keyboard alone and by pointer, and `crt review --json` reads the result back. The
// ports are PORTS.review (e2e/helpers.ts); each test has its own scratch project and server.

const SHA = "4f2a91c0d3b5e6f708192a3b4c5d6e7f8091a2b3";

test.afterEach(stopCrts);

interface Seeded {
  root: string;
  origin: string;
  reviewDir: string;
  run(args: string[], env?: NodeJS.ProcessEnv): Promise<{ code: number | null; lines: string[] }>;
  json(): Promise<{ review: string; items: Array<{ id: string; keep: boolean; priority: string; route: string | null }>; totals: Record<string, number> }>;
}

/** A guest project with a running CRT on `port` and one item per route given, filed in that order (R-01, R-02, …). */
async function seeded(name: string, port: number, routes: string[]): Promise<Seeded> {
  const root = scratch("review", name, port);
  rmSync(join(root, ".crt"), { recursive: true, force: true });
  writeFileSync(join(root, ".git", "HEAD"), `${SHA}\n`);
  const reviews = join(E2E_HOME, "reviews", projectKey(root));
  rmSync(reviews, { recursive: true, force: true });
  const origin = `http://localhost:${port}`;
  const crt = startCrt(root, ["--no-open", "--port", String(port)]);
  await crt.waitFor(new RegExp(`^CRT ready at ${origin} `));
  const post = async (path: string, body: unknown) => (await fetch(origin + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json() as Promise<Record<string, unknown>>;
  for (const [i, route] of routes.entries()) {
    const body = samplePost();
    body.bundle.framework.route = route;
    const capture = await post("/__crt/captures", body);
    await post("/__crt/sessions", { captureId: capture.id, quick: true });
    await crt.waitFor(new RegExp(`^crt: task R-0${i + 1} written to `));
  }
  const run: Seeded["run"] = async (args, env) => {
    const child = startCrt(root, args, env);
    return { code: await child.exited, lines: child.lines };
  };
  const json: Seeded["json"] = async () => JSON.parse((await run(["review", "--json"])).lines.join("\n"));
  return { root, origin, reviewDir: join(reviews, (await json()).review), run, json };
}

const focused = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.id ?? null);

/** Press Tab until the control named `label` has the focus — the only way these tests reach a control. */
async function tabTo(page: Page, label: string): Promise<void> {
  for (let i = 0; i < 80; i++) {
    if ((await focused(page)) === label) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`Tab never reached "${label}" (stopped on "${await focused(page)}")`);
}

const groups = (page: Page) =>
  page.locator("section.group").evaluateAll((sections) => sections.map((s) => [s.getAttribute("data-route"), [...s.querySelectorAll("li.item")].map((li) => `${li.getAttribute("data-id")}${li.classList.contains("dropped") ? "!" : ""}`)]));

test("the review page drops one item and raises another by keyboard, and `crt review --json` shows both (F-135)", async ({ page }) => {
  const s = await seeded("keyboard", 4440, ["/cart", "/checkout", "/cart"]);
  await page.goto(`${s.origin}/__crt/review`);
  await expect(page.locator("main[data-state=ready]")).toBeVisible();
  await expect(page.locator("#totals")).toHaveText("3 items · 3 kept · 2 routes");
  await expect(page.locator("h1")).toHaveText(`Review ${(await s.json()).review}`);
  expect(await groups(page)).toEqual([
    ["/cart", ["R-01", "R-03"]],
    ["/checkout", ["R-02"]],
  ]);
  // Each card shows the annotated screenshot (served by id and file name) and the reviewed commit.
  const shot = page.locator('li[data-id="R-01"] img');
  await expect(shot).toHaveAttribute("src", "/__crt/review/assets/R-01/viewport-annotated.png");
  await expect.poll(() => shot.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(page.locator('li[data-id="R-01"] .meta')).toHaveText(`reviewed at ${SHA.slice(0, 7)}`);

  // Drop R-02 with Enter: greyed, counted, and the focus stays on the same control, now "Keep".
  await tabTo(page, "Drop R-02");
  await page.keyboard.press("Enter");
  await expect(page.locator('li[data-id="R-02"]')).toHaveClass(/dropped/);
  await expect(page.locator("#totals")).toHaveText("3 items · 2 kept · 2 routes");
  await expect(page.locator("#status")).toHaveText("R-02 dropped.");
  expect(await focused(page)).toBe("Keep R-02");

  // Raise R-03: its priority with the arrow key on the <select>, then above R-01 with Space on Move up.
  await tabTo(page, "Priority of R-03");
  await page.keyboard.press("ArrowDown"); // low, normal, high
  await expect(page.locator("#status")).toHaveText("R-03 is now high priority.");
  await expect(page.locator('li[data-id="R-03"] select')).toHaveValue("high");
  await tabTo(page, "Move R-03 up");
  await page.keyboard.press("Space");
  await expect.poll(() => groups(page)).toEqual([
    ["/cart", ["R-03", "R-01"]],
    ["/checkout", ["R-02!"]],
  ]);
  // Move up is now disabled for R-03, so the focus moved to its twin rather than being lost.
  expect(await focused(page)).toBe("Move R-03 down");

  // A group as a whole, with Enter.
  await tabTo(page, "Move the group /checkout up");
  await page.keyboard.press("Enter");
  await expect.poll(() => groups(page)).toEqual([
    ["/checkout", ["R-02!"]],
    ["/cart", ["R-03", "R-01"]],
  ]);

  // All of it is in the review as the CLI reads it, and only R-03's file was rewritten.
  const json = await s.json();
  expect(json.totals).toEqual({ items: 3, kept: 2, routes: 2 });
  expect(json.items.map((i) => [i.id, i.keep, i.priority, i.route])).toEqual([
    ["R-02", false, "normal", "/checkout"],
    ["R-03", true, "high", "/cart"],
    ["R-01", true, "normal", "/cart"],
  ]);
  expect((await s.run(["review"])).lines).toEqual([
    "R-02  normal  dropped  /checkout  Cart total excludes applied discount",
    "R-03  high    kept     /cart      Cart total excludes applied discount",
    "R-01  normal  kept     /cart      Cart total excludes applied discount",
    `Review ${json.review}: 3 items · 2 kept · 2 routes`,
    "Next: `crt handoff` sends the kept items to the project.",
  ]);
  const r03 = readFileSync(join(s.reviewDir, "tasks", "R-03-cart-total-excludes-applied-discount.md"), "utf8");
  expect(r03).toContain("\npriority: high\n");
  expect(r03.trimEnd().split("\n").at(-1)).toMatch(/ — priority normal → high, set on the review page \(`crt review`\)\.$/);
  expect(readFileSync(join(s.reviewDir, "tasks", "R-02-cart-total-excludes-applied-discount.md"), "utf8")).toContain("\npriority: normal\n");

  // A reload shows the same review: nothing lived only in the page.
  await page.reload();
  await expect(page.locator("main[data-state=ready]")).toBeVisible();
  expect(await groups(page)).toEqual([
    ["/checkout", ["R-02!"]],
    ["/cart", ["R-03", "R-01"]],
  ]);
});

test("every control on the review page is a button or a select that Tab reaches, and the pointer works too (F-135)", async ({ page }) => {
  const s = await seeded("controls", 4441, ["/cart", "/cart", "/checkout"]);
  await page.goto(`${s.origin}/__crt/review`);
  await expect(page.locator("main[data-state=ready]")).toBeVisible();

  // Nothing clickable that is not a real control.
  expect(await page.locator("[onclick], [role=button], [tabindex]").count()).toBe(0);
  const controls = await page.locator("button:enabled, select:enabled").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? e.id));
  expect(controls).toEqual([
    "copy",
    "Move the group /cart down",
    "Drop R-01",
    "Priority of R-01",
    "Move R-01 down",
    "Drop R-02",
    "Priority of R-02",
    "Move R-02 up",
    "Move the group /checkout up",
    "Drop R-03",
    "Priority of R-03",
  ]);
  // Tab walks them all, in that order (links sit between them: the header and each screenshot).
  const reached: string[] = [];
  for (let i = 0; i < 40 && reached.length < controls.length; i++) {
    await page.keyboard.press("Tab");
    const label = await focused(page);
    if (label !== null && controls.includes(label)) reached.push(label);
  }
  expect(reached).toEqual(controls);
  // Each is focusable with a visible ring (the accent outline).
  await page.locator('[aria-label="Drop R-01"]').focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  expect(await page.locator('[aria-label="Drop R-01"]').evaluate((b) => getComputedStyle(b).outlineStyle)).toBe("solid");

  // By pointer: drop, restore, reprioritise, reorder.
  await page.getByRole("button", { name: "Drop R-01" }).click();
  await expect(page.locator('li[data-id="R-01"]')).toHaveClass(/dropped/);
  await expect(page.locator('li[data-id="R-01"] .tag')).toHaveText("dropped");
  await page.getByRole("button", { name: "Keep R-01" }).click();
  await expect(page.locator('li[data-id="R-01"]')).not.toHaveClass(/dropped/);
  await page.getByLabel("Priority of R-02").selectOption("low");
  await expect(page.locator("#status")).toHaveText("R-02 is now low priority.");
  await page.getByRole("button", { name: "Move R-01 down" }).click();
  await expect.poll(() => groups(page)).toEqual([
    ["/cart", ["R-02", "R-01"]],
    ["/checkout", ["R-03"]],
  ]);
  expect((await s.json()).items.map((i) => [i.id, i.keep, i.priority])).toEqual([
    ["R-02", true, "low"],
    ["R-01", true, "normal"],
    ["R-03", true, "normal"],
  ]);

  // The command to hand the review over is there to copy.
  await expect(page.locator("#handoff")).toHaveText("crt handoff");
  await page.locator("#copy").click();
  await expect(page.locator("#copy")).toHaveText("Copied");
});

test("an app page cannot read or edit the review; `crt review --open` opens the page on the running server or starts one (F-135)", async ({ page }) => {
  const s = await seeded("origin", 4442, ["/cart"]);
  // From the app's own origin (another loopback port) the browser sends its Origin: refused, with no CORS answer.
  await page.goto(`${FIXTURE_ORIGIN}/untouched`);
  const tried = await page.evaluate(async (origin) => {
    const attempt = (path: string, init?: RequestInit) =>
      fetch(origin + path, init).then(
        (r) => `answered ${r.status}`,
        () => "refused",
      );
    return [await attempt("/__crt/review/items"), await attempt("/__crt/review/items/R-01", { method: "PATCH", headers: { "content-type": "application/json" }, body: '{"keep":false}' }), await attempt("/__crt/review/assets/R-01/viewport.png")];
  }, s.origin);
  expect(tried).toEqual(["refused", "refused", "refused"]);
  // … and an <img> pointed at a screenshot does not load either.
  expect(
    await page.evaluate(
      (src) =>
        new Promise<string>((done) => {
          const img = new Image();
          img.onload = () => done("loaded");
          img.onerror = () => done("refused");
          img.src = src;
        }),
      `${s.origin}/__crt/review/assets/R-01/viewport-annotated.png`,
    ),
  ).toBe("refused");
  expect((await s.json()).items).toMatchObject([{ id: "R-01", keep: true }]);

  // `crt review --open` with a CRT serving the project: the list, then its page on that server (CRT_BROWSER: a command that does nothing).
  const opened = await s.run(["review", "--open", "--port", "4442"], { CRT_BROWSER: process.execPath });
  expect(opened.code).toBe(0);
  expect(opened.lines.at(-1)).toBe(`Opened ${s.origin}/__crt/review (CRT is already serving this project).`);
  // --no-open never does.
  expect((await s.run(["review", "--open", "--no-open", "--port", "4442"], { CRT_BROWSER: process.execPath })).lines.at(-1)).toBe("Next: `crt handoff` sends the kept items to the project.");

  // With none running, it starts one for the project and opens the page there.
  await stopCrts();
  const started = startCrt(s.root, ["review", "--open", "--port", "4443"], { CRT_BROWSER: process.execPath });
  await started.waitFor(/^CRT ready at http:\/\/localhost:4443 /);
  await started.waitFor(/^Opening http:\/\/localhost:4443\/__crt\/review — Ctrl\+C stops CRT\.$/);
  await page.goto("http://localhost:4443/__crt/review");
  await expect(page.locator("main[data-state=ready]")).toBeVisible();
  await expect(page.locator("#totals")).toHaveText("1 item · 1 kept · 1 route");
});

test("the review page says so when there is no review yet (F-135)", async ({ page }) => {
  const root = scratch("review", "empty", 4444);
  const crt = startCrt(root, ["--no-open", "--port", "4444"]);
  await crt.waitFor(/^CRT ready at http:\/\/localhost:4444 /);
  rmSync(join(E2E_HOME, "reviews", projectKey(root)), { recursive: true, force: true });
  await page.goto("http://localhost:4444/__crt/review");
  await expect(page.locator("main[data-state=empty]")).toHaveText(`crt: no review for ${root} yet — run \`crt\`, send some feedback, then \`crt review\``);
  await expect(page.locator("#totals")).toHaveText("");
});
