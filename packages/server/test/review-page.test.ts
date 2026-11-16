import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { currentReview, readReview } from "../src/home.js";
import { LANDING_TOKENS } from "../src/landing.js";
import { createProxyServer } from "../src/proxy.js";
import { reviewView } from "../src/review.js";
import {
  groupByRoute,
  moveGroup,
  moveItem,
  parseItemPatch,
  renderReviewPage,
  REVIEW_ASSETS_PATH,
  REVIEW_GROUPS_PATH,
  REVIEW_ITEMS_PATH,
  REVIEW_PAGE_CSP,
  REVIEW_PATH,
  type ReviewEntry,
  type ReviewPagePayload,
  reviewRequestAllowed,
  setKeep,
} from "../src/review-page.js";
import { findCrtFor } from "../src/serve.js";
import { openStore } from "../src/store.js";
import { type NewTaskInput, parseTask, setTaskPriority, taskSummaryText, validateTaskText } from "../src/tasks.js";
import { apiAt, listen0 } from "./helpers/http.js";
import { samplePost } from "./helpers/sample-capture.js";

// PRD-zero F-135 (M30): the review page — its pure reducers, who may call its routes, what a change
// writes (keep and order to review.json, a priority to the task file) and the page itself. Always
// under a temp `CRT_HOME`.

const NOW = new Date(2026, 10, 16, 9, 30, 0);
const LATER = new Date(2026, 10, 16, 14, 5, 0);

const entry = (id: string, route: string | null, keep = true): ReviewEntry => ({ id, keep, route });
const ids = (items: ReviewEntry[] | null) => items?.map((i) => i.id);

describe("the reducers (F-135)", () => {
  /** Filed in this order: two routes interleaved, and one item with no route. */
  const filed = [entry("R-01", "/cart"), entry("R-02", "/checkout"), entry("R-03", "/cart"), entry("R-04", null), entry("R-05", "/cart")];

  it("groups by route in the order of each route's first item, items in the order filed (F-135)", () => {
    expect(groupByRoute(filed).map((g) => [g.route, g.items.map((i) => i.id)])).toEqual([
      ["/cart", ["R-01", "R-03", "R-05"]],
      ["/checkout", ["R-02"]],
      [null, ["R-04"]],
    ]);
    expect(groupByRoute([])).toEqual([]);
  });

  it("drops an item and keeps it again without moving anything (F-135)", () => {
    const dropped = setKeep(filed, "R-03", false)!;
    expect(dropped.map((i) => [i.id, i.keep])).toEqual([["R-01", true], ["R-02", true], ["R-03", false], ["R-04", true], ["R-05", true]]);
    expect(filed[2]!.keep).toBe(true); // the input is not touched
    expect(setKeep(dropped, "R-03", true)).toEqual(filed);
    expect(setKeep(filed, "R-99", false)).toBeNull();
  });

  it("moves an item a step within its group, across the other groups' items between them (F-135)", () => {
    // R-03 changes places with R-01, the nearest /cart item above it; R-02 (/checkout) stays where it is.
    expect(ids(moveItem(filed, "R-03", "up"))).toEqual(["R-03", "R-02", "R-01", "R-04", "R-05"]);
    // … and down, with R-05, over R-04.
    expect(ids(moveItem(filed, "R-03", "down"))).toEqual(["R-01", "R-02", "R-05", "R-04", "R-03"]);
    // The groups keep their order either way.
    for (const moved of [moveItem(filed, "R-03", "up")!, moveItem(filed, "R-05", "up")!, moveItem(filed, "R-01", "down")!]) {
      expect(groupByRoute(moved).map((g) => g.route)).toEqual(["/cart", "/checkout", null]);
    }
    expect(groupByRoute(moveItem(filed, "R-05", "up")!)[0]!.items.map((i) => i.id)).toEqual(["R-01", "R-05", "R-03"]);
  });

  it("leaves the order alone at the edge of a group, and knows an item that is not there (F-135)", () => {
    expect(ids(moveItem(filed, "R-01", "up"))).toEqual(ids(filed));
    expect(ids(moveItem(filed, "R-05", "down"))).toEqual(ids(filed));
    expect(ids(moveItem(filed, "R-02", "up"))).toEqual(ids(filed)); // alone in its group
    expect(moveItem(filed, "R-99", "up")).toBeNull();
  });

  it("moves a group as a whole and lays the groups end to end (F-135)", () => {
    expect(ids(moveGroup(filed, "/checkout", "up"))).toEqual(["R-02", "R-01", "R-03", "R-05", "R-04"]);
    expect(ids(moveGroup(filed, "/cart", "down"))).toEqual(["R-02", "R-01", "R-03", "R-05", "R-04"]);
    expect(ids(moveGroup(filed, null, "up"))).toEqual(["R-01", "R-03", "R-05", "R-04", "R-02"]);
    // At the edge the order of the groups stays; the items still come out grouped.
    expect(ids(moveGroup(filed, "/cart", "up"))).toEqual(["R-01", "R-03", "R-05", "R-02", "R-04"]);
    expect(ids(moveGroup(filed, null, "down"))).toEqual(["R-01", "R-03", "R-05", "R-02", "R-04"]);
    expect(moveGroup(filed, "/nowhere", "up")).toBeNull();
    // A dropped item moves with its group and stays dropped.
    expect(moveGroup(setKeep(filed, "R-02", false)!, "/checkout", "up")![0]).toEqual(entry("R-02", "/checkout", false));
  });

  it("accepts keep, priority and move in a PATCH body and nothing else (F-135)", () => {
    expect(parseItemPatch({ keep: false })).toEqual({ keep: false });
    expect(parseItemPatch({ priority: "high", move: "up" })).toEqual({ priority: "high", move: "up" });
    for (const bad of [null, [], {}, { keep: "no" }, { priority: "urgent" }, { move: "left" }, { keep: true, status: "done" }, "keep"]) {
      expect(typeof parseItemPatch(bad)).toBe("string");
    }
  });
});

