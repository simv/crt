import { type ChildProcess, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// PRD-setup F-80, F-81, F-82 (the M13 half of F-90): the launcher dot, the welcome card and the
// "never fetched the overlay" line. The dot and the F-80 line need a server of their own (the
// timer and the once-per-server lines are per server, and the dot must see its server die), so
// those specs spawn `dist/cli.js serve --yes` from scratch projects with `CRT_SESSION_STUB=1` and
// stdout captured, the way start.spec.ts does; ports 4470–4479 are this file's. The welcome card
// is suppressed under the stub, so it is opened explicitly with `window.__crt.welcome()` on the
// shared stub server (baseURL) and never shows on the pages the other specs load.

const here = dirname(fileURLToPath(import.meta.url));
const CLI = join(here, "..", "dist", "cli.js");
const FIXTURE = "http://localhost:3999";

interface Crt {
  child: ChildProcess;
  lines: string[];
  root: string;
  exited: Promise<number | null>;
  waitFor(re: RegExp, timeoutMs?: number): Promise<string>;
}

const running: ChildProcess[] = [];

function scratch(name: string, port: number): string {
  const root = join(here, ".project", `arrival-${name}`);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, ".git"), { recursive: true });
  mkdirSync(join(root, ".crt"), { recursive: true });
  writeFileSync(join(root, ".crt", "config.json"), JSON.stringify({ tasksDir: ".crt/tasks", target: null, port }, null, 2) + "\n");
  return root;
}

function startCrt(root: string, args: string[]): Crt {
  const child = spawn(process.execPath, [CLI, ...args], { cwd: root, env: { ...process.env, CRT_SESSION_STUB: "1" }, stdio: ["ignore", "pipe", "pipe"], shell: false, windowsHide: true });
  running.push(child);
  const lines: string[] = [];
  const waiters: Array<{ re: RegExp; resolve: (line: string) => void }> = [];
  const push = (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (!line) continue;
      lines.push(line);
      for (const w of [...waiters]) {
        if (w.re.test(line)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(line);
        }
      }
    }
  };
  child.stdout!.on("data", push);
  child.stderr!.on("data", push);
  const exited = new Promise<number | null>((resolve) => child.on("exit", (code) => resolve(code)));
  return {
    child,
    lines,
    root,
    exited,
    waitFor: (re, timeoutMs = 20_000) =>
      new Promise<string>((resolve, reject) => {
        const hit = lines.find((l) => re.test(l));
        if (hit) return resolve(hit);
        const timer = setTimeout(() => reject(new Error(`no line matching ${re} within ${timeoutMs} ms; got:\n${lines.join("\n")}`)), timeoutMs);
        waiters.push({
          re,
          resolve: (line) => {
            clearTimeout(timer);
            resolve(line);
          },
        });
      }),
  };
}

async function health(port: number): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`http://localhost:${port}/__crt/health`);
    return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

test.afterEach(async () => {
  for (const c of running.splice(0)) {
    if (c.exitCode === null) c.kill();
  }
  await new Promise((r) => setTimeout(r, 300));
});

test("launcher dot reaches `connected` with the project in its tooltip, and turns `unreachable` once its server is gone (F-81)", async ({ page }) => {
  const root = scratch("dot", 4471);
  const crt = startCrt(root, ["--target", FIXTURE, "--yes"]);
  await crt.waitFor(/^CRT ready at http:\/\/localhost:4471 /);
  const projectRoot = (await health(4471))!.projectRoot as string;

  await page.goto("http://localhost:4471/");
  const launcher = page.locator("#crt-host .launcher");
  await expect(launcher).toBeVisible();
  await expect(launcher).toHaveAttribute("data-health", "connected");
  // The stub's login is unknown, so the tooltip carries the suffix; the agent noun is the provider's display name (F-56).
  await expect(launcher).toHaveAttribute("title", `CRT · Claude ready · ${projectRoot} · login not checked yet`);
  expect(await page.evaluate(() => (window as unknown as { __crt: { healthState(): string } }).__crt.healthState())).toBe("connected");

  crt.child.kill();
  await crt.exited;
  await expect.poll(() => health(4471)).toBeNull();
  // The dot never polls: the tab coming back into view is one of the three triggers.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(launcher).toHaveAttribute("data-health", "unreachable");
  await expect(launcher).toHaveAttribute("title", "CRT server not answering — is crt serve still running? (Send will fail)");
});

