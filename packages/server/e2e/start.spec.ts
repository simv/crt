import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { projectKey } from "../src/home.js";
import { samplePost } from "../test/helpers/sample-capture.js";
import { E2E_HOME, FIXTURE_ORIGIN, health, scratch, startCrt, stopCrts } from "./helpers.js";

// PRD-setup F-69, F-72, F-73, F-78, F-79 (the M12 half of F-90): the guided start driven through
// `dist/cli.js` with argv — under `crt proxy`, the v0.3 flow verbatim (PRD-embedded F-92, N-21; embedded.spec.ts
// covers the embedded ready line) —, from scratch projects of their own (never the shared e2e/.project root,
// whose crt.mjs log a second server would truncate), each spec spawning its own servers with
// `CRT_SESSION_STUB=1` and stdout captured. The ports are PORTS.start (e2e/helpers.ts). Nothing
// here needs a browser.

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = FIXTURE_ORIGIN;
const PKG = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as { version: string; dependencies: Record<string, string> };
const VERSION = PKG.version;
const SDK_VERSION = PKG.dependencies["@anthropic-ai/claude-agent-sdk"]!;
/** A detached HEAD for the guest project's `.git` (PRD-zero F-134). */
const SHA = "4f2a91c0d3b5e6f708192a3b4c5d6e7f8091a2b3";

function listenPlain(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const s = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("not crt");
    });
    s.once("error", reject);
    s.listen(port, "127.0.0.1", () => resolve(s));
  });
}

test.afterEach(stopCrts);

test("`crt 3999` starts with no prompt and remembers the target; the second run asks nothing and still names 3999 (F-69, F-72, N-15)", async () => {
  const root = scratch("start", "remember", 4485);
  const first = startCrt(root, ["proxy", "3999", "--yes"]);
  const ready = await first.waitFor(/^CRT ready at /);
  // PRD-embedded F-93: the proxy-mode ready line reads `→ <target> (proxy; …)`.
  expect(ready).toMatch(/^CRT ready at http:\/\/localhost:4485 → http:\/\/localhost:3999 \(proxy; project: .*, 0 tasks in \.crt[\\/]tasks, provider: stub \(CRT_SESSION_STUB\), login: unchecked\)$/);
  expect(first.lines).toContain("Remembered http://localhost:3999 in .crt/config.local.json — `crt <port>` switches.");
  expect(first.lines.some((l) => /Dev server URL|Which one\?/.test(l))).toBe(false);
  expect(JSON.parse(readFileSync(join(root, ".crt", "config.local.json"), "utf8"))).toEqual({ target: FIXTURE });
  // PRD-zero F-129 (retiring PRD-embedded F-99's implicit init): a start never runs `crt init`, with or without --yes.
  expect(first.lines.some((l) => l.startsWith("crt init"))).toBe(false);
  expect(existsSync(join(root, ".crt", "README.md"))).toBe(false);
  // F-78: health tells the whole story.
  const h = await health(4485);
  expect(h).toMatchObject({ ok: true, version: VERSION, target: FIXTURE, tasks: 0, provider: "stub", login: "unchecked", sessions: 0, overlay: { injected: 0, fetched: 0 } });
  expect(typeof h!.startedAt).toBe("string");
  expect(typeof h!.tasksDir).toBe("string");
  first.child.kill();
  await first.exited;

  const second = startCrt(root, ["proxy", "--yes"]);
  const started = Date.now();
  const again = await second.waitFor(/^CRT ready at /);
  expect(again).toContain("CRT ready at http://localhost:4485 → http://localhost:3999 (proxy; ");
  expect(Date.now() - started).toBeLessThan(15_000);
  expect(second.lines.some((l) => l.startsWith("Remembered "))).toBe(false);
  expect(second.lines.some((l) => l.startsWith("crt init:"))).toBe(false);
});

test("a second start on the same target and project exits 0 with the reuse line while the first keeps serving (F-73)", async () => {
  const root = scratch("start", "reuse", 4489);
  const first = startCrt(root, ["proxy", "--target", FIXTURE, "--yes"]);
  await first.waitFor(/^CRT ready at http:\/\/localhost:4489 /);
  const before = await health(4489);
  // --target is the scripting form: never remembered (the chat spec relies on this too).
  expect(existsSync(join(root, ".crt", "config.local.json"))).toBe(false);

  const second = startCrt(root, ["proxy", "--target", FIXTURE, "--yes"]);
  expect(await second.exited).toBe(0);
  const reuse = second.lines.find((l) => l.startsWith("CRT "));
  expect(reuse).toContain(`CRT ${VERSION} is already serving http://localhost:3999 for this project at http://localhost:4489 (since `);
  expect(reuse).toMatch(/ \(since \d\d:\d\d\) — open it in your browser\.$/);
  expect(second.lines.some((l) => l.startsWith("CRT ready"))).toBe(false);

  const after = await health(4489);
  expect(after).not.toBeNull();
  expect(after!.startedAt).toBe(before!.startedAt);
  expect(first.child.exitCode).toBeNull();

  if (process.platform !== "win32") {
    // F-77: SIGINT/SIGTERM close cleanly, say so, and exit 0 (Windows has no signals to send).
    first.child.kill("SIGTERM");
    expect(await first.exited).toBe(0);
    expect(first.lines).toContain("Stopping CRT … 0 sessions ended; written task files are kept.");
  }
});

