/**
 * The extension's options page (PRD-extension §5.4, F-164): the default CRT server port, the CRT
 * servers running on this machine, and — per site that is turned on — which of them that site's
 * reviews go to. One server is one project, so choosing the server is choosing the project.
 *
 * PRD-connect F-168, F-169: a site's feedback can also stay in this browser, with or without a
 * destination it is sent to from the review page; the destinations — a Claude Code scheduled task's
 * address and token — are added and removed here. Saving one asks Chrome for the one host a send
 * goes to (N-46); nothing is sent from this page.
 *
 * N-43: the only requests made here are health reads of loopback ports (`scanTargets`: 4400 and
 * the default with their fallbacks, and the servers already chosen), and a choice is stored only as a loopback origin. What a health
 * answer says (the project's folder, the version) is shown as text and used for nothing else.
 */
import { BROWSER_ROUTE, CLAUDE_API_PERMISSION, CLAUDE_TASKS_PAGE, type ClaudeDestination, DESTINATIONS_KEY, destinationRoute, newDestination, readDestinations, targetFor, TASK_PROMPTS } from "./destinations.js";
import { DEFAULT_SERVER, type FoundServer, foundServer, loopbackServer, ROUTES_KEY, scanTargets, SERVER_KEY, serverForPort, serverLabel, sitesOf } from "./wire.js";

const HEALTH_PATH = "/__crt/health";
const SCAN_TIMEOUT_MS = 1_200;

const port = document.getElementById("port") as HTMLInputElement;
const note = document.getElementById("note") as HTMLElement;
const sitesList = document.getElementById("sites") as HTMLElement;
const serversList = document.getElementById("servers") as HTMLElement;
const refresh = document.getElementById("refresh") as HTMLButtonElement;
const fallbackSelect = document.getElementById("fallback") as HTMLSelectElement;
const destinationsList = document.getElementById("destinations") as HTMLElement;
const destForm = document.getElementById("add-destination") as HTMLFormElement;
const destNote = document.getElementById("dest-note") as HTMLElement;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  return node;
};

interface Settings {
  /** The default server's origin (the port field), whether or not the default is a server. */
  fallback: string;
  /** The stored default as it is: a loopback origin, `browser`, `dest:<id>`, or undefined for auto (F-165). */
  rawFallback: unknown;
  routes: Record<string, string>;
  destinations: ClaudeDestination[];
}

async function settings(): Promise<Settings> {
  const stored = await chrome.storage.local.get([SERVER_KEY, ROUTES_KEY, DESTINATIONS_KEY]);
  return {
    fallback: loopbackServer(stored[SERVER_KEY]) ?? DEFAULT_SERVER,
    rawFallback: stored[SERVER_KEY],
    routes: { ...(stored[ROUTES_KEY] as Record<string, string> | undefined) },
    destinations: readDestinations(stored[DESTINATIONS_KEY]),
  };
}

const BROWSER_LABEL = "This browser (no server)";
const claudeLabel = (d: ClaudeDestination) => `This browser, then Claude · ${d.name}`;

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
  const { fallback, rawFallback, routes, destinations } = await settings();
  port.value = new URL(fallback).port || "80";
  const base = targetFor("", {}, rawFallback);
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
          const own = Object.hasOwn(routes, site) ? targetFor(site, routes, undefined) : null;
          const chosen = own?.kind === "server" ? own.server : null;
          const defaultLabel = base.kind === "server" ? labelOf(fallback) : base.kind === "auto" ? `${labelOf(DEFAULT_SERVER)}, else this browser` : (destinations.find((d) => d.id === base.destination)?.name ?? "this browser");
          select.append(new Option(`Default (${defaultLabel})`, ""));
          for (const server of new Set([...found.map((f) => f.server), ...(chosen ? [chosen] : [])])) select.append(new Option(labelOf(server), server));
          select.append(new Option(BROWSER_LABEL, BROWSER_ROUTE));
          for (const d of destinations) select.append(new Option(claudeLabel(d), destinationRoute(d.id)));
          select.value = chosen ?? (own?.kind === "browser" ? (own.destination && destinations.some((d) => d.id === own.destination) ? destinationRoute(own.destination) : BROWSER_ROUTE) : "");
          select.addEventListener("change", () => void choose(site, select.value));
          li.append(el("code", site), select);
          return li;
        })
      : [el("li", "No site is turned on yet. Click the CRT button in the toolbar on a site, then come back.")]),
  );

  // F-165: what a site with no choice of its own gets.
  fallbackSelect.replaceChildren(
    new Option("A CRT server on port 4400 when one is running, else this browser", ""),
    new Option("The CRT server on the port below", "server"),
    new Option(BROWSER_LABEL, BROWSER_ROUTE),
    ...destinations.map((d) => new Option(claudeLabel(d), destinationRoute(d.id))),
  );
  fallbackSelect.value = base.kind === "server" ? "server" : base.kind === "auto" ? "" : base.destination && destinations.some((d) => d.id === base.destination) ? destinationRoute(base.destination) : BROWSER_ROUTE;

  // F-169: the saved destinations. The token is never shown again.
  destinationsList.replaceChildren(
    ...(destinations.length
      ? destinations.map((d) => {
          const li = el("li");
          li.className = "site";
          const text = el("div", `Claude · ${d.name}`);
          text.append(el("span", `scheduled task ${/trig_[A-Za-z0-9]+/.exec(d.url)?.[0] ?? ""}`));
          const remove = el("button", "Remove");
          remove.type = "button";
          remove.addEventListener("click", () => void removeDestination(d.id));
          li.append(text, remove);
          return li;
        })
      : [el("li", "None yet.")]),
  );
}

