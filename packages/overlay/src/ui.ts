/**
 * Overlay UI (PRD F-7…F-14, F-30; PRD-providers F-56; F-65…F-68; PRD-setup F-81, F-82): the
 * Shadow DOM host and the parts it composes. The host is a fixed, pointer-transparent
 * full-viewport layer and only the widgets opt back in to pointer events, so the page underneath
 * keeps working while CRT is idle.
 *
 * The parts: the launcher and its health dot (launcher.ts, health.ts); the dock with the status
 * line, the session list, the provider menu (provider-menu.ts) and the toolbar; the Select / Box /
 * Pin tools (tools.ts); the markers and the positioning pass (markers.ts); the popovers
 * (popovers.ts) and the threads they host (threads.ts, chat.ts); the welcome card (welcome.ts);
 * the stylesheet (styles.ts). This class owns what they share — open, busy, the one open popover —
 * and the flows that cross them: Send, a thread's life, restoring threads after a reload, and
 * placing everything each pass.
 *
 * Threads (F-65…F-67): every annotation owns a popover anchored beside its element. It starts as
 * a compose box (note, Quick note, the F-56 split **Send to <agent>**), and after Send the same
 * popover hosts that thread's `ChatPanel`. The annotation keeps its marker, coloured by the
 * session state. Several threads run at once and one popover is open at a time; page-level chats
 * (F-68) dock above the toolbar because they have no element. Product chrome stays "CRT" (F-64).
 */
import type { Annotation, AnnotationStore } from "./annotations.js";
import { closeSession, onRequestFailure, postCapture, type SendResult, type StartOptions, startSession } from "./api.js";
import { CRT_ORIGIN } from "./base.js";
import { capture } from "./capture.js";
import type { QuietOutcome } from "./chat.js";
import { cssEscape, messageOf, setStyle, STATE_LABEL, type StatusPart, statusNode } from "./dom-util.js";
import { CHECKING_TOOLTIP, type HealthPayload, type HealthState } from "./health.js";
import { Launcher } from "./launcher.js";
import { Markers, Positioner } from "./markers.js";
import { placePopover } from "./popover.js";
import { buildAnnotationPop, buildPagePop, type ComposeState, patchAnnotationPop, patchPagePop, wirePops } from "./popovers.js";
import { ProviderMenu, UNKNOWN_AGENT } from "./provider-menu.js";
import { canQuickNote, planSend, type SendOptions } from "./send-plan.js";
import { SessionList } from "./session-list.js";
import { OVERLAY_CSS } from "./styles.js";
import { readPageThreads, rememberOpenThread, type Thread, Threads, threadState, type ThreadSummary } from "./threads.js";
import { type Tool, Tools } from "./tools.js";
import { buildWelcome, markWelcomeSeen, shouldShowWelcome, welcomeCopy, welcomeSeen } from "./welcome.js";

export { OVERLAY_CSS } from "./styles.js";
export type { SendOptions, ThreadSummary, Tool };

export class OverlayUI {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  readonly store: AnnotationStore;
  /** F-56: which agent the next Send runs on (`window.__crt.providers`). */
  readonly providers: ProviderMenu;
  private readonly tools: Tools;
  private readonly launcher: Launcher;
  private readonly markers: Markers;
  private readonly positioner = new Positioner(() => this.positionAll());
  /** F-66: every live thread. */
  private readonly threads: Threads;
  /** F-30: the toolbar's session list. */
  private readonly sessions: SessionList;
  private busy = false;
  private open = false;
  private draggingLauncher = false;
  /** F-65: the one popover showing right now. */
  private openPop: HTMLElement | null = null;

  /** F-82: the card, once built. */
  private welcomeEl: HTMLElement | null = null;
  /** The mount-time provider load, so the welcome card can name the agent (F-56). */
  private providersReady: Promise<unknown> = Promise.resolve();
  /** F-82: threads or annotations came back from sessionStorage on this load (a mid-work reload). */
  private readonly restored: boolean;

  private readonly count: HTMLElement;
  private readonly dock: HTMLElement;
  private readonly toolbar: HTMLElement;
  private readonly status: HTMLElement;
  /** The pending auto-hide of the current status message, if it has one. */
  private statusTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly pops: HTMLElement;
  /** F-68: the docked compose box the toolbar's Chat button opens. */
  private readonly pagePop: HTMLElement;

