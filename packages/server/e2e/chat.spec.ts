import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import type { SessionEvent } from "../src/session-events.js";
import { validateTaskText, writeIndex } from "../src/tasks.js";

// M3 (task CRT-0003 Ask 7): Send opens the chat panel on an intake session. The server runs
// with CRT_SESSION_STUB=1 (e2e/fixture/crt.mjs), so the events come from the scripted driver in
// src/session-stub.ts rather than the Agent SDK, but the transport (SSE), the permission policy
// (F-26), the task writer (F-23, F-32, F-34) and the panel (F-25, F-28, F-29) are the real ones.

type Snapshot = { sessionId: string | null; state: string | null; taskId: string | null; events: SessionEvent[] };
type Hooks = {
  addSelect(sel: string): number;
  setNote(n: number, note: string): void;
  send(opts?: { quick?: boolean }): Promise<{ id: string; dir: string; files: string[] }>;
  canQuickNote(): boolean;
  chat: { snapshot(): Snapshot; isOpen(): boolean; discard(): Promise<void> };
  sessions: { toggle(force?: boolean): Promise<void>; list(): Promise<Array<{ id: string; startedAt: string; summary: string | null; quick: boolean }>> };
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
    // F-28: session id + resume hint.
    const snap = await page.evaluate(() => window.__crt.chat.snapshot());
    expect(snap.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    await expect(shadow(page, ".chat-foot")).toContainText(`claude --resume ${snap.sessionId}`);
    await expect(shadow(page, ".chat-foot")).toContainText("stub-model");

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

    // Multi-turn input (F-25): Enter sends.
    await shadow(page, ".chat-input textarea").fill("write");
    await shadow(page, ".chat-input textarea").press("Enter");
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
      expect(text).toContain(`session: ${snap.sessionId}`);
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
