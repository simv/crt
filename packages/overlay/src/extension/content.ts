/**
 * The extension's isolated-world half (PRD-extension §5.1, §5.2, F-156…F-159; built to
 * `dist/extension/content.js`): the overlay itself, in a world the page cannot see into. It puts
 * the four seams in place — the transport and the storage through the service worker, the probe
 * through the page-world half, the rasteriser through the browser's own capture of the tab — and
 * then mounts the same overlay the other three ways in run (mount.ts), in a closed shadow root.
 *
 * Nothing here is reachable from the page: no global is set in its world, `chrome.runtime` does
 * not exist there, and the root is closed (N-42). Nothing is written to the site: no storage, no
 * cookie, no header (N-44).
 */
import { HEALTH_PATH } from "../../../server/src/routes.js";
import type { HealthPayload } from "../health.js";
import { mountPill, type PillHandle, pillText } from "../loader.js";
import { mountOverlay } from "../mount.js";
import { remoteProbe } from "../probe-wire.js";
import { setProbe } from "../probe.js";
import { pageRasteriser, type Rasteriser, setRasteriser } from "../screenshot.js";
import { memoryStorage, setStorageBacking } from "../storage.js";
import { type CrtAnswer, setTransport, type Transport, transport } from "../transport.js";
import { cleaners } from "./clean.js";
import { type BadgeState, type CaptureAnswer, EVENTS_PORT, type Hello, type JsonAnswer, mismatchLine, sameMinor, type StreamMessage, type StreamOpen, type ToContent, type ToWorker } from "./wire.js";

/** F-157: how long a dropped stream waits before it reconnects (EventSource's own default). */
const RECONNECT_MS = 3000;
/** F-157: a message on the port at least this often keeps the service worker from idling out under a quiet stream. */
const PING_MS = 20_000;

function send<T>(message: ToWorker): Promise<T> {
  return chrome.runtime.sendMessage(message) as Promise<T>;
}

/** F-151 / F-157: the transport through the service worker. */
function workerTransport(server: string): Transport {
  return {
    async json(path, init) {
      const answer = await send<JsonAnswer | undefined>({ kind: "json", path, ...(init ? { init } : {}) });
      if (!answer || "failed" in answer) throw new TypeError(answer?.failed ?? "the CRT extension did not answer");
      return answer satisfies CrtAnswer;
    },
    events(path, handlers, types = []) {
      let port: chrome.runtime.Port | null = null;
      let closed = false;
      let lastEventId = "";
      let retry: ReturnType<typeof setTimeout> | undefined;
      let ping: ReturnType<typeof setInterval> | undefined;
      const drop = (final: boolean) => {
        clearInterval(ping);
        port = null;
        if (closed) return;
        if (final) closed = true;
        handlers.onError(final);
        if (!final) retry = setTimeout(open, RECONNECT_MS);
      };
      const open = () => {
        if (closed) return;
        const p = chrome.runtime.connect({ name: EVENTS_PORT });
        port = p;
        p.onMessage.addListener((raw) => {
          const m = raw as StreamMessage;
          if ("event" in m) {
            if (m.event.id) lastEventId = m.event.id;
            if (m.event.type === "message" || types.includes(m.event.type)) handlers.onEvent(m.event);
          } else if ("end" in m && port === p) {
            p.disconnect();
            drop(m.end === "closed");
          }
        });
        // The worker was stopped or restarted: the stream is gone with it, the session is not (it lives in the CRT server).
        p.onDisconnect.addListener(() => {
          if (port === p) drop(false);
        });
        p.postMessage({ path, lastEventId } satisfies StreamOpen);
        ping = setInterval(() => p.postMessage({ ping: true } satisfies StreamMessage), PING_MS);
      };
      open();
      return {
        close() {
          closed = true;
          clearTimeout(retry);
          clearInterval(ping);
          port?.disconnect();
          port = null;
        },
      };
    },
    url: (path) => server + path,
    origin: () => server,
  };
}

/** Two frames, so the hidden overlay is really off the screen before the tab is captured; a background tab gets no frames, hence the timer. */
function painted(): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, 150);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      }),
    );
  });
}