  constructor(store: AnnotationStore) {
    this.store = store;
    this.host = document.createElement("div");
    this.host.id = "crt-host";
    this.host.setAttribute("data-crt", "");
    this.root = this.host.attachShadow({ mode: "open" });
    this.root.innerHTML = `
      <style>${OVERLAY_CSS}</style>
      <div class="layer" hidden>
        <div class="hover"></div><div class="hover-label"></div><div class="drag"></div>
      </div>
      <div class="hint" hidden></div>
      <div class="markers" part="markers"></div>
      <div class="pops" hidden></div>
      <div class="dock" hidden>
        <div class="status" hidden></div>
        <div class="sessions" hidden></div>
        <div class="providers" hidden></div>
        <div class="toolbar" role="toolbar" aria-label="CRT tools">
          <button type="button" data-tool="select" title="Select an element (F-8)">Select</button>
          <button type="button" data-tool="box" title="Draw a box (F-9)">Box</button>
          <button type="button" data-tool="pin" title="Drop a pin (F-10)">Pin</button>
          <span class="sep"></span>
          <span class="badge" data-count>0</span>
          <button type="button" data-action="clear" title="Remove all annotations and their popovers (sessions keep running, F-67)">Clear</button>
          <button type="button" data-action="sessions" title="Recent intake sessions (F-30)">Sessions</button>
          <button type="button" data-action="agent" title="Choose the agent that runs intake (F-56)">Agent</button>
          <span class="sep"></span>
          <button type="button" data-action="chat" title="Chat with the agent about this page (F-68)">Chat<span class="dot" hidden></span></button>
        </div>
      </div>
      <button type="button" class="launcher" aria-label="Toggle CRT (Ctrl/Cmd+Shift+.)" data-health="checking" title="${CHECKING_TOOLTIP}">
        <span class="health"></span> CRT <span class="count">0</span>
      </button>
    `;
    const q = <T extends HTMLElement>(sel: string) => this.root.querySelector(sel) as T;
    this.count = q(".launcher .count");
    this.dock = q(".dock");
    this.toolbar = q(".toolbar");
    this.status = q(".status");
    this.pops = q(".pops");
    this.pagePop = buildPagePop();
    this.pops.appendChild(this.pagePop);
    this.restored = this.store.all().length > 0 || readPageThreads().length > 0;

    this.launcher = new Launcher(q(".launcher"), this.dock, {
      toggle: () => this.toggle(),
      dragging: (on) => {
        this.draggingLauncher = on;
        this.updateLoop();
      },
      moved: () => this.positionDocked(),
      row: (id) => this.providers.row(id),
    });
    this.providers = new ProviderMenu(q(".dock > .providers"), {
      changed: () => this.render(),
      loaded: () => this.launcher.paintHealth(), // the tooltip names the agent and carries its N-7 line (F-81)
      opening: () => this.sessions.hide(),
      status: (text, opts) => this.showStatus(text, opts),
    });
    this.sessions = new SessionList(q(".sessions"), {
      opening: () => {
        this.providers.close();
        this.closePops();
        this.render();
      },
      current: () => this.currentThread()?.sessionId ?? null,
      open: (id) => this.threads.open(id),
    });
    this.threads = new Threads({
      store,
      popFor: (id) => this.popFor(id),
      dock: (pop) => this.pops.appendChild(pop),
      visibility: (pop, open) => {
        if (open) this.showPop(pop);
        else if (this.openPop === pop) this.hidePop(pop);
        this.render();
      },
      removing: (pop) => {
        if (this.openPop === pop) this.openPop = null;
      },
      quiet: (outcome, sessionId) => this.onQuiet(outcome, sessionId),
      attention: (thread, reason) => this.onAttention(thread, reason),
      changed: () => this.render(),
    });
    this.tools = new Tools({ layer: q(".layer"), hover: q(".hover"), hoverLabel: q(".hover-label"), drag: q(".drag"), hint: q(".hint") }, store, {
      busy: () => this.busy,
      armed: (tool) => this.armed(tool),
      annotated: (n) => this.togglePop(n, true), // its popover opens with the caret in the note
    });
    this.markers = new Markers(q(".markers"), () => this.positioner.schedule(), (n) => this.togglePop(n));
    this.wireToolbar();
    wirePops(this.pops, {
      numberOf: (id) => this.store.byId(id)?.n,
      close: (pop) => {
        this.hidePop(pop);
        this.render();
      },
      pickProvider: (btn) => this.providers.onClick(btn),
      toggleProviders: (list) => void this.providers.toggle(undefined, list),
      remove: (n) => this.store.remove(n),
      send: (opts) => void this.sendToAgent(opts).catch(() => undefined),
      setNote: (n, note) => this.store.setNote(n, note),
      changed: () => this.render(),
    });
    this.wireKeyboard();
    this.store.subscribe(() => this.render());
    document.documentElement.appendChild(this.host);
    this.launcher.place(); // needs the launcher's real height, so after mount
    this.render();
    void this.threads.restore(); // a reload re-attaches every thread (F-66)
    onRequestFailure(() => this.noteFailure()); // F-81: any failed CRT request re-reads health
    this.providersReady = this.providers.load(false).catch(() => undefined); // F-56: label the Send buttons with the active agent
    this.wireHealth();
  }

