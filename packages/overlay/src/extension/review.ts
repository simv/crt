/**
 * The review page of the extension (PRD-connect F-167, F-170, F-171; built to
 * `dist/extension/review.js`): every item kept in this browser, by site — keep or drop, delete,
 * copy or download as Markdown, and send a site's kept items to the destination chosen for it.
 *
 * N-46, N-48: the one request this page makes is the send, on the developer's click, to the
 * scheduled task's address at api.anthropic.com (destinations.ts `fireRequest` builds every byte
 * of it). An item is marked sent only when Claude answered that it started a session. What an item
 * holds came from a reviewed page: it is shown as text, never as HTML.
 */
import { CLAUDE_API_PERMISSION, DESTINATIONS_KEY, fireAnswer, fireRequest, readDestinations, targetFor, type ClaudeDestination } from "./destinations.js";
import { idbKv } from "./idb.js";
import { exportName, itemTitle, renderItem, renderReview, type ReviewItem, sendable, setKeep } from "./review-items.js";
import { deleteItem, imageKey, listItems, saveItem } from "./standalone.js";
import { ROUTES_KEY, SERVER_KEY } from "./wire.js";

const kv = idbKv();
const groups = document.getElementById("groups") as HTMLElement;
const totals = document.getElementById("totals") as HTMLElement;
const status = document.getElementById("status") as HTMLElement;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
};

let items: ReviewItem[] = [];

async function destinationOf(origin: string): Promise<ClaudeDestination | null> {
  const stored = await chrome.storage.local.get([SERVER_KEY, ROUTES_KEY, DESTINATIONS_KEY]);
  const target = targetFor(origin, stored[ROUTES_KEY], stored[SERVER_KEY]);
  return target.kind === "browser" ? (readDestinations(stored[DESTINATIONS_KEY]).find((d) => d.id === target.destination) ?? null) : null;
}

/** F-170: one send — the site's kept, unsent items to its destination; marked sent only on Claude's yes. */
async function send(origin: string, destination: ClaudeDestination, granted: boolean): Promise<void> {
  if (!granted) {
    status.textContent = "Chrome was not allowed to reach api.anthropic.com, so nothing was sent.";
    return;
  }
  const request = fireRequest(destination, sendable(items, [origin]));
  if (!request.ok) {
    status.textContent = request.error;
    return;
  }
  status.textContent = `Sending ${request.items.length} item${request.items.length === 1 ? "" : "s"} to Claude · ${destination.name}…`;
  let answer;
  try {
    const res = await fetch(request.url, request.init);
    answer = fireAnswer(res.status, await res.json().catch(() => ({})), res.headers.get("retry-after"));
  } catch (err) {
    answer = { ok: false as const, error: `The request to Claude did not complete (${err instanceof Error ? err.message : String(err)}). Nothing was marked as sent.` };
  }
  if (!answer.ok) {
    status.textContent = answer.error;
    return;
  }
  const at = new Date().toISOString();
  for (const item of items) {
    if (!request.items.includes(item.id)) continue;
    item.sent = { at, destination: destination.name, sessionUrl: answer.sessionUrl };
    await saveItem(kv, item);
  }
  status.replaceChildren(`Sent ${request.items.length} item${request.items.length === 1 ? "" : "s"} to Claude · ${destination.name}${request.compact ? " (without the HTML and the logs, to fit one send)" : ""}. `);
  if (answer.sessionUrl) {
    const link = el("a", "Open the Claude session");
    link.href = answer.sessionUrl;
    link.target = "_blank";
    link.rel = "noopener";
    status.append(link);
  }
  await render();
}