test("a non-CRT listener on the port makes the next start take the next port and say so (F-73)", async () => {
  const root = scratch("start", "busy", 4487);
  const plain = await listenPlain(4487);
  try {
    const crt = startCrt(root, ["proxy", "--target", FIXTURE, "--yes"]);
    const ready = await crt.waitFor(/^CRT ready at /);
    expect(ready).toContain("CRT ready at http://localhost:4488 → http://localhost:3999 (proxy; ");
    expect(crt.lines).toContain("crt: port 4487 is in use by a process that is not CRT; using 4488");
    expect(await health(4488)).toMatchObject({ ok: true, target: FIXTURE });
    expect(await health(4487)).toBeNull();
  } finally {
    await new Promise<void>((r) => plain.close(() => r()));
  }
});

test("an explicit --port is never stepped around, and --replace stops the CRT on the port through the shutdown route (F-73, F-79)", async () => {
  const root = scratch("start", "replace", 4483);
  const first = startCrt(root, ["proxy", "--target", FIXTURE, "--yes"]);
  await first.waitFor(/^CRT ready at http:\/\/localhost:4483 /);

  const other = scratch("start", "replace-other", 4483);
  const refused = startCrt(other, ["proxy", "--target", FIXTURE, "--yes", "--port", "4483"]);
  expect(await refused.exited).toBe(1);
  expect(refused.lines.find((l) => l.startsWith("crt: port 4483"))).toMatch(/^crt: port 4483 is already in use by CRT .* \(→ http:\/\/localhost:3999, project .*\) — stop the other process, run `crt --replace`, or pass --port <n>$/);

  const stepped = startCrt(other, ["proxy", "--target", FIXTURE, "--yes"]);
  const ready = await stepped.waitFor(/^CRT ready at /);
  expect(ready).toContain("CRT ready at http://localhost:4484 →");
  expect(stepped.lines.find((l) => l.startsWith("crt: port 4483"))).toMatch(/^crt: port 4483 is held by another CRT \(→ http:\/\/localhost:3999, project .*\); using 4484$/);
  stepped.child.kill();
  await stepped.exited;

  const replacing = startCrt(root, ["proxy", "--target", FIXTURE, "--yes", "--replace"]);
  await replacing.waitFor(/^CRT ready at http:\/\/localhost:4483 /);
  expect(replacing.lines).toContain(`Stopped CRT ${VERSION} on port 4483.`);
  expect(await first.exited).toBe(0);
  expect((await health(4483))!.startedAt).not.toBe(undefined);
});

test("crt --version, crt help and an unknown command (F-69)", async () => {
  const root = scratch("start", "grammar", 4481);
  const version = startCrt(root, ["--version"]);
  expect(await version.exited).toBe(0);
  expect(version.lines).toEqual([`crt ${VERSION} (agent sdk ${SDK_VERSION})`]);
  const help = startCrt(root, ["help"]);
  expect(await help.exited).toBe(0);
  expect(help.lines[0]).toBe("crt — Claude Review Tool");
  const bogus = startCrt(root, ["bogus"]);
  expect(await bogus.exited).toBe(2);
  expect(bogus.lines).toEqual(['crt: unknown command "bogus" — a target is a port, host:port or URL; `crt help` lists commands']);
  // A bad positional target is a usage error, not a probe.
  const down = startCrt(root, ["proxy", "--yes", "3998"]);
  expect(await down.exited).toBe(1);
  expect(down.lines).toContain("crt: target http://localhost:3998 is not responding — start your dev server there, or run `crt <port>`");
});

