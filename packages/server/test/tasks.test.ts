import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeCapture } from "../src/captures.js";
import {
  allocateTaskId,
  createTask,
  findTaskFile,
  listTasks,
  localIso,
  logStamp,
  parseFrontmatter,
  parseTask,
  renderIndex,
  serializeTask,
  slugify,
  type Task,
  TaskFormatError,
  validateTaskText,
  writeIndex,
  yamlScalar,
} from "../src/tasks.js";
import { samplePost } from "./helpers/sample-capture.js";

let root: string;
let tasksDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "crt-tasks-"));
  tasksDir = join(root, ".crt", "tasks");
  mkdirSync(tasksDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const NOW = new Date(2026, 8, 15, 10, 32, 0);

function sampleTask(): Task {
  return {
    frontmatter: {
      id: "CRT-0007",
      title: "Cart total excludes applied discount",
      status: "backlog",
      priority: "normal",
      created: "2026-09-14T10:32:00+08:00",
      updated: "2026-09-14T10:32:00+08:00",
      url: "http://localhost:3000/cart?promo=SAVE10",
      route: "/cart",
      session: "7a3d0000-0000-4000-8000-000000000000",
      tags: ["cart", "pricing"],
      files: ["src/components/Cart.tsx", "src/lib/pricing.ts"],
    },
    sections: {
      Summary: "The total ignores the discount.",
      Context: "Reproduce at /cart?promo=SAVE10.",
      Evidence: "![viewport](assets/CRT-0007/viewport.png)",
      Ask: "Apply the discount to the total.",
      "Definition of Done": "- [ ] Total applies the discount\n- [ ] Test covers it",
      Notes: "None.",
      Log: "- 2026-09-14T10:32+08:00 — created by intake session 7a3d…",
    },
  };
}

describe("ids and slugs (F-31)", () => {
  it("allocates one above the highest existing id, ignoring other files", () => {
    expect(allocateTaskId(tasksDir)).toBe("CRT-0001");
    writeFileSync(join(tasksDir, "CRT-0003-x.md"), "");
    writeFileSync(join(tasksDir, "CRT-0012-y.md"), "");
    writeFileSync(join(tasksDir, "README.md"), "");
    mkdirSync(join(tasksDir, "assets", "CRT-0040"), { recursive: true });
    expect(allocateTaskId(tasksDir)).toBe("CRT-0013");
    expect(allocateTaskId(join(root, "missing"))).toBe("CRT-0001");
  });

  it("slugs are ≤ 40 chars, lowercase, hyphenated, never empty", () => {
    expect(slugify("Cart total excludes applied discount")).toBe("cart-total-excludes-applied-discount");
    expect(slugify("  Fix: the “Buy now” button (v2)! ")).toBe("fix-the-buy-now-button-v2");
    const long = slugify("This is a very long task title that goes on and on beyond forty characters");
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long).toBe("this-is-a-very-long-task-title-that-goes");
    expect(slugify("Ünïcödé façade")).toBe("unicode-facade");
    expect(slugify("!!!")).toBe("task");
  });
});

describe("frontmatter parsing", () => {
  it("reads scalars, nulls, quoted strings and flow lists; ignores comments", () => {
    const fm = parseFrontmatter(`---
id: CRT-0001
title: "A title: with a colon"
status: backlog            # backlog | in_progress
url: null
route: /cart
tags: [cart, "pricing, taxes", 'x']
files: []
---
body`);
    expect(fm?.body).toBe("body");
    expect(fm?.data).toEqual({
      id: "CRT-0001",
      title: "A title: with a colon",
      status: "backlog",
      url: null,
      route: "/cart",
      tags: ["cart", "pricing, taxes", "x"],
      files: [],
    });
  });

  it("quotes only what YAML would misread", () => {
    expect(yamlScalar("plain title")).toBe("plain title");
    expect(yamlScalar("has: colon")).toBe('"has: colon"');
    expect(yamlScalar("#hash")).toBe('"#hash"');
    expect(yamlScalar("null")).toBe('"null"');
    expect(yamlScalar("42")).toBe('"42"');
    expect(yamlScalar(null)).toBe("null");
  });
});

