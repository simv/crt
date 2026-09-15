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
import type { PermissionDecision } from "./session-events.js";

export type { PermissionDecision };

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
