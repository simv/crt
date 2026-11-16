import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  addReviewItem,
  announceOnce,
  createReview,
  crtHome,
  currentReview,
  ensureDir,
  ensureProjectHome,
  freeReviewName,
  guestConfigPath,
  listReviews,
  projectKey,
  projectReviewsDir,
  readReview,
  reviewCapturesDir,
  reviewDate,
  reviewTasksDir,
  writeReview,
} from "../src/home.js";

// PRD-zero F-130, F-133: the CRT home's layout and the review files, always under a temp home.

let home: string;
let root: string;
let env: NodeJS.ProcessEnv;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "crt-home-"));
  root = mkdtempSync(join(tmpdir(), "crt-proj-"));
  env = { CRT_HOME: home };
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

const NOW = new Date(2026, 10, 16, 9, 30, 0);

describe("the CRT home (F-130, N-34)", () => {
  it("refuses the real home under a test runner, so a test that forgot CRT_HOME fails (N-34)", () => {
    expect(() => crtHome({ VITEST: "true" })).toThrow(/CRT_HOME is not set/);
    expect(crtHome({ VITEST: "true", CRT_HOME: home })).toBe(home);
    // The suite's own worker has one (test/helpers/setup.ts), and it is not the developer's.
    expect(crtHome()).toContain("crt-home-");
  });

  it("a project's reviews, its guest config and a review's folders sit where §5.3 puts them (F-130)", () => {
    const base = join(home, "reviews", projectKey(root));
    expect(projectReviewsDir(root, env)).toBe(base);
    expect(guestConfigPath(root, env)).toBe(join(base, "config.local.json"));
    expect(reviewTasksDir(join(base, "2026-11-16"))).toBe(join(base, "2026-11-16", "tasks"));
    expect(reviewCapturesDir(join(base, "2026-11-16"))).toBe(join(base, "2026-11-16", "captures"));
  });

  it("ensureDir reports the outermost directory it had to create, and nothing when it was there (N-34)", () => {
    const made: string[] = [];
    ensureDir(join(home, "a", "b", "c"), (p) => made.push(p));
    ensureDir(join(home, "a", "b", "c"), (p) => made.push(p));
    ensureDir(join(home, "a", "d"), (p) => made.push(p));
    expect(made).toEqual([join(home, "a"), join(home, "a", "d")]);
  });

  it("announceOnce says `crt: created <path>` for the first creation of a run and nothing after (N-34)", () => {
    const lines: string[] = [];
    const announce = announceOnce((l) => lines.push(l));
    announce(join(home, "reviews"));
    announce(join(home, "browser"));
    expect(lines).toEqual([`crt: created ${join(home, "reviews")}`]);
  });

  it("ensureProjectHome writes project.json once: the checkout, its remote, its name (F-130)", () => {
    const dir = ensureProjectHome(root, { env, remote: "git@github.com:me/app.git" });
    const file = join(dir, "project.json");
    const first = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    expect(first).toMatchObject({ root, remote: "git@github.com:me/app.git" });
    expect(typeof first.name).toBe("string");
    ensureProjectHome(root, { env, remote: null });
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(first);
  });
});

