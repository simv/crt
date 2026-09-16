import { defineConfig, devices } from "@playwright/test";

// E2E smoke (PRD §9, task CRT-0001 Ask 8): the static fixture app sits behind a real
// `crt serve --target`, and Chromium loads pages through the CRT origin.
// Playwright starts the web servers in order, so the fixture is up before crt probes it.
const FIXTURE_PORT = 3999;
const CRT_PORT = 4499;
/** PRD-providers F-61 `stub` axis, `sandboxed` variant (F-46): a second CRT on its own scratch root. */
export const CRT_SANDBOXED_PORT = 4498;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${CRT_PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node e2e/fixture/server.mjs",
      env: { FIXTURE_PORT: String(FIXTURE_PORT) },
      url: `http://localhost:${FIXTURE_PORT}/`,
      reuseExistingServer: false,
      timeout: 15_000,
    },
    {
      // e2e/fixture/crt.mjs runs `crt serve` from a scratch project (e2e/.project/) with the
      // scripted session driver, so the chat spec never needs a Claude login and nothing is
      // written under this repo's .crt/.
      command: `node e2e/fixture/crt.mjs --target http://localhost:${FIXTURE_PORT} --port ${CRT_PORT}`,
      url: `http://localhost:${CRT_PORT}/__crt/health`,
      reuseExistingServer: false,
      timeout: 15_000,
    },
    {
      // The same, with the stub in its `sandboxed` variant (chat.spec.ts "sandboxed stub" block).
      command: `node e2e/fixture/crt.mjs --target http://localhost:${FIXTURE_PORT} --port ${CRT_SANDBOXED_PORT}`,
      env: { CRT_SESSION_STUB: "sandboxed", CRT_E2E_PROJECT: "sandboxed" },
      url: `http://localhost:${CRT_SANDBOXED_PORT}/__crt/health`,
      reuseExistingServer: false,
      timeout: 15_000,
    },
  ],
});
