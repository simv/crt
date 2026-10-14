/**
 * Intake permission policy (PRD F-26, N-4, N-5). Pure: given a tool call, say whether the server
 * allows it silently, denies it, or asks the developer in the panel. The session runs in Claude
 * Code's `default` permission mode, so this only sees calls the CLI would otherwise prompt for.
 *
 *   • Read / Glob / Grep / other read-only built-ins → allow
 *   • Bash with a read-only git command (status, log, diff, show, …) and no shell operators → allow
 *   • Write / Edit / NotebookEdit whose path resolves under `<root>/.crt/` → allow (N-5)
 *   • CRT's own MCP tool (`mcp__crt__*`) → allow
 *   • WebFetch / WebSearch → deny (nothing leaves the machine, N-4)
 *   • everything else → ask (Allow / Deny card in the panel; 5-minute timeout defaults to deny)
 */
import { isAbsolute, relative, resolve, sep } from "node:path";
import { readConfig, writeLocalConfig } from "./config.js";
import type { AllowList, PermissionDecision, PermissionSubject } from "./session-events.js";

export type { AllowList, PermissionDecision, PermissionSubject };

export const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000;

const READ_ONLY_TOOLS = new Set(["Read", "Glob", "Grep", "LS", "TodoWrite", "TodoRead", "ToolSearch", "Skill", "Task", "Agent"]);
const OFF_TOOLS = new Set(["WebFetch", "WebSearch"]);
const FILE_WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);
const CRT_MCP_PREFIX = "mcp__crt__";