describe("reviews (F-133)", () => {
  it("a new review is named after the local date, holds tasks/ and captures/, and its manifest is the F-133 shape (F-133)", () => {
    expect(currentReview(root, env)).toBeNull();
    const review = createReview(root, undefined, { env, now: NOW, created: "2026-11-16T09:30:00+08:00", remote: "git@github.com:me/app.git" });
    expect(review.name).toBe("2026-11-16");
    expect(reviewDate(NOW)).toBe("2026-11-16");
    expect(existsSync(reviewTasksDir(review.dir))).toBe(true);
    expect(existsSync(reviewCapturesDir(review.dir))).toBe(true);
    expect(JSON.parse(readFileSync(join(review.dir, "review.json"), "utf8"))).toEqual({
      name: "2026-11-16",
      status: "open",
      created: "2026-11-16T09:30:00+08:00",
      project: { root, remote: "git@github.com:me/app.git" },
      items: [],
      handovers: [],
    });
    expect(readFileSync(join(review.dir, "review.json"), "utf8").endsWith("}\n")).toBe(true);
    expect(currentReview(root, env)?.name).toBe("2026-11-16");
  });

  it("a clash gets -2, then -3; a given name is used as it is, and suffixed the same way (F-133)", () => {
    const names = [1, 2, 3].map(() => createReview(root, undefined, { env, now: NOW }).name);
    expect(names).toEqual(["2026-11-16", "2026-11-16-2", "2026-11-16-3"]);
    expect(createReview(root, "sprint-12", { env, now: NOW }).name).toBe("sprint-12");
    expect(createReview(root, "sprint-12", { env, now: NOW }).name).toBe("sprint-12-2");
    expect(freeReviewName(root, undefined, env, NOW)).toBe("2026-11-16-4");
  });

  it("a name is [a-z0-9][a-z0-9-]*: anything else is refused before a folder exists (F-133)", () => {
    for (const bad of ["Sprint", "-x", "a b", "../up", "a/b", "", "review.json"]) {
      expect(() => createReview(root, bad, { env }), bad).toThrow(/a review name is/);
    }
    expect(listReviews(root, env)).toEqual([]);
  });

  it("the current review is the newest open one; a handed review is listed and never current (F-133)", () => {
    const first = createReview(root, "one", { env, created: "2026-11-14T10:00:00+08:00" });
    const second = createReview(root, "two", { env, created: "2026-11-15T10:00:00+08:00" });
    expect(listReviews(root, env).map((r) => r.name)).toEqual(["one", "two"]);
    expect(currentReview(root, env)?.name).toBe("two");
    writeReview(second.dir, { ...second.manifest, status: "handed" });
    expect(currentReview(root, env)?.name).toBe("one");
    writeReview(first.dir, { ...first.manifest, status: "handed" });
    expect(currentReview(root, env)).toBeNull();
    expect(listReviews(root, env).map((r) => `${r.name}:${r.manifest.status}`)).toEqual(["one:handed", "two:handed"]);
  });

  it("review.json is replaced through a temp file: no partial file and nothing left beside it (F-133)", () => {
    const review = createReview(root, "atomic", { env });
    for (let n = 1; n <= 5; n++) addReviewItem(review.dir, `R-0${n}`);
    expect(readdirSync(review.dir).sort()).toEqual(["captures", "review.json", "tasks"]);
    expect(readReview(review.dir)?.items).toEqual([1, 2, 3, 4, 5].map((n) => ({ id: `R-0${n}`, keep: true, order: n })));
  });

  it("an item joins once, kept, after the last; a manifest with junk in it still reads (F-133)", () => {
    const review = createReview(root, "items", { env });
    addReviewItem(review.dir, "R-01");
    addReviewItem(review.dir, "R-01");
    expect(readReview(review.dir)?.items).toEqual([{ id: "R-01", keep: true, order: 1 }]);
    writeFileSync(join(review.dir, "review.json"), JSON.stringify({ status: "nonsense", items: [{ id: "R-01", keep: false, order: 4 }, "junk", { keep: true }], handovers: "no" }));
    expect(readReview(review.dir)).toEqual({ name: "items", status: "open", created: "", project: { root: "", remote: null }, items: [{ id: "R-01", keep: false, order: 4 }], handovers: [] });
    addReviewItem(review.dir, "R-02");
    expect(readReview(review.dir)?.items.at(-1)).toEqual({ id: "R-02", keep: true, order: 5 });
    expect(readReview(join(review.dir, "nowhere"))).toBeNull();
    expect(addReviewItem(join(review.dir, "nowhere"), "R-01")).toBeNull();
  });
});
