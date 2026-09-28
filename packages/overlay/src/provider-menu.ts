/**
 * The provider menu (PRD-providers F-56, F-57): which agent the next Send runs on. **Send** is a
 * split button; its main half reads `Send to <agent>` — the server's active provider
 * (`GET /__crt/providers`), or the one picked from the caret's list for this send only, kept in
 * sessionStorage for the tab until that send happens. The same list opens from the toolbar's Agent
 * button. Opening it shows the last known rows at once and re-runs the server's preflight
 * (`?refresh=1`) with a spinner per row; unusable rows are disabled with the problem as tooltip,
 * and "Remember for this project on this machine" writes `.crt/config.local.json` through
 * `PUT /__crt/config`. Quick note uses the same choice.
 */
import type { ProviderRow, ProvidersPayload } from "../../server/src/session-events.js";
import { fetchProviders, saveProvider } from "./api.js";
import { messageOf, type StatusPart } from "./dom-util.js";
import { safeGet, safeRemove, safeSet } from "./storage.js";

/** F-56: the per-send provider choice, per tab. */
const PROVIDER_KEY = "crt.provider.v1";
/** What the overlay calls the agent before the server has said which one it is. */
export const UNKNOWN_AGENT = "the agent";

export type ProviderState = "ready" | "not on PATH" | "not logged in" | "too old" | "unknown";

/** F-45's state column, derived from the F-57 row the way `preflightState` does on the server. */
export function providerState(p: ProviderRow): ProviderState {
  if (!p.installed) return "not on PATH";
  if (p.loggedIn === false) return "not logged in";
  if (p.problem === null) return "ready";
  return /too old/i.test(p.problem) ? "too old" : "unknown";
}

export interface ProviderMenuHost {
  /** The choice, the list or whether it shows changed: the Send buttons and the toolbar follow. */
  changed(): void;
  /** A fresh list arrived: the launcher's tooltip names the agent and carries its N-7 line (F-81). */
  loaded(): void;
  /** A list is about to open: the session list closes. */
  opening(): void;
  /** Say how remembering a provider went, on the status line. */
  status(text: string | StatusPart[], opts: { error?: boolean; autoHide?: boolean }): void;
}

export class ProviderMenu {
  /** The last `GET /__crt/providers` payload; null until the server has answered once. */
  payload: ProvidersPayload | null = null;
  /** The provider picked from the caret for the next send only; null = the server's active one. */
  pending: string | null = safeGet("session", PROVIDER_KEY);
  /** The list showing now (the dock's or a popover's), if any. */
  openIn: HTMLElement | null = null;

  /** `dockList`: the dock's list, the one the toolbar's Agent button opens. */
  constructor(
    readonly dockList: HTMLElement,
    private readonly host: ProviderMenuHost,
  ) {
    dockList.addEventListener("click", (e) => {
      const btn = (e.target as Element).closest<HTMLButtonElement>("button");
      if (btn) this.onClick(btn);
    });
  }

  /** The provider id the next Send (or Quick note) will ask for: the per-send pick, else the server's active one. */
  sendProvider(): string | null {
    return this.pending ?? this.payload?.active ?? null;
  }

  row(id: string | null): ProviderRow | undefined {
    return id ? this.payload?.providers.find((p) => p.id === id) : undefined;
  }

  /** The display name the menu knows for an id; the id itself when the list has not loaded. */
  name(id: string | null): string {
    if (!id) return UNKNOWN_AGENT;
    return this.row(id)?.displayName ?? id;
  }

  /** Pick a provider for the next send only; null clears the pick. Persists per tab. */
  pick(id: string | null): void {
    this.pending = id;
    if (id) safeSet("session", PROVIDER_KEY, id);
    else safeRemove("session", PROVIDER_KEY);
    this.host.changed();
  }

  /** `GET /__crt/providers`, with `refresh` to re-run the server's preflight (F-56, F-57). */
  async load(refresh: boolean): Promise<ProvidersPayload> {
    this.payload = await fetchProviders(refresh);
    this.host.changed();
    this.host.loaded();
    return this.payload;
  }

