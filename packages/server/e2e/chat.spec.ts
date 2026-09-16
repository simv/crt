import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { FIRST_MESSAGE_HEADING } from "../src/intake-message.js";
import { INTERNAL_WRITE_TASK_PATH, STALE_TOKEN_LINE } from "../src/mcp-stdio.js";
import { CODEX_CAPABILITIES, codexProfile } from "../src/providers/codex.js";
import { stubProfile } from "../src/providers/stub.js";
import type { ProvidersPayload, SessionEvent } from "../src/session-events.js";
import { parseTask, validateTaskText, writeIndex } from "../src/tasks.js";
import { CRT_CODEX_PORT, CRT_SANDBOXED_PORT } from "../playwright.config.js";

// M3 (task CRT-0003 Ask 7): Send opens the chat panel on an intake session. The server runs
// with CRT_SESSION_STUB=1 (e2e/fixture/crt.mjs), so the `stub` provider is resolved (F-43 step 0)
// and the events come from the scripted driver in src/providers/stub.ts rather than the Agent
// SDK, but the transport (SSE), the permission policy (F-26), the task writer (F-23, F-32, F-34)
// and the panel (F-25, F-28, F-29) are the real ones.
//
// M8 (PRD-providers F-61, `stub` axis): the footer is rendered from the session's replayed init
// event (F-47, F-56), the split Send button's per-send choice is spent on one send (F-56), and
// the second describe block runs against the `sandboxed` stub (F-46): no Allow/Deny cards.
//
// M9 (F-61, `codex` axis): the last block runs against `--provider codex` on a fake `codex` CLI
// (e2e/fixture/fake-codex.mjs, first on PATH; an npm-shaped `codex.cmd` shim on Windows) that
// replays the M6 recordings and calls `write_task` through the real `crt mcp` shim, token and
// internal route (F-49, F-53).

type Snapshot = { sessionId: string | null; state: string | null; taskId: string | null; provider: string | null; events: SessionEvent[] };
type Hooks = {
  addSelect(sel: string): number;
  setNote(n: number, note: string): void;
  send(opts?: { quick?: boolean }): Promise<{ id: string; dir: string; files: string[] }>;
  canQuickNote(): boolean;
  chat: { snapshot(): Snapshot; isOpen(): boolean; discard(): Promise<void> };
  sessions: { toggle(force?: boolean): Promise<void>; list(): Promise<Array<{ id: string; startedAt: string; summary: string | null; quick: boolean; provider: string }>> };
  providers: { toggle(force?: boolean): Promise<void>; load(refresh?: boolean): Promise<ProvidersPayload>; sendProvider(): string | null; pick(id: string | null): void; remember(id: string): Promise<void> };
};
declare global {
  interface Window {
    __crt: Hooks;
  }
}

const shadow = (page: Page, sel: string) => page.locator("#crt-host").locator(sel);

async function projectRoot(page: Page): Promise<string> {
  const res = await page.request.get("/__crt/health");
  return ((await res.json()) as { projectRoot: string }).projectRoot;
}

/** Annotate, Send, and wait for the chat to reach the permission card. */
async function sendAndWaitForPermission(page: Page): Promise<string> {
  await page.goto("/app");
  await page.evaluate(() => {
    window.__crt.addSelect("[data-testid=card-1] .price");
    window.__crt.setNote(1, "total excludes discount");
  });
  const sent = await page.evaluate(() => window.__crt.send());
  await expect(shadow(page, ".chat")).toBeVisible();
  await expect(shadow(page, ".perm")).toBeVisible();
  return sent.id;
}

