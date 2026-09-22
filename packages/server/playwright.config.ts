import { defineConfig, devices } from "@playwright/test";

// E2E smoke (PRD §9, task CRT-0001 Ask 8; PRD-embedded F-110, M18): the static fixture app is the
// app under test on its own origin (baseURL) and carries the CRT loader tag for the primary
// embedded `crt serve` (FIXTURE_CRT_ORIGIN), so capture, chat, arrival and focus run the way a
// real app does since v0.4 — the overlay loaded cross-origin from the CRT server. A dedicated
// `crt proxy` server on its own scratch root serves proxy.spec.ts (and the proxy rows in
// arrival.spec.ts / start.spec.ts spawn their own). Playwright starts the web servers in order,
// so the fixture is up before crt probes it.
const FIXTURE_PORT = 3999;
/** The app origin: what every browser spec navigates to (F-110). */
export const FIXTURE_ORIGIN = `http://localhost:${FIXTURE_PORT}`;
const CRT_PORT = 4499;
/** The primary embedded CRT server: `/__crt/*` for the pages on FIXTURE_ORIGIN. */
export const CRT_ORIGIN = `http://localhost:${CRT_PORT}`;
/** PRD-providers F-61 `stub` axis, `sandboxed` variant (F-46): a second CRT on its own scratch root. */
export const CRT_SANDBOXED_PORT = 4498;
/** PRD-providers F-61 `codex` axis: a third CRT on `--provider codex` against the fake Codex CLI (e2e/fixture/fake-codex.mjs). */
export const CRT_CODEX_PORT = 4497;
/** PRD-providers F-54 / F-61 `acp` axis: a fourth CRT on the ad-hoc `{ kind: "acp" }` config against the fake ACP agent (e2e/fixture/fake-acp.mjs). */
export const CRT_ACP_PORT = 4495;
/** PRD-providers F-111 / F-61 `antigravity` axis: a fifth CRT on `--provider antigravity` against the fake Antigravity CLI (e2e/fixture/fake-agy.mjs). */
export const CRT_ANTIGRAVITY_PORT = 4494;
/** PRD-embedded F-92 / N-21: the proxy-mode server for proxy.spec.ts — the v0.3 shape, on its own scratch root. */
export const CRT_PROXY_PORT = 4496;
export const CRT_PROXY_ORIGIN = `http://localhost:${CRT_PROXY_PORT}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  // PRD-polish F-116: the README screenshots have their own config (playwright.screenshots.config.ts,
  // `npm run screenshots`) and never run here or in CI.
  testIgnore: "**/screenshots.spec.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: FIXTURE_ORIGIN,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "node e2e/fixture/server.mjs",
      env: { FIXTURE_PORT: String(FIXTURE_PORT), FIXTURE_CRT_ORIGIN: CRT_ORIGIN },
      url: `${FIXTURE_ORIGIN}/`,
      reuseExistingServer: false,
      timeout: 15_000,
    },
    {
      // e2e/fixture/crt.mjs runs `crt serve` (embedded, F-91) from a scratch project (e2e/.project/)
      // with the scripted session driver, so the chat spec never needs a Claude login and nothing
      // is written under this repo's .crt/. The target is only the app URL it would open (--no-open).
      command: `node e2e/fixture/crt.mjs --target ${FIXTURE_ORIGIN} --port ${CRT_PORT} --no-open`,
      url: `${CRT_ORIGIN}/__crt/health`,
      reuseExistingServer: false,
      timeout: 15_000,
    },
    {
      // The same, with the stub in its `sandboxed` variant (chat.spec.ts "sandboxed stub" block);
      // its pages ask for it with `?crt=`.
      command: `node e2e/fixture/crt.mjs --target ${FIXTURE_ORIGIN} --port ${CRT_SANDBOXED_PORT} --no-open`,
      env: { CRT_SESSION_STUB: "sandboxed", CRT_E2E_PROJECT: "sandboxed" },
      url: `http://localhost:${CRT_SANDBOXED_PORT}/__crt/health`,
      reuseExistingServer: false,
      timeout: 15_000,
    },
    {
      // The codex axis (chat.spec.ts "codex provider" block): no stub (the variable is present but
      // empty), the fake `codex` first on PATH, and the provider fixed by CRT_PROVIDER (F-43 step 2).
      command: `node e2e/fixture/crt.mjs --target ${FIXTURE_ORIGIN} --port ${CRT_CODEX_PORT} --no-open`,
      env: { CRT_SESSION_STUB: "", CRT_PROVIDER: "codex", CRT_E2E_PROJECT: "codex", CRT_E2E_FAKE_CODEX: "1" },
      url: `http://localhost:${CRT_CODEX_PORT}/__crt/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      // The acp axis (chat.spec.ts "ad-hoc ACP agent" block): no stub, the provider is the F-54 object
      // form in the scratch project's .crt/config.json (never a flag or a route, N-8).
      command: `node e2e/fixture/crt.mjs --target ${FIXTURE_ORIGIN} --port ${CRT_ACP_PORT} --no-open`,
      env: { CRT_SESSION_STUB: "", CRT_E2E_PROJECT: "acp", CRT_E2E_FAKE_ACP: "1" },
      url: `http://localhost:${CRT_ACP_PORT}/__crt/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      // The antigravity axis (chat.spec.ts "antigravity provider" block): no stub, the fake `agy` on PATH
      // (installed for every server — N-9 — and the only agy this PATH has), the provider fixed by CRT_PROVIDER.
      command: `node e2e/fixture/crt.mjs --target ${FIXTURE_ORIGIN} --port ${CRT_ANTIGRAVITY_PORT} --no-open`,
      env: { CRT_SESSION_STUB: "", CRT_PROVIDER: "antigravity", CRT_E2E_PROJECT: "antigravity" },
      url: `http://localhost:${CRT_ANTIGRAVITY_PORT}/__crt/health`,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      // Proxy mode (F-92): `crt proxy` in front of the fixture, which serves its plain pages to the
      // proxy (no loader tag on a forwarded request) so injection is what puts the overlay there.
      command: `node e2e/fixture/crt.mjs --proxy --target ${FIXTURE_ORIGIN} --port ${CRT_PROXY_PORT}`,
      env: { CRT_E2E_PROJECT: "proxy" },
      url: `${CRT_PROXY_ORIGIN}/__crt/health`,
      reuseExistingServer: false,
      timeout: 15_000,
    },
  ],
});