test("`window.__crt.welcome()` shows the card with health's target, project and agent line; Got it remembers it per project (F-82)", async ({ page, request }) => {
  await page.goto("/");
  const host = page.locator("#crt-host");
  await expect(host.locator(".launcher")).toBeVisible();
  // Suppressed under the stub: nothing appears on its own.
  await expect(host.locator(".launcher")).toHaveAttribute("data-health", "connected");
  await expect(host.locator(".welcome")).toHaveCount(0);

  const h = (await (await request.get("/__crt/health")).json()) as { target: string; projectRoot: string; tasks: number };
  await page.evaluate(() => (window as unknown as { __crt: { welcome(): Promise<void> } }).__crt.welcome());
  const card = host.locator(".welcome");
  await expect(card).toBeVisible();
  await expect(card.locator("h2")).toHaveText("CRT is on this page");
  await expect(card.locator("p.proxying")).toContainText(`Proxying ${h.target} for ${h.projectRoot}. Tasks are written to `);
  await expect(card.locator("p.proxying")).toContainText(`(${h.tasks} there now).`);
  await expect(card.locator("p.agent")).toHaveText("Agent: Claude — login not checked yet; the first Send will tell you");
  await expect(card.locator("ol li")).toHaveText(["Open the toolbar: the CRT button, or Ctrl/Cmd+Shift+.", "Select, Box or Pin the thing.", "Type a note and Send."]);
  // The card sits above the launcher, never over it.
  const [cardBox, launcherBox] = await Promise.all([card.boundingBox(), host.locator(".launcher").boundingBox()]);
  expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(launcherBox!.y);

  await card.locator("button[data-welcome=got-it]").click();
  await expect(host.locator(".welcome")).toHaveCount(0);
  const key = `crt.welcome.v1:${h.projectRoot}`;
  expect(await page.evaluate((k) => localStorage.getItem(k), key)).not.toBeNull();

  // Should: Show me opens the toolbar with Select armed and dismisses.
  await page.evaluate(() => (window as unknown as { __crt: { welcome(): Promise<void> } }).__crt.welcome());
  await expect(card).toBeVisible();
  await card.locator("button[data-welcome=show]").click();
  await expect(host.locator(".welcome")).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __crt: { isOpen(): boolean; currentTool(): string | null } }).__crt.isOpen())).toBe(true);
  expect(await page.evaluate(() => (window as unknown as { __crt: { currentTool(): string | null } }).__crt.currentTool())).toBe("select");
  await page.evaluate((k) => localStorage.removeItem(k), key);
});

test("a page whose CSP blocks the overlay script produces the F-80 line and leaves overlay.fetched at 0 (F-80)", async ({ page }) => {
  const root = scratch("csp", 4473);
  const crt = startCrt(root, ["--target", FIXTURE, "--yes"]);
  await crt.waitFor(/^CRT ready at http:\/\/localhost:4473 /);

  await page.goto("http://localhost:4473/csp-strict");
  await expect(page.locator("#heading")).toHaveText("CRT fixture app");
  await expect(page.locator("#crt-host")).toHaveCount(0);
  // Should: the unrelaxable policy is named at once.
  expect(crt.lines).toContain("crt: GET /csp-strict sends a CSP with 'strict-dynamic' that CRT cannot relax — the overlay may be blocked; use the script-tag fallback");
  const missing = await crt.waitFor(/^crt: injected the overlay into GET /, 20_000);
  expect(missing).toBe("crt: injected the overlay into GET /csp-strict but the browser never fetched /__crt/overlay.js — a Content-Security-Policy or a JS-rendered shell is blocking it; see README › Overlay does not appear");
  expect(crt.lines.filter((l) => l.startsWith("crt: injected the overlay"))).toHaveLength(1);
  const h = (await health(4473))!;
  expect(h.overlay).toMatchObject({ fetched: 0, cspWarning: "script-src 'nonce-abc' 'strict-dynamic'" });
  expect((h.overlay as { injected: number }).injected).toBeGreaterThanOrEqual(1);
  // What the terminal showed, kept as this scratch project's crt-serve.log for the record.
  writeFileSync(join(root, "crt-serve.log"), crt.lines.join("\n") + "\n");
});
