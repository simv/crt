import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { request as httpRequest, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startFixture, type Fixture } from "../e2e/fixture/server.mjs";
import { writeCapture } from "../src/captures.js";
import { createProxyServer } from "../src/proxy.js";
import { stubProfile } from "../src/providers/stub.js";
import { ProviderRegistry } from "../src/session.js";
import type { SessionEvent } from "../src/session-events.js";
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
  proxy = createProxyServer({ target: fixture.url, projectRoot: root, overlayPath: join(root, "overlay.js"), sessions: registry });
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
  crt = `http://localhost:${(proxy.address() as { port: number }).port}`;
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

/** Read the SSE stream until `until(event)` is true (or the stream ends); returns every event seen. */
function collect(
  path: string,
  until: (e: SessionEvent, all: SessionEvent[]) => boolean,
  headers: Record<string, string> = {},
): Promise<{ events: SessionEvent[]; ids: number[] }> {
  return new Promise((resolve, reject) => {
    const events: SessionEvent[] = [];
    const ids: number[] = [];
    const req = httpRequest(crt + path, { headers }, (res) => {
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/event-stream");
      let buf = "";
      const finish = () => {
        res.destroy();
        resolve({ events, ids });
      };
      res.on("data", (c: Buffer) => {
        buf += c.toString("utf8");
        let idx: number;
        while ((idx = buf.indexOf("\n\n")) !== -1) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          if (frame.startsWith(":")) continue;
          const id = /^id: (\d+)$/m.exec(frame);
          const data = /^data: (.*)$/m.exec(frame);
          if (!data) continue;
          const event = JSON.parse(data[1]!) as SessionEvent;
          events.push(event);
          if (id) ids.push(Number(id[1]));
          if (until(event, events)) return finish();
        }
      });
      res.on("end", () => resolve({ events, ids }));
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
    expect(events[0]).toEqual({ type: "error", message: 'provider "nope" is not a built-in provider (claude, codex)' });
    expect(events[1]).toMatchObject({ type: "state", state: "error" });
    // F-30: the row stays listable and the session cannot be driven.
    expect(strict.list().map((s) => s.id)).toContain(info.id);
    expect(strict.send(info.id, "hi")).toBe(false);
    strict.closeAll();
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