async function itemRow(item: ReviewItem): Promise<HTMLElement> {
  const li = el("li", undefined, `item${item.keep ? "" : " dropped"}`);
  li.dataset.id = item.id;
  const keep = el("input");
  keep.type = "checkbox";
  keep.checked = item.keep;
  keep.setAttribute("aria-label", `Keep ${item.id}`);
  keep.addEventListener("change", () => {
    items = setKeep(items, item.id, keep.checked) ?? items;
    const changed = items.find((i) => i.id === item.id);
    void (changed ? saveItem(kv, changed) : Promise.resolve()).then(render);
  });

  const text = el("div");
  text.append(el("div", `${item.id} — ${itemTitle(item)}`, "title"), el("div", `${item.bundle.page.url} · ${new Date(item.createdAt).toLocaleString()}`, "meta"));
  if (item.sent) {
    const sent = el("div", `Sent to Claude · ${item.sent.destination} on ${new Date(item.sent.at).toLocaleString()}. `, "meta");
    if (item.sent.sessionUrl) {
      const link = el("a", "Open the session");
      link.href = item.sent.sessionUrl;
      link.target = "_blank";
      link.rel = "noopener";
      sent.append(link);
    }
    text.append(sent);
  }

  const side = el("div");
  const shot = item.images.find((i) => i === "viewport-annotated.png") ?? item.images.find((i) => i === "viewport.png");
  const png = shot ? await kv.get(imageKey(item.id, shot)) : undefined;
  if (typeof png === "string") {
    const img = el("img", undefined, "thumb");
    img.alt = `Screenshot of ${item.id}`;
    img.src = `data:image/png;base64,${png}`;
    const link = el("a");
    link.href = img.src;
    link.download = `${item.id}-${shot}`;
    link.title = "Save the screenshot";
    link.append(img);
    side.append(link);
  }
  const remove = el("button", "Delete");
  remove.type = "button";
  remove.addEventListener("click", () => void deleteItem(kv, item.id).then(render));
  side.append(remove);

  const details = el("details");
  details.append(el("summary", "What is sent"), el("pre", renderItem(item)));
  li.append(keep, text, side, details);
  return li;
}

async function render(): Promise<void> {
  items = await listItems(kv);
  const kept = items.filter((i) => i.keep);
  totals.textContent = items.length ? `${items.length} item${items.length === 1 ? "" : "s"}, ${kept.length} kept, ${items.filter((i) => i.sent).length} sent.` : "Nothing yet. Turn CRT on for a site with no CRT server running, annotate the page and press Send.";
  const sections: HTMLElement[] = [];
  for (const origin of [...new Set(items.map((i) => i.origin))]) {
    const section = el("section");
    section.append(el("h2", origin));
    const destination = await destinationOf(origin);
    const ready = sendable(items, [origin]);
    const bar = el("div", undefined, "bar");
    if (destination) {
      const button = el("button", `Send ${ready.length} to Claude · ${destination.name}`, "primary");
      button.type = "button";
      button.disabled = !ready.length;
      // The click is the user's gesture: Chrome asks for the host here if it was not granted when the destination was saved.
      button.addEventListener("click", () => {
        button.disabled = true;
        void chrome.permissions
          .request({ origins: [CLAUDE_API_PERMISSION] })
          .catch(() => false)
          .then((granted) => send(origin, destination, granted));
      });
      bar.append(button, el("span", "Screenshots stay here: Claude's task address takes text only.", "muted"));
    } else {
      bar.append(el("span", "No destination is chosen for this site. Copy or download the review, or choose one under “Where feedback goes”.", "muted"));
    }
    const list = el("ul");
    for (const item of items.filter((i) => i.origin === origin)) list.append(await itemRow(item));
    section.append(bar, list);
    sections.push(section);
  }
  groups.replaceChildren(...sections);
}

(document.getElementById("copy") as HTMLButtonElement).addEventListener("click", () => {
  void navigator.clipboard.writeText(renderReview(items)).then(
    () => (status.textContent = "Copied the kept items as Markdown. Paste it into a Claude chat or project."),
    () => (status.textContent = "The browser did not allow the copy. Use Download."),
  );
});
(document.getElementById("download") as HTMLButtonElement).addEventListener("click", () => {
  const link = el("a");
  link.href = URL.createObjectURL(new Blob([renderReview(items)], { type: "text/markdown" }));
  link.download = exportName(new Date());
  link.click();
  URL.revokeObjectURL(link.href);
});
// Another tab's Send in the overlay adds an item: show it when this page is looked at again.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void render();
});
void render();
