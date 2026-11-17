/**
 * The overlay's one way to what only the page's own JavaScript world holds (PRD-extension F-152):
 * the console log (F-20), the failed-request log (F-21) and the framework lookups (F-18, F-22).
 * The default calls them directly — the overlay shares the page's world when the loader, the
 * proxy or the CRT browser put it there. In the extension the overlay runs in an isolated world
 * that cannot see a page's `__reactFiber$…` properties or its wrapped `console`
 * (docs/spikes/extension-2026-11.md row 3), so the content script sets a probe that asks the
 * page-world half over DOM events (probe-wire.ts).
 *
 * No other overlay module imports console-hook.ts, network-hook.ts or component.ts, the entries
 * that install the hooks aside (test/overlay-structure.test.ts).
 */
import type { ConsoleEntry, FrameworkInfo, NetworkEntry } from "../../server/src/capture-schema.js";
import { type ComponentDetection, detectComponents, detectFramework, nearestComponentName } from "./component.js";
import { clearConsoleEntries, consoleEntries } from "./console-hook.js";
import { clearNetworkEntries, networkEntries, pauseNetworkLog, resumeNetworkLog } from "./network-hook.js";

export type { ComponentDetection };

export interface Probe {
  /** F-20: the console buffer, oldest first. */
  console(): ConsoleEntry[];
  clearConsole(): void;
  /** F-21: the failed-request buffer, oldest first. */
  network(): NetworkEntry[];
  clearNetwork(): void;
  /** F-21: CRT's own requests run between these two; their failures are not the page's. */
  pauseNetwork(): void;
  resumeNetwork(): void;
  /** F-18: the component chain and source of an element. */
  components(el: Element): ComponentDetection;
  /** F-18: the first component name, the cheap way (the hover label, N-3). */
  componentName(el: Element): string | null;
  /** F-22: framework and bundler hints. */
  framework(): FrameworkInfo;
}

/** F-152: today's behaviour, same world. */
export const pageProbe: Probe = {
  console: consoleEntries,
  clearConsole: clearConsoleEntries,
  network: networkEntries,
  clearNetwork: clearNetworkEntries,
  pauseNetwork: pauseNetworkLog,
  resumeNetwork: resumeNetworkLog,
  components: detectComponents,
  componentName: nearestComponentName,
  framework: detectFramework,
};

let current: Probe = pageProbe;

/** The probe in use. */
export function probe(): Probe {
  return current;
}

/** F-152: replace the probe (the extension's content script, before the overlay mounts; tests). */
export function setProbe(next: Probe): void {
  current = next;
}
