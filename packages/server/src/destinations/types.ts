/**
 * The destination contract (PRD-destinations §5.2, F-140, F-141): what `crt handoff --to <name>`
 * hands a review to. A destination is one module with two functions — `plan` says what will
 * happen and does nothing, `publish` does it one item at a time — and `handoff.ts` owns everything
 * between them: printing the plan, the one question, and the record in `review.json` (N-38).
 *
 * This file is the published contract: `claude-review-tool/destination` re-exports it (api.ts), and
 * a module named by `destinations.<name>.use` in the config is written against it (F-143). It
 * imports nothing, so it means the same inside CRT and outside it. Additions are optional fields;
 * anything else is a new `apiVersion`.
 */

/** The contract version of this file. A module that names another one is refused, with both versions in the line. */
export const API_VERSION = 1;

export interface Destination {
  /** The contract version the module was written against. */
  apiVersion: 1;
  /** What follows `--to`: `[a-z][a-z0-9-]*`. For a module named in the config, CRT uses the config key. */
  id: string;
  /** For people: "GitHub Issues". */
  title: string;
  /** True when publishing here hands the feedback over (the review becomes `handed`); false for an export. */
  final: boolean;
  /**
   * What will happen, and nothing else: no write, nothing sent. Throw an `Error` whose message is
   * one line when this cannot work here (no remote, a missing option) — CRT prints it after `crt: `.
   */
  plan(input: PublishInput, ctx: DestinationContext): Promise<DestinationPlan> | DestinationPlan;
  /**
   * Called only after the developer said yes. Yield each item as it lands: CRT records it before
   * asking for the next, so a publish that stops can be continued (F-142). Throw to stop.
   */
  publish(input: PublishInput, plan: DestinationPlan, ctx: DestinationContext): AsyncIterable<PublishedItem>;
}

export interface PublishInput {
  review: { name: string; created: string; totals: { items: number; kept: number; routes: number } };
  project: { root: string; name: string; remote: string | null; setUp: boolean };
  /** The kept items not yet published to this destination, in review order. */
  items: FeedbackItem[];
  /** Kept items an earlier, unfinished run already published here. */
  already: PublishedItem[];
}

/** One item of feedback, read from its task file by CRT (F-141). */
export interface FeedbackItem {
  /** The review's id for it: `R-03`. */
  id: string;
  title: string;
  priority: "low" | "normal" | "high";
  url: string | null;
  route: string | null;
  /** The branch and full commit SHA the project was on when this was captured. */
  branch: string | null;
  commit: string | null;
  tags: string[];
  files: string[];
  /** The sections of the task file by name, as written: Summary, Context, Evidence, Ask, Definition of Done, Notes. Never Log. */
  sections: Record<string, string>;
  /** The whole task file. */
  markdown: string;
  /** The task file: its name, and its absolute path on this machine. */
  file: string;
  path: string;
  /** The item's image files, the annotated viewport first. `capture.json` is never listed. */
  images: FeedbackImage[];
}

export interface FeedbackImage {
  /** `viewport-annotated.png` */
  name: string;
  /** Absolute path on this machine. */
  path: string;
  bytes: number;
}

export interface DestinationPlan {
  /** What will exist afterwards, one line each; printed as given. */
  lines: string[];
  /** What leaves the machine and where to ("9 issues and 18 screenshots to github.com"); empty for a local destination. */
  sends: string[];
  /** The destination's own state, handed back to `publish`. */
  state?: unknown;
}

export interface PublishedItem {
  /** The `FeedbackItem.id` this is. */
  item: string;
  /** Its id there: `#412`, `WEB-17`, `CRT-0031`. */
  id: string;
  /** Its link there, when it has one. */
  url?: string;
}

export interface ToolResult {
  /** Exit code; null when the tool was killed (timeout) or could not start. */
  status: number | null;
  stdout: string;
  stderr: string;
  /** Set when the tool could not be started or was killed by the timeout. */
  error: string | null;
}

export interface DestinationContext {
  /** This destination's object from the config, without `use`. */
  options: Record<string, unknown>;
  /** The flags of this `crt handoff` run that CRT does not own (`--out`, `--branch`, `--no-screenshots`, …). */
  flags: Record<string, string | boolean>;
  env: NodeJS.ProcessEnv;
  /** Where the developer ran `crt handoff`. */
  cwd: string;
  now: Date;
  /** Print one line. */
  log(line: string): void;
  /** Whether a command-line tool is on PATH. */
  has(tool: string): boolean;
  /** Run a tool found on PATH to completion, without a shell, in `cwd` (default: the project root). Never throws. */
  run(tool: string, args: string[], opts?: { cwd?: string; timeoutMs?: number }): Promise<ToolResult>;
  /** A fresh directory under the OS temp dir, removed when the command ends. */
  tmp(): string;
  /** Extra fields for this hand-over's entry in `review.json` (a branch, a folder, a summary link). Kept at once. */
  record(fields: Record<string, string>): void;
  /** What an earlier, unfinished run to this destination recorded that way; empty on a first run. */
  recorded: Record<string, string>;
}
