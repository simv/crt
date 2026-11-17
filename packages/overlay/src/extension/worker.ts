/**
 * The extension's service worker (PRD-extension §5.1, §5.3, §5.4; F-155, F-157, F-158; built to
 * `dist/extension/worker.js`). It knows which sites are on, and it is the only part that talks to
 * the CRT server: a page's own network context cannot (docs/spikes/extension-2026-11.md rows 1
 * and 5), and the worker's can, under the extension's host permission for loopback (row 6).
 *
 * N-43: its one network peer is the configured CRT origin, which is loopback or refused
 * (`loopbackServer`). It changes no header (there is no `declarativeNetRequest` here), runs no
 * remote code, and reads nothing of a site that was not turned on. N-42: it answers only its own
 * content scripts — a message must come from this extension, from a tab's top frame — and for
 * them it requests only `/__crt/` routes that are not `/__crt/internal/` (`isCrtApiPath`).
 *
 * The worker may be stopped at any time. Everything it needs is in `chrome.storage` or in the
 * registrations themselves; a stream it was relaying is reopened by the content script, and the
 * session lives in the CRT server.
 */
import type { StorageArea } from "../storage.js";
import {
  type BadgeState,
  type CaptureAnswer,
  EVENTS_PORT,
  type Hello,
  isCrtApiPath,
  type JsonAnswer,
  PAGE_HEADER,
  ROUTES_KEY,
  routeFor,
  SERVER_KEY,
  siteOf,
  sitePatterns,
  siteScripts,
  sitesOf,
  sseParser,
  type Stored,
  type StreamMessage,
  type StreamOpen,
  type ToContent,
  type ToWorker,
  VIA_EXTENSION,
  VIA_HEADER,
} from "./wire.js";

/** The CRT origin a site's requests go to: its route (F-164), else the default server; loopback or ignored (N-43). */
async function server(origin: string): Promise<string> {
  const stored = await chrome.storage.local.get([SERVER_KEY, ROUTES_KEY]);
  return routeFor(origin, stored[ROUTES_KEY], stored[SERVER_KEY]);
}

/** F-164: a site that is turned off is forgotten, its route with it. */
async function forgetRoute(origin: string): Promise<void> {
  const routes = { ...((await chrome.storage.local.get(ROUTES_KEY))[ROUTES_KEY] as Record<string, string> | undefined) };
  if (!Object.hasOwn(routes, origin)) return;
  delete routes[origin];
  await chrome.storage.local.set({ [ROUTES_KEY]: routes });
}

async function sitesOn(): Promise<string[]> {
  return sitesOf(await chrome.scripting.getRegisteredContentScripts());
}

/** Tabs turned on by a click whose permission prompt was declined: on until the tab goes, remembered nowhere else. */
const TAB_ONLY_KEY = "tabOnly";
async function tabOnly(): Promise<Record<string, string>> {
  return ((await chrome.storage.session.get(TAB_ONLY_KEY))[TAB_ONLY_KEY] as Record<string, string> | undefined) ?? {};
}

// ---- storage for the overlay (F-153): per site in `local`, per tab and site in `session` --------

const localKey = (origin: string) => `site:${origin}`;
const sessionKey = (tabId: number, origin: string) => `tab:${tabId}:${origin}`;

async function stored(tabId: number, origin: string): Promise<Stored> {
  const [l, s] = await Promise.all([chrome.storage.local.get(localKey(origin)), chrome.storage.session.get(sessionKey(tabId, origin))]);
  return { local: (l[localKey(origin)] as Record<string, string> | undefined) ?? {}, session: (s[sessionKey(tabId, origin)] as Record<string, string> | undefined) ?? {} };
}

/** Writes are applied one after another, so two quick ones cannot lose each other. */
let writes: Promise<unknown> = Promise.resolve();
function store(tabId: number, origin: string, which: StorageArea, key: string, value: string | null): void {
  const area = which === "local" ? chrome.storage.local : chrome.storage.session;
  const name = which === "local" ? localKey(origin) : sessionKey(tabId, origin);
  writes = writes
    .then(async () => {
      const map = ((await area.get(name))[name] as Record<string, string> | undefined) ?? {};
      if (value === null) delete map[key];
      else map[key] = value;
      if (Object.keys(map).length) await area.set({ [name]: map });
      else await area.remove(name);
    })
    .catch(() => undefined);
}

// ---- on and off (F-155) -------------------------------------------------------------------------

const BADGE: Record<BadgeState, { text: string; color: string; title: string }> = {
  on: { text: "on", color: "#1f8f4e", title: "CRT is on for this site — click to turn it off" },
  "no server": { text: "!", color: "#b3261e", title: "CRT is on for this site, but no CRT server answered — run `crt` in the project" },
  mismatch: { text: "!", color: "#b3261e", title: "CRT is on for this site, but the extension and the CRT server are different versions — run `crt extension`, then Reload" },
  off: { text: "", color: "#666666", title: "CRT — click to review this site" },
};