/**
 * F-158: the browser's own picture of the tab, with CRT's UI hidden for that frame (the markers
 * are drawn onto a copy afterwards, as always). When Chrome refuses — the click's grant has
 * lapsed — the in-page rasteriser makes the picture and the capture says so.
 */
const tabRasteriser: Rasteriser = async () => {
  const host = document.getElementById("crt-host");
  const was = host?.style.visibility ?? "";
  let shot: CaptureAnswer | undefined;
  try {
    if (host) host.style.visibility = "hidden";
    await painted();
    shot = await send<CaptureAnswer | undefined>({ kind: "capture" }).catch(() => undefined);
  } finally {
    if (host) host.style.visibility = was;
  }
  if (!shot?.ok) return { canvas: (await pageRasteriser()).canvas, via: "page" };
  // Decoded here from bytes: no image element and no fetch, so the page's policy has no say.
  const bytes = Uint8Array.from(atob(shot.png), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return { canvas, via: "browser" };
};

function ready(): Promise<void> {
  if (document.readyState !== "loading") return Promise.resolve();
  return new Promise((resolve) => document.addEventListener("DOMContentLoaded", () => resolve(), { once: true }));
}

const badge = (state: BadgeState) => void send({ kind: "badge", state }).catch(() => undefined);

async function start(): Promise<void> {
  const hello = await send<Hello | undefined>({ kind: "hello" }).catch(() => undefined);
  if (!hello?.on) return; // F-155: not a site the developer turned on

  setTransport(workerTransport(hello.server));
  setStorageBacking(memoryStorage(hello.stored, (area, key, value) => void send({ kind: "store", area, key, value }).catch(() => undefined)));
  const probe = remoteProbe(() => document.documentElement, cleaners);
  setProbe(probe);
  setRasteriser(tabRasteriser);

  await ready();
  let host: HTMLElement | null = null;
  let pill: PillHandle | null = null;
  let dismissed = false;
  let off = false;

  const say = (line: string, retry: () => void) => {
    pill?.remove();
    if (dismissed) return;
    pill = mountPill(line, retry, () => (dismissed = true));
    pill.show();
  };

  /** F-159: mount, or say in one line why not — never a silent nothing. */
  const mount = async (): Promise<void> => {
    if (off || host) return;
    if (probe.present()) {
      // F-156: the integration, the proxy or the CRT browser is already here, with the server's own overlay.
      console.info("CRT: this page already has CRT, so the CRT extension stands down here.");
      badge("off");
      return;
    }
    const health = await transport()
      .json(HEALTH_PATH, { cache: "no-store" })
      .then(
        (a) => (a.ok && a.data && typeof a.data === "object" ? (a.data as HealthPayload) : null),
        () => null,
      );
    if (off || host) return;
    if (!health?.ok) {
      badge("no server");
      say(pillText(hello.server), () => void mount());
      return;
    }
    if (!sameMinor(hello.version, health.version)) {
      badge("mismatch"); // N-45
      say(mismatchLine(hello.version, health.version), () => void mount());
      return;
    }
    pill?.remove();
    pill = null;
    host = mountOverlay({ closed: true });
    badge("on");
  };

  // F-159: the server was started after the page: retry once per user action, never on a timer (the loader's rule, N-20).
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void mount();
  });
  window.addEventListener("focus", () => void mount());

  chrome.runtime.onMessage.addListener((raw) => {
    const m = raw as ToContent;
    if (m?.kind === "off") {
      // F-155: turned off — CRT's element leaves the page; the scripts are already unregistered for the next load.
      off = true;
      host?.remove();
      host = null;
      pill?.remove();
      pill = null;
    } else if (m?.kind === "on") {
      off = false;
      dismissed = false;
      void mount();
    }
  });

  await mount();
}

// One copy per document: the click's immediate injection and the registration can both reach a page.
const world = globalThis as unknown as { __crtContent?: true };
if (window.top === window && !world.__crtContent) {
  world.__crtContent = true;
  void start();
}
