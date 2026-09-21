import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { request as httpRequest, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startFixture, type Fixture } from "../e2e/fixture/server.mjs";
import { writeCapture } from "../src/captures.js";
import { FIRST_MESSAGE_HEADING, QUICK_NOTE_INSTRUCTIONS } from "../src/intake-message.js";
import { INTERNAL_WRITE_TASK_PATH } from "../src/mcp-stdio.js";
import { createProxyServer } from "../src/proxy.js";
import { makeStubProfile, stubProfile } from "../src/providers/stub.js";
import { ProviderRegistry } from "../src/session.js";
import type { SessionEvent, WriteTaskRequest } from "../src/session-events.js";
import { SessionRegistry } from "../src/sessions.js";
import { parseTask, validateTaskText } from "../src/tasks.js";
import { samplePost } from "./helpers/sample-capture.js";

// The registry and its /__crt/sessions routes, driven by the scripted stub (providers/stub.ts),
// selected through the real provider resolution with CRT_SESSION_STUB=1 (F-43 step 0).
// The Claude driver is exercised by session.test.ts when a Claude login is available.

let fixture: Fixture;
let proxy: Server;
let crt: string;
let root: string;
let registry: SessionRegistry;
const logs: string[] = [];

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "crt-sessions-"));
  mkdirSync(join(root, ".crt", "tasks"), { recursive: true });
  fixture = await startFixture();
  const providers = new ProviderRegistry({ root, env: { CRT_SESSION_STUB: "1" }, log: (l) => logs.push(l) });
  await providers.refresh();
  registry = new SessionRegistry({
    projectRoot: root,
    tasksDir: join(root, ".crt", "tasks"),
    intakePrompt: "INTAKE $ARGUMENTS",
    providers,
    permissionTimeoutMs: 400,
    log: (l) => logs.push(l),
  });
  proxy = createProxyServer({ target: fixture.url, projectRoot: root, overlayPath: join(root, "overlay.js"), sessions: registry, providers });
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
  registry.mcpPort = (proxy.address() as { port: number }).port;
  crt = `http://localhost:${registry.mcpPort}`;
});

afterAll(async () => {
  registry.closeAll();
  proxy.closeAllConnections();
  await new Promise<void>((r) => proxy.close(() => r()));
  await fixture.close();
  rmSync(root, { recursive: true, force: true });
});

afterEach(() => {
  for (const f of readdirSync(join(root, ".crt", "tasks"))) rmSync(join(root, ".crt", "tasks", f), { recursive: true, force: true });
});

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(crt + path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
}

/**
 * Read the SSE stream until `until(event)` is true (or the stream ends); returns every event seen,
 * and `liveAfter`: how many events had been replayed when the named `live` frame arrived (F-66), or -1.
 */
