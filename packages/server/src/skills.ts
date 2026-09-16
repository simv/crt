/**
 * `crt skills install [--provider <id>] [--global] [--dir <path>]` (PRD-providers F-58): the
 * plugin's skills (`next`, `tasks`, `task`, `done`, `intake`, `serve`) as portable Agent Skills —
 * `<dir>/<name>/SKILL.md` — for agents that read that format (Codex, Gemini, …). The text is the
 * plugin's, after rewriting the Claude-only tokens:
 *
 *   ${CLAUDE_PROJECT_DIR}          → the project root (your working directory)
 *   ${CLAUDE_SESSION_ID}           → your session id
 *   AskUserQuestion                → asking the user
 *   disable-model-invocation / allowed-tools frontmatter lines → dropped
 *   + a first paragraph: "Installed by `crt skills install`; the no-questions guarantee of
 *     `/crt:next` is tested on Claude Code only."
 *
 * Idempotent: a file whose content already matches is left alone, and every path written is
 * printed. This is the one deliberate write outside `.crt/` besides the `.gitignore` line (N-5
 * as amended in PRD-providers §9). The Claude Code plugin stays the distribution for Claude:
 * `--provider claude` is refused with a pointer to `claude plugin install crt@crt`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { CrtError } from "./errors.js";
import type { ProviderProfile } from "./providers/types.js";

/** The six skills, in plugin order; the build copies each `plugin/skills/<name>/SKILL.md` to `dist/skills/<name>/SKILL.md`. */
export const SKILL_NAMES = ["next", "tasks", "task", "done", "intake", "serve"] as const;
export const SKILL_FILE = "SKILL.md";
export const INSTALLED_PARAGRAPH = "Installed by `crt skills install`; the no-questions guarantee of `/crt:next` is tested on Claude Code only.";
export const CLAUDE_REFUSAL = "crt skills install --provider claude is not needed: Claude Code gets the skills from the plugin — claude plugin marketplace add simv/crt && claude plugin install crt@crt";
const DROPPED_FRONTMATTER = /^(?:disable-model-invocation|allowed-tools):/;

/** F-58 rewrites, applied to the body and the frontmatter alike. */
export function rewriteSkill(text: string): string {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  const frontmatter = fm
    ? fm[1]!
        .split(/\r?\n/)
        .filter((line) => !DROPPED_FRONTMATTER.test(line))
        .join("\n")
        .trimEnd()
    : null;
  let body = fm ? text.slice(fm[0].length) : text;
  body = body
    .split("${CLAUDE_PROJECT_DIR}").join("the project root (your working directory)")
    .split("${CLAUDE_SESSION_ID}").join("your session id")
    // "Never call AskUserQuestion" reads as a sentence once the tool name is gone.
    .replace(/\bcall AskUserQuestion\b/g, "resort to asking the user")
    .split("AskUserQuestion").join("asking the user");
  const head = frontmatter === null ? "" : `---\n${frontmatter}\n---\n\n`;
  return `${head}${INSTALLED_PARAGRAPH}\n\n${body.replace(/^\s+/, "").replace(/\r\n/g, "\n")}`;
}

export interface InstallSkillsOptions {
  /** Directory holding `<name>/SKILL.md` for every skill (`dist/skills` in the package, `plugin/skills` in the repo). */
  sourceDir: string;
  /** Project root: the default target is `<root>/<profile project dir>`. */
  root: string;
  /** The profile whose skills directory is used; null when `--dir` alone decides. */
  profile: ProviderProfile | null;
  /** `--global`: the user-level directory. */
  global?: boolean;
  /** `--dir <path>`: an explicit target (relative to `root`), which wins over the profile. */
  dir?: string | null;
  env?: NodeJS.ProcessEnv;
}

export interface InstallSkillsResult {
  dir: string;
  /** Every `SKILL.md` written this run (absolute paths). */
  written: string[];
  /** Files that already had this content. */
  unchanged: string[];
}

/** Where the skills go, per F-58: `--dir`, else the profile's project/user directory, else an error naming `--dir`. */
export function skillsTargetDir(opts: Pick<InstallSkillsOptions, "root" | "profile" | "global" | "dir" | "env">): string {
  if (opts.dir) return isAbsolute(opts.dir) ? opts.dir : resolve(opts.root, opts.dir);
  const profile = opts.profile;
  if (!profile) throw new CrtError("crt skills install needs --provider <id> or --dir <path>");
  if (profile.id === "claude") throw new CrtError(CLAUDE_REFUSAL);
  const dirs = profile.skillsDirs(opts.env ?? process.env);
  const chosen = opts.global ? dirs.user : dirs.project;
  if (!chosen) {
    throw new CrtError(`${profile.displayName} records no ${opts.global ? "user-level" : "project-level"} skills directory for the tested version — pass --dir <path>`);
  }
  return isAbsolute(chosen) ? chosen : resolve(opts.root, chosen);
}

export function installSkills(opts: InstallSkillsOptions): InstallSkillsResult {
  if (opts.profile?.id === "claude") throw new CrtError(CLAUDE_REFUSAL);
  const dir = skillsTargetDir(opts);
  const written: string[] = [];
  const unchanged: string[] = [];
  for (const name of SKILL_NAMES) {
    const source = join(opts.sourceDir, name, SKILL_FILE);
    if (!existsSync(source)) throw new CrtError(`skill source missing at ${source} — run npm run build`);
    const text = rewriteSkill(readFileSync(source, "utf8"));
    const target = join(dir, name, SKILL_FILE);
    if (existsSync(target) && readFileSync(target, "utf8") === text) {
      unchanged.push(target);
      continue;
    }
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(target, text);
    written.push(target);
  }
  return { dir, written, unchanged };
}