/** F-164, F-168: store one site's choice — a loopback server, this browser, or a destination — or drop it for the default. */
async function choose(site: string, value: string): Promise<void> {
  const { routes, destinations } = await settings();
  const target = targetFor(site, { [site]: value }, undefined);
  if (target.kind === "auto") delete routes[site];
  else routes[site] = value;
  await chrome.storage.local.set({ [ROUTES_KEY]: routes });
  const named = target.kind === "browser" ? destinations.find((d) => d.id === target.destination) : undefined;
  const where = target.kind === "server" ? target.server : target.kind === "auto" ? "the default" : named ? `this browser, then Claude · ${named.name}` : "this browser";
  note.textContent = `Saved. Reviews of ${site} go to ${where} from the page's next load.`;
}

async function removeDestination(id: string): Promise<void> {
  const stored = await chrome.storage.local.get([DESTINATIONS_KEY, ROUTES_KEY, SERVER_KEY]);
  const all = { ...(stored[DESTINATIONS_KEY] as Record<string, unknown> | undefined) };
  delete all[id];
  // A site that sent there keeps its review in this browser; it does not fall back to a server by surprise.
  const routes = { ...(stored[ROUTES_KEY] as Record<string, string> | undefined) };
  for (const [site, value] of Object.entries(routes)) if (value === destinationRoute(id)) routes[site] = BROWSER_ROUTE;
  await chrome.storage.local.set({ [DESTINATIONS_KEY]: all, [ROUTES_KEY]: routes, ...(stored[SERVER_KEY] === destinationRoute(id) ? { [SERVER_KEY]: BROWSER_ROUTE } : {}) });
  destNote.textContent = "Removed. The token is forgotten here; generate a new one on the scheduled task to revoke it at Claude.";
  await render();
}

destForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const field = (name: string) => (destForm.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement).value;
  const made = newDestination(field("name"), field("address"), field("token"), crypto.randomUUID());
  if (typeof made === "string") {
    destNote.textContent = made;
    return;
  }
  // The submit is the user's gesture: Chrome asks for the one host a send goes to (N-46). The destination is saved
  // whatever the answer, and before it: the review page asks again on Send if the host was not granted.
  const asked = chrome.permissions.request({ origins: [CLAUDE_API_PERMISSION] }).catch(() => false);
  void (async () => {
    const stored = (await chrome.storage.local.get(DESTINATIONS_KEY))[DESTINATIONS_KEY] as Record<string, unknown> | undefined;
    await chrome.storage.local.set({ [DESTINATIONS_KEY]: { ...stored, [made.id]: made } });
    destForm.reset();
    destNote.textContent = `Saved Claude · ${made.name}. Choose it for a site above, then send from the review page.`;
    await render();
    if (!(await asked)) destNote.textContent = `Saved Claude · ${made.name}. Chrome was not allowed to reach api.anthropic.com yet; it asks again when you send.`;
  })();
});

fallbackSelect.addEventListener("change", () => {
  const value = fallbackSelect.value;
  const done = value === "" ? chrome.storage.local.remove(SERVER_KEY) : chrome.storage.local.set({ [SERVER_KEY]: value === "server" ? (serverForPort(port.value) ?? DEFAULT_SERVER) : value });
  void done.then(() => {
    note.textContent = "Saved. Sites with no choice of their own follow it from their next load.";
    return render();
  });
});

for (const button of Array.from(document.querySelectorAll<HTMLButtonElement>("button[data-prompt]"))) {
  button.addEventListener("click", () => {
    void navigator.clipboard.writeText(TASK_PROMPTS[button.dataset.prompt as keyof typeof TASK_PROMPTS]).then(() => (destNote.textContent = "Copied. Paste it as the scheduled task's prompt."));
  });
}
(document.getElementById("tasks-page") as HTMLAnchorElement).href = CLAUDE_TASKS_PAGE;
(document.getElementById("open-review") as HTMLAnchorElement).href = chrome.runtime.getURL("review.html");

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
