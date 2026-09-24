import { defineConfig } from "@playwright/test";
import { PORTS } from "./e2e/helpers.js";

// PRD-polish F-116 / N-27 (M22, task CRT-0026): `npm run screenshots` — the reproducible README
// screenshots. Not part of `npm run e2e` (playwright.config.ts ignores screenshots.spec.ts) and
// never run in CI (pixel diffs flake, §12 rule 3): a developer runs it by hand after `npm run build`
// and commits docs/images/*.png. Same infrastructure as the e2e: the fixture app is the app under
// test on its own origin (its /shop page, the trial shop — CRT-0029), with the loader tag pointing at one embedded `crt serve` on
// CRT_SESSION_STUB=1 from its own scratch project (e2e/.project/screenshots) — spare ports, so a
// running e2e or a real `crt serve` on :4400 is never in the way.
//
// Everything a screenshot can depend on is pinned here or in the spec: viewport 800 × 600 CSS px
// at DPR 2, light colour scheme, one worker in file order, a fresh browser context (cleared storage)
// per image, and in the spec a fixed clock, `animations: "disabled"` on every capture and waits on
// the overlay's own signals.
const FIXTURE_PORT = PORTS.screenshotsFixture;
export const SCREENSHOTS_FIXTURE_ORIGIN = `http://localhost:${FIXTURE_PORT}`;
const CRT_PORT = PORTS.screenshotsCrt;
export const SCREENSHOTS_CRT_ORIGIN = `http://localhost:${CRT_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/screenshots.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: "list",
  timeout: 60_000,
  use: {
    baseURL: SCREENSHOTS_FIXTURE_ORIGIN,
    viewport: { width: 800, height: 600 },
    deviceScaleFactor: 2,
    colorScheme: "light",
    locale: "en-US",
    timezoneId: "UTC",
    trace: "off",
    video: "off",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: [
    {
      command: "node e2e/fixture/server.mjs",
      env: { FIXTURE_PORT: String(FIXTURE_PORT), FIXTURE_CRT_ORIGIN: SCREENSHOTS_CRT_ORIGIN },
      url: `${SCREENSHOTS_FIXTURE_ORIGIN}/`,
      reuseExistingServer: false,
      timeout: 15_000,
    },
    {
      // The stub as Claude (F-46) from the `screenshots` scratch root; the spec resets that root's
      // .crt/tasks and .crt/captures before the first image so every run starts from the same state.
      command: `node e2e/fixture/crt.mjs --target ${SCREENSHOTS_FIXTURE_ORIGIN} --port ${CRT_PORT} --no-open`,
      env: { CRT_SESSION_STUB: "1", CRT_E2E_PROJECT: "screenshots" },
      url: `${SCREENSHOTS_CRT_ORIGIN}/__crt/health`,
      reuseExistingServer: false,
      timeout: 15_000,
    },
  ],
});
