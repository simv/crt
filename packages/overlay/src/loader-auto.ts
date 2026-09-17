/**
 * The auto-mounting entry behind `dist/loader.js` (PRD-embedded F-96): what CRT serves at
 * /__crt/loader.js for pages without a bundler. The logic is loader.ts; this file only reads
 * `data-crt-port` off its own <script> tag and mounts. The ES module form (`dist/integrations/loader.js`)
 * is built from loader.ts directly and has no side effect on import.
 */
import { mountCrt } from "./loader.js";

const own = document.currentScript;
const port = own instanceof HTMLScriptElement ? Number(own.dataset.crtPort) : NaN;
mountCrt(Number.isInteger(port) && port > 0 ? { port } : undefined);