function collect(
  path: string,
  until: (e: SessionEvent, all: SessionEvent[]) => boolean,
  headers: Record<string, string> = {},
): Promise<{ events: SessionEvent[]; ids: number[]; liveAfter: number }> {
  return new Promise((resolve, reject) => {
    const events: SessionEvent[] = [];
    const ids: number[] = [];
    let liveAfter = -1;
    const req = httpRequest(crt + path, { headers }, (res) => {
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/event-stream");
      let buf = "";
      const finish = () => {
        res.destroy();
        resolve({ events, ids, liveAfter });
      };
      res.on("data", (c: Buffer) => {
        buf += c.toString("utf8");
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (frame.startsWith(":")) continue;
          // Named frames are not transcript events: `live` marks the end of the replay.
          const named = /^event: (\w+)$/m.exec(frame);
          if (named) {
            if (named[1] === "live") liveAfter = events.length;
            continue;
          }
          const id = /^id: (\d+)$/m.exec(frame);
          const data = /^data: (.*)$/m.exec(frame);
          if (!data) continue;
          const event = JSON.parse(data[1]!) as SessionEvent;
          events.push(event);
          if (id) ids.push(Number(id[1]));
          if (until(event, events)) return finish();
        }
      });
      res.on("end", () => resolve({ events, ids, liveAfter }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end();
  });
}

const isState = (s: string) => (e: SessionEvent) => e.type === "state" && e.state === s;

describe("session routes (F-24, F-25, F-29)", () => {
  it("POST /__crt/sessions starts a session for a stored capture; 404 / 400 otherwise", async () => {
    const cap = writeCapture(root, samplePost());
    const r = await api("POST", "/__crt/sessions", { captureId: cap.id });
    expect(r.status).toBe(201);
    expect(r.json.id).toMatch(/^[0-9a-f-]{36}$/);
    // F-47: the provider is known at once, the native id only from the init event.
    expect(r.json.session).toMatchObject({ captureId: cap.id, state: "starting", taskId: null, provider: "stub", nativeSessionId: null });
    expect(logs.at(-1)).toContain(`session ${r.json.id as string} started on stub`);

    expect((await api("POST", "/__crt/sessions", { captureId: "20200101-000000-dead" })).status).toBe(404);
    expect((await api("POST", "/__crt/sessions", { captureId: 42 })).status).toBe(400);
    expect((await api("POST", "/__crt/sessions", { captureId: "../x" })).status).toBe(400);
    expect((await api("GET", "/__crt/sessions/nope")).status).toBe(404);

    const list = await api("GET", "/__crt/sessions");
    expect((list.json.sessions as Array<{ id: string }>).map((s) => s.id)).toContain(r.json.id);
    registry.close(r.json.id as string);
  });

  it("streams init, text deltas, tool lines, a permission card, and a result; Deny is honoured", async () => {
    const cap = writeCapture(root, samplePost());
    const { id } = (await api("POST", "/__crt/sessions", { captureId: cap.id })).json as { id: string };
    const first = await collect(`/__crt/sessions/${id}/events`, (e) => e.type === "permission");
    const types = first.events.map((e) => e.type);
    expect(types[0]).toBe("user");
    expect(first.events[0]).toMatchObject({ type: "user", text: expect.stringContaining(`CRT intake for capture ${cap.id}`), images: ["viewport (annotated)", "annotation 1", "annotation 2"] });
    expect(types).toContain("init");
    // F-47: the init event carries the provider identity; the registry learns the native id from it.
    const init = first.events.find((e) => e.type === "init") as Extract<SessionEvent, { type: "init" }>;
    expect(init).toMatchObject({ sessionId: id, nativeSessionId: id, provider: "stub", displayName: stubProfile.displayName, model: "stub-model", agentVersion: "stub", resumeCommand: stubProfile.resumeCommand(id), capabilities: stubProfile.capabilities });
    expect(registry.get(id)?.nativeSessionId).toBe(id);
    // F-63: the resume hint in the log comes from the profile, not from a hard-coded "claude --resume".
    expect(logs.find((l) => l.includes(`session ${id} is`))).toContain(stubProfile.resumeCommand(id)!);
    expect(types).toContain("assistant_start");
    expect(types.filter((t) => t === "text").length).toBeGreaterThan(3);
    expect(first.events.find((e) => e.type === "tool_use")).toMatchObject({ name: "Read", label: "Read src/components/Cart.tsx" });
    expect(first.events.find((e) => e.type === "tool_result")).toMatchObject({ isError: false, summary: "88 lines" });
    const perm = first.events.at(-1) as Extract<SessionEvent, { type: "permission" }>;
    expect(perm).toMatchObject({ toolName: "Bash", detail: "npm test" });
    expect(first.ids).toEqual(first.events.map((_, i) => i + 1));
    expect(registry.get(id)?.state).toBe("waiting");

    // Deny → resolved card, no Bash tool line, the "won't run tests" branch, idle.
    const deny = await api("POST", `/__crt/sessions/${id}/permission`, { id: perm.id, behavior: "deny" });
    expect(deny.status).toBe(200);
    const rest = await collect(`/__crt/sessions/${id}/events`, isState("idle"), { "last-event-id": String(first.ids.at(-1)) });
    expect(rest.events).toContainEqual({ type: "permission_resolved", id: perm.id, behavior: "deny", by: "user" });
    expect(rest.events.some((e) => e.type === "tool_use" && e.name === "Bash")).toBe(false);
    const text = rest.events.filter((e) => e.type === "text").map((e) => (e as { text: string }).text).join("");
    expect(text).toContain("I won't run tests");
    expect(rest.events.find((e) => e.type === "result")).toMatchObject({ ok: true });
    expect((await api("POST", `/__crt/sessions/${id}/permission`, { id: perm.id, behavior: "allow" })).status).toBe(409);
    registry.close(id);
  });

  it("Allow runs the tool; a later 'write' turn writes the task and the panel learns the id", async () => {
    const cap = writeCapture(root, samplePost());
    const { id } = (await api("POST", "/__crt/sessions", { captureId: cap.id })).json as { id: string };
    const first = await collect(`/__crt/sessions/${id}/events`, (e) => e.type === "permission");
    const perm = first.events.at(-1) as Extract<SessionEvent, { type: "permission" }>;
    expect((await api("POST", `/__crt/sessions/${id}/permission`, { id: perm.id, behavior: "allow" })).status).toBe(200);
    const rest = await collect(`/__crt/sessions/${id}/events?after=${first.ids.at(-1)}`, isState("idle"));
    // F-66: the `live` frame separates the replay from live events on every connection.
    expect(first.liveAfter).toBe(1); // the first user message was recorded before the stream connected
    expect(rest.liveAfter).toBeGreaterThanOrEqual(0);
    expect(rest.liveAfter).toBeLessThan(rest.events.length);
    expect(rest.events.find((e) => e.type === "permission_resolved")).toMatchObject({ behavior: "allow", by: "user" });
    expect(rest.events.find((e) => e.type === "tool_use" && e.name === "Bash")).toMatchObject({ label: "Bash npm test" });
    expect(rest.events.find((e) => e.type === "tool_result" && e.summary === "12 passing")).toBeDefined();

    expect((await api("POST", `/__crt/sessions/${id}/messages`, { text: "write it" })).status).toBe(202);
    const after = Number(first.ids.at(-1)) + rest.events.length;
    const turn = await collect(`/__crt/sessions/${id}/events?after=${after}`, (e) => e.type === "result");
    expect(turn.events[0]).toEqual({ type: "user", text: "write it", images: [] });
    const written = turn.events.find((e) => e.type === "task_written") as Extract<SessionEvent, { type: "task_written" }>;
    expect(written).toMatchObject({ id: "CRT-0001", path: ".crt/tasks/CRT-0001-cart-total-excludes-applied-discount.md" });
    expect(registry.get(id)?.taskId).toBe("CRT-0001");

    // F-23 / F-32 / F-34 on disk
    const file = join(root, written.path);
    expect(validateTaskText(readFileSync(file, "utf8"), "CRT-0001-cart-total-excludes-applied-discount.md")).toEqual([]);
    // F-48: session is the native id, provider follows it, and the Log names both.
    const task = parseTask(readFileSync(file, "utf8"));
    expect(task.frontmatter).toMatchObject({ session: id, provider: "stub" });
    expect(readFileSync(file, "utf8")).toContain(`session: ${id}
provider: stub
`);
    expect(task.sections.Log).toContain(`created by intake session ${id} (stub) from capture ${cap.id}.`);
    expect(readdirSync(join(root, ".crt", "tasks", "assets", "CRT-0001"))).toContain("viewport.png");
    expect(existsSync(cap.dir)).toBe(false);
    expect(readFileSync(join(root, ".crt", "tasks", "README.md"), "utf8")).toContain("[CRT-0001]");

    expect((await api("POST", `/__crt/sessions/${id}/messages`, { text: "" })).status).toBe(400);
    registry.close(id);
  });

  it("warm start: POST with no capture boots the session; POST …/capture sends the first message (N-2)", async () => {
    const r = await api("POST", "/__crt/sessions", {});
    expect(r.status).toBe(201);
    const id = r.json.id as string;
    expect(r.json.session).toMatchObject({ captureId: null, state: "starting" });
    // Nothing has been said yet: no user echo, no init.
    await new Promise((res) => setTimeout(res, 60));
    expect(registry.get(id)?.state).toBe("starting");

    expect((await api("POST", `/__crt/sessions/${id}/capture`, { captureId: "20200101-000000-dead" })).status).toBe(404);
    expect((await api("POST", `/__crt/sessions/${id}/capture`, {})).status).toBe(400);
    const cap = writeCapture(root, samplePost());
    expect((await api("POST", `/__crt/sessions/${id}/capture`, { captureId: cap.id })).status).toBe(200);
    expect(registry.get(id)?.captureId).toBe(cap.id);
    expect((await api("POST", `/__crt/sessions/${id}/capture`, { captureId: cap.id })).status).toBe(409);

    const got = await collect(`/__crt/sessions/${id}/events`, (e) => e.type === "permission");
    expect(got.events[0]).toMatchObject({ type: "user", text: expect.stringContaining(`CRT intake for capture ${cap.id}`) });
    expect(got.events.map((e) => e.type)).toContain("init");
    registry.close(id);
  });

  it("a permission nobody answers is denied after the timeout", async () => {
    const cap = writeCapture(root, samplePost());
    const { id } = (await api("POST", "/__crt/sessions", { captureId: cap.id })).json as { id: string };
    const all = await collect(`/__crt/sessions/${id}/events`, (e) => e.type === "permission_resolved");
    expect(all.events.at(-1)).toMatchObject({ behavior: "deny", by: "timeout" });
    registry.close(id);
  });

  it("interrupt cuts the turn short and DELETE ends the session", async () => {
    const cap = writeCapture(root, samplePost());
    const { id } = (await api("POST", "/__crt/sessions", { captureId: cap.id })).json as { id: string };
    await collect(`/__crt/sessions/${id}/events`, (e) => e.type === "text");
    expect((await api("POST", `/__crt/sessions/${id}/interrupt`)).status).toBe(202);
    const got = await collect(`/__crt/sessions/${id}/events`, isState("idle"));
    expect(got.events.find((e) => e.type === "result")).toMatchObject({ ok: false, errors: ["interrupted"] });
    expect(got.events.some((e) => e.type === "permission")).toBe(false);

    expect((await api("DELETE", `/__crt/sessions/${id}`)).status).toBe(200);
    expect(registry.get(id)?.state).toBe("ended");
    expect((await api("POST", `/__crt/sessions/${id}/messages`, { text: "hi" })).status).toBe(409);
  });

  it("quick note: the first message carries the F-14 instructions, the stub writes without asking, and the list shows it (F-14, F-30)", async () => {
    const cap = writeCapture(root, samplePost());
    expect((await api("POST", "/__crt/sessions", { captureId: cap.id, quick: "yes" })).status).toBe(400);
    const r = await api("POST", "/__crt/sessions", { captureId: cap.id, quick: true });
    expect(r.status).toBe(201);
    const id = r.json.id as string;
    expect(r.json.session).toMatchObject({ quick: true, summary: "total excludes discount", url: "http://localhost:4400/cart?promo=SAVE10#top" });
    expect(logs.at(-1)).toContain(`quick-note session ${id}`);
    const got = await collect(`/__crt/sessions/${id}/events`, isState("idle"));
    expect(got.events[0]).toMatchObject({ type: "user", text: expect.stringContaining("Quick note (F-14)") });
    expect(got.events.some((e) => e.type === "permission")).toBe(false);
    expect(got.events.find((e) => e.type === "task_written")).toMatchObject({ id: "CRT-0001" });
    expect(registry.get(id)).toMatchObject({ quick: true, taskId: "CRT-0001", state: "idle" });

    const list = (await api("GET", "/__crt/sessions")).json.sessions as Array<{ id: string; quick: boolean; summary: string | null; startedAt: string }>;
    expect(list[0]).toMatchObject({ id, quick: true, summary: "total excludes discount" });
    expect([...list].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map((s) => s.id)).toEqual(list.map((s) => s.id));
    registry.close(id);
  });

  it("warm-started sessions have no summary until the capture arrives, and a plain session is not quick (F-30)", async () => {
    const r = await api("POST", "/__crt/sessions", {});
    const id = r.json.id as string;
    expect(r.json.session).toMatchObject({ quick: false, summary: null, url: null });
    const cap = writeCapture(root, samplePost());
    await api("POST", `/__crt/sessions/${id}/capture`, { captureId: cap.id });
    expect(registry.get(id)).toMatchObject({ summary: "total excludes discount", url: "http://localhost:4400/cart?promo=SAVE10#top" });
    const got = await collect(`/__crt/sessions/${id}/events`, (e) => e.type === "user");
    expect((got.events[0] as { text: string }).text).not.toContain("Quick note");
    registry.close(id);
  });

  it("an explicitly requested provider that cannot be used fails the session at once with the N-7 line (F-43)", async () => {
    // A registry without the stub env: claude is listed but its preflight has not run, so it fails.
    const providers = new ProviderRegistry({ root, env: {}, log: () => undefined });
    const strict = new SessionRegistry({ projectRoot: root, tasksDir: join(root, ".crt", "tasks"), intakePrompt: "x", providers });
    const cap = writeCapture(root, samplePost());
    const info = strict.create(cap.id, { provider: "nope" });
    expect(info).toMatchObject({ provider: "nope", state: "starting" });
    await new Promise((r) => setTimeout(r, 20));
    expect(strict.get(info.id)?.state).toBe("error");
    const events: SessionEvent[] = [];
    strict.subscribe(info.id, 0, (_seq, e) => events.push(e));
    expect(events[0]).toEqual({ type: "error", message: 'provider "nope" is not a built-in provider (claude, codex, gemini)' });
    expect(events[1]).toMatchObject({ type: "state", state: "error" });
    // F-30: the row stays listable and the session cannot be driven.
    expect(strict.list().map((s) => s.id)).toContain(info.id);
    expect(strict.send(info.id, "hi")).toBe(false);
    strict.closeAll();
  });

  it("the same write_task request yields the same file through the in-process tool and the stdio route, PRD-providers §5.3 (F-49)", async () => {
    // In-process: the stub calls its `writeTask` option when told to write (the Claude driver's path).
    const capA = writeCapture(root, samplePost());
    const a = (await api("POST", "/__crt/sessions", { captureId: capA.id })).json as { id: string };
    await collect(`/__crt/sessions/${a.id}/events`, (e) => e.type === "permission");
    await api("POST", `/__crt/sessions/${a.id}/messages`, { text: "write" });
    const viaTool = await collect(`/__crt/sessions/${a.id}/events`, (e) => e.type === "task_written");
    const wroteA = viaTool.events.find((e) => e.type === "task_written") as Extract<SessionEvent, { type: "task_written" }>;
    // Over stdio: `crt mcp` POSTs the same arguments with the session's bearer token (the stub's fixed request).
    const capB = writeCapture(root, samplePost());
    const b = (await api("POST", "/__crt/sessions", { captureId: capB.id })).json as { id: string };
    await collect(`/__crt/sessions/${b.id}/events`, (e) => e.type === "init");
    const request: WriteTaskRequest = {
      title: "Cart total excludes applied discount",
      summary: "The cart total ignores the SAVE10 promo that the page shows as applied.",
      context: "Reproduce: open /cart?promo=SAVE10. `CartSummary` (src/components/Cart.tsx:88) renders `subtotal` instead of `total`.",
      ask: "Render the discounted total and cover it with a unit test.",
      definitionOfDone: ["Cart total applies the promo discount", "Unit test covers the discounted total"],
      notes: "Stub intake; nothing was read from disk.",
      tags: ["cart", "pricing"],
      files: ["src/components/Cart.tsx"],
    };
    const res = await fetch(crt + INTERNAL_WRITE_TASK_PATH, {
      method: "POST",
      headers: { authorization: `Bearer ${registry.tokenOf(b.id)!}`, "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    expect(res.status).toBe(201);
    const wroteB = (await res.json()) as { ok: boolean; id: string; path: string };
    expect(wroteB).toEqual({ ok: true, id: "CRT-0002", path: ".crt/tasks/CRT-0002-cart-total-excludes-applied-discount.md" });
    // The route emitted task_written like the in-process tool does, and the registry learned the id.
    const viaRoute = await collect(`/__crt/sessions/${b.id}/events`, (e) => e.type === "task_written");
    expect(viaRoute.events.find((e) => e.type === "task_written")).toEqual({ type: "task_written", id: "CRT-0002", path: wroteB.path });
    expect(registry.get(b.id)?.taskId).toBe("CRT-0002");
    // Same file apart from the id, the session, the capture id and the timestamps.
    const normalise = (text: string, id: string, session: string, capture: string) =>
      text.split(id).join("CRT-NNNN").split(session).join("SESSION").split(capture).join("CAPTURE").replace(/\d{4}-\d{2}-\d{2}T[\d:+.-]+/g, "TIME");
    const fileA = normalise(readFileSync(join(root, wroteA.path), "utf8"), wroteA.id, a.id, capA.id);
    const fileB = normalise(readFileSync(join(root, wroteB.path), "utf8"), wroteB.id, b.id, capB.id);
    expect(fileB).toBe(fileA);
    expect(fileB).toContain("provider: stub");
    // Bad arguments are a 400 with the first problem named; a stale token a bare 404.
    const bad = await fetch(crt + INTERNAL_WRITE_TASK_PATH, { method: "POST", headers: { authorization: `Bearer ${registry.tokenOf(b.id)!}`, "content-type": "application/json" }, body: JSON.stringify({ title: "x" }) });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toMatch(/^title: /);
    registry.close(a.id);
    registry.close(b.id);
    const stale = await fetch(crt + INTERNAL_WRITE_TASK_PATH, { method: "POST", headers: { authorization: `Bearer ${registry.tokenOf(b.id)!}` }, body: "{}" });
    expect(stale.status).toBe(404);
    expect(await stale.text()).toBe("");
  });

  it("first-message providers get the instructions above the capture with the quick-note sentinel still last; sandboxed ones get images by path and no cards (F-46, F-50, F-51)", async () => {
    const sandboxed = new ProviderRegistry({ root, env: { CRT_SESSION_STUB: "sandboxed" }, profiles: [makeStubProfile("sandboxed")], log: () => undefined });
    await sandboxed.refresh();
    const reg = new SessionRegistry({ projectRoot: root, tasksDir: join(root, ".crt", "tasks"), intakePrompt: "INTAKE for $ARGUMENTS", providers: sandboxed, permissionTimeoutMs: 200 });
    const cap = writeCapture(root, samplePost());
    const info = reg.create(cap.id, { quick: true });
    expect(info.provider).toBe("stub");
    const events: SessionEvent[] = [];
    reg.subscribe(info.id, 0, (_s, e) => events.push(e));
    await new Promise<void>((resolve) => {
      const tick = () => (events.some((e) => e.type === "state" && e.state === "idle") ? resolve() : setTimeout(tick, 10));
      tick();
    });
    const first = events[0] as Extract<SessionEvent, { type: "user" }>;
    expect(first.text.startsWith(`${FIRST_MESSAGE_HEADING}\n\nINTAKE for the capture directory named in the first message\n\n---\n\nCRT intake for capture ${cap.id}.`)).toBe(true);
    expect(first.text.trim().split(/\n{2,}/).at(-1)).toBe(QUICK_NOTE_INSTRUCTIONS);
    expect(first.images).toEqual(["viewport (annotated)", "annotation 1", "annotation 2"]);
    // The variant's own checks (heading, no system prompt, no base64) all passed: no error events.
    expect(events.filter((e) => e.type === "error")).toEqual([]);
    expect(events.some((e) => e.type === "permission")).toBe(false);
    expect(events.find((e) => e.type === "init")).toMatchObject({ capabilities: { permissions: "sandboxed", images: "path", instructions: "first-message" } });
    expect(events.find((e) => e.type === "task_written")).toBeDefined();
    // The same registry with the default stub keeps the instructions out of the message (F-51 `system`).
    const capD = writeCapture(root, samplePost());
    const d = (await api("POST", "/__crt/sessions", { captureId: capD.id })).json as { id: string };
    const plain = await collect(`/__crt/sessions/${d.id}/events`, (e) => e.type === "init");
    expect((plain.events[0] as { text: string }).text.startsWith(`CRT intake for capture ${capD.id}.`)).toBe(true);
    reg.closeAll();
    registry.close(d.id);
  });

  it("answers 503 when the server has no session registry", async () => {
    const bare = createProxyServer({ target: fixture.url, projectRoot: root, overlayPath: join(root, "overlay.js") });
    await new Promise<void>((r) => bare.listen(0, "127.0.0.1", r));
    const res = await fetch(`http://localhost:${(bare.address() as { port: number }).port}/__crt/sessions`);
    expect(res.status).toBe(503);
    bare.closeAllConnections();
    await new Promise<void>((r) => bare.close(() => r()));
  });
});
