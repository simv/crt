import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { CrtError } from "../src/errors.js";
import { createTerminalPrompter, isInteractive } from "../src/prompt.js";

// PRD-setup §5.2, F-71, F-77: the readline prompter over pipes (what can be driven without a
// TTY — Ctrl+C in raw mode is a keypress readline handles itself, so its path is exercised by
// hand; EOF takes the same route and is covered here).

function io(reprobeMs = 20) {
  const input = new PassThrough();
  const output = new PassThrough();
  let written = "";
  output.on("data", (c: Buffer) => (written += c.toString("utf8")));
  return { input, output, prompter: createTerminalPrompter({ input, output, reprobeMs }), text: () => written };
}

describe("createTerminalPrompter (F-71, F-77)", () => {
  it("ask prints the question and returns the trimmed line (F-71)", async () => {
    const t = io();
    const answer = t.prompter.ask("Dev server URL or port:");
    await new Promise((r) => setTimeout(r, 10));
    expect(t.text()).toContain("Dev server URL or port: ");
    t.input.write("  3100 \n");
    expect(await answer).toBe("3100");
    // A second question reuses the same streams (a fresh interface each time).
    const again = t.prompter.ask("Which one? [1]");
    t.input.write("\n");
    expect(await again).toBe("");
  });

  it("waitFor prints the line and returns `ready` when the re-probe succeeds, without an answer (F-71, N-14)", async () => {
    const t = io(10);
    let calls = 0;
    const outcome = await t.prompter.waitFor("http://localhost:3100 is not responding yet — start it, then press Enter to retry", async () => ++calls >= 3);
    expect(outcome).toEqual({ kind: "ready" });
    expect(calls).toBe(3);
    expect(t.text()).toContain("http://localhost:3100 is not responding yet — start it, then press Enter to retry\n");
  });

  it("waitFor returns the developer's answer first when one arrives, and stops re-probing (F-71)", async () => {
    const t = io(10);
    let calls = 0;
    const outcome = t.prompter.waitFor("waiting", async () => {
      calls++;
      return false;
    });
    t.input.write("5173\n");
    expect(await outcome).toEqual({ kind: "answer", text: "5173" });
    const seen = calls;
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toBe(seen);
  });

  it("EOF at a prompt (the Ctrl+C route) rejects with `cancelled`, exit 130 (F-77)", async () => {
    const t = io();
    const pending = t.prompter.ask("Dev server URL or port:");
    t.input.end();
    const err = await pending.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(CrtError);
    expect((err as CrtError).message).toBe("cancelled");
    expect((err as CrtError).exitCode).toBe(130);
    const w = io();
    const waiting = w.prompter.waitFor("line", async () => false);
    w.input.end();
    await expect(waiting).rejects.toMatchObject({ exitCode: 130 });
  });
});

describe("isInteractive (PRD-setup §5.2)", () => {
  const tty = { isTTY: true };
  const pipe = { isTTY: false };
  it("is true only with a TTY on both ends, CI unset and no --yes (F-70)", () => {
    expect(isInteractive({ yes: false, env: {}, stdin: tty, stdout: tty })).toBe(true);
    expect(isInteractive({ yes: true, env: {}, stdin: tty, stdout: tty })).toBe(false);
    expect(isInteractive({ yes: false, env: { CI: "true" }, stdin: tty, stdout: tty })).toBe(false);
    expect(isInteractive({ yes: false, env: { CI: "" }, stdin: tty, stdout: tty })).toBe(true);
    expect(isInteractive({ yes: false, env: {}, stdin: pipe, stdout: tty })).toBe(false);
    expect(isInteractive({ yes: false, env: {}, stdin: tty, stdout: pipe })).toBe(false);
    expect(isInteractive({ yes: false, env: {}, stdin: {}, stdout: {} })).toBe(false);
  });
});