  // ---- public surface (also exposed on window.__crt for tests) ------------------------------

  isOpen(): boolean {
    return this.open;
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.dock.hidden = !this.open;
    this.pops.hidden = !this.open;
    if (!this.open) this.setTool(null);
    this.render();
    this.positionDocked();
  }

  currentTool(): Tool | null {
    return this.tools.current();
  }

  setTool(tool: Tool | null): void {
    this.tools.set(tool);
  }

  /** Programmatic hover for the Select tool (tests). */
  hoverAt(x: number, y: number): Element | null {
    return this.tools.hoverAt(x, y);
  }

  /** A tool was armed — a popover over the page would swallow the click (F-65) — or put away. */
  private armed(tool: Tool | null): void {
    if (tool) {
      this.closePops();
      if (!this.open) this.toggle(true);
    }
    for (const b of Array.from(this.toolbar.querySelectorAll<HTMLButtonElement>("[data-tool]"))) b.classList.toggle("active", b.dataset.tool === tool);
  }

  /**
   * F-13/F-65: capture one annotation (plus, with `include`, the other unsent ones), POST it, and
   * turn its popover into the chat of a new intake session (F-24, F-66). The session is
   * warm-started in parallel with the capture so the agent process boots while the page is being
   * rasterised (N-2). A capture that saved but whose session failed to start is still reported
   * as sent — the files are on disk and the status line says what went wrong.
   *
   * F-68 `message`: a page-level chat — the capture has no annotations and carries the message as
   * its `note`; the thread docks above the toolbar.
   *
   * F-14 `quick`: every sent annotation must carry a note; the popover stays closed and the
   * status line reports the task id when the agent writes it (or the popover opens itself if the
   * agent needs you).
   *
   * F-56: the session runs on the provider picked for this send (the caret's list), else the
   * server's active one; the per-send choice is spent the moment the session is requested.
   */
  async sendToAgent(opts: SendOptions = {}): Promise<SendResult> {
    const quick = opts.quick === true;
    if (this.busy) throw new Error("already sending");
    const page = opts.message !== undefined;
    const { ids, note } = planSend(this.store.all(), opts);
    this.store.flush(); // N-3: a note typed just now is persisted before the send
    this.busy = true;
    this.setTool(null);
    this.sessions.hide();
    this.providers.close();
    const start: StartOptions = { quick, provider: this.providers.pending };
    const name = this.providers.name(this.providers.sendProvider());
    this.providers.pick(null);
    const hostPop = page ? this.pagePop : this.popFor(ids[0]!);
    hostPop?.classList.add("sending");
    this.showStatus("Capturing page…");
    this.render();
    const warm = startSession(null, start).catch(() => null);
    try {
      const result = await capture(this.store, { ids, ...(note ? { note } : {}) });
      this.showStatus(`Sending to ${name}…`);
      const sent = await postCapture(result);
      this.showStatus(["Capture saved: ", { code: sent.dir }], { autoHide: !quick });
      try {
        const sessionId = (await warm) ?? (await startSession(sent.id, start));
        const thread = this.threads.start(sessionId, ids);
        if (thread.annotationIds.length) this.store.setSession(thread.annotationIds, sessionId);
        else this.threads.savePage();
        if (page) this.resetPagePop();
        // The warm session still needs its first message; a cold one already has it.
        if ((await warm) === sessionId) await thread.chat.attachCapture(sessionId, sent.id, { quick });
        else if (quick) thread.chat.follow(sessionId);
        else thread.chat.open(sessionId);
        if (quick) this.showStatus(`Quick note sent — ${name} is writing the task…`, { link: sessionId });
      } catch (err) {
        this.showStatus(["Capture saved: ", { code: sent.dir }, ` — but ${name} did not start: ${messageOf(err)}`], { error: true });
      }
      return sent;
    } catch (err) {
      void warm.then((id) => (id ? closeSession(id).catch(() => undefined) : undefined));
      this.showStatus(`Send failed: ${messageOf(err)}`, { error: true });
      throw err;
    } finally {
      this.busy = false;
      hostPop?.classList.remove("sending");
      this.render();
    }
  }