describe("F-32 round-trip and validation", () => {
  it("serializes in the fixed layout and parses back to the same task", () => {
    const text = serializeTask(sampleTask());
    expect(text.startsWith("---\nid: CRT-0007\ntitle: Cart total excludes applied discount\nstatus: backlog\n")).toBe(true);
    expect(text).toContain("\n## Summary\n");
    expect(text).toContain("\n## Definition of Done\n- [ ] Total applies the discount\n");
    expect(text.endsWith("\n")).toBe(true);
    expect(text).not.toContain("\r\n");
    expect(validateTaskText(text, "CRT-0007-cart-total-excludes-applied-discount.md")).toEqual([]);
    expect(parseTask(text)).toEqual(sampleTask());
  });

  it("round-trips titles that need quoting and empty lists", () => {
    const t = sampleTask();
    t.frontmatter.title = "Fix: “Buy now” #12";
    t.frontmatter.tags = [];
    t.frontmatter.url = null;
    expect(parseTask(serializeTask(t))).toEqual(t);
  });

  it("reports every format problem", () => {
    const bad = `---
id: CRT-7
title:
status: pending
priority: urgent
created: yesterday
updated: 2026-09-14T10:32:00+08:00
url: null
tags: cart
files: [a]
extra: 1
---

## Summary

## Ask
Do it.

## Log
`;
    const errors = validateTaskText(bad, "CRT-0007-bad.md");
    expect(errors).toEqual(
      expect.arrayContaining([
        'frontmatter: id "CRT-7" is not CRT-NNNN',
        'frontmatter: "title" must not be empty',
        'frontmatter: status "pending" is not one of backlog|in_progress|review|done|blocked',
        'frontmatter: priority "urgent" is not one of low|normal|high',
        'frontmatter: created "yesterday" is not an ISO-8601 timestamp with offset',
        'frontmatter: missing "route"',
        'frontmatter: missing "session"',
        'frontmatter: "tags" must be a list like [a, b]',
        'frontmatter: unknown key "extra"',
        "file name id CRT-0007 does not match frontmatter id CRT-7",
      ]),
    );
    expect(errors.find((e) => e.startsWith("sections must be exactly"))).toBeDefined();
    expect(validateTaskText("no frontmatter")).toEqual(["missing YAML frontmatter (--- … ---) at the top of the file"]);
  });

  it("flags empty Summary/Ask, a DoD without checkboxes, an empty Log and CRLF", () => {
    const t = sampleTask();
    t.sections.Summary = "";
    t.sections["Definition of Done"] = "just prose";
    t.sections.Log = "";
    const errors = validateTaskText(serializeTask(t).replace(/\n/g, "\r\n"));
    expect(errors).toEqual(
      expect.arrayContaining([
        "## Summary is empty",
        "## Definition of Done needs at least one `- [ ] item`",
        "## Log needs at least one `- <timestamp> — …` entry",
        "file uses CRLF line endings; tasks are written with \\n",
      ]),
    );
    expect(() => parseTask(serializeTask(t))).toThrow(TaskFormatError);
  });

  it("this repo's own task files validate (dogfood)", () => {
    const repoTasks = fileURLToPath(new URL("../../../.crt/tasks/", import.meta.url));
    const files = readdirSync(repoTasks).filter((f) => /^CRT-\d{4}-.*\.md$/.test(f));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(validateTaskText(readFileSync(join(repoTasks, f), "utf8"), f), f).toEqual([]);
    }
  });
});

describe("timestamps", () => {
  it("render local time with the machine's offset", () => {
    const d = new Date(2026, 8, 14, 10, 32, 5);
    const off = -d.getTimezoneOffset();
    const sign = off >= 0 ? "+" : "-";
    const tz = `${sign}${String(Math.floor(Math.abs(off) / 60)).padStart(2, "0")}:${String(Math.abs(off) % 60).padStart(2, "0")}`;
    expect(localIso(d)).toBe(`2026-09-14T10:32:05${tz}`);
    expect(logStamp(d)).toBe(`2026-09-14T10:32${tz}`);
  });
});

describe("listing and index (F-33, F-34)", () => {
  function put(id: string, title: string, status: string, updated = "2026-09-15T08:00:00+08:00") {
    const t = sampleTask();
    t.frontmatter.id = id;
    t.frontmatter.title = title;
    t.frontmatter.status = status as Task["frontmatter"]["status"];
    t.frontmatter.updated = updated;
    writeFileSync(join(tasksDir, `${id}-${slugify(title)}.md`), serializeTask(t), "utf8");
  }

  it("lists well-formed tasks sorted by id and skips junk", () => {
    put("CRT-0002", "Second", "review");
    put("CRT-0001", "First | pipe", "backlog", "2026-09-14T01:02:03+08:00");
    writeFileSync(join(tasksDir, "CRT-0003-broken.md"), "not a task");
    writeFileSync(join(tasksDir, "notes.md"), "---\nid: CRT-0009\n---\n");
    const tasks = listTasks(tasksDir);
    expect(tasks.map((t) => [t.id, t.status, t.title, t.file])).toEqual([
      ["CRT-0001", "backlog", "First | pipe", "CRT-0001-first-pipe.md"],
      ["CRT-0002", "review", "Second", "CRT-0002-second.md"],
    ]);
    expect(findTaskFile(tasksDir, "crt-0002")).toBe(join(tasksDir, "CRT-0002-second.md"));
    expect(findTaskFile(tasksDir, "CRT-0004")).toBeNull();
    expect(listTasks(join(root, "nope"))).toEqual([]);
  });

  it("renders the README table and rewrites it only when stale", () => {
    put("CRT-0001", "First | pipe", "backlog", "2026-09-14T01:02:03+08:00");
    const index = renderIndex(listTasks(tasksDir));
    expect(index).toContain("| ID | Status | Priority | Title | Updated |");
    expect(index).toContain("| [CRT-0001](CRT-0001-first-pipe.md) | backlog | normal | First \\| pipe | 2026-09-14 |");
    expect(writeIndex(tasksDir)).toBe(true);
    expect(readFileSync(join(tasksDir, "README.md"), "utf8")).toBe(index);
    expect(writeIndex(tasksDir)).toBe(false);
    put("CRT-0002", "Second", "done");
    expect(writeIndex(tasksDir)).toBe(true);
    expect(readFileSync(join(tasksDir, "README.md"), "utf8")).toContain("[CRT-0002]");
    expect(writeIndex(join(root, "nope"))).toBe(false);
  });
});

