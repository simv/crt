/**
 * The overlay's colours in one place (PRD-polish F-112, §5.1, decision 7) — the brand's inputs.
 * `ui.ts` and `screenshot.ts` interpolate them into the stylesheet and the marker drawing (`chat.ts`
 * takes the accent); the rendered CSS is byte-for-byte what it was when the values were literals
 * (test/brand.test.ts pins every site). The brand files under docs/brand/ carry INK, GLASS,
 * BEZEL_DARK and ACCENT as literals — the same test pins them equal — and the landing page (server
 * code, M21) repeats what it needs: the server never imports overlay source at runtime.
 */

/** Ink: text, the launcher pill, the active tool, the mark's bezel on light. */
export const INK = "#111";
/** The accent: markers, the count badge, primary buttons, the mark's badge — never a screen fill. */
export const ACCENT = "#ff3d71";
/** Primary buttons on hover. */
export const ACCENT_HOVER = "#e62e63";
/** The badge — on the launcher (the count) and on the mark: the accent. */
export const BADGE = ACCENT;
/** The mark's glass, the screen inside the bezel, on both themes. Brand only. */
export const GLASS = "#2b2b31";
/** The mark's bezel on dark backgrounds (crt-mark-dark.svg, the favicon under `prefers-color-scheme: dark`). Brand only. */
export const BEZEL_DARK = "#f2f2f4";
/** Green: the server connected, a provider ready, a task written. */
export const OK = "#2e9e5b";
/** Amber: the agent not ready, a different project, a provider unknown, a session starting or running. */
export const WARN = "#e0a800";
/** Red: the server unreachable. */
export const DANGER = "#d7263d";
/** Deep red: error states (the status bar, a marker). */
export const ERROR = "#b00020";
/** Blue: a session idle (a marker). */
export const IDLE = "#2f6fed";
/** The tinted status pills, `[background, text]` by session state. */
export const PILL = {
  running: ["#fff3cd", "#7a5a00"],
  idle: ["#dbe7ff", "#1a4d99"],
  task: ["#d9f5e3", "#0a5b2b"],
  error: ["#fde2e2", "#8b0000"],
} as const;
/** The "experimental" badge on a provider row, `[background, text]`. */
export const EXPERIMENTAL = ["#fff3cd", "#7a5200"] as const;