  /** Toggle a list — the dock's (toolbar Agent button) or a popover's (its caret). */
  async toggle(force?: boolean, into: HTMLElement = this.dockList): Promise<void> {
    const show = force ?? this.openIn !== into;
    this.close();
    if (!show) {
      this.host.changed();
      return;
    }
    this.host.opening();
    this.openIn = into;
    into.hidden = false;
    this.render(true);
    this.host.changed();
    try {
      await this.load(true);
      this.render(false);
    } catch (err) {
      const why = into.querySelector(".why");
      if (why) why.textContent = `Could not list agents: ${messageOf(err)}`;
      into.classList.remove("refreshing");
    }
  }

  close(): void {
    if (this.openIn) this.openIn.hidden = true;
    this.openIn = null;
  }

  /** A click inside a list: its close button, or a usable row. */
  onClick(btn: HTMLButtonElement): void {
    if (btn.dataset.providers === "close") {
      this.close();
      this.host.changed();
    } else if (btn.dataset.provider && !btn.disabled) {
      const remember = this.openIn?.querySelector<HTMLInputElement>("input[type=checkbox]")?.checked === true;
      void this.choose(btn.dataset.provider, remember);
    }
  }

  /** A row was clicked: for this send only, or — with the checkbox — remembered via `PUT /__crt/config`. */
  async choose(id: string, remember: boolean): Promise<void> {
    const name = this.name(id);
    if (remember) {
      try {
        await this.remember(id);
        this.pick(null);
        this.host.status([`Remembered: new sessions run on ${name} for this project on this machine (`, { code: ".crt/config.local.json" }, ")"], { autoHide: true });
      } catch (err) {
        this.host.status(`Could not remember ${name}: ${messageOf(err)}`, { error: true });
      }
    } else {
      this.pick(id);
    }
    this.close();
    this.host.changed();
  }

  /** F-57: the server writes the local file and replaces its active provider. */
  async remember(id: string): Promise<void> {
    const active = await saveProvider(id);
    if (this.payload && active) this.payload = { ...this.payload, active };
  }

  /** F-56: a Send button's main half names the agent this send will use; `data-provider` is the id it will ask for. */
  labelSend(btn: HTMLButtonElement): void {
    const provider = this.sendProvider();
    const name = this.name(provider);
    btn.textContent = provider ? `Send to ${name}` : "Send";
    if (provider) btn.dataset.provider = provider;
    else delete btn.dataset.provider;
    btn.title = `Capture and send to ${name} (F-13)${this.pending ? " — for this send only" : ""}`;
  }

  private render(refreshing: boolean): void {
    const into = this.openIn;
    if (!into) return;
    const remember = into.querySelector<HTMLInputElement>("input[type=checkbox]")?.checked === true;
    into.classList.toggle("refreshing", refreshing);
    const head = document.createElement("div");
    head.className = "head";
    head.innerHTML = `<span>Send to…</span><span class="spacer"></span><button type="button" data-providers="close">×</button>`;
    const rows = (this.payload?.providers ?? []).map((p) => providerRow(p, p.id === this.sendProvider()));
    const why = document.createElement("div");
    why.className = "why";
    if (this.payload) {
      const d = this.payload.decision;
      why.textContent = `Auto-detected: ${this.name(d.provider)}${d.reason ? ` — ${d.reason}` : " (default)"}`;
    } else why.textContent = "Loading…";
    const label = document.createElement("label");
    label.className = "remember";
    label.innerHTML = `<input type="checkbox"> Remember for this project on this machine`;
    (label.querySelector("input") as HTMLInputElement).checked = remember;
    into.replaceChildren(head, ...rows, why, label);
  }
}

/** One row of the menu: state dot, name and id, tick on the active one, spinner while refreshing. */
function providerRow(p: ProviderRow, active: boolean): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `provider${active ? " active" : ""}`;
  btn.dataset.provider = p.id;
  const state = providerState(p);
  btn.disabled = p.problem !== null;
  btn.title = p.problem ?? `${state}${p.version ? ` · ${p.version}` : ""}`;
  btn.innerHTML = `<span class="dot"></span><span class="name"><b></b><small></small></span><span class="tick">✓</span><span class="spin"></span>`;
  (btn.querySelector(".dot") as HTMLElement).dataset.state = state;
  (btn.querySelector(".name b") as HTMLElement).textContent = p.displayName;
  (btn.querySelector(".name small") as HTMLElement).textContent = p.id;
  if (p.experimental) {
    // F-54 (M10): a profile shipped untested against a real agent wears a badge; the reason is its tooltip.
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = "experimental";
    badge.title = p.experimental;
    (btn.querySelector(".name") as HTMLElement).appendChild(badge);
  }
  return btn;
}
