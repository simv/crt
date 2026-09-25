import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { type CaptureBundle, validateCaptureBundle } from "../src/capture-schema.js";
import { CRT_ORIGIN } from "../playwright.config.js";
import { FIXTURE_ORIGIN, shadow } from "./helpers.js";

// M2 (task CRT-0002 Ask 8): the fixture's /app and /react pages are loaded on the app's own origin
// (baseURL) with the overlay coming from the embedded `crt serve` through the loader tag
// (PRD-embedded F-110, M18), and the overlay is driven through its `window.__crt` hooks plus real
// pointer/keyboard input. Everything here runs on the same machine as the server, so written
// captures are read from disk.

async function projectRoot(page: Page): Promise<string> {
  const res = await page.request.get(`${CRT_ORIGIN}/__crt/health`);
  return ((await res.json()) as { projectRoot: string }).projectRoot;
}

test.describe("selector and XPath generation (F-17)", () => {
  test("produce unique, readable selectors and absolute XPaths", async ({ page }) => {
    await page.goto("/app");
    const out = await page.evaluate(() => {
      const h = window.__crt;
      const check = (sel: string) => {
        const s = h.selectorFor(sel);
        return { s, unique: document.querySelectorAll(s).length === 1, same: document.querySelector(s) === document.querySelector(sel) };
      };
      return {
        heading: check("#heading"),
        price2: check("article.featured .price"),
        buy1: check("[data-testid=card-1] .buy"),
        xpath: h.xpathFor("article.featured .price"),
        xpathHeading: h.xpathFor("#heading"),
      };
    });
    expect(out.heading.s).toBe("#heading");
    expect(out.price2).toMatchObject({ unique: true, same: true });
    expect(out.price2.s).toBe("article.featured > span");
    expect(out.buy1).toMatchObject({ unique: true, same: true });
    expect(out.xpath).toBe("/html/body/main/section/article[2]/span");
    expect(out.xpathHeading).toBe("/html/body/main/h1");
  });
});

test.describe("React component chain (F-18)", () => {
  test("walks the fiber tree for names, kinds and _debugSource on a React 18 dev build", async ({ page }) => {
    await page.goto("/react");
    await expect(page.locator("article.card")).toHaveCount(2);
    const out = await page.evaluate(() => {
      const h = window.__crt;
      return {
        price: h.componentsFor("article.card:nth-of-type(2) .price"),
        buy: h.componentsFor("article.card .buy"),
        desc: h.componentsFor("article.card .desc"),
        framework: h.framework(),
      };
    });
    expect(out.price.framework).toBe("react");
    expect(out.price.components.map((c) => c.name)).toEqual(["Price", "Card", "Shop", "App"]);
    expect(out.price.components.map((c) => c.kind)).toEqual(["function", "class", "function", "function"]);
    expect(out.price.source).toEqual({ file: "src/components/Shop.jsx", line: 30, column: 5, via: "debug_source" });
    expect(out.buy.components[0]).toEqual({ name: "FancyButton", kind: "forward_ref" });
    expect(out.desc.components[0]).toEqual({ name: "Desc", kind: "memo" });
    expect(out.framework.name).toBe("react");
  });

  test("reports unknown with an empty chain on a plain page", async ({ page }) => {
    await page.goto("/app");
    const out = await page.evaluate(() => window.__crt.componentsFor("#heading"));
    expect(out).toEqual({ framework: "unknown", components: [], source: null });
  });
});

test.describe("console hooks (F-20)", () => {
  test("keep console.error/warn, uncaught errors and unhandled rejections fired before Send", async ({ page }) => {
    await page.goto("/app");
    await expect
      .poll(() => page.evaluate(() => window.__crt.consoleEntries().map((e) => e.level)))
      .toEqual(expect.arrayContaining(["error", "warn", "uncaught", "unhandledrejection"]));
    const entries = await page.evaluate(() => window.__crt.consoleEntries());
    expect(entries.find((e) => e.level === "error")?.message).toBe("fixture: something went wrong at load");
    expect(entries.find((e) => e.level === "uncaught")?.message).toContain("fixture: uncaught boom");
    expect(entries.find((e) => e.level === "uncaught")?.stack).toContain("Error");
    expect(entries.find((e) => e.level === "unhandledrejection")?.message).toContain("fixture: rejected");
  });
});

