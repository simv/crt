/**
 * PRD-chat §5.2 (F-120, N-29): the agent's F-27 proposal, read deterministically so the panel can
 * fold it — the restatement, the item count, and the text without the closing line (the Accept
 * bar is that line's UI). Pure: no DOM, no rendering, nothing called.
 */

/**
 * F-27 step 5: the intake skill ends its proposal with exactly this line; when a turn ends on it
 * with no task written the panel shows an Accept button that replies `ACCEPT_REPLY`.
 */
export const ACCEPT_LINE = "Accept as-is, or tell me what to change, and I'll write the task.";
export const ACCEPT_REPLY = "Accept";

/**
 * `ACCEPT_LINE` at the end of a message, tolerating markdown emphasis, curly quotes, any
 * whitespace (line breaks included) and case.
 */
const ACCEPT_RE = new RegExp(
  "[*_`]*" +
    ACCEPT_LINE.split("")
      .map((c) => (c === " " ? "[\\s*_`]+" : c === "'" ? "['‘’]" : c.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")) + "[*_`]*")
      .join("") +
    "[\\s*_`]*$",
  "i",
);

/** Whether an assistant message ends on `ACCEPT_LINE`, tolerating markdown emphasis, curly quotes and trailing whitespace. */
export function endsWithAcceptLine(text: string): boolean {
  return ACCEPT_RE.test(text);
}

export interface ProposalSummary {
  /** (a): the first paragraph that is not a heading, a list item or a fence; the first line when there is none. */
  lead: string;
  /** (c): the `- [ ]` / `- [x]` items in order (any other list item counts too), markers stripped. */
  items: string[];
  /** The message with the closing line removed. */
  body: string;
}

const FENCE = /^\s*```/;
const HEADING = /^#{1,6}\s/;
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;

/** PRD-chat §5.2. The caller decides whether `text` is a proposal (`endsWithAcceptLine`). */
export function summarizeProposal(text: string): ProposalSummary {
  const m = ACCEPT_RE.exec(text);
  const body = m ? text.slice(0, m.index).trimEnd() : text;
  const items: string[] = [];
  let lead: string | null = null;
  let para: string[] = [];
  let fenced = false;
  const endPara = () => {
    if (lead === null && para.length) lead = para.join(" ");
    para = [];
  };
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (FENCE.test(raw)) {
      endPara();
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const item = ITEM.exec(raw);
    if (item) {
      endPara();
      items.push(item[1]!.replace(/^\[[ xX]\]\s+/, "").trim());
    } else if (!line || HEADING.test(line)) endPara();
    else para.push(line);
  }
  endPara();
  return { lead: lead ?? body.split("\n").find((l) => l.trim())?.trim() ?? "", items, body };
}
