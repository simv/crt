import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  answerPermission,
  attachSessionCapture,
  closeSession,
  crtJson,
  fetchProviders,
  interruptSession,
  isSessionAlive,
  listSessions,
  onRequestFailure,
  postCapture,
  saveProvider,
  sendSessionMessage,
  sessionEventsUrl,
  startSession,
} from "../../overlay/src/api.js";
import { samplePost } from "./helpers/sample-capture.js";

// CRT-0043: the overlay's one /__crt/ client. `fetch` is stubbed; each test says what the server
// answers and reads back what the overlay asked for. Relative paths: behind the proxy (and in
// Node) the CRT origin is "" (base.ts, F-6).

type Answer = { status?: number; body?: unknown } | "network error";

let calls: Array<{ url: string; method: string; body: unknown; contentType: string | null }>;
let failures: number;

function answer(a: Answer): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const headers = new Headers(init.headers);
      calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined, contentType: headers.get("content-type") });
      if (a === "network error") throw new TypeError("Failed to fetch");
      const text = typeof a.body === "string" ? a.body : JSON.stringify(a.body ?? {});
      return new Response(text, { status: a.status ?? 200, headers: { "content-type": "application/json" } });
    }),
  );
}

beforeEach(() => {
  calls = [];
  failures = 0;
  onRequestFailure(() => failures++);
});

afterEach(() => {
  onRequestFailure(null);
  vi.unstubAllGlobals();
});

describe("crtJson (CRT-0043)", () => {
  it("returns the answer of a 2xx that says ok: true, and reports no failure (F-81)", async () => {
    answer({ body: { ok: true, n: 1 } });
    await expect(crtJson<{ n: number }>("/__crt/x")).resolves.toEqual({ ok: true, n: 1 });
    expect(failures).toBe(0);
  });

  it("throws the server's error line, else the status, and reports each failure once (F-81)", async () => {
    answer({ status: 409, body: { ok: false, error: "already has a capture" } });
    await expect(crtJson("/__crt/x")).rejects.toThrow("already has a capture");
    answer({ status: 500, body: "<html>not json</html>" });
    await expect(crtJson("/__crt/x")).rejects.toThrow("CRT server answered 500");
    answer({ status: 409, body: { ok: true } }); // a busy session: 409 even with ok: true
    await expect(crtJson("/__crt/x")).rejects.toThrow("CRT server answered 409");
    answer({ status: 200, body: { ok: false } });
    await expect(crtJson("/__crt/x")).rejects.toThrow("CRT server answered 200");
    answer("network error");
    await expect(crtJson("/__crt/x")).rejects.toThrow("Failed to fetch");
    expect(failures).toBe(5);
  });

  it("throws when a field the caller needs is missing (F-13, F-24)", async () => {
    answer({ status: 201, body: { ok: true } });
    await expect(crtJson<{ id: string }>("/__crt/x", undefined, ["id"])).rejects.toThrow("CRT server answered 201");
    expect(failures).toBe(1);
  });
});

describe("one function per route the overlay calls (CRT-0043)", () => {
  it("postCapture POSTs the bundle as JSON to /__crt/captures and returns where it went (F-13)", async () => {
    answer({ status: 201, body: { ok: true, id: "20260928-0001", dir: ".crt/captures/20260928-0001", files: ["capture.json"] } });
    const post = samplePost();
    await expect(postCapture(post)).resolves.toEqual({ id: "20260928-0001", dir: ".crt/captures/20260928-0001", files: ["capture.json"] });
    expect(calls).toEqual([{ url: "/__crt/captures", method: "POST", body: post, contentType: "application/json" }]);
  });

  it("startSession sends only what was chosen: the capture, quick, the per-send provider (F-24, F-14, F-56)", async () => {
    answer({ status: 201, body: { ok: true, id: "s1" } });
    await expect(startSession("c1", { quick: true, provider: "codex" })).resolves.toBe("s1");
    await expect(startSession(null, { provider: null })).resolves.toBe("s1");
    expect(calls.map((c) => [c.url, c.method, c.body])).toEqual([
      ["/__crt/sessions", "POST", { captureId: "c1", quick: true, provider: "codex" }],
      ["/__crt/sessions", "POST", {}],
    ]);
  });

  it("the session routes: capture, messages, interrupt, permission, DELETE and the event stream (F-25, F-26, F-29, N-2)", async () => {
    answer({ status: 202, body: { ok: true } });
    await attachSessionCapture("s1", "c1");
    await sendSessionMessage("s1", "yes");
    await interruptSession("s1");
    await answerPermission("s1", "p1", "deny");
    await closeSession("s1");
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ["POST", "/__crt/sessions/s1/capture", { captureId: "c1" }],
      ["POST", "/__crt/sessions/s1/messages", { text: "yes" }],
      ["POST", "/__crt/sessions/s1/interrupt", undefined],
      ["POST", "/__crt/sessions/s1/permission", { id: "p1", behavior: "deny" }],
      ["DELETE", "/__crt/sessions/s1", undefined],
    ]);
    expect(sessionEventsUrl("s1", 42)).toBe("/__crt/sessions/s1/events?after=42");
  });

  it("listSessions returns the list; a missing list is a failure (F-30)", async () => {
    answer({ body: { ok: true, sessions: [{ id: "s1" }] } });
    await expect(listSessions()).resolves.toEqual([{ id: "s1" }]);
    answer({ body: { ok: true } });
    await expect(listSessions()).rejects.toThrow("CRT server answered 200");
  });

  it("isSessionAlive is true for a live session and false otherwise, and a gone session is not a failure (F-66)", async () => {
    answer({ body: { ok: true, session: {} } });
    await expect(isSessionAlive("s1")).resolves.toBe(true);
    answer({ status: 404, body: { ok: false, error: "no session s1" } });
    await expect(isSessionAlive("s1")).resolves.toBe(false);
    answer("network error");
    await expect(isSessionAlive("s1")).resolves.toBe(false);
    expect(failures).toBe(0);
  });

  it("fetchProviders GETs the list, ?refresh=1 re-runs the preflight; saveProvider PUTs the choice (F-56, F-57)", async () => {
    const payload = { ok: true, active: "claude", decision: { provider: "claude", reason: null }, providers: [] };
    answer({ body: payload });
    await expect(fetchProviders(false)).resolves.toEqual(payload);
    await expect(fetchProviders(true)).resolves.toEqual(payload);
    answer({ body: { ok: true, active: "codex", provider: "codex", file: ".crt/config.local.json" } });
    await expect(saveProvider("codex")).resolves.toBe("codex");
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ["GET", "/__crt/providers", undefined],
      ["GET", "/__crt/providers?refresh=1", undefined],
      ["PUT", "/__crt/config", { provider: "codex" }],
    ]);
    answer({ body: { ok: true, providers: [] } });
    await expect(fetchProviders(false)).rejects.toThrow("CRT server answered 200"); // no active provider
  });
});
