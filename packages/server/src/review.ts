/**
 * A review as the CLI (and, from M30, the review page) shows it (PRD-zero F-133, F-135): the
 * manifest's items in review order, each joined with what its task file says — title, priority,
 * route, the reviewed branch and commit — and the totals. Reading only; home.ts owns the files.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type Review, reviewTasksDir } from "./home.js";
import { compareTaskIds, listTasks, parseFrontmatter, type TaskPriority, type TaskStatus } from "./tasks.js";

export interface ReviewItemView {
  id: string;
  keep: boolean;
  order: number;
  title: string;
  priority: TaskPriority;
  status: TaskStatus;
  route: string | null;
  branch: string | null;
  commit: string | null;
  /** File name inside the review's tasks directory. */
  file: string;
}

export interface ReviewView {
  name: string;
  dir: string;
  tasksDir: string;
  status: "open" | "handed";
  created: string;
  project: { root: string; remote: string | null };
  items: ReviewItemView[];
  totals: { items: number; kept: number; routes: number };
  handovers: unknown[];
}

/**
 * The items of a review in order: the manifest's order, then any task file the manifest does not
 * list (kept, by id) — a file is never hidden because `review.json` was edited or lost. A manifest
 * entry whose file is gone is left out.
 */
export function reviewView(review: Review): ReviewView {
  const tasksDir = reviewTasksDir(review.dir);
  const files = new Map(listTasks(tasksDir).map((t) => [t.id, t]));
  const listed = [...review.manifest.items].sort((a, b) => a.order - b.order || compareTaskIds(a.id, b.id));
  const known = new Set(listed.map((i) => i.id));
  const unlisted = [...files.keys()].filter((id) => !known.has(id)).sort(compareTaskIds);
  const items: ReviewItemView[] = [];
  for (const entry of [...listed, ...unlisted.map((id) => ({ id, keep: true, order: 0 }))]) {
    const task = files.get(entry.id);
    if (!task) continue;
    const data = frontmatterOf(join(tasksDir, task.file));
    const scalar = (key: string): string | null => (typeof data[key] === "string" ? (data[key] as string) : null);
    items.push({
      id: entry.id,
      keep: entry.keep,
      order: items.length + 1,
      title: task.title,
      priority: task.priority,
      status: task.status,
      route: scalar("route"),
      branch: scalar("branch"),
      commit: scalar("commit"),
      file: task.file,
    });
  }
  return {
    name: review.name,
    dir: review.dir,
    tasksDir,
    status: review.manifest.status,
    created: review.manifest.created,
    project: review.manifest.project,
    items,
    totals: { items: items.length, kept: items.filter((i) => i.keep).length, routes: new Set(items.map((i) => i.route ?? "")).size },
    handovers: review.manifest.handovers,
  };
}

/** Items by `route`, groups in the order of their first item, items in review order (§5.4). */
export function groupByRoute<T extends { route: string | null }>(items: readonly T[]): { route: string | null; items: T[] }[] {
  const groups: { route: string | null; items: T[] }[] = [];
  const at = new Map<string | null, number>();
  for (const item of items) {
    let i = at.get(item.route);
    if (i === undefined) {
      i = groups.length;
      at.set(item.route, i);
      groups.push({ route: item.route, items: [] });
    }
    groups[i]!.items.push(item);
  }
  return groups;
}

function frontmatterOf(path: string): Record<string, unknown> {
  try {
    return parseFrontmatter(readFileSync(path, "utf8"))?.data ?? {};
  } catch {
    return {};
  }
}

/** `11 items · 9 kept · 3 routes` (F-135). */
export function totalsLine(t: ReviewView["totals"]): string {
  return `${t.items} item${t.items === 1 ? "" : "s"} · ${t.kept} kept · ${t.routes} route${t.routes === 1 ? "" : "s"}`;
}

/** F-135: one line per item in review order — `R-03  high    kept     /checkout   Cart total excludes applied discount`. */
export function renderReviewItems(view: ReviewView): string[] {
  const routeW = Math.max(1, ...view.items.map((i) => (i.route ?? "-").length));
  const idW = Math.max(4, ...view.items.map((i) => i.id.length));
  return view.items.map((i) => `${i.id.padEnd(idW)}  ${i.priority.padEnd(6)}  ${(i.keep ? "kept" : "dropped").padEnd(7)}  ${(i.route ?? "-").padEnd(routeW)}  ${i.title}`);
}

/** F-135: the line `crt review` prints when the project has no review. */
export function noReviewLine(root: string): string {
  return `crt: no review for ${root} yet — run \`crt\`, send some feedback, then \`crt review\``;
}