  /** F-14: a quick note needs words, since there is no conversation to add them; `n` defaults to the most recent unsent annotation. */
  canQuickNote(n?: number): boolean {
    return canQuickNote(this.store.all(), { n });
  }

  private onQuiet(outcome: QuietOutcome, sessionId: string): void {
    if (outcome.kind === "task") {
      this.showStatus(["Task ", { b: outcome.id }, " written to ", { code: outcome.path }], { link: sessionId });
    } else {
      const name = this.threads.bySession(sessionId)?.chat.agentName() ?? UNKNOWN_AGENT;
      this.showStatus(`${name} needs you: ${outcome.reason}`, { autoHide: true });
    }
  }

  /**
   * F-26/F-66: a live permission request opens its thread unless the developer is busy in another
   * popover, in which case the marker pulses and the status line says who needs them.
   */
  private onAttention(thread: Thread, reason: string): void {
    if (!this.openPop || this.openPop === thread.pop) {
      thread.chat.show(true);
      return;
    }
    this.showStatus(reason, { link: thread.sessionId, autoHide: true });
    this.render();
  }

  // ---- threads (F-66, F-67, F-68) --------------------------------------------------------------

  /** Every live thread, oldest first (tests). */
  threadSummaries(): ThreadSummary[] {
    return this.threads.summaries();
  }

  /** The thread whose popover is open, else the most recent one (what `window.__crt.chat` drives). */
  currentThread(): Thread | null {
    return this.threads.current(this.openPop);
  }

  /** F-30/F-66: open a session — its own popover when it has one, else a docked page-level popover. */
  openSession(sessionId: string): void {
    this.threads.open(sessionId);
  }

  // ---- popovers (F-65, F-68) -------------------------------------------------------------------

  /** The annotation's popover element, if it has been rendered. */
  private popFor(annotationId: string): HTMLElement | null {
    return this.pops.querySelector<HTMLElement>(`.pop[data-id="${cssEscape(annotationId)}"]`);
  }

  /** F-65: show one popover (closing any other), bring the overlay up, and place it. */
  private showPop(pop: HTMLElement): void {
    const prev = this.openPop;
    if (prev && prev !== pop) {
      const t = this.threads.byPop(prev);
      if (t) t.chat.show(false); // keeps the panel's own open state truthful
      else this.hidePop(prev);
    }
    this.openPop = pop;
    pop.hidden = false;
    if (!this.open) this.toggle(true);
    this.positionAll();
    this.updateLoop();
    rememberOpenThread(this.threads.byPop(pop)?.sessionId ?? null);
  }

  private hidePop(pop: HTMLElement): void {
    pop.hidden = true;
    if (this.openPop === pop) {
      this.openPop = null;
      rememberOpenThread(null);
    }
    if (this.providers.openIn && pop.contains(this.providers.openIn)) this.providers.close();
    this.updateLoop();
  }

