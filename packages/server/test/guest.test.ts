import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { INJECT_ORIGIN_PLACEHOLDER } from "../src/browser.js";
import { currentReview, guestConfigPath, projectKey } from "../src/home.js";
import { reviewView } from "../src/review.js";
import { serve, type ServeHandle } from "../src/serve.js";
import { parseTask } from "../src/tasks.js";
import { restoreEnv, setEnv } from "./helpers/fake-cli.js";
import { apiAt } from "./helpers/http.js";
import { samplePost } from "./helpers/sample-capture.js";

// PRD-zero F-129, F-130, F-133, F-134, N-33, N-34: a real start (`serve()`, the stub provider) in
// a scratch project, under a temp `CRT_HOME`. A project without `.crt/tasks/` starts as a guest —
// no question, no refusal, no init — a stub Send lands as R-01 under the home, and the project
// is byte-for-byte what it was (the N-33 snapshot). A set-up project is untouched by all of it.

const SHA = "4f2a91c0d3b5e6f708192a3b4c5d6e7f8091a2b3";
const INTAKE = fileURLToPath(new URL("../../../plugin/skills/intake/SKILL.md", import.meta.url));

let home: string;
let root: string;
let lines: string[];
let handle: ServeHandle | null;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "crt-home-"));
  root = mkdtempSync(join(tmpdir(), "crt-guest-"));
  setEnv({ CRT_HOME: home, CRT_SESSION_STUB: "1" });
  lines = [];
  handle = null;
  // A project with a history: a branch, a commit, a remote, a source file.
  put(".git/HEAD", "ref: refs/heads/main\n");
  put(".git/refs/heads/main", `${SHA}\n`);
  put(".git/config", '[remote "origin"]\n\turl = git@github.com:me/app.git\n');
  put("package.json", '{ "name": "app", "scripts": { "dev": "vite" } }\n');
  put("src/app.ts", "export const total = 1;\n");
});
afterEach(async () => {
  await handle?.close();
  restoreEnv();
  rmSync(home, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });
});

function put(path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text, "utf8");
}

/** N-33: every path under the project with its size and mtime (directories: the path alone — their mtime is their entries'). */
function snapshot(): string[] {
  return (readdirSync(root, { recursive: true }) as string[]).sort().map((rel) => {
    const st = statSync(join(root, rel));
    return st.isDirectory() ? `${rel}/` : `${rel} ${st.size} ${st.mtimeMs}`;
  });
}