/** git subcommands that never change the working tree, index or refs. */
const GIT_READ_ONLY = new Set([
  "status",
  "log",
  "diff",
  "show",
  "blame",
  "branch",
  "rev-parse",
  "ls-files",
  "ls-tree",
  "describe",
  "tag",
  "remote",
  "shortlog",
  "grep",
  "cat-file",
  "reflog",
  "stash list",
  "worktree list",
  "config --get",
  "config --list",
  "config -l",
]);
/** `git branch` / `git tag` only list when every argument is one of these (positionals need a listing flag). */
const BRANCH_LIST_FLAGS = /^(-[arvli]+|-n\d*|--(list|all|remotes|verbose|show-current|contains|no-contains|merged|no-merged|points-at|sort|format|column|no-column|ignore-case)(=.*)?)$/;
const TAG_LIST_FLAGS = /^(-[li]+|-n\d*|--(list|contains|no-contains|merged|no-merged|points-at|sort|format|column|no-column|ignore-case)(=.*)?)$/;
const SHELL_OPERATORS = /[|;&<>`$]|\n/;

export function decidePermission(toolName: string, input: Record<string, unknown>, projectRoot: string): PermissionDecision {
  if (READ_ONLY_TOOLS.has(toolName) || toolName.startsWith(CRT_MCP_PREFIX)) return { kind: "allow" };
  if (OFF_TOOLS.has(toolName)) return { kind: "deny", reason: `${toolName} is disabled during CRT intake (nothing leaves the machine)` };
  if (toolName === "Bash") {
    const command = typeof input.command === "string" ? input.command : "";
    return isReadOnlyGit(command) ? { kind: "allow" } : { kind: "ask" };
  }
  if (FILE_WRITE_TOOLS.has(toolName)) {
    const target = typeof input.file_path === "string" ? input.file_path : typeof input.notebook_path === "string" ? input.notebook_path : "";
    return target && isUnderCrtDir(target, projectRoot) ? { kind: "allow" } : { kind: "ask" };
  }
  return { kind: "ask" };
}

/** `git <read-only subcommand> …` with no pipes, redirects, chaining or substitution. */
export function isReadOnlyGit(command: string): boolean {
  const c = command.trim();
  if (!c || SHELL_OPERATORS.test(c)) return false;
  const m = /^git\s+(?:(?:-C\s+\S+|--no-pager|-c\s+\S+)\s+)*(\S+)(?:\s+(.*))?$/.exec(c);
  if (!m) return false;
  const sub = m[1]!;
  const args = (m[2] ?? "").split(/\s+/).filter(Boolean);
  const two = args[0] ? `${sub} ${args[0]}` : "";
  if (!GIT_READ_ONLY.has(sub) && !GIT_READ_ONLY.has(two)) return false;
  if (sub === "stash" || sub === "worktree" || sub === "config") return GIT_READ_ONLY.has(two);
  if (sub === "branch" || sub === "tag") {
    const flag = sub === "branch" ? BRANCH_LIST_FLAGS : TAG_LIST_FLAGS;
    const listing = args.some((a) => flag.test(a));
    return args.every((a) => flag.test(a) || (listing && !a.startsWith("-")));
  }
  if (sub === "remote") return args.length === 0 || ["-v", "--verbose", "show", "get-url"].includes(args[0]!);
  return true;
}

/** True when `target` (absolute or relative to the root) resolves inside `<root>/.crt/`. */
export function isUnderCrtDir(target: string, projectRoot: string): boolean {
  const root = resolve(projectRoot);
  const abs = isAbsolute(target) ? resolve(target) : resolve(root, target);
  const crt = resolve(root, ".crt");
  const rel = relative(crt, abs);
  if (rel === "" || isAbsolute(rel)) return false;
  return rel !== ".." && !rel.startsWith(`..${sep}`);
}

/**
 * PRD-chat F-124 "Always allow". What a card asks about, normalised across providers so one rule
 * covers every agent: a shell command (Claude's `Bash`, an ACP `execute`), file writes (Claude's
 * Write / Edit / MultiEdit / NotebookEdit, an ACP `edit` / `delete` / `move`), or any other tool by
 * name. Rules use Claude Code's permission-rule syntax:
 *
 *   • `Bash(npm test:*)` — a command that is exactly `npm test` or starts with `npm test `, with no
 *     shell operators (so `npm test && rm -rf .` never matches); `Bash(rm -rf dist)` — that command only
 *   • `Edit(src/components/**)` — every path under that project directory; `Edit(**)` the whole project
 *   • `mcp__figma__get_screenshot` — that tool, any input
 *
 * Rules live in `permissions.allow` of `.crt/config.local.json` (per machine, gitignored — the
 * analogue of Claude Code's `.claude/settings.local.json`), and `.crt/config.json` may list shared ones.
 */

/** The subject of a tool call as Claude Code (and the stub) name it. */
export function subjectOf(toolName: string, input: Record<string, unknown>): PermissionSubject {
  if (toolName === "Bash") return { kind: "command", command: typeof input.command === "string" ? input.command : "" };
  if (FILE_WRITE_TOOLS.has(toolName)) {
    const target = typeof input.file_path === "string" ? input.file_path : typeof input.notebook_path === "string" ? input.notebook_path : "";
    return { kind: "edit", paths: target ? [target] : [] };
  }
  return { kind: "tool", name: toolName };
}

/** At most this many leading words make a command prefix (`npx vitest run`). */
const PREFIX_WORDS = 3;

/**
 * The rule "Always allow" saves for a subject, or null when it offers none (an empty command, a
 * write with no path or outside the project). A command's prefix is its leading words up to the
 * first flag, at most three; a command with shell operators, or one whose prefix would be a bare
 * program name followed by more (`rm -rf dist`, `node -e …`), gets an exact rule instead.
 */
export function suggestRule(subject: PermissionSubject, projectRoot: string): string | null {
  switch (subject.kind) {
    case "command": {
      const c = subject.command.trim();
      if (!c) return null;
      const words = c.split(/\s+/);
      if (SHELL_OPERATORS.test(c) || words.length === 1) return `Bash(${c})`;
      const lead: string[] = [];
      for (const w of words) {
        if (w.startsWith("-") || lead.length === PREFIX_WORDS) break;
        lead.push(w);
      }
      return lead.length < 2 ? `Bash(${c})` : `Bash(${lead.join(" ")}:*)`;
    }
    case "edit": {
      if (!subject.paths.length) return null;
      const dirs = subject.paths.map((p) => projectDir(p, projectRoot));
      if (dirs.some((d) => d === null)) return null;
      const common = commonDir(dirs as string[]);
      return common ? `Edit(${common}/**)` : "Edit(**)";
    }
    case "tool":
      return subject.name && !/[()]/.test(subject.name) ? subject.name : null;
  }
}

/** True when `rule` (one `permissions.allow` entry) covers `subject`. */
export function ruleAllows(rule: string, subject: PermissionSubject, projectRoot: string): boolean {
  const m = /^(\w+)\((.*)\)$/s.exec(rule.trim());
  if (!m) return subject.kind === "tool" && subject.name === rule.trim();
  const [, tool, spec] = m as unknown as [string, string, string];
  if (tool === "Bash" && subject.kind === "command") {
    const c = subject.command.trim();
    if (!spec.endsWith(":*")) return c === spec;
    const prefix = spec.slice(0, -2);
    return !!prefix && !SHELL_OPERATORS.test(c) && (c === prefix || c.startsWith(`${prefix} `));
  }
  if (tool === "Edit" && subject.kind === "edit") {
    if (!subject.paths.length || !spec.endsWith("**")) return false;
    const base = spec.slice(0, -2).replace(/\/$/, "");
    const dir = base ? resolve(projectRoot, ...base.split("/")) : resolve(projectRoot);
    return subject.paths.every((p) => {
      if (projectDir(p, projectRoot) === null) return false;
      const rel = relative(dir, isAbsolute(p) ? resolve(p) : resolve(projectRoot, p));
      return rel !== "" && !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`);
    });
  }
  return false;
}

/** How the card names a rule: commands starting with "npm test", edits under src/, the tool mcp__x__y. */
export function describeRule(rule: string): string {
  const m = /^(\w+)\((.*)\)$/s.exec(rule);
  if (!m) return `the tool ${rule}`;
  const [, tool, spec] = m as unknown as [string, string, string];
  if (tool === "Bash") return spec.endsWith(":*") ? `commands starting with "${spec.slice(0, -2)}"` : `the command "${spec}"`;
  if (tool === "Edit") return spec === "**" ? "file edits anywhere" : `file edits under ${spec.slice(0, -3)}/`;
  return rule;
}

/** The project-relative directory (posix, "" for the root) holding `path`, or null outside the project. */
function projectDir(path: string, projectRoot: string): string | null {
  const root = resolve(projectRoot);
  const abs = isAbsolute(path) ? resolve(path) : resolve(root, path);
  const rel = relative(root, abs);
  if (rel === "" || isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`)) return null;
  const parts = rel.split(sep);
  return parts.slice(0, -1).join("/");
}

function commonDir(dirs: string[]): string {
  const split = dirs.map((d) => (d ? d.split("/") : []));
  const out: string[] = [];
  for (let i = 0; split.every((s) => i < s.length && s[i] === split[0]![i]); i++) out.push(split[0]![i]!);
  return out.join("/");
}

/**
 * F-124: the project's "Always allow" rules, read from the config files on every check (so a hand
 * edit or another session's rule applies at once) and added to `.crt/config.local.json`.
 */
export function projectAllowList(projectRoot: string): AllowList {
  return {
    allows: (subject) => readConfig(projectRoot).allow.some((rule) => ruleAllows(rule, subject, projectRoot)),
    suggest: (subject) => suggestRule(subject, projectRoot),
    add: (rule) => {
      writeLocalConfig(projectRoot, { allow: [rule] });
    },
  };
}