  closePops(): void {
    if (this.openPop) this.hidePop(this.openPop);
    this.pagePop.hidden = true;
  }

  /** F-65: toggle the popover of annotation `n` — a grouped annotation opens the thread that holds it. */
  togglePop(n: number, force?: boolean): void {
    const a = this.store.get(n);
    if (!a) return;
    const thread = this.threads.byAnnotation(a.id);
    const pop = thread?.pop ?? this.popFor(a.id);
    if (!pop) return;
    const show = force ?? pop.hidden;
    if (!show) {
      if (thread) thread.chat.show(false);
      else this.hidePop(pop);
      return;
    }
    if (thread) {
      thread.chat.show(true);
    } else {
      this.showPop(pop);
      pop.querySelector("textarea")?.focus();
    }
  }

  /** F-68: the docked compose box for a page-level chat. */
  togglePageChat(force?: boolean): void {
    const show = force ?? this.pagePop.hidden;
    if (!show) {
      this.hidePop(this.pagePop);
      this.render();
      return;
    }
    this.sessions.hide();
    this.providers.close();
    this.showPop(this.pagePop);
    this.pagePop.querySelector("textarea")?.focus();
    this.render();
  }

  private resetPagePop(): void {
    (this.pagePop.querySelector("textarea") as HTMLTextAreaElement).value = "";
    this.hidePop(this.pagePop);
  }

  /** Reconcile the popovers in place (popovers.ts: a focused textarea must never be detached). */
  private renderPops(items: Annotation[]): void {
    const keep = new Set(items.map((a) => a.id));
    for (const el of Array.from(this.pops.querySelectorAll<HTMLElement>(".pop[data-id]"))) {
      if (keep.has(el.dataset.id!)) continue;
      if (this.openPop === el) this.openPop = null;
      el.remove();
    }
    const state: ComposeState = {
      all: items,
      unsent: this.store.unsent(),
      busy: this.busy,
      focusedId: (this.root.activeElement as HTMLElement | null)?.closest<HTMLElement>(".pop")?.dataset.id,
      labelSend: (btn) => this.providers.labelSend(btn),
    };
    for (const a of items) {
      let pop = this.popFor(a.id);
      if (!pop) {
        pop = buildAnnotationPop(a);
        this.pops.appendChild(pop);
      }
      patchAnnotationPop(pop, a, state, this.threads.byPop(pop) !== undefined);
    }
    patchPagePop(this.pagePop, state, this.providers.name(this.providers.sendProvider()));
    this.threads.retitle();
  }

  /** F-30: the toolbar's Sessions list. */
  toggleSessions(force?: boolean): Promise<void> {
    return this.sessions.toggle(force);
  }

  // ---- launcher health (F-81) and the welcome card (F-82) ---------------------------------------

  /** F-81: health is read at mount (the launcher also reads it when the tab is visible again); F-82: the card may follow. */
  private wireHealth(): void {
    void Promise.all([this.checkHealth(), this.providersReady]).then(() => {
      if (this.welcomeEl) return;
      const gate = { health: this.launcher.health, inIframe: window.top !== window, restored: this.restored, seen: welcomeSeen };
      if (shouldShowWelcome(gate)) this.showWelcome();
    });
  }

  /** A CRT request just failed: re-read health so the dot says whether the server is gone (F-81). */
  private noteFailure(): void {
    void this.checkHealth();
  }

  checkHealth(): Promise<HealthPayload | "failed"> {
    return this.launcher.checkHealth();
  }

  /** The dot's state as painted (tests). */
  healthState(): HealthState {
    return this.launcher.healthState();
  }

  /** F-82: show the card now, whatever the suppression rules say (`window.__crt.welcome()`). */
  async welcome(): Promise<void> {
    if (this.launcher.health === null || this.launcher.health === "failed") await this.checkHealth();
    if (this.launcher.health === null || this.launcher.health === "failed") return;
    if (!this.providers.payload) await this.providers.load(false).catch(() => undefined);
    this.showWelcome();
  }