test.describe("chat panel (F-24, F-25, F-26, F-28, F-29)", () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => window.__crt.chat.discard()).catch(() => undefined);
  });

  test("Send opens the chat: first message, streamed text, collapsed tool line, permission card; Deny is honoured", async ({ page }) => {
    const captureId = await sendAndWaitForPermission(page);

    // F-24: the first message is the capture summary with the images attached.
    await expect(shadow(page, ".msg.user").first()).toContainText(`CRT intake for capture ${captureId}`);
    await expect(shadow(page, ".msg.user").first()).toContainText("viewport (annotated), annotation 1");
    // F-25: streamed text rendered as markdown, tool activity as a collapsed line.
    await expect(shadow(page, ".msg.assistant").first()).toContainText("let me look at the source");
    await expect(shadow(page, ".msg.assistant strong").first()).toHaveText("CartSummary");
    await expect(shadow(page, ".tool summary").first()).toHaveText("Read src/components/Cart.tsx");
    await expect(shadow(page, ".tool").first()).toHaveClass(/done/);
    // F-26: Bash npm test is not pre-allowed, so it prompts.
    await expect(shadow(page, ".perm .t")).toHaveText("Bash npm test");
    await expect(shadow(page, ".perm pre")).toHaveText("npm test");
    await expect(shadow(page, ".chat-head .state")).toHaveAttribute("data-state", "waiting");
    // F-28/F-47: session id + the resume hint, which comes from the session's own init event (F-63: read from the profile).
    const snap = await page.evaluate(() => window.__crt.chat.snapshot());
    expect(snap.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(shadow(page, ".chat-foot")).toContainText(stubProfile.resumeCommand(snap.sessionId!)!);
    await expect(shadow(page, ".chat-foot")).toContainText("stub-model");
    expect(snap.provider).toBe("stub");

    await shadow(page, ".perm button.deny").click();
    await expect(shadow(page, ".perm.resolved .done")).toHaveText("Denied");
    await expect(shadow(page, ".msg.assistant").nth(1)).toContainText("I won't run tests");
    await expect(shadow(page, ".chat-head .state")).toHaveAttribute("data-state", "idle");
    await expect(shadow(page, ".tool summary")).toHaveCount(1); // Bash never ran
    await expect(shadow(page, ".chat-input textarea")).toBeFocused();
  });

  test("Allow runs the tool; a reply of 'write' writes the task and the panel shows its ID", async ({ page }) => {
    await sendAndWaitForPermission(page);
    await shadow(page, ".perm button.allow").click();
    await expect(shadow(page, ".perm.resolved .done")).toHaveText("Allowed");
    await expect(shadow(page, ".tool summary").nth(1)).toHaveText("Bash npm test");
    await expect(shadow(page, ".tool").nth(1)).toHaveClass(/done/);
    await expect(shadow(page, ".tool .out").nth(1)).toHaveText("12 passing");
    await expect(shadow(page, ".chat-head .state")).toHaveAttribute("data-state", "idle");

    // Multi-turn input (F-25): typed key by key (focus must survive every keystroke), Enter sends.
    const input = shadow(page, ".chat-input textarea");
    await expect(input).toBeFocused();
    for (const key of "write") {
      await page.keyboard.press(key);
      await expect(input).toBeFocused();
    }
    await expect(input).toHaveValue("write");
    await input.press("Enter");
    await expect(shadow(page, ".msg.user").nth(1)).toHaveText("write");
    await expect(shadow(page, ".chat-task")).toBeVisible();
    await expect(shadow(page, ".chat-task b")).toHaveText(/^CRT-\d{4}$/);
    const snap = await page.evaluate(() => window.__crt.chat.snapshot());
    const written = snap.events.find((e) => e.type === "task_written") as Extract<SessionEvent, { type: "task_written" }>;
    expect(snap.taskId).toBe(written.id);
    expect(written.path).toMatch(/^\.crt\/tasks\/CRT-\d{4}-cart-total-excludes-applied-discount\.md$/);

    // F-23 / F-32 / F-34 on disk (in the e2e scratch project, see e2e/fixture/crt.mjs).
    const root = await projectRoot(page);
    const tasksDir = join(root, ".crt", "tasks");
    const file = join(root, written.path);
    try {
      const text = readFileSync(file, "utf8");
      expect(validateTaskText(text, `${written.id}-cart-total-excludes-applied-discount.md`)).toEqual([]);
      // F-48: session is the native id (the stub's equals CRT's) and provider names the stub.
      expect(parseTask(text).frontmatter).toMatchObject({ session: snap.sessionId, provider: stubProfile.id });
      expect(text).toContain(`![viewport (annotated)](assets/${written.id}/viewport-annotated.png)`);
      expect(existsSync(join(tasksDir, "assets", written.id, "viewport.png"))).toBe(true);
      expect(readFileSync(join(tasksDir, "README.md"), "utf8")).toContain(`[${written.id}]`);
    } finally {
      rmSync(file, { force: true });
      rmSync(join(tasksDir, "assets", written.id), { recursive: true, force: true });
      writeIndex(tasksDir);
    }
  });

  test("Quick note: the chat stays hidden, Claude writes the task, the status line shows the id (F-14)", async ({ page }) => {
    await page.goto("/app");
    await shadow(page, ".launcher").click();
    await page.evaluate(() => window.__crt.addSelect("[data-testid=card-1] .price"));
    // No note, no quick note: there is no conversation to add the words later.
    expect(await page.evaluate(() => window.__crt.canQuickNote())).toBe(false);
    await expect(shadow(page, "[data-action=quick]")).toBeDisabled();
    await page.evaluate(() => window.__crt.setNote(1, "total excludes discount"));
    await expect(shadow(page, "[data-action=quick]")).toBeEnabled();

    await shadow(page, "[data-action=quick]").click();
    await expect(shadow(page, ".status")).toContainText(/Task CRT-\d{4} written to/);
    await expect(shadow(page, ".chat")).toBeHidden();
    const snap = await page.evaluate(() => window.__crt.chat.snapshot());
    expect(snap.taskId).toMatch(/^CRT-\d{4}$/);
    expect(snap.quiet).toBe(false);
    expect((snap.events[0] as { text: string }).text).toContain("Quick note (F-14)");
    expect(snap.events.some((e) => e.type === "permission")).toBe(false);
    const written = snap.events.find((e) => e.type === "task_written") as Extract<SessionEvent, { type: "task_written" }>;

    // The transcript is still there behind the "open chat" link.
    await shadow(page, ".status button[data-status=chat]").click();
    await expect(shadow(page, ".chat")).toBeVisible();
    await expect(shadow(page, ".chat-task b")).toHaveText(written.id);

    const root = await projectRoot(page);
    const tasksDir = join(root, ".crt", "tasks");
    try {
      expect(existsSync(join(root, written.path))).toBe(true);
    } finally {
      rmSync(join(root, written.path), { force: true });
      rmSync(join(tasksDir, "assets", written.id), { recursive: true, force: true });
      writeIndex(tasksDir);
    }
  });

  test("Quick note: when Claude has a question the panel opens itself (F-14)", async ({ page }) => {
    await page.goto("/app");
    await page.evaluate(() => {
      window.__crt.addSelect("#heading");
      window.__crt.setNote(1, "not sure about this one, ask me");
    });
    await page.evaluate(() => window.__crt.send({ quick: true }));
    await expect(shadow(page, ".chat")).toBeVisible();
    await expect(shadow(page, ".msg.assistant").first()).toContainText("Quick question before I write this");
    await expect(shadow(page, ".status")).toContainText("Claude needs you: Claude has a question");
    await expect(shadow(page, ".chat-head .state")).toHaveAttribute("data-state", "idle");
    expect((await page.evaluate(() => window.__crt.chat.snapshot())).taskId).toBeNull();
  });

  test("Sessions lists recent intake sessions newest first and re-opens one (F-30)", async ({ page }) => {
    await sendAndWaitForPermission(page);
    const mine = (await page.evaluate(() => window.__crt.chat.snapshot())).sessionId!;
    await shadow(page, "[data-chat=hide]").click();
    await expect(shadow(page, ".chat")).toBeHidden();

    await shadow(page, "[data-action=sessions]").click();
    const row = shadow(page, `.session[data-session="${mine}"]`);
    await expect(row).toBeVisible();
    await expect(row.locator(".sum")).toHaveText("total excludes discount");
    await expect(row.locator(".pill")).toHaveText("needs permission");
    await expect(row.locator(".meta")).toContainText("/app");
    const list = await page.evaluate(() => window.__crt.sessions.list());
    expect(list.map((s) => s.id)).toContain(mine);
    expect([...list].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map((s) => s.id)).toEqual(list.map((s) => s.id));

    await row.click();
    await expect(shadow(page, ".chat")).toBeVisible();
    await expect(shadow(page, ".sessions")).toBeHidden();
    expect((await page.evaluate(() => window.__crt.chat.snapshot())).sessionId).toBe(mine);
    await expect(shadow(page, ".perm")).toBeVisible();
  });

  test("Stop interrupts the turn, a reload restores the transcript, New session discards it (F-29)", async ({ page }) => {
    await page.goto("/app");
    await page.evaluate(() => {
      window.__crt.addSelect("#heading");
      window.__crt.setNote(1, "wrong heading");
    });
    await page.evaluate(() => window.__crt.send());
    await expect(shadow(page, ".msg.assistant").first()).toContainText("I read the capture");
    await shadow(page, "[data-chat=interrupt]").click();
    await expect(shadow(page, ".sys").last()).toHaveText("interrupted");
    await expect(shadow(page, ".chat-head .state")).toHaveAttribute("data-state", "idle");
    const before = await page.evaluate(() => window.__crt.chat.snapshot());

    await page.reload();
    await expect(shadow(page, ".chat")).toBeVisible();
    await expect(shadow(page, ".msg.user").first()).toContainText("CRT intake for capture");
    const after = await page.evaluate(() => window.__crt.chat.snapshot());
    expect(after.sessionId).toBe(before.sessionId);
    expect(after.events.length).toBeGreaterThanOrEqual(before.events.length);

    await shadow(page, "[data-chat=new]").click();
    await expect(shadow(page, ".chat")).toBeHidden();
    expect((await page.evaluate(() => window.__crt.chat.snapshot())).sessionId).toBeNull();
    const res = await page.request.get(`/__crt/sessions/${before.sessionId}`);
    expect(((await res.json()) as { session: { state: string } }).session.state).toBe("ended");
  });
});

