/**
 * The `write_task` tool as every agent sees it (PRD F-24, F-32; PRD-providers §5.3, F-49): one
 * name, one description, one input schema, whichever way the call arrives — in-process through
 * the Agent SDK for Claude (`providers/claude.ts`) or over stdio through `crt mcp`
 * (`mcp-stdio.ts`) for every other provider. Both paths validate with `parseWriteTaskRequest`
 * and hand the same `WriteTaskRequest` to the same `writeTask` in `sessions.ts`, so a task file
 * is identical whichever route wrote it (§5.3, tested in sessions.test.ts).
 */
import { z } from "zod/v4";
import type { WriteTaskRequest } from "./session-events.js";

export const CRT_MCP_SERVER = "crt";
export const WRITE_TASK_TOOL = "write_task";
/** How the tool is named in canUseTool / permission rules and tool lines. */
export const WRITE_TASK_TOOL_FULL = `mcp__${CRT_MCP_SERVER}__${WRITE_TASK_TOOL}`;

export const WRITE_TASK_DESCRIPTION =
  "Write the CRT task file for this intake (PRD F-32). The server allocates the CRT-NNNN id, moves the capture's screenshots to .crt/tasks/assets/<ID>/, renders the Evidence section from the capture, writes the file and regenerates the index. Call it once, after the developer has confirmed the definition of done. Returns the id and path.";

/** The v0.1 schema, unchanged; `tool()` in the Claude driver takes the shape, `crt mcp` the JSON Schema. */
export const writeTaskShape = {
  title: z.string().min(3).describe("Short imperative title, e.g. 'Cart total excludes applied discount'"),
  summary: z.string().min(1).describe("One paragraph: what is wrong / wanted, in plain language"),
  context: z.string().min(1).describe("What the page showed, how to reproduce, which component renders it, where the logic lives (file:line)"),
  evidence: z.string().optional().describe("Extra evidence beyond the screenshots and annotations the server adds automatically (optional)"),
  ask: z.string().min(1).describe("The change requested, precisely"),
  definitionOfDone: z.array(z.string().min(1)).min(1).describe("Checkable items, one per entry; the server renders them as - [ ] checkboxes"),
  notes: z.string().optional().describe("Constraints, hunches, non-goals, alternatives considered"),
  priority: z.enum(["low", "normal", "high"]).optional().describe("Default normal"),
  tags: z.array(z.string()).optional().describe("Short lowercase tags, e.g. ['cart', 'pricing']"),
  files: z.array(z.string()).optional().describe("Project-relative source files identified during intake"),
};

export const writeTaskSchema = z.object(writeTaskShape);

/** MCP `tools/list` input schema (F-49). */
export function writeTaskJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(writeTaskSchema) as Record<string, unknown>;
}

/** Validate a tool call's arguments; the error is one line naming the first bad field. */
export function parseWriteTaskRequest(input: unknown): { ok: true; value: WriteTaskRequest } | { ok: false; error: string } {
  const r = writeTaskSchema.safeParse(input);
  if (r.success) return { ok: true, value: r.data as WriteTaskRequest };
  const first = r.error.issues[0];
  const where = first?.path.length ? `${first.path.join(".")}: ` : "";
  return { ok: false, error: `${where}${first?.message ?? "invalid write_task arguments"}` };
}