describe("who may call the review routes (F-135)", () => {
  const req = (headers: Record<string, string>) => ({ headers });

  it("lets the page itself and a local process through (F-135)", () => {
    expect(reviewRequestAllowed(req({ host: "localhost:4400" }))).toBe(true); // a navigation, or a Node process
    expect(reviewRequestAllowed(req({ host: "127.0.0.1:4400" }))).toBe(true);
    expect(reviewRequestAllowed(req({ host: "localhost:4400", origin: "http://localhost:4400", "sec-fetch-site": "same-origin" }))).toBe(true); // the page's PATCH
    expect(reviewRequestAllowed(req({ host: "localhost:4400", "sec-fetch-site": "none" }))).toBe(true); // typed in the address bar
  });

  it("refuses another origin, another site, and a host that is not loopback (F-135)", () => {
    expect(reviewRequestAllowed(req({ host: "localhost:4400", origin: "http://localhost:3000" }))).toBe(false); // the app's own page
    expect(reviewRequestAllowed(req({ host: "localhost:4400", origin: "http://127.0.0.1:4400" }))).toBe(false); // not the origin it was served from
    expect(reviewRequestAllowed(req({ host: "localhost:4400", origin: "https://example.com" }))).toBe(false);
    expect(reviewRequestAllowed(req({ host: "localhost:4400", origin: "null" }))).toBe(false); // a sandboxed frame
    expect(reviewRequestAllowed(req({ host: "localhost:4400", "sec-fetch-site": "same-site" }))).toBe(false); // an <img> on localhost:3000
    expect(reviewRequestAllowed(req({ host: "localhost:4400", "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(reviewRequestAllowed(req({ host: "evil.example:4400", origin: "http://evil.example:4400" }))).toBe(false); // a rebound name
    expect(reviewRequestAllowed(req({}))).toBe(false);
  });
});

describe("the review routes (F-135)", () => {
  let home: string;
  let root: string;
  let env: NodeJS.ProcessEnv;
  let server: Awaited<ReturnType<typeof listen0>>;
  let api: ReturnType<typeof apiAt>;

  const task = (over: Partial<NewTaskInput> = {}): NewTaskInput => ({
    title: "Cart total excludes applied discount",
    summary: "The total ignores the discount.\n\nA second paragraph the list does not show.",
    context: "Reproduce at /cart?promo=SAVE10.",
    ask: "Apply the discount to the total.",
    definitionOfDone: ["Total applies the discount"],
    session: null,
    provider: "stub",
    ...over,
  });

  /** R-01 (/cart), R-02 (/checkout), R-03 (/cart) — each from a capture, so with screenshots — and R-04 (no capture: no route, no screenshot). */
  function seed(): void {
    const store = openStore({ root, env });
    const from = (route: string, over: Partial<NewTaskInput>) => {
      const post = samplePost();
      post.bundle.framework.route = route;
      store.createTask(task({ captureId: store.writeCapture(post, NOW).id, ...over }), NOW);
    };
    from("/cart", {});
    from("/checkout", { title: "Pay button is off-centre" });
    from("/cart", { title: "Empty cart has no message" });
    store.createTask(task({ title: "Footer year is stale" }), NOW);
  }
  const review = () => currentReview(root, env)!;
  const order = () => reviewView(review()).items.map((i) => `${i.id}${i.keep ? "" : "!"}`);
  const groups = (json: Record<string, unknown>) => (json as unknown as ReviewPagePayload).groups.map((g) => [g.route, g.items.map((i) => i.id)]);

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "crt-home-"));
    root = mkdtempSync(join(tmpdir(), "crt-proj-"));
    mkdirSync(join(root, ".git"));
    env = { CRT_HOME: home };
    server = await listen0(createProxyServer({ target: null, mode: "embedded", projectRoot: root, overlayPath: join(root, "overlay.js"), version: "0.8.0", env, now: () => LATER }));
    api = apiAt(() => server.origin);
  });
  afterEach(async () => {
    await server.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  });

  it("answers with no review as an empty list and the F-135 line, and creates nothing (F-135)", async () => {
    const r = await api("GET", REVIEW_ITEMS_PATH);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      ok: true,
      review: null,
      message: `crt: no review for ${root} yet — run \`crt\`, send some feedback, then \`crt review\``,
      project: root,
      totals: { items: 0, kept: 0, routes: 0 },
      totalsLine: "0 items · 0 kept · 0 routes",
      groups: [],
      handoff: "crt handoff",
    });
    expect((await api("PATCH", `${REVIEW_ITEMS_PATH}/R-01`, { keep: false })).status).toBe(404);
    expect((await api("PATCH", REVIEW_GROUPS_PATH, { route: "/cart", move: "up" })).status).toBe(404);
    expect(currentReview(root, env)).toBeNull();
  });

  it("lists the review grouped by route with each item's summary, screenshot and reviewed commit (F-135)", async () => {
    seed();
    const { json } = await api("GET", REVIEW_ITEMS_PATH);
    const payload = json as unknown as ReviewPagePayload;
    expect(payload).toMatchObject({ ok: true, review: review().name, message: null, totals: { items: 4, kept: 4, routes: 3 }, totalsLine: "4 items · 4 kept · 3 routes" });
    expect(groups(json)).toEqual([
      ["/cart", ["R-01", "R-03"]],
      ["/checkout", ["R-02"]],
      [null, ["R-04"]],
    ]);
    expect(payload.groups[0]!.items[0]).toMatchObject({ id: "R-01", keep: true, priority: "normal", title: "Cart total excludes applied discount", summary: "The total ignores the discount.", screenshot: "viewport-annotated.png", route: "/cart" });
    expect(payload.groups[2]!.items[0]).toMatchObject({ id: "R-04", route: null, screenshot: null });
  });

  it("keeps, drops and moves in review.json at once, and never touches a task file for it (F-135)", async () => {
    seed();
    const file = join(reviewView(review()).tasksDir, "R-03-empty-cart-has-no-message.md");
    const before = readFileSync(file, "utf8");

    const dropped = await api("PATCH", `${REVIEW_ITEMS_PATH}/R-03`, { keep: false });
    expect(dropped.status).toBe(200);
    expect(dropped.json).toMatchObject({ totals: { items: 4, kept: 3, routes: 3 } });
    expect(order()).toEqual(["R-01", "R-02", "R-03!", "R-04"]);

    expect(groups((await api("PATCH", `${REVIEW_ITEMS_PATH}/R-03`, { move: "up" })).json)[0]).toEqual(["/cart", ["R-03", "R-01"]]);
    expect(order()).toEqual(["R-03!", "R-02", "R-01", "R-04"]);
    // At the top of its group a move changes nothing and is not an error.
    expect((await api("PATCH", `${REVIEW_ITEMS_PATH}/R-03`, { move: "up" })).status).toBe(200);
    expect(order()).toEqual(["R-03!", "R-02", "R-01", "R-04"]);

    expect(groups((await api("PATCH", REVIEW_GROUPS_PATH, { route: null, move: "up" })).json).map((g) => g[0])).toEqual(["/cart", null, "/checkout"]);
    expect(order()).toEqual(["R-03!", "R-01", "R-04", "R-02"]);
    expect(readReview(review().dir)!.items).toEqual([
      { id: "R-03", keep: false, order: 1 },
      { id: "R-01", keep: true, order: 2 },
      { id: "R-04", keep: true, order: 3 },
      { id: "R-02", keep: true, order: 4 },
    ]);

    expect((await api("PATCH", `${REVIEW_ITEMS_PATH}/R-03`, { keep: true })).json).toMatchObject({ totals: { kept: 4 } });
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("a priority change rewrites priority and updated in the task file, appends a Log line and leaves the rest (F-135)", async () => {
    seed();
    const tasksDir = reviewView(review()).tasksDir;
    const file = join(tasksDir, "R-02-pay-button-is-off-centre.md");
    const before = readFileSync(file, "utf8");
    const manifest = readFileSync(join(review().dir, "review.json"), "utf8");

    const r = await api("PATCH", `${REVIEW_ITEMS_PATH}/R-02`, { priority: "high" });
    expect(r.status).toBe(200);
    expect((r.json as unknown as ReviewPagePayload).groups[1]!.items[0]).toMatchObject({ id: "R-02", priority: "high" });

    const after = readFileSync(file, "utf8");
    expect(validateTaskText(after, "R-02-pay-button-is-off-centre.md")).toEqual([]);
    const parsed = parseTask(after, "R-02-pay-button-is-off-centre.md");
    expect(parsed.frontmatter).toMatchObject({ priority: "high", created: parseTask(before).frontmatter.created });
    expect(parsed.frontmatter.updated).toMatch(/^2026-11-16T14:05:00/);
    expect(after.split("\n").at(-2)).toMatch(/^- 2026-11-16T14:05[+-]\d\d:\d\d — priority normal → high, set on the review page \(`crt review`\)\.$/);
    // Only those two frontmatter lines changed, and one line was added.
    const changed = before.split("\n").slice(0, -1).filter((line, i) => line !== after.split("\n")[i]);
    expect(changed.map((l) => l.split(":")[0])).toEqual(["priority", "updated"]);
    expect(after.split("\n").length).toBe(before.split("\n").length + 1);
    expect(readFileSync(join(tasksDir, "README.md"), "utf8")).toContain("| [R-02](R-02-pay-button-is-off-centre.md) | backlog | high |");
    expect(readFileSync(join(review().dir, "review.json"), "utf8")).toBe(manifest);

    // The same priority again writes nothing.
    await api("PATCH", `${REVIEW_ITEMS_PATH}/R-02`, { priority: "high" });
    expect(readFileSync(file, "utf8")).toBe(after);
  });

  it("refuses a body it does not understand, an unknown item and a wrong method (F-135)", async () => {
    seed();
    expect((await api("PATCH", `${REVIEW_ITEMS_PATH}/R-01`, { keep: "no" })).status).toBe(400);
    expect((await api("PATCH", `${REVIEW_ITEMS_PATH}/R-01`, {})).status).toBe(400);
    expect((await api("PATCH", `${REVIEW_ITEMS_PATH}/R-01`, { priority: "urgent" })).status).toBe(400);
    expect((await api("PATCH", `${REVIEW_ITEMS_PATH}/R-09`, { keep: false })).status).toBe(404);
    expect((await api("PATCH", `${REVIEW_ITEMS_PATH}/..%2Freview.json`, { keep: false })).status).toBe(404);
    expect((await api("PATCH", REVIEW_GROUPS_PATH, { route: "/cart" })).status).toBe(400);
    expect((await api("PATCH", REVIEW_GROUPS_PATH, { route: "/nowhere", move: "up" })).status).toBe(404);
    expect((await api("POST", REVIEW_ITEMS_PATH, {})).status).toBe(405);
    expect((await api("GET", `${REVIEW_ITEMS_PATH}/R-01`)).status).toBe(405);
    expect((await api("DELETE", REVIEW_PATH)).status).toBe(405);
    expect((await api("GET", `${REVIEW_PATH}/nothing`)).status).toBe(404);
    expect(order()).toEqual(["R-01", "R-02", "R-03", "R-04"]);
  });

  it("refuses a foreign Origin on every review route, before anything is read or written (F-135)", async () => {
    seed();
    const routes: Array<[string, string, unknown?]> = [
      ["GET", REVIEW_PATH],
      ["GET", REVIEW_ITEMS_PATH],
      ["PATCH", `${REVIEW_ITEMS_PATH}/R-01`, { keep: false }],
      ["PATCH", REVIEW_GROUPS_PATH, { route: "/checkout", move: "up" }],
      ["GET", `${REVIEW_ASSETS_PATH}/R-01/viewport-annotated.png`],
      ["OPTIONS", `${REVIEW_ITEMS_PATH}/R-01`],
    ];
    const foreigners: Record<string, string>[] = [{ origin: "http://localhost:3000" }, { origin: "https://example.com" }, { "sec-fetch-site": "same-site" }];
    for (const foreign of foreigners) {
      for (const [method, path, body] of routes) {
        const res = await fetch(server.origin + path, { method, headers: { ...foreign, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
        expect([method, path, res.status]).toEqual([method, path, 403]);
        // No CORS answer either: a loopback app origin gets headers on the overlay's routes, never here.
        expect(res.headers.get("access-control-allow-origin")).toBeNull();
      }
    }
    expect(order()).toEqual(["R-01", "R-02", "R-03", "R-04"]);
    // The server's own origin — what the page's fetch sends — goes through.
    expect((await api("PATCH", `${REVIEW_ITEMS_PATH}/R-01`, { keep: false }, { origin: server.origin, "sec-fetch-site": "same-origin" })).status).toBe(200);
    expect(order()).toEqual(["R-01!", "R-02", "R-03", "R-04"]);
  });

  it("serves a screenshot by item id and file name only, never by path (F-135)", async () => {
    seed();
    const shot = await fetch(`${server.origin}${REVIEW_ASSETS_PATH}/R-01/viewport-annotated.png`);
    expect([shot.status, shot.headers.get("content-type"), shot.headers.get("x-content-type-options")]).toEqual([200, "image/png", "nosniff"]);
    expect(Buffer.from(await shot.arrayBuffer()).equals(readFileSync(join(reviewView(review()).tasksDir, "assets", "R-01", "viewport-annotated.png")))).toBe(true);
    // A secret beside the review, and every way a name could try to reach it or anything else.
    writeFileSync(join(review().dir, "secret.png"), "nope");
    for (const rest of [
      "R-01/capture.json", // not an image
      "R-01/..%2F..%2F..%2Fsecret.png",
      "R-01/%2E%2E/%2E%2E/%2E%2E/secret.png",
      "R-01/..%5C..%5C..%5Csecret.png",
      "..%2F..%2Fsecret.png",
      "R-01/sub/viewport.png",
      "R-01",
      "R-01/",
      "R-09/viewport.png",
      "assets/R-01/viewport.png",
      "R-01/%ZZ.png",
      "R-01/.png",
    ]) {
      const res = await fetch(`${server.origin}${REVIEW_ASSETS_PATH}/${rest}`);
      expect([rest, res.status]).toEqual([rest, 404]);
    }
  });

  it("serves the page under its own policy, with the overlay's colours and nothing from another origin (F-135)", async () => {
    const res = await fetch(server.origin + REVIEW_PATH);
    const html = await res.text();
    expect([res.status, res.headers.get("content-type"), res.headers.get("cache-control"), res.headers.get("content-security-policy")]).toEqual([200, "text/html; charset=utf-8", "no-store", REVIEW_PAGE_CSP]);
    expect(REVIEW_PAGE_CSP).toContain("frame-ancestors 'none'");
    expect(html).toBe(renderReviewPage({ version: "0.8.0", projectRoot: root }));
    expect(html).toContain('<main id="review" data-state="loading"></main>');
    expect(html).toContain("<noscript><p>Run <code>crt review</code> in a terminal for this list.</p></noscript>");
    expect(html).toContain(`--accent:${LANDING_TOKENS.ACCENT}`);
    expect(html).toContain(`--ink:${LANDING_TOKENS.INK}`);
    // No external request: every URL in the page is its own.
    expect(html.match(/https?:\/\/[^\s"'<)]+/g) ?? []).toEqual([]);
    expect(html.match(/(?:src|href)="[^"]+"/g)).toEqual(['href="/__crt/favicon.svg"', 'href="/__crt/"']);
    expect(Buffer.byteLength(html)).toBeLessThan(32 * 1024);
    // A project path is text, never markup.
    expect(renderReviewPage({ version: null, projectRoot: 'C:\\a<b>"c' })).toContain("C:\\a&lt;b&gt;&quot;c");
  });
});

describe("what the page's changes rest on (F-135)", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "crt-tasks-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("setTaskPriority knows a missing file and a file without frontmatter (F-135)", () => {
    expect(setTaskPriority(dir, "R-01", "high")).toBeNull();
    writeFileSync(join(dir, "R-01-x.md"), "no frontmatter\n");
    expect(setTaskPriority(dir, "R-01", "high")).toBeNull();
    expect(readFileSync(join(dir, "R-01-x.md"), "utf8")).toBe("no frontmatter\n");
  });

  it("taskSummaryText is the first paragraph of the Summary on one line (F-135)", () => {
    writeFileSync(join(dir, "a.md"), "---\nid: R-01\n---\n\n## Summary\nFirst line\nwraps here.\n\nSecond paragraph.\n\n## Context\nnot this\n");
    expect(taskSummaryText(join(dir, "a.md"))).toBe("First line wraps here.");
    expect(taskSummaryText(join(dir, "a.md"), 12)).toBe("First line…");
    writeFileSync(join(dir, "b.md"), "## Summary\nLast section, no other heading.\n");
    expect(taskSummaryText(join(dir, "b.md"))).toBe("Last section, no other heading.");
    expect(taskSummaryText(join(dir, "missing.md"))).toBe("");
  });
});

describe("crt review finds the server to open its page on (F-135)", () => {
  it("the CRT serving this project, in either mode, on the port or one a start stepped to (F-135)", async () => {
    const health = (projectRoot: string, mode: "embedded" | "proxy" = "embedded") => ({ version: "0.8.0", startedAt: null, target: null, projectRoot, sessions: 0, mode });
    const probed: number[] = [];
    const on = (map: Record<number, ReturnType<typeof health>>) => async (port: number) => {
      probed.push(port);
      return map[port] ?? null;
    };
    expect(await findCrtFor("/work/app", 4400, on({ 4400: health("/work/app", "proxy") }))).toMatchObject({ port: 4400, url: "http://localhost:4400" });
    // Another project's CRT holds 4400; this project's stepped to 4401.
    expect(await findCrtFor("/work/app", 4400, on({ 4400: health("/work/other"), 4401: health("/work/app") }))).toMatchObject({ port: 4401 });
    probed.length = 0;
    expect(await findCrtFor("/work/app", 4400, on({ 4400: health("/work/other") }))).toBeNull();
    expect(probed).toEqual([4400, 4401, 4402, 4403, 4404, 4405, 4406, 4407, 4408, 4409]);
  });
});
