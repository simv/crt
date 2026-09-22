import { expect, type Page, test } from "@playwright/test";
import type { DoctorPayload } from "../src/doctor-route.js";
import { CRT_ORIGIN, FIXTURE_ORIGIN } from "../playwright.config.js";

// PRD-polish M21 (F-113, F-114, N-23, N-24): the landing page on the primary stub server. The
// Checkup rows the script renders equal the route's JSON (the `stub` provider row among them), the
// passes <details> opens, Re-check re-fetches the four URLs, every request the page makes goes to
// the CRT origin, the tube does not animate under reduced motion, Tab reaches Open → Re-check →
// Docs with a visible ring, the overlay is never mounted, and the route itself answers within 2 s,
// caches 5 s and refuses an Origin. Ports: the shared servers only (nothing is started here).

const ACCENT = "rgb(255, 61, 113)";

type Row = { status: string; name: string; detail: string };

/** The rows as the page shows them: the problems table (if any), then the collapsed passes, each row as the doctor's triple. */
async function pageRows(page: Page): Promise<{ problems: Row[]; passes: Row[]; attention: Row[] }> {
  const read = async (sel: string): Promise<Row[]> =>
    page.locator(`${sel} tr.row`).evaluateAll((trs) =>
      trs.map((tr) => ({
        status: tr.querySelector("td.st")!.textContent!.trim(),
        name: tr.querySelector("td.nm")!.textContent!.trim(),
        detail: tr.querySelector("td.dt")!.textContent!.trim(),
      })),
    );
  return {
    problems: await read("#rows > table"),
    passes: await read("#rows details"),
    attention: await read("#attention"),
  };
}

