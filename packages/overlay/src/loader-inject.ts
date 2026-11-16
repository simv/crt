/**
 * The injectable entry behind `dist/loader-inject.js` (PRD-zero F-126, F-127): what the CRT
 * browser registers to run in every new document, before the page's own scripts. There is no
 * script tag to read a port from, so the origin is a placeholder the injector replaces with its
 * own origin (packages/server/src/browser.ts `loaderSource`). It skips CRT's own pages — the
 * landing page and the review page are served by the CRT origin and are not the app — and
 * `mountCrt` itself does nothing off a loopback hostname or inside a frame (F-96 step 1).
 */
import { mountCrt } from "./loader.js";

/** Replaced as a whole string literal; never a valid origin, so an unreplaced build mounts nothing. */
const ORIGIN = "__CRT_INJECT_ORIGIN__";

if (ORIGIN.startsWith("http") && location.port !== new URL(ORIGIN).port) mountCrt({ origin: ORIGIN });
