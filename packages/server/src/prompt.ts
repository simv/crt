/**
 * The terminal prompter behind the guided start (PRD-setup §5.2, F-71, F-77) on
 * `node:readline/promises`. Used only when cli.ts decided the run is interactive; start.ts
 * never calls it otherwise, so nothing here runs under a skill or in CI.
 *
 *   • `ask` prints the question and returns the trimmed answer ("" for Enter alone).
 *   • `waitFor` prints the F-71 wait line and races the developer's Enter against a re-probe every
 *     2 s: the target coming up ends the wait on its own, so an unanswered prompt on a console
 *     that lies about being a TTY still completes (PRD-setup §11).
 *   • Ctrl+C (or EOF) at a prompt rejects with `CrtError("cancelled", 130)`, which cli.ts prints as
 *     `crt: cancelled` and exits 130 (F-77). A fresh interface per question, closed after it, so
 *     stdin is back to normal before the server takes over.
 */
import { createInterface, type Interface } from "node:readline/promises";
import { CrtError } from "./errors.js";
import type { Prompter, WaitOutcome } from "./start.js";

/** F-71/N-14: how often the wait loop re-probes the target. */
export const REPROBE_MS = 2_000;

export interface TerminalIo {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  /** Poll interval for `waitFor` (tests shorten it). */
  reprobeMs?: number;
}

const cancelled = () => new CrtError("cancelled", 130);

export function createTerminalPrompter(io: TerminalIo): Prompter {
  const reprobeMs = io.reprobeMs ?? REPROBE_MS;
  const open = (): Interface => createInterface({ input: io.input, output: io.output });

  return {
    ask(question) {
      return new Promise<string>((resolve, reject) => {
        const rl = open();
        let done = false;
        const finish = (fn: () => void) => {
          if (done) return;
          done = true;
          rl.close();
          fn();
        };
        rl.on("SIGINT", () => {
          io.output.write("\n");
          finish(() => reject(cancelled()));
        });
        rl.on("close", () => finish(() => reject(cancelled())));
        rl.question(`${question} `).then(
          (answer) => finish(() => resolve(answer.trim())),
          () => finish(() => reject(cancelled())),
        );
      });
    },

    waitFor(line, check) {
      return new Promise<WaitOutcome>((resolve, reject) => {
        io.output.write(`${line}\n`);
        const rl = open();
        let done = false;
        const timer = setInterval(() => {
          void check().then((up) => {
            if (up) finish(() => resolve({ kind: "ready" }));
          }, () => undefined);
        }, reprobeMs);
        const finish = (fn: () => void) => {
          if (done) return;
          done = true;
          clearInterval(timer);
          rl.close();
          fn();
        };
        rl.on("SIGINT", () => {
          io.output.write("\n");
          finish(() => reject(cancelled()));
        });
        rl.on("close", () => finish(() => reject(cancelled())));
        rl.question("").then(
          (answer) => finish(() => resolve({ kind: "answer", text: answer.trim() })),
          () => finish(() => reject(cancelled())),
        );
      });
    },
  };
}

/** PRD-setup §5.2: interactive iff stdin and stdout are TTYs, `CI` is unset, and `--yes` is absent. */
export function isInteractive(opts: { yes: boolean; env?: NodeJS.ProcessEnv; stdin?: { isTTY?: boolean }; stdout?: { isTTY?: boolean } }): boolean {
  const env = opts.env ?? process.env;
  const stdin = opts.stdin ?? process.stdin;
  const stdout = opts.stdout ?? process.stdout;
  return !opts.yes && stdin.isTTY === true && stdout.isTTY === true && (env.CI === undefined || env.CI === "");
}
