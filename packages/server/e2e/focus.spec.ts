import { expect, type Page, test } from "@playwright/test";

// Regression: typing a note re-rendered the panel and detached the focused textarea on every
// keystroke, so the caret was lost after each character (F-11).

type Hooks = {
  annotations(): Array<{ n: number; note: string }>;
  toggle(force?: boolean): void;
  togglePop(n: number, force?: boolean): void;
  addSelect(sel: string): number;
  addPin(x: number, y: number): number;
};
declare global {
  interface Window {
    __crt: Hooks;
  }
}

const shadow = (page: Page, sel: string) => page.locator("#crt-host").locator(sel);

const activeNote = (page: Page) =>
  page.evaluate(() => {
    const root = document.getElementById("crt-host")!.shadowRoot!;
    const a = root.activeElement as HTMLElement | null;
    return a?.tagName === "TEXTAREA" ? (a.closest<HTMLElement>(".pop")?.dataset.n ?? null) : null;
  });

test("note textarea keeps focus while typing key by key (F-11, F-65)", async ({ page }) => {
  await page.goto("/app");
  await page.evaluate(() => {
    window.__crt.addSelect("#heading");
    window.__crt.addPin(50, 50);
    window.__crt.togglePop(1, true);
  });
  const note = shadow(page, '.pop[data-n="1"] textarea');
  await note.click();
  expect(await activeNote(page)).toBe("1");
  for (const ch of "hello world") {
    await page.keyboard.press(ch === " " ? "Space" : ch);
    expect(await activeNote(page)).toBe("1");
  }
  await expect(note).toHaveValue("hello world");
  expect((await page.evaluate(() => window.__crt.annotations()))[0]!.note).toBe("hello world");
});
