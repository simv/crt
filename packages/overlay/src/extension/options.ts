/**
 * The extension's options page (PRD-extension §5.4, F-164): the default CRT server port, the CRT
 * servers running on this machine, and — per site that is turned on — which of them that site's
 * reviews go to. One server is one project, so choosing the server is choosing the project.
 *
 * N-43: the only requests made here are health reads of loopback ports (`scanTargets`: 4400 and
 * the default with their fallbacks, and the servers already chosen), and a choice is stored only as a loopback origin. What a health
 * answer says (the project's folder, the version) is shown as text and used for nothing else.
 */
import { DEFAULT_SERVER, type FoundServer, foundServer, loopbackServer, ROUTES_KEY, routeFor, scanTargets, SERVER_KEY, serverForPort, serverLabel, sitesOf } from "./wire.js";

const HEALTH_PATH = "/__crt/health";
const SCAN_TIMEOUT_MS = 1_200;

const port = document.getElementById("port") as HTMLInputElement;
const note = document.getElementById("note") as HTMLElement;
const sitesList = document.getElementById("sites") as HTMLElement;
const serversList = document.getElementById("servers") as HTMLElement;
const refresh = document.getElementById("refresh") as HTMLButtonElement;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};

async function settings(): Promise<{ fallback: string; routes: Record<string, string> }> {
  const stored = await chrome.storage.local.get([SERVER_KEY, ROUTES_KEY]);
  return { fallback: loopbackServer(stored[SERVER_KEY]) ?? DEFAULT_SERVER, routes: { ...(stored[ROUTES_KEY] as Record<string, string> | undefined) } };
}

/** One loopback health read; null when nothing answers in time or the answer is not a CRT server's. */
async function probe(server: string): Promise<FoundServer | null> {
  try {
    const res = await fetch(server + HEALTH_PATH, { cache: "no-store", credentials: "omit", signal: AbortSignal.timeout(SCAN_TIMEOUT_MS) });
    return res.ok ? foundServer(server, await res.json()) : null;
  } catch {
    return null;
  }
}

async function scan(fallback: string, routes: Record<string, string>): Promise<FoundServer[]> {
  return (await Promise.all(scanTargets(fallback, routes).map(probe))).filter((f): f is FoundServer => f !== null);
}

async function render(): Promise<void> {
  const { fallback, routes } = await settings();
  port.value = new URL(fallback).port || "80";
  const sites = sitesOf(await chrome.scripting.getRegisteredContentScripts());
  const found = await scan(fallback, routes);
  const labelOf = (server: string) => {
    const f = found.find((x) => x.server === server);
    return f ? serverLabel(f) : `port ${new URL(server).port || "80"} — not running`;
  };

  serversList.replaceChildren(
    ...(found.length
      ? found.map((f) => {
          const li = el("li", serverLabel(f));
          li.append(el("span", `${f.projectRoot ?? "unknown folder"} · CRT ${f.version ?? "unknown version"}`));
          return li;
        })
      : [el("li", "None found. Start one with crt in a project's folder, then Refresh.")]),
  );

  sitesList.replaceChildren(
    ...(sites.length
      ? sites.map((site) => {
          const li = el("li");
          li.className = "site";
          const select = el("select");
          select.setAttribute("aria-label", `Where reviews of ${site} go`);
          const chosen = Object.hasOwn(routes, site) ? loopbackServer(routes[site]) : null;
          select.append(new Option(`Default (${labelOf(fallback)})`, ""));
          for (const server of new Set([...found.map((f) => f.server), ...(chosen ? [chosen] : [])])) select.append(new Option(labelOf(server), server));
          select.value = chosen ?? "";
          select.addEventListener("change", () => void choose(site, select.value));
          li.append(el("code", site), select);
          return li;
        })
      : [el("li", "No site is turned on yet. Click the CRT button in the toolbar on a site, then come back.")]),
  );
}

/** F-164: store one site's route (a loopback origin), or drop it for the default. */
async function choose(site: string, value: string): Promise<void> {
  const { fallback, routes } = await settings();
  const server = loopbackServer(value);
  if (server) routes[site] = server;
  else delete routes[site];
  await chrome.storage.local.set({ [ROUTES_KEY]: routes });
  note.textContent = `Saved. Reviews of ${site} go to ${routeFor(site, routes, fallback)} from the page's next load.`;
}

port.addEventListener("change", () => {
  const server = serverForPort(port.value);
  if (!server) {
    note.textContent = "A port is a number from 1 to 65535.";
    return;
  }
  void chrome.storage.local.set({ [SERVER_KEY]: server }).then(() => {
    note.textContent = `Saved. Sites with no choice of their own talk to ${server} from their next load.`;
    return render();
  });
});
refresh.addEventListener("click", () => void render());
void render();