  private showWelcome(): void {
    const h = this.launcher.health;
    if (!h || h === "failed") return;
    const row = this.providers.row(h.provider);
    const copy = welcomeCopy(h, { name: row?.displayName ?? null, problem: row?.problem ?? null }, CRT_ORIGIN || location.origin);
    this.welcomeEl?.remove();
    const el = buildWelcome(copy, {
      gotIt: () => this.dismissWelcome(),
      showMe: () => {
        // Should: open the toolbar, arm Select, dismiss.
        this.dismissWelcome();
        this.toggle(true);
        this.setTool("select");
      },
    });
    this.welcomeEl = el;
    this.root.appendChild(el);
    this.positionDocked();
  }

  private dismissWelcome(): void {
    const h = this.launcher.health;
    if (h && h !== "failed") markWelcomeSeen(h.projectRoot);
    this.welcomeEl?.remove();
    this.welcomeEl = null;
  }

  // ---- toolbar, rendering and positioning ------------------------------------------------------

  private wireToolbar(): void {
    this.toolbar.addEventListener("click", (e) => {
      const btn = (e.target as Element).closest("button");
      if (!btn) return;
      const tool = btn.dataset.tool as Tool | undefined;
      if (tool) {
        this.setTool(this.currentTool() === tool ? null : tool);
        return;
      }
      if (btn.dataset.action === "clear") {
        this.store.clear();
        this.hideStatus();
      } else if (btn.dataset.action === "chat") {
        this.togglePageChat();
      } else if (btn.dataset.action === "sessions") {
        void this.toggleSessions();
      } else if (btn.dataset.action === "agent") {
        void this.providers.toggle();
      }
    });
    this.status.addEventListener("click", (e) => {
      const btn = (e.target as Element).closest<HTMLButtonElement>("button");
      if (btn?.dataset.status === "chat") this.openSession(btn.dataset.session ?? this.currentThread()?.sessionId ?? "");
    });
    // Keys typed into the dock must not reach the host page's shortcuts.
    for (const type of ["keydown", "keyup", "keypress"] as const) {
      this.dock.addEventListener(type, (e) => e.stopPropagation());
    }
  }

