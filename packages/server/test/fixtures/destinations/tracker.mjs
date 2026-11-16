// What a developer's own command looks like to the example destination (examples/destination-command.mjs):
// it reads one item as JSON on stdin, appends its id to the file named by TRACKER_LOG, and answers on stdout.
import { appendFileSync } from "node:fs";

let text = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (text += chunk));
process.stdin.on("end", () => {
  const { item, review } = JSON.parse(text);
  if (process.env.TRACKER_FAIL_ON === item.id) {
    console.error(`the tracker is down for ${item.id}`);
    process.exit(3);
  }
  appendFileSync(process.env.TRACKER_LOG, `${review.name} ${item.id} ${process.env.CRT_ITEM_ID} ${item.sections.Ask}\n`);
  console.log("working…");
  console.log(JSON.stringify({ id: `WEB-${item.id.slice(2)}`, url: `https://tracker.invalid/WEB-${item.id.slice(2)}` }));
});