test.describe("provider UX on the stub axis (F-46, F-47, F-49, F-56, F-57, F-61)", () => {
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => window.__crt.chat.discard()).catch(() => undefined);
  });

  test("the footer and every agent name come from the session's replayed init event, also after a reload (F-47, F-56, F-61)", async ({ page }) => {
    await sendAndWaitForPermission(page);
    const snap = await page.evaluate(() => window.__crt.chat.snapshot());
    const init = snap.events.find((e) => e.type === "init") as Extract<SessionEvent, { type: "init" }>;
    expect(init).toMatchObject({ provider: "stub", displayName: stubProfile.displayName, model: "stub-model", agentVersion: "stub", resumeCommand: stubProfile.resumeCommand(snap.sessionId!) });
    const foot = shadow(page, ".chat-foot");
    // F-56: `provider · model · agent version · resume command`; the head names the agent, the panel stays "CRT" (F-64).
    const expected = `${init.displayName} · ${init.model} · ${init.agentVersion} · continue in a terminal: ${init.resumeCommand}`;
    await expect(foot).toHaveText(expected);
    await expect(shadow(page, ".chat-head .title")).toHaveText("CRT");
    await expect(shadow(page, ".chat-head .agent")).toHaveText(init.displayName);
    await expect(shadow(page, ".chat-input textarea")).toHaveAttribute("placeholder", `Reply to ${init.displayName}… (Enter to send, Shift+Enter for a new line)`);
    await expect(shadow(page, "[data-chat=interrupt]")).toBeVisible();
    await expect(foot.locator(".badge")).toHaveCount(0);

    await page.reload();
    await expect(shadow(page, ".chat")).toBeVisible();
    await expect(foot).toHaveText(expected);
    await expect(shadow(page, ".chat-head .agent")).toHaveText(init.displayName);
    expect((await page.evaluate(() => window.__crt.chat.snapshot())).provider).toBe("stub");

    // F-47: the session list names the provider per row.
    await shadow(page, "[data-chat=hide]").click();
    await shadow(page, "[data-action=sessions]").click();
    await expect(shadow(page, `.session[data-session="${snap.sessionId}"] .meta`)).toContainText("· stub ·");
    const list = await page.evaluate(() => window.__crt.sessions.list());
    expect(list.find((s) => s.id === snap.sessionId)?.provider).toBe("stub");
  });

  test("the split Send button lists the providers and honours a per-send pick for that send only (F-56, F-57, F-61)", async ({ page }) => {
    await page.goto("/app");
    await page.evaluate(() => {
      window.__crt.addSelect("[data-testid=card-1] .price");
      window.__crt.setNote(1, "total excludes discount");
    });
    await shadow(page, ".launcher").click();
    const sendBtn = shadow(page, "[data-action=send]");
    // F-43 step 0: with CRT_SESSION_STUB the server's active provider is the stub, which the button names.
    await expect(sendBtn).toHaveAttribute("data-provider", "stub");
    await expect(sendBtn).toHaveText(`Send to ${stubProfile.displayName}`);

    // The caret opens the list, which refreshes the server's preflight (F-57 ?refresh=1) and shows a row per provider.
    const refreshed = page.waitForRequest((r) => r.url().includes("/__crt/providers?refresh=1"));
    await shadow(page, "[data-action=agent].caret").click();
    await refreshed;
    const menu = shadow(page, ".providers");
    await expect(menu).toBeVisible();
    await expect(menu.locator(".provider")).toHaveCount(3);
    await expect(menu.locator(".provider[data-provider=stub]")).toHaveClass(/active/);
    await expect(menu.locator(".provider[data-provider=claude] .name b")).toHaveText("Claude");
    await expect(menu.locator(".provider[data-provider=codex] .name small")).toHaveText("codex");
    await expect(menu.locator(".why")).toContainText("Auto-detected:");
    const payload = await page.evaluate(() => window.__crt.providers.load());
    expect(payload.providers.map((p) => p.id)).toEqual(["claude", "codex", "stub"]);
    // Unusable rows are disabled with the problem as tooltip; usable ones say so.
    for (const p of payload.providers) {
      const row = menu.locator(`.provider[data-provider=${p.id}]`);
      if (p.problem) {
        await expect(row).toBeDisabled();
        await expect(row).toHaveAttribute("title", p.problem);
      } else await expect(row).toBeEnabled();
    }
    await expect(menu).not.toHaveClass(/refreshing/);

    // Pick claude for this send: the button says so, the request carries it, then the pick is spent.
    await menu.locator(".provider[data-provider=claude]").click();
    await expect(menu).toBeHidden();
    await expect(sendBtn).toHaveAttribute("data-provider", "claude");
    await expect(sendBtn).toHaveText("Send to Claude");
    expect(await page.evaluate(() => window.__crt.providers.sendProvider())).toBe("claude");
    await page.reload(); // per tab, survives a reload until used
    await shadow(page, ".launcher").click();
    await expect(shadow(page, "[data-action=send]")).toHaveAttribute("data-provider", "claude");
    await page.evaluate(() => {
      window.__crt.addSelect("[data-testid=card-1] .price");
      window.__crt.setNote(1, "total excludes discount");
    });
    const created = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/__crt/sessions"));
    await shadow(page, "[data-action=send]").click();
    expect((await created).postDataJSON()).toMatchObject({ provider: "claude" });
    await expect(shadow(page, ".chat")).toBeVisible();
    await expect(shadow(page, ".perm")).toBeVisible();
    // Honoured for that send only: the next one goes to the active provider with no `provider` in the body.
    await expect(shadow(page, "[data-action=send]")).toHaveAttribute("data-provider", "stub");
    expect(await page.evaluate(() => window.__crt.providers.sendProvider())).toBe("stub");
    await page.evaluate(() => window.__crt.chat.discard());
    await page.evaluate(() => {
      window.__crt.addSelect("#heading");
      window.__crt.setNote(1, "again");
    });
    const second = page.waitForRequest((r) => r.method() === "POST" && r.url().endsWith("/__crt/sessions"));
    await shadow(page, "[data-action=send]").click();
    expect((await second).postDataJSON()).not.toHaveProperty("provider");
    await expect(shadow(page, ".chat")).toBeVisible();
  });

  test("\"Remember for this project on this machine\" writes .crt/config.local.json through PUT /__crt/config (F-56, F-57)", async ({ page }) => {
    await page.goto("/app");
    await shadow(page, ".launcher").click();
    await shadow(page, "[data-action=agent]").first().click();
    const menu = shadow(page, ".providers");
    await expect(menu.locator(".provider")).toHaveCount(3);
    await menu.locator(".remember input").check();
    const put = page.waitForRequest((r) => r.method() === "PUT" && r.url().endsWith("/__crt/config"));
    await menu.locator(".provider[data-provider=claude]").click();
    expect((await put).postDataJSON()).toEqual({ provider: "claude" });
    await expect(shadow(page, ".status")).toContainText("Remembered: new sessions run on Claude for this project on this machine");
    const root = await projectRoot(page);
    const local = join(root, ".crt", "config.local.json");
    try {
      expect(JSON.parse(readFileSync(local, "utf8"))).toEqual({ provider: "claude" });
      // A remembered choice is not a per-send override.
      expect(await page.evaluate(() => window.__crt.providers.sendProvider())).toBe("stub");
    } finally {
      rmSync(local, { force: true });
    }
    // N-8: the page cannot set anything but the two keys or a non-built-in id.
    expect((await page.request.put("/__crt/config", { data: { provider: { kind: "acp", command: "evil" } } })).status()).toBe(400);
    expect((await page.request.put("/__crt/config", { data: { provider: "nope" } })).status()).toBe(400);
    expect((await page.request.put("/__crt/config", { data: { models: { claude: "has space" } } })).status()).toBe(400);
    expect((await page.request.put("/__crt/config", { data: { providers: { codex: { command: ["x"] } } } })).status()).toBe(400);
    expect(((await (await page.request.get("/__crt/health")).json()) as { provider: string }).provider).toBe("stub");
  });

  test("the internal write_task route refuses browsers and stale tokens, and the server log never carries a token (F-49, N-8)", async ({ page }) => {
    await sendAndWaitForPermission(page);
    // From the page (Origin present): 403 before anything is read.
    const fromPage = await page.evaluate(async (path) => {
      const r = await fetch(path, { method: "POST", headers: { authorization: "Bearer whatever", "content-type": "application/json" }, body: "{}" });
      return { status: r.status, body: await r.text() };
    }, INTERNAL_WRITE_TASK_PATH);
    expect(fromPage).toEqual({ status: 403, body: "" });
    // From a non-browser client with a wrong token: 404, empty body, one N-7 log line.
    const stale = await page.request.post(INTERNAL_WRITE_TASK_PATH, { headers: { authorization: "Bearer not-a-token" }, data: {} });
    expect(stale.status()).toBe(404);
    expect(await stale.text()).toBe("");
    const log = readFileSync(join(await projectRoot(page), "crt-serve.log"), "utf8");
    expect(log).toContain(STALE_TOKEN_LINE);
    expect(log).not.toMatch(/Bearer\s+\S/);
    expect(log).not.toMatch(/[A-Za-z0-9_-]{43}/); // a 32-byte base64url token never reaches the log
    // Nor does it reach the page: the session info and events carry no token.
    const snap = await page.evaluate(() => window.__crt.chat.snapshot());
    const info = await (await page.request.get(`/__crt/sessions/${snap.sessionId}`)).text();
    expect(info).not.toMatch(/token/i);
    expect(JSON.stringify(snap.events)).not.toMatch(/[A-Za-z0-9_-]{43}/);
  });
});