  private wireKeyboard(): void {
    document.addEventListener(
      "keydown",
      (e) => {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.code === "Period" || e.key === "." || e.key === ">")) {
          e.preventDefault();
          e.stopPropagation();
          this.toggle();
          return;
        }
        if (this.tools.current()) {
          this.tools.onKey(e);
          return;
        }
        // F-65: Esc inside an open popover closes it.
        if (e.key === "Escape" && this.openPop && e.composedPath().includes(this.openPop)) {
          e.preventDefault();
          e.stopPropagation();
          const thread = this.threads.byPop(this.openPop);
          if (thread) thread.chat.show(false);
          else this.hidePop(this.openPop);
          this.render();
        }
      },
      true,
    );
  }

  private render(): void {
    const items = this.store.all();
    this.threads.prune(items);
    const n = items.length;
    this.count.textContent = String(n);
    this.count.classList.toggle("on", n > 0);
    (this.toolbar.querySelector("[data-count]") as HTMLElement).textContent = String(n);
    for (const b of Array.from(this.toolbar.querySelectorAll("button"))) b.disabled = this.busy;
    (this.toolbar.querySelector("[data-action=clear]") as HTMLButtonElement).disabled = this.busy || n === 0;
    (this.toolbar.querySelector("[data-action=sessions]") as HTMLButtonElement).classList.toggle("active", this.sessions.isOpen());
    (this.toolbar.querySelector("[data-action=agent]") as HTMLButtonElement).classList.toggle("active", this.providers.openIn === this.providers.dockList);
    const chatBtn = this.toolbar.querySelector("[data-action=chat]") as HTMLButtonElement;
    chatBtn.classList.toggle("active", !this.pagePop.hidden);
    // F-68: the latest page-level thread's state as a dot on the Chat button.
    const latestPage = this.threads.all().filter((t) => !t.annotationIds.length).at(-1)?.chat.status();
    const dot = chatBtn.querySelector(".dot") as HTMLElement;
    const pageState = latestPage ? threadState(latestPage.state, latestPage.taskId) : null;
    dot.hidden = !pageState;
    if (pageState) dot.dataset.state = pageState;
    else delete dot.dataset.state;
    dot.title = pageState ? `page chat: ${STATE_LABEL[pageState]}` : "";

    this.renderPops(items);
    this.markers.render(items, (a) => {
      const status = a.sessionId ? this.threads.bySession(a.sessionId)?.chat.status() : undefined;
      return status ? { state: threadState(status.state, status.taskId), taskId: status.taskId } : null;
    });
    this.positioner.schedule();
    this.updateLoop();
  }

  /** N-3: every frame only while a popover is open (its chat grows as it streams) or the launcher is being dragged. */
  private updateLoop(): void {
    this.positioner.loop((this.open && this.openPop !== null && !this.openPop.hidden) || this.draggingLauncher);
  }

  /** F-68: page-level popovers (and the welcome card) sit above the dock, in the launcher's corner. */
  private positionDocked(): void {
    this.placeDocked(this.launcher.dockedBottom());
  }

  private placeDocked(bottom: number): void {
    this.launcher.placeDocked(Array.from(this.pops.querySelectorAll<HTMLElement>(".pop.page")), this.welcomeEl, bottom);
  }

  /**
   * Keep the markers and the open popover glued to their elements. N-3: every layout read (anchor
   * rectangles, the popover's size, the dock) happens before the first style write.
   */
  private positionAll(): void {
    // Read.
    const anchors = this.markers.read(this.store.all());
    const open = this.openPop;
    const pop = open && !open.hidden && !open.classList.contains("page") && open.dataset.id ? open : null;
    // The annotation a popover is anchored to: the host of a grouped thread, or its own.
    const anchorId = pop ? (this.threads.byPop(pop)?.annotationIds[0] ?? pop.dataset.id) : undefined;
    const anchor = anchors.find((x) => x.a.id === anchorId);
    const popSize = pop ? { width: pop.offsetWidth, height: pop.offsetHeight } : null;
    const viewport = pop ? this.popoverViewport() : null;
    const dockedBottom = this.launcher.dockedBottom();
    // Write.
    this.markers.write(anchors);
    if (pop && anchor && popSize && viewport) {
      // F-65: the open popover follows its annotation.
      const { a, rect } = anchor;
      const p = placePopover(a.kind === "pin" ? { x: rect.x, y: rect.y, width: 1, height: 1 } : rect, popSize, viewport);
      setStyle(pop, "left", `${p.x}px`);
      setStyle(pop, "top", `${p.y}px`);
      if (pop.dataset.side !== p.side) pop.dataset.side = p.side;
    }
    this.placeDocked(dockedBottom);
  }

  /**
   * F-65's "inside the viewport", minus the dock: when the toolbar is open in the lower half of the
   * window, a popover is clamped above it rather than under it (at 600 px a chat popover would
   * otherwise end over the toolbar, reply box first — CRT-0029). A dock dragged into the upper half
   * leaves the whole viewport to the popover.
   */
  private popoverViewport(): { width: number; height: number } {
    const width = window.innerWidth;
    if (this.dock.hidden) return { width, height: window.innerHeight };
    const top = this.dock.getBoundingClientRect().top;
    return { width, height: top > window.innerHeight / 2 ? top : window.innerHeight };
  }

  /**
   * The status line above the toolbar, built as DOM from text (never HTML): plain parts, `code`
   * and `b` parts, and with `link` an "open chat" button for that session (F-66).
   */
  private showStatus(text: string | StatusPart[], opts: { link?: string; error?: boolean; autoHide?: boolean } = {}): void {
    // An earlier message's auto-hide timer must not hide this one.
    clearTimeout(this.statusTimer);
    this.status.replaceChildren(...(typeof text === "string" ? [text] : text).map(statusNode));
    if (opts.link) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.dataset.status = "chat";
      btn.dataset.session = opts.link;
      btn.textContent = "open chat";
      this.status.appendChild(btn);
    }
    this.status.classList.toggle("error", opts.error === true);
    this.status.hidden = false;
    if (!this.open) this.toggle(true);
    this.statusTimer = opts.autoHide ? setTimeout(() => this.hideStatus(), 15_000) : undefined;
  }

  private hideStatus(): void {
    clearTimeout(this.statusTimer);
    this.statusTimer = undefined;
    this.status.hidden = true;
  }
}
