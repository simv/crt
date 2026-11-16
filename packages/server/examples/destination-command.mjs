// A CRT destination that sends each item of a review to a command of your own.
//
// This file is two things: a destination you can use as it is, and the worked example of how to
// write one (docs/destinations.md walks through it). It imports nothing from CRT — a destination
// is a plain object with two functions — so you can copy it into your project and change it.
//
// Use it from .crt/config.json:
//
//   {
//     "destinations": {
//       "tracker": {
//         "use": "claude-review-tool/destination-command",
//         "command": ["node", "tools/to-tracker.mjs"]
//       }
//     }
//   }
//
// then `crt handoff --to tracker`. For every kept item, in review order, the command is started
// in the project root with the item as JSON on its standard input:
//
//   { "schema": 1, "review": { "name": … }, "project": { "root": …, "name": … }, "item": { "id": "R-01", "title": …,
//     "priority": …, "url": …, "route": …, "branch": …, "commit": …, "sections": { "Summary": …, "Ask": … },
//     "markdown": "<the whole task file>", "images": [{ "name": …, "path": "<absolute path>", "bytes": … }] } }
//
// and with CRT_REVIEW, CRT_ITEM_ID, CRT_ITEM_TITLE and CRT_ITEM_FILE in its environment. What it
// does with the item is its own business. When it exits 0 the item counts as published; what it
// printed last says where — a JSON object `{"id": "WEB-17", "url": "https://…"}`, or a bare URL,
// or nothing. When it exits with anything else the run stops there, and running `crt handoff`
// again sends only the items that have not gone yet.
//
// Options: `command` (an array: the program and its arguments; started without a shell, so on
// Windows name `node` or an `.exe`, not a `.cmd`), `timeoutSeconds` (how long one item may take;
// default 120).

import { spawn } from "node:child_process";

/** @typedef {import("claude-review-tool/destination").Destination} Destination */
/** @typedef {import("claude-review-tool/destination").DestinationContext} DestinationContext */

/** @param {DestinationContext} ctx @returns {string[]} */
function commandOf(ctx) {
  const command = ctx.options.command;
  if (!Array.isArray(command) || !command.length || !command.every((part) => typeof part === "string" && part)) {
    // A refusal is an Error with a one-line message: CRT prints it and nothing is written.
    throw new Error('the "command" option is missing — give it as an array, e.g. "command": ["node", "tools/to-tracker.mjs"]');
  }
  return command;
}

/**
 * Start the command, write `input` to its standard input, and collect what it prints.
 * @returns {Promise<{ status: number | null, stdout: string, stderr: string, error: string | null }>}
 */
function run(command, input, { cwd, env, timeoutMs }) {
  return new Promise((done) => {
    let stdout = "";
    let stderr = "";
    let error = null;
    const child = spawn(command[0], command.slice(1), { cwd, env, shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      error = `no exit after ${Math.round(timeoutMs / 1000)} s`;
      child.kill();
    }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk) => (stderr += chunk));
    child.on("error", (err) => {
      clearTimeout(timer);
      done({ status: null, stdout, stderr, error: err.message });
    });
    child.on("close", (status) => {
      clearTimeout(timer);
      done({ status, stdout, stderr, error });
    });
    child.stdin.on("error", () => {}); // a command that does not read its input is not an error
    child.stdin.end(input);
  });
}

const lastLine = (text) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop() ?? "";

/** What the command printed last: `{"id": …, "url": …}`, a bare URL, or nothing. */
export function parseAnswer(stdout, fallbackId) {
  const line = lastLine(stdout);
  if (/^https?:\/\/\S+$/.test(line)) return { id: fallbackId, url: line };
  try {
    const answer = JSON.parse(line);
    if (answer && typeof answer === "object") {
      return { id: typeof answer.id === "string" && answer.id ? answer.id : fallbackId, ...(typeof answer.url === "string" && answer.url ? { url: answer.url } : {}) };
    }
  } catch {
    // not JSON: the command said nothing CRT can use
  }
  return { id: fallbackId };
}

/** @type {Destination} */
export const destination = {
  // The version of the contract this was written against.
  apiVersion: 1,
  // CRT uses the name from the config after `--to`; this one is for people.
  id: "command",
  title: "Your own command, once per item",
  // true: publishing here hands the review over (it becomes `handed`). An export says false and the review stays open.
  final: true,

  // 1. Say what will happen. No side effects here: CRT prints these lines and then asks.
  plan(input, ctx) {
    const command = commandOf(ctx);
    const n = input.items.length;
    return {
      lines: [
        `Send review ${input.review.name} to your command: ${n} item${n === 1 ? "" : "s"}.`,
        ...input.items.map((item) => `  ${item.id}  ${item.priority.padEnd(6)}  ${item.route ?? "-"}  ${item.title}`),
        `Runs \`${command.join(" ")}\` in ${input.project.root} once per item, the item as JSON on its standard input.`,
      ],
      // What leaves the machine. This destination cannot know what the command does with an item, so it says that.
      sends: ["each item to that command — what it sends on is the command's own"],
      // Whatever `publish` needs again.
      state: { command },
    };
  },

  // 2. Do it, one item at a time. Called only after the yes. Each `yield` is recorded by CRT at
  //    once, so when this throws on the sixth item, the first five are not sent again next time.
  async *publish(input, plan, ctx) {
    const { command } = plan.state;
    const timeoutMs = (typeof ctx.options.timeoutSeconds === "number" && ctx.options.timeoutSeconds > 0 ? ctx.options.timeoutSeconds : 120) * 1000;
    let sent = 0;
    for (const item of input.items) {
      const result = await run(command, JSON.stringify({ schema: 1, review: input.review, project: input.project, item }) + "\n", {
        cwd: input.project.root,
        env: { ...ctx.env, CRT_REVIEW: input.review.name, CRT_ITEM_ID: item.id, CRT_ITEM_TITLE: item.title, CRT_ITEM_FILE: item.path },
        timeoutMs,
      });
      if (result.status !== 0) {
        const why = result.error ?? (lastLine(result.stderr) || `exit ${result.status}`);
        throw new Error(`\`${command.join(" ")}\` failed on ${item.id} (${why}); ${sent} of ${input.items.length} were sent`);
      }
      const answer = parseAnswer(result.stdout, item.id);
      ctx.log(`  ${item.id} → ${answer.id}${answer.url ? `  ${answer.url}` : ""}`);
      sent++;
      yield { item: item.id, ...answer };
    }
    ctx.log(`Sent review ${input.review.name} to your command: ${sent} item${sent === 1 ? "" : "s"}.`);
  },
};

// CRT reads the export named `destination`, or the default export.
export default destination;