test.describe("sandboxed stub (F-46, F-50, F-51, F-61)", () => {
  test.use({ baseURL: `http://localhost:${CRT_SANDBOXED_PORT}` });
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => window.__crt.chat.discard()).catch(() => undefined);
  });

  test("no Allow/Deny cards, a read-only badge, instructions in the first message, images by path, a valid task (F-46, F-50, F-51, F-61)", async ({ page }) => {
    await page.goto("/app");
    await page.evaluate(() => {
      window.__crt.addSelect("[data-testid=card-1] .price");
      window.__crt.setNote(1, "total excludes discount");
    });
    await page.evaluate(() => window.__crt.send());
    await expect(shadow(page, ".chat")).toBeVisible();
    // The tool that would have prompted ran inside the sandbox: a tool line, never a card.
    await expect(shadow(page, ".tool summary").nth(1)).toHaveText("Bash npm test");
    await expect(shadow(page, ".chat-head .state")).toHaveAttribute("data-state", "idle");
    await expect(shadow(page, ".perm")).toHaveCount(0);
    const snap = await page.evaluate(() => window.__crt.chat.snapshot());
    expect(snap.events.some((e) => e.type === "permission")).toBe(false);
    expect(snap.events.some((e) => e.type === "state" && e.state === "waiting")).toBe(false);
    expect(snap.events.filter((e) => e.type === "error")).toEqual([]);
    const init = snap.events.find((e) => e.type === "init") as Extract<SessionEvent, { type: "init" }>;
    expect(init.capabilities).toMatchObject({ permissions: "sandboxed", images: "path", instructions: "first-message" });
    // F-51: the intake instructions travel in the first message, under the fixed heading.
    const first = snap.events[0] as Extract<SessionEvent, { type: "user" }>;
    expect(first.text.startsWith(`${FIRST_MESSAGE_HEADING}\n\n`)).toBe(true);
    expect(first.text).toContain("\n\n---\n\nCRT intake for capture ");
    expect(first.images).toEqual(["viewport (annotated)", "annotation 1"]);
    // F-46: the footer badge instead of Allow/Deny; Stop stays (interrupt: true); resume hint stays.
    const foot = shadow(page, ".chat-foot");
    await expect(foot.locator(".badge")).toHaveText("read-only sandbox");
    await expect(foot).toContainText(init.resumeCommand!);
    await expect(shadow(page, "[data-chat=interrupt]")).toBeVisible();
    await expect(shadow(page, ".chat-foot")).toContainText("stub-sandboxed");

    await page.reload();
    await expect(shadow(page, ".chat")).toBeVisible();
    await expect(foot.locator(".badge")).toHaveText("read-only sandbox");
    await expect(shadow(page, ".perm")).toHaveCount(0);

    // write_task still works: the server performs it (§5.3), the file names the stub.
    await shadow(page, ".chat-input textarea").fill("write");
    await shadow(page, ".chat-input textarea").press("Enter");
    await expect(shadow(page, ".chat-task b")).toHaveText(/^CRT-\d{4}$/);
    const after = await page.evaluate(() => window.__crt.chat.snapshot());
    const written = after.events.find((e) => e.type === "task_written") as Extract<SessionEvent, { type: "task_written" }>;
    const root = await projectRoot(page);
    const tasksDir = join(root, ".crt", "tasks");
    try {
      const text = readFileSync(join(root, written.path), "utf8");
      expect(validateTaskText(text, `${written.id}-cart-total-excludes-applied-discount.md`)).toEqual([]);
      expect(parseTask(text).frontmatter).toMatchObject({ provider: "stub", session: snap.sessionId });
    } finally {
      rmSync(join(root, written.path), { force: true });
      rmSync(join(tasksDir, "assets", written.id), { recursive: true, force: true });
      writeIndex(tasksDir);
    }
  });
});