async function freePort(): Promise<number> {
  const s = createServer();
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

async function start(opts: { command?: "serve" | "proxy"; review?: boolean | string; target?: string; open?: boolean } = {}): Promise<{ handle: ServeHandle; api: ReturnType<typeof apiAt> }> {
  const result = await serve({
    cwd: root,
    command: opts.command ?? "serve",
    port: await freePort(),
    review: opts.review,
    target: opts.target,
    open: opts.open,
    overlayPath: join(root, "overlay.js"), // never read: no page asks for it
    intakePromptPath: INTAKE,
    log: (line) => lines.push(line),
    version: "0.8.0",
    deps: { probeAll: async () => [], isReachable: async () => true },
  });
  if (result.kind !== "serving") throw new Error("expected a server");
  handle = result.handle;
  return { handle: result.handle, api: apiAt(() => result.handle.url) };
}

/** A quick-note Send over the routes the overlay uses: the capture, then a session the stub answers by writing the task. */
async function send(api: ReturnType<typeof apiAt>): Promise<{ id: string; path: string }> {
  const capture = await api("POST", "/__crt/captures", samplePost());
  expect(capture.status).toBe(201);
  const session = await api("POST", "/__crt/sessions", { captureId: capture.json.id, quick: true });
  expect(session.status).toBe(201);
  for (let i = 0; i < 200; i++) {
    const { json } = await api("GET", "/__crt/sessions");
    const info = (json.sessions as Array<{ id: string; taskId: string | null }>).find((s) => s.id === session.json.id);
    if (info?.taskId) {
      const line = lines.find((l) => l.startsWith(`crt: task ${info.taskId} written to `))!;
      return { id: info.taskId, path: line.slice(`crt: task ${info.taskId} written to `.length) };
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`no task was written: ${lines.join(" | ")}`);
}

describe("what plain `crt` opens (F-132)", () => {
  const APP = "http://localhost:3000";
  /** No Chrome, Edge or Chromium where F-125 looks (Windows: the three install roots; Linux: PATH). */
  const noBrowser = () => setEnv({ PATH: root, ProgramFiles: root, "ProgramFiles(x86)": root, LocalAppData: root, LOCALAPPDATA: root });
  const ready = () => lines.find((l) => l.startsWith("CRT ready at "))!;

  it("with the integration: the default browser on the app, and the ready line of 0.7.2 plus `guest` (F-132, N-36)", async () => {
    put("package.json", '{ "name": "app", "devDependencies": { "vite": "^7.0.0" } }\n');
    put("vite.config.ts", 'import { crt } from "claude-review-tool/vite";\nexport default { plugins: [crt()] };\n');
    noBrowser();
    setEnv({ CRT_BROWSER: process.execPath }); // "opens" the app with a command that does nothing
    const { handle } = await start({ target: APP, open: true });
    expect(ready()).toBe(`CRT ready at ${handle.url} for ${APP} (embedded, guest; project: ${root}, review ${handle.store.review()}: 0 items, provider: stub (CRT_SESSION_STUB), login: unchecked)`);
    expect(handle.browser?.isOpen).toBe(false);
    expect(lines.some((l) => l.includes("no CRT integration"))).toBe(false);
  });

  it("without the integration and with a browser: the CRT browser, named in the ready line (F-132)", async () => {
    // `browser.command` names a browser (F-125), so the CRT browser is what opens. This one is node, which is no
    // browser: the launch says so in one line and CRT stays up — a real launch is e2e/browser.spec.ts.
    put("loader-inject.js", `window.__crtInject = "${INJECT_ORIGIN_PLACEHOLDER}";\n`); // what `npm run build` puts next to the overlay
    mkdirSync(dirname(guestConfigPath(root)), { recursive: true });
    writeFileSync(guestConfigPath(root), JSON.stringify({ browser: { command: [process.execPath] } }));
    setEnv({ CRT_BROWSER: join(root, "the-default-browser-must-not-be-used") });
    const { handle, api } = await start({ target: APP, open: true });
    expect(ready()).toBe(`CRT ready at ${handle.url} for ${APP} (embedded, CRT browser, guest; project: ${root}, review ${handle.store.review()}: 0 items, provider: stub (CRT_SESSION_STUB), login: unchecked)`);
    expect(lines.at(-1)).toMatch(/^crt: .+ did not accept a DevTools connection \(.+\) — set browser\.command in \.crt\/config\.local\.json, or run `crt proxy`$/);
    expect(lines.some((l) => l.includes("could not open browser"))).toBe(false); // the default opener was never tried
    expect((await api("GET", "/__crt/health")).json).toMatchObject({ ok: true });
    // No F-94 timer: nothing in the app asks for the loader.
    expect(lines.some((l) => l.includes("never loaded the CRT loader"))).toBe(false);
  });

  it.skipIf(process.platform === "darwin")("with neither: one line, and CRT stays up for a page that loads the loader later (F-132)", async () => {
    noBrowser();
    const { handle, api } = await start({ target: APP, open: true });
    expect(lines.at(-1)).toBe("crt: no CRT integration in this app and no Chrome or Edge found — run `crt proxy`, or set browser.command in .crt/config.local.json");
    expect(ready()).toContain("(embedded, guest; ");
    expect(handle.browser?.isOpen).toBe(false);
    expect((await api("GET", "/__crt/health")).json).toMatchObject({ ok: true });
  });

  it("--no-open opens nothing, whatever the app carries (F-132)", async () => {
    const { handle } = await start({ target: APP, open: false });
    expect(ready()).toContain("(embedded, guest; ");
    expect(handle.browser?.isOpen).toBe(false);
    expect(lines.some((l) => l.includes("no CRT integration"))).toBe(false);
  });
});

describe("guest start (F-129)", () => {
  it("a project that is not set up starts without asking: the guest line, the guest ready line, health — and R-01 under the home with its assets (F-129, F-130, F-133, F-134)", async () => {
    const before = snapshot();
    const { handle, api } = await start();
    const reviews = join(home, "reviews", projectKey(root));
    const today = handle.store.review()!;
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(lines[0]).toBe(`crt: ${root} is not set up for CRT — keeping this review in ${reviews} (nothing is written to the project; \`crt init\` adopts CRT here).`);
    expect(lines.at(-1)).toBe(`CRT ready at ${handle.url} (embedded, guest; project: ${root}, review ${today}: 0 items, provider: stub (CRT_SESSION_STUB), login: unchecked)`);
    expect(lines.some((l) => /crt init will|Set up CRT/.test(l))).toBe(false);
    const health = (await api("GET", "/__crt/health")).json;
    expect(health).toMatchObject({ ok: true, store: "review", review: today, guest: true, tasks: 0, tasksDir: null, projectRoot: root });

    const written = await send(api);
    const file = join(reviews, today, "tasks", "R-01-cart-total-excludes-applied-discount.md");
    expect(written).toEqual({ id: "R-01", path: file });
    const task = parseTask(readFileSync(file, "utf8"), "R-01-cart-total-excludes-applied-discount.md");
    expect(task.frontmatter).toMatchObject({ id: "R-01", status: "backlog", branch: "main", commit: SHA, provider: "stub" });
    expect(readdirSync(join(reviews, today, "tasks", "assets", "R-01")).sort()).toEqual(["ann-1.png", "ann-2.png", "capture.json", "viewport-annotated.png", "viewport.png"]);
    expect(readFileSync(join(reviews, today, "tasks", "README.md"), "utf8")).toContain("[R-01]");
    expect((await api("GET", "/__crt/health")).json).toMatchObject({ store: "review", review: today, guest: true, tasks: 1, tasksDir: join(reviews, today, "tasks") });
    // N-34: the first creation under the home is announced, once.
    expect(lines.filter((l) => l.startsWith("crt: created "))).toEqual([`crt: created ${join(home, "reviews")}`]);

    // What `crt review --json` reports.
    const view = reviewView(currentReview(root)!);
    expect(view).toMatchObject({ name: today, status: "open", project: { root, remote: "git@github.com:me/app.git" }, totals: { items: 1, kept: 1, routes: 1 } });
    expect(view.items).toEqual([{ id: "R-01", keep: true, order: 1, title: task.frontmatter.title, priority: "normal", status: "backlog", route: "/cart", branch: "main", commit: SHA, file: "R-01-cart-total-excludes-applied-discount.md" }]);

    await handle.close();
    // N-33: start, Send, the review read and stop left the project exactly as it was.
    expect(snapshot()).toEqual(before);
  });

  it("`crt proxy` as a guest: the same store, the proxy ready line, and the remembered target goes to the home (F-129, F-130, N-33)", async () => {
    const before = snapshot();
    const result = await serve({
      cwd: root,
      command: "proxy",
      positional: "3999",
      port: await freePort(),
      overlayPath: join(root, "overlay.js"),
      intakePromptPath: INTAKE,
      log: (line) => lines.push(line),
      deps: { probeAll: async () => [], isReachable: async () => true },
    });
    if (result.kind !== "serving") throw new Error("expected a server");
    handle = result.handle;
    const local = join(home, "reviews", projectKey(root), "config.local.json");
    expect(lines).toContain(`Remembered http://localhost:3999 in ${local} — \`crt <port>\` switches.`);
    expect(JSON.parse(readFileSync(local, "utf8"))).toEqual({ target: "http://localhost:3999" });
    expect(lines.at(-1)).toMatch(/^CRT ready at http:\/\/localhost:\d+ → http:\/\/localhost:3999 \(proxy, guest; project: .*, review \d{4}-\d{2}-\d{2}: 0 items, provider: stub \(CRT_SESSION_STUB\), login: unchecked\)$/);
    // The provider choice (F-57) goes the same way.
    const api = apiAt(() => result.handle.url);
    const set = await api("PUT", "/__crt/config", { provider: "stub" });
    expect(set).toMatchObject({ status: 200, json: { ok: true, file: local } });
    expect(JSON.parse(readFileSync(local, "utf8"))).toEqual({ target: "http://localhost:3999", provider: "stub" });
    await handle.close();
    expect(snapshot()).toEqual(before);
    // The next start reads it back: no positional, nothing remembered again.
    lines = [];
    const again = await start({ command: "proxy" });
    expect(again.handle.target).toBe("http://localhost:3999");
    expect(lines.some((l) => l.startsWith("Remembered "))).toBe(false);
  });
});

describe("a set-up project (F-129)", () => {
  beforeEach(() => mkdirSync(join(root, ".crt", "tasks"), { recursive: true }));

  it("writes CRT-0001 into .crt/tasks as before, with branch and commit; nothing appears under the home (F-129, F-134, N-34)", async () => {
    const { handle, api } = await start();
    expect(lines.some((l) => l.includes("is not set up for CRT"))).toBe(false);
    expect(lines.at(-1)).toMatch(/\(embedded; project: .*, 0 tasks in \.crt\/tasks, provider: stub \(CRT_SESSION_STUB\), login: unchecked\)$/);
    expect((await api("GET", "/__crt/health")).json).toMatchObject({ store: "project", review: null, guest: false, tasksDir: join(root, ".crt", "tasks") });
    expect(await send(api)).toEqual({ id: "CRT-0001", path: ".crt/tasks/CRT-0001-cart-total-excludes-applied-discount.md" });
    const task = parseTask(readFileSync(join(root, ".crt", "tasks", "CRT-0001-cart-total-excludes-applied-discount.md"), "utf8"));
    expect(task.frontmatter).toMatchObject({ id: "CRT-0001", branch: "main", commit: SHA });
    await handle.close();
    expect(readdirSync(home)).toEqual([]);
    expect(lines.some((l) => l.startsWith("crt: created "))).toBe(false);
  });

  it("--review and store: review send its feedback to a review instead, and leave the project as it was (F-129, N-33)", async () => {
    const before = snapshot();
    const flagged = await start({ review: true });
    expect(lines.some((l) => l.includes("is not set up for CRT"))).toBe(false);
    expect(lines.at(-1)).toMatch(/\(embedded; project: .*, review \d{4}-\d{2}-\d{2}: 0 items, provider: stub/);
    expect((await flagged.api("GET", "/__crt/health")).json).toMatchObject({ store: "review", guest: false });
    expect((await send(flagged.api)).id).toBe("R-01");
    await flagged.handle.close();
    expect(snapshot()).toEqual(before);

    put(".crt/config.json", JSON.stringify({ store: "review" }));
    lines = [];
    const configured = await start();
    expect(lines.at(-1)).toMatch(/review \d{4}-\d{2}-\d{2}: 1 item, provider: stub/);
    expect((await send(configured.api)).id).toBe("R-02");

    await configured.handle.close();
    lines = [];
    const named = await start({ review: "sprint-12" });
    expect(lines.at(-1)).toContain("review sprint-12: 0 items");
    expect((await send(named.api)).path).toBe(join(home, "reviews", projectKey(root), "sprint-12", "tasks", "R-01-cart-total-excludes-applied-discount.md"));
  });
});