async function showBadge(tabId: number, state: BadgeState, title?: string): Promise<void> {
  const b = BADGE[state];
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text: b.text }),
    chrome.action.setBadgeBackgroundColor({ tabId, color: b.color }),
    chrome.action.setTitle({ tabId, title: title ?? b.title }),
  ]).catch(() => undefined);
}

async function inject(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["probe.js"], world: "MAIN", injectImmediately: true });
  await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"], world: "ISOLATED", injectImmediately: true });
}

const tell = (tabId: number, message: ToContent) => chrome.tabs.sendMessage(tabId, message).catch(() => undefined);

/**
 * F-155: the toolbar button (or its shortcut) on a tab. Off → on: the one origin's permission,
 * the two registrations, and the scripts into this page at once. On → off: the reverse, and CRT's
 * element leaves every open page of the site. Returns the state the tab is left in.
 */
export async function toggle(tab: { id?: number; url?: string }): Promise<BadgeState | "unsupported"> {
  const tabId = tab.id;
  const origin = siteOf(tab.url);
  if (tabId === undefined) return "unsupported";
  if (!origin) {
    // chrome://, the Web Store, a file: a page Chrome does not let an extension touch.
    await showBadge(tabId, "off", "CRT cannot run on this page — open a site over http or https");
    return "unsupported";
  }
  const { permission } = sitePatterns(origin);
  const once = await tabOnly();
  const on = (await sitesOn()).includes(origin) || once[String(tabId)] === origin;

  if (on) {
    await chrome.scripting.unregisterContentScripts({ ids: siteScripts(origin).map((s) => s.id) }).catch(() => undefined);
    delete once[String(tabId)];
    await chrome.storage.session.set({ [TAB_ONLY_KEY]: once });
    // What the overlay kept for the site goes with it — after any write still on its way.
    await writes;
    const kept = Object.keys(await chrome.storage.session.get(null)).filter((k) => k.startsWith("tab:") && k.endsWith(`:${origin}`));
    await Promise.all([chrome.storage.local.remove(localKey(origin)), kept.length ? chrome.storage.session.remove(kept) : undefined, forgetRoute(origin)]);
    // Keep the permission while another origin on the same host is still on (a pattern has no port); loopback is the extension's own.
    const hostStillOn = (await sitesOn()).some((o) => sitePatterns(o).permission === permission);
    if (!hostStillOn) await chrome.permissions.remove({ origins: [permission] }).catch(() => false);
    // Every open page of the site, not only this tab (the pattern has no port, so the origin is checked here).
    const open = await chrome.tabs.query({ url: permission }).catch(() => [] as chrome.tabs.Tab[]);
    const ids = new Set([tabId, ...open.filter((t) => siteOf(t.url) === origin).map((t) => t.id)]);
    for (const id of ids) {
      const t = { id };
      if (t.id === undefined) continue;
      await tell(t.id, { kind: "off" });
      await showBadge(t.id, "off");
    }
    return "off";
  }

  // The click is the user's gesture: Chrome shows its own prompt for this one origin the first time.
  const granted = (await chrome.permissions.contains({ origins: [permission] })) || (await chrome.permissions.request({ origins: [permission] }).catch(() => false));
  if (granted) {
    await chrome.scripting.unregisterContentScripts({ ids: siteScripts(origin).map((s) => s.id) }).catch(() => undefined);
    await chrome.scripting.registerContentScripts(siteScripts(origin));
  } else {
    // Declined: the click still lets CRT into this tab for now (`activeTab`); nothing is remembered.
    once[String(tabId)] = origin;
    await chrome.storage.session.set({ [TAB_ONLY_KEY]: once });
  }
  await showBadge(tabId, "on");
  try {
    await inject(tabId);
    await tell(tabId, { kind: "on" }); // a page that was turned off and on again without a reload
  } catch (err) {
    await showBadge(tabId, "off", `CRT could not start on this page: ${err instanceof Error ? err.message : String(err)}`);
    return "unsupported";
  }
  return "on";
}

chrome.action.onClicked.addListener((tab) => void toggle(tab));

chrome.tabs.onRemoved.addListener((tabId) => {
  void (async () => {
    const once = await tabOnly();
    if (once[String(tabId)]) {
      delete once[String(tabId)];
      await chrome.storage.session.set({ [TAB_ONLY_KEY]: once });
    }
    const all = await chrome.storage.session.get(null);
    const gone = Object.keys(all).filter((k) => k.startsWith(`tab:${tabId}:`));
    if (gone.length) await chrome.storage.session.remove(gone);
  })().catch(() => undefined);
});