describe("createTask (F-23, F-31, F-32, F-34)", () => {
  const input = {
    title: "Cart total excludes applied discount",
    summary: "The total ignores the promo.",
    context: "CartSummary renders subtotal.",
    ask: "Render the discounted total.",
    definitionOfDone: ["Total applies the discount", "- [ ] already a checkbox"],
    notes: "Hunch: pricing.ts.",
    tags: ["cart"],
    files: ["src/components/Cart.tsx"],
    session: "7a3d0000-0000-4000-8000-000000000000",
  };

  it("writes a valid file, moves the capture's assets, fills url/route/Evidence and regenerates the index", () => {
    const capture = writeCapture(root, samplePost(), NOW);
    const created = createTask(root, tasksDir, { ...input, captureId: capture.id }, NOW);
    expect(created.id).toBe("CRT-0001");
    expect(basename(created.path)).toBe("CRT-0001-cart-total-excludes-applied-discount.md");
    expect(created.assetsDir).toBe(join(tasksDir, "assets", "CRT-0001"));

    const text = readFileSync(created.path, "utf8");
    expect(validateTaskText(text, created.file)).toEqual([]);
    const task = parseTask(text);
    expect(task.frontmatter).toMatchObject({
      id: "CRT-0001",
      status: "backlog",
      priority: "normal",
      url: "http://localhost:4400/cart?promo=SAVE10#top",
      route: "/cart",
      session: input.session,
      tags: ["cart"],
      files: ["src/components/Cart.tsx"],
    });
    expect(task.frontmatter.created).toBe(localIso(NOW));
    expect(task.sections["Definition of Done"]).toBe("- [ ] Total applies the discount\n- [ ] already a checkbox");
    expect(task.sections.Evidence).toContain("![viewport (annotated)](assets/CRT-0001/viewport-annotated.png)");
    expect(task.sections.Evidence).toContain("![annotation 1](assets/CRT-0001/ann-1.png)");
    expect(task.sections.Evidence).toContain('Annotation 1 — `<span id="total" class="cart-total">` in `CartSummary` (src/components/Cart.tsx:88), selector `#total`: "total excludes discount"');
    expect(task.sections.Evidence).toContain('Annotation 2 — pin at (300, 400): "missing a coupon field here"');
    expect(task.sections.Evidence).toContain("Failed requests at send time: 1 (first: GET /api/cart/promo → 500) — see capture.json.");
    expect(task.sections.Log).toBe(`- ${logStamp(NOW)} — created by intake session ${input.session} from capture ${capture.id}.`);

    // F-23: assets moved, capture dir gone
    expect(readdirSync(created.assetsDir!).sort()).toEqual(["ann-1.png", "ann-2.png", "capture.json", "viewport-annotated.png", "viewport.png"]);
    expect(existsSync(capture.dir)).toBe(false);
    // F-34
    expect(readFileSync(join(tasksDir, "README.md"), "utf8")).toContain("[CRT-0001](CRT-0001-cart-total-excludes-applied-discount.md) | backlog");
  });

  it("works without a capture and allocates the next id", () => {
    writeFileSync(join(tasksDir, "CRT-0041-old.md"), "");
    const created = createTask(root, tasksDir, { ...input, evidence: "Seen in the console.", priority: "high" }, NOW);
    expect(created.id).toBe("CRT-0042");
    expect(created.assetsDir).toBeNull();
    const task = parseTask(readFileSync(created.path, "utf8"));
    expect(task.frontmatter).toMatchObject({ url: null, route: null, priority: "high" });
    expect(task.sections.Evidence).toBe("Seen in the console.");
  });

  it("rejects incomplete input and a missing capture", () => {
    expect(() => createTask(root, tasksDir, { ...input, title: " ", definitionOfDone: [] }, NOW)).toThrow(/title is required; definitionOfDone/);
    expect(() => createTask(root, tasksDir, { ...input, captureId: "20260101-000000-dead" }, NOW)).toThrow(/capture 20260101-000000-dead not found/);
    expect(readdirSync(tasksDir)).toEqual([]);
  });
});