test.describe("codex provider on the fake codex CLI (F-49, F-53, F-56, F-61)", () => {
  test.use({ baseURL: `http://localhost:${CRT_CODEX_PORT}` });
  test.afterEach(async ({ page }) => {
    await page.evaluate(() => window.__crt.chat.discard()).catch(() => undefined);
  });

  test("Send to Codex: replayed text and tool lines, the read-only badge and no cards, a resumable thread id in the footer that survives a reload, write_task through crt mcp, Stop kills the turn (F-49, F-53, F-56, F-61)", async ({ page }) => {
    // F-43 step 2 / F-57: the server runs on codex and says so.
    const health = (await (await page.request.get("/__crt/health")).json()) as { provider: string };
    expect(health.provider).toBe("codex");
    const payload = (await (await page.request.get("/__crt/providers")).json()) as ProvidersPayload;
    expect(payload.active).toBe("codex");
    expect(payload.providers.find((p) => p.id === "codex")).toMatchObject({ installed: true, loggedIn: true, version: "0.154.0", problem: null, capabilities: CODEX_CAPABILITIES });
    expect(payload.providers.map((p) => p.id)).toEqual(["claude", "codex"]); // no stub without CRT_SESSION_STUB (F-42)

    await page.goto("/app");
    await shadow(page, ".launcher").click();
    await expect(shadow(page, "[data-action=send]")).toHaveText(`Send to ${codexProfile.displayName}`);
    await page.evaluate(() => {
      window.__crt.addSelect("[data-testid=card-1] .price");
      window.__crt.setNote(1, "total excludes discount");
    });
    await page.evaluate(() => window.__crt.send());
    await expect(shadow(page, ".chat")).toBeVisible();
    // Turn 1 replays first-turn.jsonl: an MCP tool line, a command line, then the whole message.
    await expect(shadow(page, ".tool summary").first()).toHaveText("crt/crt_ping");
    await expect(shadow(page, ".tool .out").first()).toHaveText("listener replied 200: pong #5");
    await expect(shadow(page, ".tool summary").nth(1)).toHaveText(/^Run /);
    await expect(shadow(page, ".msg.assistant").first()).toContainText("listener replied 200: pong #5");
    await expect(shadow(page, ".chat-head .state")).toHaveAttribute("data-state", "idle");
    await expect(shadow(page, ".perm")).toHaveCount(0);
    await expect(shadow(page, ".chat-head .agent")).toHaveText("Codex");

    const snap = await page.evaluate(() => window.__crt.chat.snapshot());
    expect(snap.provider).toBe("codex");
    expect(snap.events.some((e) => e.type === "permission")).toBe(false);
    expect(snap.events.filter((e) => e.type === "error")).toEqual([]);
    const init = snap.events.find((e) => e.type === "init") as Extract<SessionEvent, { type: "init" }>;
    // §5.4: the native id is Codex's thread id (a UUID that is not CRT's), and the footer shows its resume command.
    expect(init).toMatchObject({ provider: "codex", displayName: "Codex", model: null, agentVersion: "0.154.0", capabilities: CODEX_CAPABILITIES });
    expect(init.nativeSessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(init.nativeSessionId).not.toBe(snap.sessionId);
    expect(init.resumeCommand).toBe(codexProfile.resumeCommand(init.nativeSessionId));
    const foot = shadow(page, ".chat-foot");
    await expect(foot).toHaveText(`Codex · 0.154.0 · read-only sandbox · continue in a terminal: ${init.resumeCommand}`);
    await expect(foot.locator(".badge")).toHaveText("read-only sandbox");
    await expect(shadow(page, "[data-chat=interrupt]")).toBeVisible();
    // F-51/F-50: instructions in the first message; images went by path (the fake checks the files exist).
    const first = snap.events[0] as Extract<SessionEvent, { type: "user" }>;
    expect(first.text.startsWith(`${FIRST_MESSAGE_HEADING}\n\n`)).toBe(true);
    expect(first.images).toEqual(["viewport (annotated)", "annotation 1"]);
    // F-53: no streaming — one text event per assistant message.
    expect(snap.events.filter((e) => e.type === "text").length).toBe(snap.events.filter((e) => e.type === "assistant_start").length);

    await page.reload();
    await expect(shadow(page, ".chat")).toBeVisible();
    await expect(foot).toHaveText(`Codex · 0.154.0 · read-only sandbox · continue in a terminal: ${init.resumeCommand}`);
    await expect(shadow(page, ".chat-head .agent")).toHaveText("Codex");

    // Turn 2 resumes the thread; the fake calls write_task through `crt mcp` → the internal route writes the file.
    await shadow(page, ".chat-input textarea").fill("write");
    await shadow(page, ".chat-input textarea").press("Enter");
    await expect(shadow(page, ".chat-task b")).toHaveText(/^CRT-\d{4}$/);
    await expect(shadow(page, ".tool summary").last()).toHaveText("Write task: Cart total excludes applied discount");
    await expect(shadow(page, ".tool").last()).toHaveClass(/done/);
    await expect(shadow(page, ".chat-head .state")).toHaveAttribute("data-state", "idle");
    const after = await page.evaluate(() => window.__crt.chat.snapshot());
    const written = after.events.find((e) => e.type === "task_written") as Extract<SessionEvent, { type: "task_written" }>;
    expect(after.events.filter((e) => e.type === "task_written")).toHaveLength(1);
    expect(after.events.filter((e) => e.type === "init")).toHaveLength(1);
    expect(after.events.filter((e) => e.type === "error")).toEqual([]);
    const root = await projectRoot(page);
    const tasksDir = join(root, ".crt", "tasks");
    try {
      const text = readFileSync(join(root, written.path), "utf8");
      expect(validateTaskText(text, `${written.id}-cart-total-excludes-applied-discount.md`)).toEqual([]);
      expect(parseTask(text).frontmatter).toMatchObject({ provider: "codex", session: init.nativeSessionId });
      expect(text).toContain(`created by intake session ${init.nativeSessionId} (codex)`);
      expect(readFileSync(join(tasksDir, "README.md"), "utf8")).toContain(`[${written.id}]`);
      // F-49/N-8: the token (32 bytes base64url = exactly 43 chars) never reaches the log or the page.
      const token = /(^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/;
      const log = readFileSync(join(root, "crt-serve.log"), "utf8");
      expect(log).toContain("is Codex 0.154.0");
      expect(log).not.toMatch(token);
      expect(log).not.toMatch(/Bearer|CRT_MCP_TOKEN/);
      expect(JSON.stringify(after.events)).not.toMatch(token);
    } finally {
      rmSync(join(root, written.path), { force: true });
      rmSync(join(tasksDir, "assets", written.id), { recursive: true, force: true });
      writeIndex(tasksDir);
    }

    // Turn 3: a slow turn, cut by Stop (process-tree kill); the session stays usable.
    await shadow(page, ".chat-input textarea").fill("be slow please");
    await shadow(page, ".chat-input textarea").press("Enter");
    await expect(shadow(page, ".chat-head .state")).toHaveAttribute("data-state", "running");
    await shadow(page, "[data-chat=interrupt]").click();
    await expect(shadow(page, ".sys").last()).toHaveText("interrupted");
    await expect(shadow(page, ".chat-head .state")).toHaveAttribute("data-state", "idle");
    const list = await page.evaluate(() => window.__crt.sessions.list());
    expect(list.find((s) => s.id === snap.sessionId)?.provider).toBe("codex");
  });
});
