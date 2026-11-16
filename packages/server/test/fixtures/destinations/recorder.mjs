// A destination written outside CRT, for the tests of PRD-destinations F-142, F-143 and N-38: it
// appends every call it gets to the file named by its `calls` option, and stops after `failAfter` items.
import { appendFileSync } from "node:fs";

const note = (ctx, what) => ctx.options.calls && appendFileSync(ctx.options.calls, JSON.stringify(what) + "\n");

export const destination = {
  apiVersion: 1,
  id: "whatever-the-module-says",
  title: "A recorder",
  final: true,
  plan(input, ctx) {
    note(ctx, { call: "plan", items: input.items.map((i) => i.id), already: input.already.map((a) => a.item) });
    if (ctx.options.refuse) throw new Error("the recorder was told to refuse");
    return { lines: [`Record review ${input.review.name}: ${input.items.length} items.`], sends: ["nothing anywhere"], state: { n: input.items.length } };
  },
  async *publish(input, plan, ctx) {
    note(ctx, { call: "publish", items: input.items.map((i) => i.id), state: plan.state });
    let n = 0;
    for (const item of input.items) {
      if (typeof ctx.options.failAfter === "number" && n >= ctx.options.failAfter) throw new Error("the tracker said no");
      n++;
      yield { item: item.id, id: `T-${item.id.slice(2)}`, url: `https://tracker.invalid/${item.id}` };
    }
  },
};