test.describe("failed network requests (F-21)", () => {
  test("record fetch, XHR and sub-resource failures fired before Send, and the capture carries them", async ({ page }) => {
    await page.goto("/app");
    await expect
      .poll(() => page.evaluate(() => window.__crt.networkEntries().map((e) => `${e.via} ${e.method} ${e.status}`)))
      .toEqual(expect.arrayContaining(["fetch GET 404", "xhr POST 404", "resource GET 404"]));
    const entries = await page.evaluate(() => window.__crt.networkEntries());
    expect(entries.find((e) => e.via === "fetch")).toMatchObject({ url: "/api/missing", status: 404, error: null });
    expect(entries.find((e) => e.via === "xhr")).toMatchObject({ url: "/api/save", method: "POST", status: 404 });
    expect(entries.find((e) => e.via === "resource")?.url).toMatch(/\/missing\.png$/);
    expect(entries.every((e) => !e.url.includes("/__crt/"))).toBe(true);

    await page.evaluate(() => window.__crt.addSelect("#heading"));
    const { bundle } = await page.evaluate(() => window.__crt.capture());
    expect(validateCaptureBundle(bundle)).toEqual([]);
    expect(bundle.network.map((e) => e.via)).toEqual(expect.arrayContaining(["fetch", "xhr", "resource"]));
    expect(bundle.network.length).toBeLessThanOrEqual(50);
    // F-95: the overlay came from the loader on the app's origin, not from injection.
    expect(await page.evaluate(() => window.__crt.embeddedMode())).toBe(true);
  });

  test("the rasteriser's own failed fetch of a CORS-blocked font sheet stays out of the next capture; a page failure in between is still recorded (F-21, CRT-0038)", async ({ page }) => {
    await page.goto("/fonts");
    // The page did render the font, so the rasteriser goes after its cross-origin sheet (screenshot.ts inlineCrossOriginFonts).
    await expect
      .poll(() => page.evaluate(() => Array.from(document.fonts).some((f) => f.family.replace(/"/g, "") === "CrtFixtureFont" && f.status === "loaded")))
      .toBe(true);
    const sheet = await page.evaluate(() => document.querySelector<HTMLLinkElement>("link[rel=stylesheet]")!.href);
    expect(new URL(sheet).origin).not.toBe(new URL(page.url()).origin);
    const fontEntries = (entries: Array<{ url: string }>) => entries.filter((e) => e.url.includes("/fonts.css"));

    await page.evaluate(() => window.__crt.addSelect("#heading"));
    const first = await page.evaluate(() => window.__crt.capture());
    expect(first.bundle.screenshots.error).toBeNull();
    expect(fontEntries(await page.evaluate(() => window.__crt.networkEntries()))).toEqual([]);

    await page.evaluate(() => fetch("/api/after-first-capture").catch(() => undefined));
    const { bundle } = await page.evaluate(() => window.__crt.capture());
    expect(validateCaptureBundle(bundle)).toEqual([]);
    expect(fontEntries(bundle.network)).toEqual([]);
    expect(bundle.network).toEqual(expect.arrayContaining([expect.objectContaining({ via: "fetch", url: "/api/after-first-capture", status: 404 })]));
  });
});

test.describe("launcher and tools (F-7…F-12)", () => {
  test("launcher toggles the toolbar by click and by Ctrl+Shift+.", async ({ page }) => {
    await page.goto("/app");
    const launcher = shadow(page, ".launcher");
    const toolbar = shadow(page, ".toolbar");
    await expect(launcher).toBeVisible();
    await expect(toolbar).toBeHidden();
    await launcher.click();
    await expect(toolbar).toBeVisible();
    await page.keyboard.press("Control+Shift+Period");
    await expect(toolbar).toBeHidden();
    await page.keyboard.press("Control+Shift+Period");
    await expect(toolbar).toBeVisible();
  });

  test("launcher can be dragged to a new corner", async ({ page }) => {
    await page.goto("/app");
    const launcher = shadow(page, ".launcher");
    const before = (await launcher.boundingBox())!;
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await page.mouse.move(before.x - 300, before.y - 200, { steps: 8 });
    await page.mouse.up();
    const after = (await launcher.boundingBox())!;
    expect(after.x).toBeLessThan(before.x - 250);
    expect(after.y).toBeLessThan(before.y - 150);
    // A drag is not a click: the toolbar stays closed.
    await expect(shadow(page, ".toolbar")).toBeHidden();
  });

  test("Select: hover shows outline + label, arrows walk the tree, click pins (F-8)", async ({ page }) => {
    await page.goto("/app");
    await shadow(page, ".launcher").click();
    await shadow(page, "[data-tool=select]").click();
    await expect(shadow(page, ".layer")).toBeVisible();
    const price = page.locator("[data-testid=card-1] .price");
    // The capture layer sits over the page on purpose, so Playwright's actionability check would
    // refuse `price.hover()`; drive the raw pointer instead.
    const target = (await price.boundingBox())!;
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 3 });
    await expect(shadow(page, ".hover")).toBeVisible();
    await expect(shadow(page, ".hover-label")).toHaveText("span.price");
    const hoverBox = (await shadow(page, ".hover").boundingBox())!;
    const priceBox = (await price.boundingBox())!;
    expect(Math.abs(hoverBox.x - priceBox.x)).toBeLessThan(3);
    expect(Math.abs(hoverBox.width - priceBox.width)).toBeLessThan(5);

    await page.keyboard.press("ArrowUp");
    await expect(shadow(page, ".hover-label")).toHaveText("article.card");
    await page.keyboard.press("ArrowDown");
    await expect(shadow(page, ".hover-label")).toHaveText("h2.title");
    await page.keyboard.press("Enter");

    const anns = await page.evaluate(() => window.__crt.annotations());
    expect(anns).toEqual([{ n: 1, kind: "select", note: "", label: "article:nth-of-type(1) > h2", detached: false, sessionId: null }]);
    await expect(shadow(page, ".layer")).toBeHidden();
    await expect(shadow(page, ".num-badge")).toHaveText("1");
    // F-65: the popover opens beside the element with the note focused.
    await expect(shadow(page, '.pop[data-n="1"]')).toBeVisible();
    await expect(shadow(page, '.pop[data-n="1"] textarea')).toBeFocused();
    const popBox = (await shadow(page, '.pop[data-n="1"]').boundingBox())!;
    const titleBox = (await page.locator("[data-testid=card-1] h2.title").boundingBox())!;
    expect(popBox.x).toBeGreaterThan(titleBox.x + titleBox.width);
    expect(Math.abs(popBox.y - titleBox.y)).toBeLessThan(3);
    // The click never reached the page.
    expect(await page.evaluate(() => (window as unknown as { __fixture: string }).__fixture)).toBe("app");
  });

  test("Esc cancels a tool (F-8)", async ({ page }) => {
    await page.goto("/app");
    await page.evaluate(() => window.__crt.setTool("pin"));
    await expect(shadow(page, ".layer")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(shadow(page, ".layer")).toBeHidden();
    expect(await page.evaluate(() => window.__crt.currentTool())).toBeNull();
  });

  test("Box: drag records the elements inside it (F-9)", async ({ page }) => {
    await page.goto("/app");
    await page.evaluate(() => window.__crt.setTool("box"));
    const cards = (await page.locator("section.cards").boundingBox())!;
    await page.mouse.move(cards.x - 8, cards.y - 8);
    await page.mouse.down();
    await page.mouse.move(cards.x + cards.width + 8, cards.y + cards.height + 8, { steps: 10 });
    await page.mouse.up();
    const anns = await page.evaluate(() => window.__crt.annotations());
    expect(anns).toHaveLength(1);
    expect(anns[0]).toMatchObject({ n: 1, kind: "box" });
    const { bundle } = await page.evaluate(() => window.__crt.capture());
    const box = bundle.annotations[0]!;
    expect(box.elements.length).toBeGreaterThanOrEqual(2);
    expect(box.elements.length).toBeLessThanOrEqual(10);
    expect(box.elements[0]!.selector).toBe("section");
    expect(box.elements.map((e) => e.tag)).toContain("article");
    expect(box.elements.map((e) => e.tag)).not.toContain("body");
  });

  test("Pin: click places a point with no element (F-10)", async ({ page }) => {
    await page.goto("/app");
    await page.evaluate(() => window.__crt.setTool("pin"));
    await page.mouse.click(400, 300);
    const { bundle } = await page.evaluate(() => window.__crt.capture());
    expect(bundle.annotations[0]).toMatchObject({ n: 1, kind: "pin", element: null, elements: [], point: { x: 400, y: 300 } });
  });

  test("notes, numbering, delete and clear (F-11)", async ({ page }) => {
    await page.goto("/app");
    await page.evaluate(() => {
      const h = window.__crt;
      h.addSelect("#heading");
      h.addPin(50, 50);
      h.addSelect("[data-testid=card-2] .price");
    });
    await expect(shadow(page, ".num-badge")).toHaveCount(3);
    await expect(shadow(page, ".launcher .count")).toHaveText("3");
    // Type a note into the second popover through the real textarea (F-65: one popover open at a time).
    await page.evaluate(() => window.__crt.togglePop(2, true));
    await expect(shadow(page, '.pop[data-n="1"]')).toBeHidden();
    const note2 = shadow(page, '.pop[data-n="2"] textarea');
    await note2.fill("something is missing here");
    expect((await page.evaluate(() => window.__crt.annotations()))[1]!.note).toBe("something is missing here");
    // Delete the first from its popover: the rest renumber.
    await page.evaluate(() => window.__crt.togglePop(1, true));
    await expect(shadow(page, '.pop[data-n="2"]')).toBeHidden();
    await shadow(page, '.pop[data-n="1"] [data-action=delete]').click();
    const anns = await page.evaluate(() => window.__crt.annotations());
    expect(anns.map((a) => [a.n, a.kind, a.note])).toEqual([
      [1, "pin", "something is missing here"],
      [2, "select", ""],
    ]);
    await expect(shadow(page, ".num-badge")).toHaveCount(2);
    await shadow(page, "[data-action=clear]").click();
    expect(await page.evaluate(() => window.__crt.annotations())).toEqual([]);
    await expect(shadow(page, ".num-badge")).toHaveCount(0);
  });

  test("annotations survive in-page navigation and a reload (F-12)", async ({ page }) => {
    await page.goto("/app");
    await page.evaluate(() => {
      window.__crt.addSelect("#heading");
      window.__crt.setNote(1, "keep me");
      history.pushState({}, "", "/app?tab=2");
    });
    expect(await page.evaluate(() => window.__crt.annotations())).toMatchObject([{ n: 1, note: "keep me" }]);
    await page.reload();
    await expect(shadow(page, ".num-badge")).toHaveCount(1);
    expect(await page.evaluate(() => window.__crt.annotations())).toEqual([
      { n: 1, kind: "select", note: "keep me", label: "#heading", detached: false, sessionId: null },
    ]);
  });
});

test.describe("overlay hot paths (N-3, CRT-0039)", () => {
  /** A marker's box against its element's: the outline covers the element, the badge centres on its top-left corner. */
  async function glued(page: Page, n: number, target: string): Promise<boolean> {
    const [mark, badge, el] = await Promise.all([
      shadow(page, `.mark[data-n="${n}"]`).boundingBox(),
      shadow(page, `.num-badge[data-n="${n}"]`).boundingBox(),
      page.locator(target).boundingBox(),
    ]);
    if (!mark || !badge || !el) return false;
    const near = (a: number, b: number) => Math.abs(a - b) < 1.5;
    return (
      near(mark.x, el.x) && near(mark.y, el.y) && near(mark.width, el.width) && near(mark.height, el.height) &&
      near(badge.x + badge.width / 2, el.x) && near(badge.y + badge.height / 2, el.y)
    );
  }

  test("with 3 annotations and the toolbar closed, the overlay requests no animation frame over 1 s idle (N-3)", async ({ page }) => {
    // Count requestAnimationFrame calls whose caller is the overlay bundle (the page's own would not count).
    await page.addInitScript(() => {
      const w = window as unknown as { __crtFrames: number };
      const raf = window.requestAnimationFrame.bind(window);
      w.__crtFrames = 0;
      window.requestAnimationFrame = (cb) => {
        if ((new Error().stack ?? "").includes("/__crt/overlay.js")) w.__crtFrames++;
        return raf(cb);
      };
    });
    await page.goto("/app");
    await page.evaluate(() => {
      const h = window.__crt;
      h.addSelect("#heading");
      h.addSelect("[data-testid=card-2] .price");
      h.addPin(200, 400);
    });
    await expect(shadow(page, ".num-badge")).toHaveCount(3);
    await expect.poll(() => glued(page, 2, "[data-testid=card-2] .price")).toBe(true);
    expect(await page.evaluate(() => window.__crt.isOpen())).toBe(false);
    const frames = () => page.evaluate(() => (window as unknown as { __crtFrames: number }).__crtFrames);
    expect(await frames()).toBeGreaterThan(0); // the counter sees the overlay's frames: placing the new markers took one
    await page.evaluate(() => ((window as unknown as { __crtFrames: number }).__crtFrames = 0));
    await page.waitForTimeout(1000);
    expect(await frames()).toBe(0);
  });

  test("markers follow a resized element, the content it pushes down, and a scroll; the open popover follows too (F-65)", async ({ page }) => {
    await page.goto("/app");
    await page.evaluate(() => {
      window.__crt.addSelect("#heading");
      window.__crt.addSelect("[data-testid=card-2] .price");
    });
    const price = "[data-testid=card-2] .price";
    await expect.poll(() => glued(page, 1, "#heading")).toBe(true);
    await expect.poll(() => glued(page, 2, price)).toBe(true);
    // Toolbar closed, so no per-frame loop: the ResizeObservers move the heading's marker and the price's below it.
    await page.evaluate(() => (document.getElementById("heading")!.style.height = "140px"));
    await expect.poll(() => glued(page, 1, "#heading")).toBe(true);
    await expect.poll(() => glued(page, 2, price)).toBe(true);
    // The scroll listener.
    await page.evaluate(() => window.scrollBy(0, 150));
    await expect.poll(() => glued(page, 2, price)).toBe(true);
    await expect.poll(() => glued(page, 1, "#heading")).toBe(true);
    // The popover opens beside its element and stays there through a scroll and a resize of the element.
    await page.evaluate(() => window.__crt.togglePop(2, true));
    const pop = shadow(page, '.pop[data-n="2"]');
    await expect(pop).toBeVisible();
    const beside = async () => {
      const [p, el] = await Promise.all([pop.boundingBox(), page.locator(price).boundingBox()]);
      return !!p && !!el && p.x > el.x + el.width && Math.abs(p.y - el.y) < 3;
    };
    await expect.poll(beside).toBe(true);
    // Further down the page, so the element rises and its popover stays clear of the dock's clamp (CRT-0029): it must track the element exactly.
    await page.evaluate(() => window.scrollBy(0, 100));
    await expect.poll(beside).toBe(true);
    await expect.poll(() => glued(page, 2, price)).toBe(true);
    await page.evaluate((sel) => {
      const el = document.querySelector<HTMLElement>(sel)!;
      el.style.display = "inline-block";
      el.style.padding = "20px 40px";
    }, price);
    await expect.poll(() => glued(page, 2, price)).toBe(true);
    await expect.poll(beside).toBe(true);
    // With the popover closed (no loop), an anchored element leaving the page still dims its marker (F-12 detached).
    await page.evaluate(() => window.__crt.togglePop(2, false));
    await page.evaluate(() => document.getElementById("heading")!.remove());
    await expect(shadow(page, '.mark[data-n="1"]')).toHaveClass(/detached/);
    await expect(shadow(page, '.mark[data-n="2"]')).not.toHaveClass(/detached/);
  });

  test("a note typed just before a reload is kept: its debounced write is flushed on pagehide (F-12)", async ({ page }) => {
    await page.clock.install();
    await page.goto("/app");
    await page.evaluate(() => {
      window.__crt.addSelect("#heading");
      window.__crt.togglePop(1, true);
    });
    // Time stands still from here, so the debounced write cannot come due before the reload.
    await page.clock.pauseAt(Date.now() + 60_000);
    await shadow(page, '.pop[data-n="1"] textarea').pressSequentially("the heading wraps");
    expect((await page.evaluate(() => window.__crt.annotations()))[0]!.note).toBe("the heading wraps");
    expect(await page.evaluate(() => sessionStorage.getItem("crt.annotations.v1"))).not.toContain("the heading wraps");
    await page.reload();
    await expect(shadow(page, ".num-badge")).toHaveCount(1);
    expect((await page.evaluate(() => window.__crt.annotations()))[0]!.note).toBe("the heading wraps");
  });

  test("the hover label names the component the capture names first, on the React 18 page (F-8, F-18)", async ({ page }) => {
    await page.goto("/react");
    await expect(page.locator("article.card")).toHaveCount(2);
    await page.evaluate(() => window.__crt.setTool("select"));
    const box = (await page.locator("article.card:nth-of-type(2) .price").boundingBox())!;
    await page.evaluate(({ x, y }) => window.__crt.hoverAt(x, y), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    const first = await page.evaluate(() => window.__crt.componentsFor("article.card:nth-of-type(2) .price").components[0]!.name);
    expect(first).toBe("Price");
    await expect(shadow(page, ".hover-label b")).toHaveText(first);
  });
});

test.describe("capture and send (F-13, F-15…F-20, F-22, F-23)", () => {
  test("Send writes capture.json (valid) and PNGs into .crt/captures/<id>/ with element and console details", async ({
    page,
  }) => {
    await page.goto("/app");
    await page.evaluate(() => {
      const h = window.__crt;
      h.addSelect("[data-testid=card-1] .price");
      h.setNote(1, "price should include tax");
      h.addBox({ x: 20, y: 60, width: 340, height: 120 });
      h.setNote(2, "cards look cramped");
    });
    await shadow(page, ".launcher").click();
    // F-65: one annotation per send by default; `include` groups the other unsent ones into the same capture (F-11).
    const sent = await page.evaluate(() => window.__crt.send({ n: 1, include: true }));
    expect(sent.id).toMatch(/^\d{8}-\d{6}-[a-f0-9]{4}$/);
    expect(sent.dir).toBe(join(await projectRoot(page), ".crt", "captures", sent.id));
    await expect(shadow(page, ".status")).toContainText(sent.dir);
    // F-67: sent annotations keep their markers and are bound to the same session.
    const anns = await page.evaluate(() => window.__crt.annotations());
    expect(anns.map((a) => a.n)).toEqual([1, 2]);
    expect(anns[0]!.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(anns[1]!.sessionId).toBe(anns[0]!.sessionId);
    await expect(shadow(page, ".num-badge")).toHaveCount(2);

    try {
      const bundle = JSON.parse(readFileSync(join(sent.dir, "capture.json"), "utf8")) as CaptureBundle;
      expect(validateCaptureBundle(bundle)).toEqual([]);
      expect(bundle.id).toBe(sent.id);

      // F-15
      expect(bundle.page).toMatchObject({ pathname: "/app", title: "CRT fixture app", query: "", hash: "" });
      expect(bundle.page.url).toBe(`${FIXTURE_ORIGIN}/app`);
      expect(bundle.page.viewport.width).toBeGreaterThan(0);
      expect(bundle.page.userAgent).toContain("Chrome");

      // F-16
      for (const name of ["viewport.png", "viewport-annotated.png", "ann-1.png", "ann-2.png"]) {
        const file = join(sent.dir, name);
        expect(existsSync(file), name).toBe(true);
        expect(readFileSync(file).subarray(1, 4).toString(), name).toBe("PNG");
      }
      expect(bundle.screenshots).toEqual({ viewport: "viewport.png", annotated: "viewport-annotated.png", error: null });

      // F-17, F-19
      const sel = bundle.annotations[0]!;
      expect(sel).toMatchObject({ n: 1, kind: "select", note: "price should include tax", image: "ann-1.png" });
      expect(sel.element).toMatchObject({
        tag: "span",
        classes: ["price"],
        role: "text",
        ariaLabel: "Price of Widget",
        text: "$10.00",
        detached: false,
        componentFramework: "unknown",
      });
      expect(sel.element!.selector).toMatch(/span/);
      expect(sel.element!.styles["font-weight"]).toBe("700");
      expect(sel.element!.outerHtml).toContain('class="price"');
      expect(sel.element!.parentOuterHtml).toContain('data-product-id="p-1"');
      expect(sel.element!.rect.width).toBeGreaterThan(0);
      const box = bundle.annotations[1]!;
      expect(box).toMatchObject({ n: 2, kind: "box", note: "cards look cramped", element: null, image: "ann-2.png" });
      expect(box.rect).toEqual({ x: 20, y: 60, width: 340, height: 120 });

      // F-20: errors thrown at load are in the bundle
      expect(bundle.console.map((c) => c.level)).toEqual(
        expect.arrayContaining(["error", "warn", "uncaught", "unhandledrejection"]),
      );

      // F-22
      expect(bundle.framework).toMatchObject({ name: "unknown", bundler: "unknown", route: null });
    } finally {
      rmSync(sent.dir, { recursive: true, force: true });
    }
  });

  test("a Select on a React page carries the component chain and source (F-18)", async ({ page }) => {
    await page.goto("/react");
    await expect(page.locator("article.card")).toHaveCount(2);
    await page.evaluate(() => window.__crt.addSelect("article.card:nth-of-type(2) .price"));
    const { bundle, imageNames } = await page.evaluate(() => window.__crt.capture());
    expect(imageNames.sort()).toEqual(["ann-1.png", "viewport-annotated.png", "viewport.png"]);
    const el = bundle.annotations[0]!.element!;
    expect(el.componentFramework).toBe("react");
    expect(el.components.map((c) => c.name)).toEqual(["Price", "Card", "Shop", "App"]);
    expect(el.source).toEqual({ file: "src/components/Shop.jsx", line: 30, column: 5, via: "debug_source" });
    expect(bundle.framework.name).toBe("react");
  });

  test("a Select whose element left the DOM is sent from its snapshot as detached (F-12)", async ({ page }) => {
    await page.goto("/app");
    await page.evaluate(() => {
      window.__crt.addSelect("#footer-note");
      document.getElementById("footer-note")!.remove();
    });
    const { bundle } = await page.evaluate(() => window.__crt.capture());
    expect(bundle.annotations[0]!.element).toMatchObject({ selector: "#footer-note", detached: true, text: "Bottom of the page." });
  });

  test("an error status stays up when an earlier status's auto-hide comes due, and a later auto-hiding status still hides (F-13, CRT-0038)", async ({ page }) => {
    await page.clock.install();
    await page.goto("/app");
    await page.evaluate(() => {
      const h = window.__crt;
      h.addSelect("#heading");
      h.setNote(1, "first");
      h.addSelect("[data-testid=card-1] .price");
      h.setNote(2, "second");
    });
    const status = shadow(page, ".status");
    const dirs: string[] = [];
    try {
      // A Send: "Capture saved" hides itself 15 s later.
      dirs.push((await page.evaluate(() => window.__crt.send({ n: 1 }))).dir);
      await expect(status).toContainText("Capture saved");
      // Within those 15 s, a Send that fails: an error status, which does not hide itself.
      await page.route("**/__crt/captures", (route) => route.abort());
      await expect(page.evaluate(() => window.__crt.send({ n: 2 }))).rejects.toThrow();
      await page.unroute("**/__crt/captures");
      await expect(status).toHaveClass(/error/);
      await expect(status).toContainText("Send failed");
      // 16 s after the first status: the error is still there.
      await page.clock.fastForward(16_000);
      await expect(status).toBeVisible();
      await expect(status).toContainText("Send failed");
      // The retried Send's "Capture saved" still hides itself.
      dirs.push((await page.evaluate(() => window.__crt.send({ n: 2 }))).dir);
      await expect(status).toContainText("Capture saved");
      await page.clock.fastForward(16_000);
      await expect(status).toBeHidden();
    } finally {
      for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
    }
  });

  test("Send with nothing to send is refused", async ({ page }) => {
    await page.goto("/app");
    await expect(page.evaluate(() => window.__crt.send())).rejects.toThrow(/nothing to send/);
  });
});
