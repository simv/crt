/**
 * The probe across two script worlds (PRD-extension F-152, N-42; docs/spikes/extension-2026-11.md
 * rows 3 and 4). The page-world half (`answerProbe`, bundled into the extension's probe.js) holds
 * the hooks and the framework lookups; the isolated-world half (`remoteProbe`, bundled into
 * content.js) is the `Probe` the overlay reads.
 *
 * The wire is two DOM events, because the DOM is the one thing the two worlds share and event
 * dispatch is synchronous across them — so every probe call stays the plain synchronous call the
 * overlay makes today. The asker dispatches `ASK_EVENT` on the element in question (on the
 * document's root for a question about no element), its `detail` a question name. The answerer,
 * listening on `window`, dispatches `ANSWER_EVENT` on the same target before the first dispatch
 * returns, its `detail` a JSON string. Only strings cross: a string is the same value in both
 * worlds, an object is not.
 *
 * One way. The page-world half answers questions about the page and does nothing else: there is
 * no question that starts a session, posts a capture or reaches the service worker, and the two
 * `clear` questions empty buffers the page could empty itself. A page script can listen to the
 * questions and can forge an answer; an answer is therefore data from the page and nothing more —
 * `remoteProbe` passes every one through `clean` before the overlay sees it, and the server
 * validates the capture again (capture-schema.ts).
 */
import type { ConsoleEntry, FrameworkInfo, NetworkEntry } from "../../server/src/capture-schema.js";
import type { ComponentDetection, Probe } from "./probe.js";

export const ASK_EVENT = "crt:probe:ask";
export const ANSWER_EVENT = "crt:probe:answer";

/**
 * The questions. `present` asks whether the page already carries a CRT loader (F-156); `probe`
 * asks whether a page-world half is listening at all (a second copy of it asks before it installs).
 */
export const QUESTIONS = ["console", "clearConsole", "network", "clearNetwork", "components", "componentName", "framework", "present", "probe"] as const;
export type Question = (typeof QUESTIONS)[number];

/** N-42: an answer longer than this is dropped unread (the two logs hold 50 entries of a few KB each). */
export const MAX_ANSWER_CHARS = 600_000;

/** What `answerProbe` needs from the page world: the default probe's readers, and the F-156 check. */
export interface ProbeSource extends Pick<Probe, "console" | "clearConsole" | "network" | "clearNetwork" | "components" | "componentName" | "framework"> {
  /** F-156: the page already has CRT (the integration, the proxy or the CRT browser put the loader there). */
  present(): boolean;
}

/** The slice of `EventTarget` both halves use; `window` and an `Element` both fit (and a plain `EventTarget` in tests). */
type Target = Pick<EventTarget, "addEventListener" | "removeEventListener" | "dispatchEvent">;

function isQuestion(v: unknown): v is Question {
  return typeof v === "string" && (QUESTIONS as readonly string[]).includes(v);
}

/**
 * The page-world half: answer every question dispatched under `root` (the window). Returns a
 * function that stops answering. An exception in a lookup answers `null`; the page is never
 * disturbed by a question.
 */
export function answerProbe(source: ProbeSource, root: Target): () => void {
  const onAsk = (e: Event) => {
    const question: unknown = (e as CustomEvent<unknown>).detail;
    const target = e.target;
    if (!isQuestion(question) || !target) return;
    let answer: unknown = null;
    try {
      switch (question) {
        case "console":
          answer = source.console();
          break;
        case "network":
          answer = source.network();
          break;
        case "clearConsole":
          source.clearConsole();
          break;
        case "clearNetwork":
          source.clearNetwork();
          break;
        case "components":
          answer = source.components(target as Element);
          break;
        case "componentName":
          answer = source.componentName(target as Element);
          break;
        case "framework":
          answer = source.framework();
          break;
        case "present":
          answer = source.present();
          break;
        case "probe":
          answer = true;
          break;
      }
    } catch {
      answer = null;
    }
    let detail = "null";
    try {
      detail = JSON.stringify(answer) ?? "null";
    } catch {
      // an answer that cannot be serialised is no answer
    }
    target.dispatchEvent(new CustomEvent(ANSWER_EVENT, { detail }));
  };
  // The options object, not a bare `true`: Node's EventTarget (the unit tests) only matches a removal spelled that way.
  root.addEventListener(ASK_EVENT, onAsk, { capture: true });
  return () => root.removeEventListener(ASK_EVENT, onAsk, { capture: true });
}

/** Ask one question about `target` and return the parsed answer, or null when nobody answered in this turn. */
export function ask(question: Question, target: Target): unknown {
  let raw: string | null = null;
  const onAnswer = (e: Event) => {
    const detail: unknown = (e as CustomEvent<unknown>).detail;
    if (raw === null && typeof detail === "string") raw = detail;
    e.stopImmediatePropagation();
  };
  target.addEventListener(ANSWER_EVENT, onAnswer);
  try {
    target.dispatchEvent(new CustomEvent(ASK_EVENT, { detail: question, bubbles: true, composed: true }));
  } finally {
    target.removeEventListener(ANSWER_EVENT, onAnswer);
  }
  const text = raw as string | null;
  if (text === null || text.length > MAX_ANSWER_CHARS) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/** How `remoteProbe` turns an answer into the shape the overlay expects; anything else becomes the empty value. */
export interface Cleaners {
  console(v: unknown): ConsoleEntry[];
  network(v: unknown): NetworkEntry[];
  components(v: unknown): ComponentDetection;
  framework(v: unknown): FrameworkInfo;
}

export const UNKNOWN_COMPONENTS: ComponentDetection = { framework: "unknown", components: [], source: null };
export const UNKNOWN_FRAMEWORK: FrameworkInfo = { name: "unknown", version: null, bundler: "unknown", route: null, hints: [] };

/**
 * The isolated-world half: a `Probe` whose every read is a question to the page world.
 * `root` is where a question about no element is dispatched (the document's root element).
 * The pause pair does nothing: the isolated world's `fetch` is not the page's hooked one, so
 * CRT's own requests never reach the page's log in the first place.
 */
export function remoteProbe(root: () => Target | null, clean: Cleaners): Probe & { present(): boolean } {
  const page = (q: Question): unknown => {
    const target = root();
    return target ? ask(q, target) : null;
  };
  return {
    console: () => clean.console(page("console")),
    clearConsole: () => void page("clearConsole"),
    network: () => clean.network(page("network")),
    clearNetwork: () => void page("clearNetwork"),
    pauseNetwork: () => undefined,
    resumeNetwork: () => undefined,
    components: (el) => clean.components(ask("components", el)),
    componentName: (el) => {
      const name = ask("componentName", el);
      return typeof name === "string" && name ? name.slice(0, 200) : null;
    },
    framework: () => clean.framework(page("framework")),
    present: () => page("present") === true,
  };
}