test("a project that is not set up: `crt` starts as a guest, a Send lands as R-01 under the CRT home, the review forms read it, and the project is untouched (F-129, F-130, F-133, F-134, N-33)", async () => {
  const root = scratch("start", "guest", 4480);
  rmSync(join(root, ".crt"), { recursive: true, force: true });
  writeFileSync(join(root, ".git", "HEAD"), `${SHA}\n`);
  writeFileSync(join(root, "app.js"), "console.log(1);\n");
  const reviews = join(E2E_HOME, "reviews", projectKey(root));
  rmSync(reviews, { recursive: true, force: true });
  const run = async (args: string[]) => {
    const crt = startCrt(root, args);
    return { code: await crt.exited, lines: crt.lines };
  };
  /** N-33: every path under the project with its size and mtime. */
  const snapshot = () =>
    (readdirSync(root, { recursive: true }) as string[]).sort().map((rel) => {
      const st = statSync(join(root, rel));
      return st.isDirectory() ? `${rel}/` : `${rel} ${st.size} ${st.mtimeMs}`;
    });
  const before = snapshot();

  // Before anything ran: no review is not an error, and `crt tasks` still says the project is not set up.
  expect(await run(["review"])).toEqual({ code: 0, lines: [`crt: no review for ${root} yet — run \`crt\`, send some feedback, then \`crt review\``] });
  expect(JSON.parse((await run(["review", "--json"])).lines.join("\n"))).toEqual({ review: null, items: [] });
  expect(await run(["tasks"])).toEqual({ code: 0, lines: ["no tasks (CRT is not set up here — run crt init)"] });
  expect(JSON.parse((await run(["tasks", "--json"])).lines.join("\n"))).toEqual({ tasksDir: null, tasks: [] });

  // Off a terminal, without --yes: no refusal, no question, no init.
  const crt = startCrt(root, ["--no-open", "--port", "4480"]);
  const ready = await crt.waitFor(/^CRT ready at http:\/\/localhost:4480 /);
  expect(crt.lines[0]).toBe(`crt: ${root} is not set up for CRT — keeping this review in ${reviews} (nothing is written to the project; \`crt init\` adopts CRT here).`);
  expect(ready).toMatch(/^CRT ready at http:\/\/localhost:4480( for http:\/\/localhost:\d+)? \(embedded, guest; project: .*, review \d{4}-\d{2}-\d{2}: 0 items, provider: stub \(CRT_SESSION_STUB\), login: unchecked\)$/);
  expect(crt.lines.some((l) => l.startsWith("crt init"))).toBe(false);
  const h = await health(4480);
  expect(h).toMatchObject({ ok: true, store: "review", guest: true, tasks: 0, tasksDir: null });
  const review = h!.review as string;

  // A quick-note Send over the routes the overlay uses; the stub answers by writing the task.
  const post = async (path: string, body: unknown) => (await fetch(`http://localhost:4480${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json() as Promise<Record<string, unknown>>;
  const capture = await post("/__crt/captures", samplePost());
  expect(String(capture.dir)).toBe(join(reviews, review, "captures", String(capture.id)));
  await post("/__crt/sessions", { captureId: capture.id, quick: true });
  const file = join(reviews, review, "tasks", "R-01-cart-total-excludes-applied-discount.md");
  await crt.waitFor(/^crt: task R-01 written to /);
  expect(crt.lines).toContain(`crt: task R-01 written to ${file}`);
  expect(readFileSync(file, "utf8")).toContain(`\nbranch: null\ncommit: ${SHA}\n`);
  expect(readdirSync(join(reviews, review, "tasks", "assets", "R-01")).sort()).toEqual(["ann-1.png", "ann-2.png", "capture.json", "viewport-annotated.png", "viewport.png"]);
  expect(await health(4480)).toMatchObject({ store: "review", review, guest: true, tasks: 1 });

  // The forms that read it (F-133, F-134), while the server runs.
  const json = JSON.parse((await run(["review", "--json"])).lines.join("\n")) as { review: string; status: string; items: Array<Record<string, unknown>>; totals: unknown };
  expect(json).toMatchObject({ review, status: "open", totals: { items: 1, kept: 1, routes: 1 } });
  expect(json.items).toEqual([{ id: "R-01", keep: true, order: 1, title: "Cart total excludes applied discount", priority: "normal", status: "backlog", route: "/cart", branch: null, commit: SHA, file: "R-01-cart-total-excludes-applied-discount.md" }]);
  expect((await run(["review"])).lines).toEqual(["R-01  normal  kept     /cart  Cart total excludes applied discount", `Review ${review}: 1 item · 1 kept · 1 route`, "Next: `crt handoff` sends the kept items to the project."]);
  expect((await run(["review", "list"])).lines).toEqual([`${review}  open    1 item, 1 kept  (current)`]);
  const listed = await run(["tasks", "--review"]);
  expect(listed.lines[0]).toMatch(/^R-01 {2}backlog {2}stub {2}normal {2}Cart total excludes applied discount {2}\(\d{4}-\d{2}-\d{2}\)$/);
  expect(await run(["task", "R-01", "--review", "--validate"])).toEqual({ code: 0, lines: ["crt task: R-01-cart-total-excludes-applied-discount.md is valid"] });
  expect((await run(["task", "R-01"])).lines).toEqual(["crt: no task R-01 in .crt/tasks — an R-NN id is in a review: add --review"]);

  crt.child.kill();
  await crt.exited;
  // N-33: none of it created, changed or removed anything under the project.
  expect(snapshot()).toEqual(before);
  expect(existsSync(join(root, ".crt"))).toBe(false);

  // `crt review new` starts the next one; the first stays open and listed.
  const started = await run(["review", "new", "sprint-12"]);
  expect(started).toEqual({ code: 0, lines: [`Review sprint-12 started in ${join(reviews, "sprint-12")} — new feedback for ${root} goes there.`] });
  expect((await run(["review", "list"])).lines).toEqual([`${review.padEnd(10)}  open    1 item, 1 kept`, "sprint-12   open    0 items, 0 kept  (current)"]);
  expect((await run(["review", "new", "Not A Name"])).code).toBe(2);
  expect(snapshot()).toEqual(before);
});