// ---- the bridge (F-157) -------------------------------------------------------------------------

/** N-42: a message is taken from this extension's own content script in a tab's top frame, on an http(s) page, and from nothing else. */
function pageOf(sender: chrome.runtime.MessageSender): { tabId: number; windowId: number; origin: string } | null {
  if (sender.id !== chrome.runtime.id || sender.tab?.id === undefined || (sender.frameId ?? 0) !== 0) return null;
  const origin = siteOf(sender.url ?? sender.tab.url);
  return origin ? { tabId: sender.tab.id, windowId: sender.tab.windowId, origin } : null;
}

const viaHeaders = (origin: string) => ({ [VIA_HEADER]: VIA_EXTENSION, [PAGE_HEADER]: origin });

async function json(origin: string, path: unknown, init: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<JsonAnswer> {
  if (!isCrtApiPath(path)) return { failed: "not a CRT route" };
  try {
    const res = await fetch((await server(origin)) + path, {
      method: init.method ?? "GET",
      headers: { ...init.headers, ...viaHeaders(origin) },
      ...(typeof init.body === "string" ? { body: init.body } : {}),
      cache: "no-store",
      credentials: "omit",
    });
    const data: unknown = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } catch (err) {
    return { failed: err instanceof Error ? err.message : String(err) };
  }
}

async function capture(windowId: number): Promise<CaptureAnswer> {
  try {
    const url = await chrome.tabs.captureVisibleTab(windowId, { format: "png" });
    const comma = url.indexOf(",");
    return comma > 0 ? { ok: true, png: url.slice(comma + 1) } : { ok: false, error: "the capture was empty" };
  } catch (err) {
    // F-158: the click's grant has lapsed (or the tab is not the visible one): the overlay falls back.
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function answer(message: ToWorker, page: { tabId: number; windowId: number; origin: string }): Promise<unknown> {
  switch (message.kind) {
    case "hello": {
      const on = (await sitesOn()).includes(page.origin) || (await tabOnly())[String(page.tabId)] === page.origin;
      const hello: Hello = { on, server: await server(page.origin), version: chrome.runtime.getManifest().version, stored: on ? await stored(page.tabId, page.origin) : {} };
      return hello;
    }
    case "json":
      return json(page.origin, message.path, message.init);
    case "capture":
      return capture(page.windowId);
    case "store":
      if (typeof message.key === "string" && (message.area === "local" || message.area === "session") && (message.value === null || typeof message.value === "string")) {
        store(page.tabId, page.origin, message.area, message.key, message.value);
      }
      return true;
    case "badge":
      if (message.state in BADGE) await showBadge(page.tabId, message.state);
      return true;
  }
}

chrome.runtime.onMessage.addListener((raw, sender, reply) => {
  const page = pageOf(sender);
  const message = raw as ToWorker | null;
  if (!page || !message || typeof message.kind !== "string") return false;
  answer(message, page).then(reply, () => reply(undefined));
  return true; // the answer comes later
});

chrome.runtime.onConnect.addListener((port) => {
  const page = port.sender ? pageOf(port.sender) : null;
  if (port.name !== EVENTS_PORT || !page) {
    port.disconnect();
    return;
  }
  const abort = new AbortController();
  let started = false;
  const post = (m: StreamMessage) => {
    try {
      port.postMessage(m);
    } catch {
      abort.abort(); // the page went away
    }
  };
  port.onDisconnect.addListener(() => abort.abort());
  port.onMessage.addListener((raw) => {
    const open = raw as Partial<StreamOpen> & { ping?: true };
    if (open.ping || started) return; // a ping only has to arrive: it resets the worker's idle timer
    started = true;
    void (async () => {
      if (!isCrtApiPath(open.path)) return post({ end: "closed" });
      try {
        const res = await fetch((await server(page.origin)) + open.path, {
          headers: { accept: "text/event-stream", ...viaHeaders(page.origin), ...(open.lastEventId ? { "last-event-id": String(open.lastEventId) } : {}) },
          cache: "no-store",
          credentials: "omit",
          signal: abort.signal,
        });
        // As EventSource: anything but a 200 event stream is final (the session is gone), a drop is not.
        if (res.status !== 200 || !res.body) return post({ end: "closed" });
        post({ open: true });
        const parser = sseParser();
        const reader = res.body.getReader();
        const text = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const event of parser.push(text.decode(value, { stream: true }))) post({ event });
        }
        post({ end: "dropped" });
      } catch {
        if (!abort.signal.aborted) post({ end: "dropped" });
      }
    })();
  });
});

// The e2e drives the same function the click calls (F-155): Playwright cannot press a toolbar button.
(globalThis as unknown as { crtToggle?: typeof toggle }).crtToggle = toggle;