test.describe("the landing page on the stub server (F-114, N-23)", () => {
  test("renders the Checkup rows the doctor route serves — problems first, the passes collapsed, the self port row and the stub provider — and never mounts the overlay (F-113, F-114)", async ({ page, request }) => {
    await page.goto(`${CRT_ORIGIN}/`);
    await expect(page).toHaveTitle(/^CRT \d+\.\d+\.\d+/);
    await expect(page.locator(".kicker")).toHaveText("This is the CRT server — not your app.");
    await expect(page.locator("h1")).toHaveText("Your app is at localhost:3999");
    await expect(page.locator("#open")).toHaveAttribute("href", FIXTURE_ORIGIN);
    // The script's first round: the fast rows, then the plugin row (the slow one, its own request).
    await expect(page.locator("#checked")).toHaveText(/^checked at \d\d:\d\d$/);
    await expect(page.locator("#rows tr.row td.nm", { hasText: /^plugin$/ })).toHaveCount(1, { timeout: 15_000 });

    // The same facts, from the route: inside its 5 s / 30 s caches, so the rows are identical.
    const res = await request.get(`${CRT_ORIGIN}/__crt/doctor?plugin=1`);
    expect(res.status()).toBe(200);
    const doctor = (await res.json()) as DoctorPayload;
    const { problems, passes, attention } = await pageRows(page);
    const bad = doctor.rows.filter((r) => r.status === "FAIL" || r.status === "warn");
    expect(problems).toEqual([...bad.filter((r) => r.status === "FAIL"), ...bad.filter((r) => r.status === "warn")]);
    expect(passes).toEqual(doctor.rows.filter((r) => r.status === "ok" || r.status === "--"));
    // Attention carries exactly the problem rows and is hidden when there are none.
    expect(attention).toEqual(problems);
    expect(await page.locator("#attention").isHidden()).toBe(bad.length === 0);
    const byName = Object.fromEntries(doctor.rows.map((r) => [r.name, r]));
    expect(byName.port).toEqual({ status: "ok", name: "port", detail: `${new URL(CRT_ORIGIN).port} — this server` });
    expect(byName.mode).toMatchObject({ status: "ok", name: "mode" });
    expect(byName.mode!.detail).toMatch(/^embedded/); // the scratch config may or may not name the mode
    expect(byName.target).toEqual({ status: "ok", name: "target", detail: `${FIXTURE_ORIGIN} (found) — responding` });
    expect(byName.stub).toMatchObject({ status: "ok", name: "stub" });
    expect(byName.plugin).toBeDefined();
    await expect(page.locator(".decision")).toHaveText(doctor.decision);
    await expect(page.locator(".decision")).toHaveText("→ stub (CRT_SESSION_STUB)");
    // The passes <details> opens onto the ok and -- rows in the doctor's order.
    const details = page.locator("#rows details");
    await expect(details).not.toHaveAttribute("open", "");
    await expect(details.locator("tr.row").first()).toBeHidden();
    await details.locator("summary").click();
    await expect(details).toHaveAttribute("open", "");
    await expect(details.locator("tr.row").first()).toBeVisible();
    await expect(details.locator("summary")).toHaveText(`${passes.filter((r) => r.status === "ok").length} checks pass — same rows as crt doctor`);
    // This server: the stub's line, the agent's name in card 2 (F-64: the chrome stays CRT).
    await expect(page.locator("#agents li", { hasText: "default" })).toHaveCount(1);
    await expect(page.locator("#agent")).not.toHaveText("the agent");
    await expect(page.locator("#crt-host")).toHaveCount(0);
  });

  test("Re-check re-fetches the four URLs (the providers with a fresh preflight) and names what changed; every request the page makes goes to the CRT origin (N-23)", async ({ page }) => {
    const urls: string[] = [];
    page.on("request", (r) => urls.push(r.url()));
    await page.goto(`${CRT_ORIGIN}/`);
    await expect(page.locator("#rows tr.row td.nm", { hasText: /^plugin$/ })).toHaveCount(1, { timeout: 15_000 });
    await expect(page.locator("#recheck")).toBeEnabled();
    const before = urls.length;
    // Headless Chromium may or may not ask for the favicon; the list is about everything else.
    const paths = (from: number) => urls.slice(from).map((u) => new URL(u).pathname + new URL(u).search).filter((p) => !/favicon/.test(p)).sort();
    expect(paths(0)).toEqual(["/", "/__crt/doctor", "/__crt/doctor?plugin=1", "/__crt/health", "/__crt/providers"]);
    await page.locator("#recheck").click();
    await expect(page.locator("#checked")).toHaveText(/^checked at \d\d:\d\d · no change$/);
    await expect(page.locator("#recheck")).toBeEnabled();
    // Re-check asks for a fresh preflight first (F-56), then the rest.
    expect(paths(before)).toEqual(["/__crt/doctor", "/__crt/doctor?plugin=1", "/__crt/health", "/__crt/providers?refresh=1"]);
    // Nothing left the CRT origin — not the favicon, not a font, nothing.
    for (const u of urls) expect(new URL(u).origin, u).toBe(CRT_ORIGIN);
    // The docs link is a navigation only: present, never fetched.
    await expect(page.locator("#docs")).toHaveAttribute("href", "https://github.com/simv/crt#readme");
    expect(urls.some((u) => u.includes("github.com"))).toBe(false);
  });

  test("Tab reaches Open → Re-check → Docs, each with the 2 px accent ring (N-25)", async ({ page }) => {
    await page.goto(`${CRT_ORIGIN}/`);
    await expect(page.locator("#checked")).toHaveText(/^checked at/);
    await expect(page.locator("#recheck")).toBeEnabled();
    const reached: string[] = [];
    for (let i = 0; i < 40 && !reached.includes("docs"); i++) {
      await page.keyboard.press("Tab");
      const focused = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        return { id: el.id, outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, offset: cs.outlineOffset };
      });
      if (!focused) continue;
      expect(focused.outline, focused.id).toBe(`solid 2px ${ACCENT}`);
      expect(focused.offset).toBe("2px");
      if (["open", "recheck", "docs"].includes(focused.id)) reached.push(focused.id);
    }
    expect(reached).toEqual(["open", "recheck", "docs"]);
  });

  test("GET /__crt/doctor answers within 2 s without ?plugin=1, caches 5 s, and refuses an Origin (F-113, N-24)", async ({ request }) => {
    const started = Date.now();
    const a = await request.get(`${CRT_ORIGIN}/__crt/doctor`);
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(a.status()).toBe(200);
    const first = (await a.json()) as DoctorPayload;
    expect(first.rows.find((r) => r.name === "plugin")).toBeUndefined();
    const b = (await (await request.get(`${CRT_ORIGIN}/__crt/doctor`)).json()) as DoctorPayload;
    expect(b.checkedAt).toBe(first.checkedAt);
    expect((await request.get(`${CRT_ORIGIN}/__crt/doctor`, { headers: { origin: FIXTURE_ORIGIN } })).status()).toBe(403);
    expect((await request.get(`${CRT_ORIGIN}/__crt/doctor`, { headers: { origin: CRT_ORIGIN } })).status()).toBe(403);
    expect((await request.post(`${CRT_ORIGIN}/__crt/doctor`)).status()).toBe(405);
  });
});

test.describe("under prefers-reduced-motion (N-25)", () => {
  test.use({ reducedMotion: "reduce" });

  test("the tube does not animate: its computed animation-name is none (N-25)", async ({ page }) => {
    await page.goto(`${CRT_ORIGIN}/`);
    expect(await page.locator(".tube").evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
    expect(await page.locator(".tube").evaluate((el) => getComputedStyle(el).opacity)).toBe("1");
  });
});

test.describe("without reduced motion", () => {
  test.use({ reducedMotion: "no-preference" });

  test("the tube powers on once per load, by opacity, within 1.2 s (N-25)", async ({ page }) => {
    await page.goto(`${CRT_ORIGIN}/`);
    expect(await page.locator(".tube").evaluate((el) => getComputedStyle(el).animationName)).toBe("power-on");
    expect(Number.parseFloat(await page.locator(".tube").evaluate((el) => getComputedStyle(el).animationDuration))).toBeLessThanOrEqual(1.2);
    await expect.poll(() => page.locator(".tube").evaluate((el) => getComputedStyle(el).opacity), { timeout: 3_000 }).toBe("1");
  });
});
