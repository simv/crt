// A fake Claude Code CLI for `crt setup` tests (PRD-setup F-86, F-90): stands in for the `plugin`
// subcommands of claude 2.1.x as observed on 2026-09-16, so setup.ts runs against a real process
// through exec.ts (the npm `.cmd` shim on Windows, a script elsewhere) without Claude Code
// installed. Installed by fake-codex-install.mjs `installFakeClaude`.
//
//   claude plugin list --json               → `[{ id: "crt@crt", version: FAKE_CLAUDE_INSTALLED, … }]`
//                                             (plus an unrelated plugin); `[]` when FAKE_CLAUDE_INSTALLED is unset
//   claude plugin marketplace add <path>    → "Successfully added marketplace: crt", exit 0
//   claude plugin install crt@crt           → "Successfully installed plugin: crt@crt", exit 0
//   claude plugin update crt@crt            → "Successfully updated plugin: crt@crt", exit 0
//   FAKE_CLAUDE_FAIL=<subcommand>           → that subcommand (`list`, `marketplace add`, `install`,
//                                             `update`) prints "Error: <FAKE_CLAUDE_FAIL_MESSAGE>" to
//                                             stderr and exits 1
//   FAKE_CLAUDE_LOG=<file>                  → every invocation's argv is appended as one JSON line,
//                                             so a test can assert which subcommands ran, in order
//
// Anything else exits 2 with an "unknown command" line, the way the real CLI refuses what it
// does not know — so a driver that drifts from the observed contract fails here.
import { appendFileSync } from "node:fs";

export async function main(argv) {
  if (process.env.FAKE_CLAUDE_LOG) appendFileSync(process.env.FAKE_CLAUDE_LOG, `${JSON.stringify(argv)}\n`);
  const [head, sub, ...rest] = argv;
  if (head !== "plugin") return die(`error: unknown command '${head ?? ""}'`, 2);
  const failing = process.env.FAKE_CLAUDE_FAIL;
  const message = process.env.FAKE_CLAUDE_FAIL_MESSAGE ?? "something went wrong";
  /** True (after printing the error) when `what` is the subcommand told to fail. */
  const fails = (what) => failing === what && die(`Error: ${message}\n  at fake-claude.mjs (details the real CLI would print)`, 1) === 1;

  if (sub === "list") {
    if (!rest.includes("--json")) return die("error: fake claude only answers `plugin list --json`", 2);
    if (fails("list")) return 1;
    const plugins = [{ id: "chrome-devtools-mcp@claude-plugins-official", version: "1.9.0", scope: "user", enabled: true }];
    const installed = process.env.FAKE_CLAUDE_INSTALLED;
    if (installed) plugins.push({ id: "crt@crt", version: installed, scope: "user", enabled: true });
    console.log(JSON.stringify(plugins, null, 2));
    return 0;
  }
  if (sub === "marketplace") {
    const [verb, source] = rest;
    if (verb !== "add" || !source) return die("error: fake claude only answers `plugin marketplace add <source>`", 2);
    if (fails("marketplace add")) return 1;
    console.log(`Successfully added marketplace: crt`);
    return 0;
  }
  if (sub === "install" || sub === "update") {
    const [plugin] = rest;
    if (plugin !== "crt@crt") return die(`Error: Plugin "${plugin ?? ""}" not found in any marketplace`, 1);
    if (fails(sub)) return 1;
    console.log(sub === "install" ? "Successfully installed plugin: crt@crt" : "Successfully updated plugin: crt@crt");
    return 0;
  }
  return die(`error: unknown command 'plugin ${sub ?? ""}'`, 2);
}

function die(message, code) {
  process.stderr.write(`${message}\n`);
  return code;
}
