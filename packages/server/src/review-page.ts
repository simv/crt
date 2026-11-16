/**
 * Collation (PRD-zero F-135, §5.4): the page at `GET /__crt/review` and the small API behind it.
 * The reviewer sees the current review grouped by `route` and decides, before the project sees
 * anything, what is kept, how urgent it is and in what order it is handed over.
 *
 *   GET   /__crt/review                       the page (server-rendered shell; one inline script)
 *   GET   /__crt/review/items                 `ReviewPagePayload`
 *   PATCH /__crt/review/items/<id>            `{ keep?, priority?, move?: "up" | "down" }` → the payload
 *   PATCH /__crt/review/groups                `{ route: string | null, move: "up" | "down" }` → the payload
 *   GET   /__crt/review/assets/<id>/<file>    an item's screenshot, by item id and file name only
 *
 * Who may ask (`reviewRequestAllowed`): the page itself and a local process, nothing else. A request
 * is refused with 403, before anything is read and without CORS headers, when its `Host` is not a
 * loopback name (a rebound DNS name), when it carries an `Origin` other than this server's own, or
 * when the browser says it was made from another origin (`Sec-Fetch-Site`). An app page on another
 * port has no business reading or editing a review.
 *
 * What is written: keep and order go to `review.json` (home.ts, atomically) at once; a priority
 * change rewrites that task file's `priority:` and `updated:` and appends a Log line (tasks.ts
 * `setTaskPriority`) — nothing else in a task file changes before hand-over. The agent is not
 * involved: grouping and ordering are deterministic (groups in the order of their first item, items
 * in the order filed, until the reviewer moves them). The reducers below are pure.
 *
 * The page is framework-free like the landing page and uses its colours (`LANDING_TOKENS`, pinned
 * to the overlay's tokens by test/landing.test.ts). Every control is a real `<button>` or
 * `<select>`; the script builds the list with DOM calls and `textContent`, never markup from task
 * text. `<main data-state>` says `loading`, then `ready`, `empty` or `error` — the signal a test or
 * a screenshot waits on. It fetches on load, after each change and when the tab becomes visible
 * again; never on a timer and never anything off this origin.
 */
import { lstatSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { currentReview, type Review, writeReviewItems } from "./home.js";
import { isLocalOrigin, json, readJson } from "./http.js";
import { LANDING_TOKENS } from "./landing.js";
import { destinationFact, readDestinationsConfig } from "./destinations/index.js";
import { groupByRoute, noReviewLine, type ReviewItemView, reviewView, totalsLine } from "./review.js";
import { CRT_PREFIX, FAVICON_PATH, REVIEW_ASSETS_PATH, REVIEW_GROUPS_PATH, REVIEW_ITEMS_PATH, REVIEW_PATH } from "./routes.js";
import { ASSETS_DIRNAME, setTaskPriority, TASK_ID_RE, TASK_PRIORITIES, type TaskPriority, taskSummaryText, writeIndex } from "./tasks.js";

export { REVIEW_ASSETS_PATH, REVIEW_GROUPS_PATH, REVIEW_ITEMS_PATH, REVIEW_PATH };

/** The command the page offers to copy (M31). */
export const HANDOFF_COMMAND = "crt handoff";
/** A PATCH body is a few keys. */
const MAX_BODY = 4 * 1024;
/** An asset is addressed by a plain file name: no separator can appear, so no path can be built from it. */
const ASSET_FILE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.(png|jpe?g|webp)$/;
const ASSET_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
/** The screenshot a card shows, in order of preference. */
const SHOTS = ["viewport-annotated.png", "viewport.png"];

// ---------------------------------------------------------------------------------------------
// Reducers (pure)
// ---------------------------------------------------------------------------------------------

/** What the reducers need of an item: its place is its index in the list (the review order). */
export interface ReviewEntry {
  id: string;
  keep: boolean;
  route: string | null;
}

export type MoveDirection = "up" | "down";

export { groupByRoute };

/** Keep or drop one item; null when the review has no such item. */
export function setKeep<T extends ReviewEntry>(items: readonly T[], id: string, keep: boolean): T[] | null {
  if (!items.some((i) => i.id === id)) return null;
  return items.map((i) => (i.id === id ? { ...i, keep } : i));
}

/**
 * Move one item a step within its group: it changes places with the nearest item of the same route
 * in that direction, wherever in the review order that one sits, so items of other routes between
 * them — and the order of the groups — stay as they were. At the edge of its group nothing moves.
 * Null when the review has no such item.
 */
export function moveItem<T extends ReviewEntry>(items: readonly T[], id: string, direction: MoveDirection): T[] | null {
  const from = items.findIndex((i) => i.id === id);
  if (from === -1) return null;
  const step = direction === "up" ? -1 : 1;
  let to = from + step;
  while (to >= 0 && to < items.length && items[to]!.route !== items[from]!.route) to += step;
  const out = [...items];
  if (to < 0 || to >= items.length) return out;
  [out[from], out[to]] = [out[to]!, out[from]!];
  return out;
}

/**
 * Move a whole group a step among the groups. The result is the groups laid end to end, so a
 * review whose routes were interleaved comes out grouped. Null when no item has that route.
 */
export function moveGroup<T extends ReviewEntry>(items: readonly T[], route: string | null, direction: MoveDirection): T[] | null {
  const groups = groupByRoute(items);
  const from = groups.findIndex((g) => g.route === route);
  if (from === -1) return null;
  const to = from + (direction === "up" ? -1 : 1);
  if (to >= 0 && to < groups.length) [groups[from], groups[to]] = [groups[to]!, groups[from]!];
  return groups.flatMap((g) => g.items);
}

// ---------------------------------------------------------------------------------------------
// The payload
// ---------------------------------------------------------------------------------------------

export interface ReviewPageItem extends ReviewItemView {
  /** The first paragraph of the task's Summary. */
  summary: string;
  /** The file name of the screenshot to show (under this item's assets), or null when it has none. */
  screenshot: string | null;
}

export interface ReviewPagePayload {
  ok: true;
  /** The current review's name; null when the project has none (`message` then says so). */
  review: string | null;
  message: string | null;
  project: string;
  totals: { items: number; kept: number; routes: number };
  /** `11 items · 9 kept · 3 routes` */
  totalsLine: string;
  groups: { route: string | null; items: ReviewPageItem[] }[];
  handoff: string;
  /** PRD-destinations F-149: where that command sends the review, when `handoff.to` in the config says ("GitHub Issues"). */
  handoffTo?: string;
}

function isFile(path: string): boolean {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

/** F-149: the configured default destination's title, without importing a module from outside (N-39). */
function handoffTo(root: string): { handoffTo?: string } {
  try {
    const config = readDestinationsConfig(root);
    return config.defaultTo ? { handoffTo: destinationFact(config.defaultTo, config, root).title } : {};
  } catch {
    return {};
  }
}

/** The review as the page shows it. */
export function reviewPayload(root: string, review: Review | null): ReviewPagePayload {
  if (!review) {
    const totals = { items: 0, kept: 0, routes: 0 };
    return { ok: true, review: null, message: noReviewLine(root), project: root, totals, totalsLine: totalsLine(totals), groups: [], handoff: HANDOFF_COMMAND };
  }
  const view = reviewView(review);
  const items: ReviewPageItem[] = view.items.map((item) => ({
    ...item,
    summary: taskSummaryText(join(view.tasksDir, item.file)),
    screenshot: SHOTS.find((name) => isFile(join(view.tasksDir, ASSETS_DIRNAME, item.id, name))) ?? null,
  }));
  return { ok: true, review: view.name, message: null, project: root, totals: view.totals, totalsLine: totalsLine(view.totals), groups: groupByRoute(items), handoff: HANDOFF_COMMAND, ...handoffTo(root) };
}

// ---------------------------------------------------------------------------------------------
// The routes
// ---------------------------------------------------------------------------------------------

/**
 * F-135: the page and a local process only. `Host` must be a loopback name (the server binds
 * 127.0.0.1, so anything else is a rebound name); an `Origin`, when sent, must be this server's
 * own; a browser's `Sec-Fetch-Site`, when sent, must be `same-origin` or `none` (typed in the bar).
 */
export function reviewRequestAllowed(req: Pick<IncomingMessage, "headers">): boolean {
  const host = req.headers.host;
  if (typeof host !== "string" || !isLocalOrigin(`http://${host.toLowerCase()}`)) return false;
  const origin = req.headers.origin;
  if (origin !== undefined && origin.toLowerCase() !== `http://${host.toLowerCase()}`) return false;
  const site = req.headers["sec-fetch-site"];
  return site === undefined || site === "same-origin" || site === "none";
}

export interface ReviewRouteOptions {
  projectRoot: string;
  /** This package's version, for the page header (null when unreadable). */
  version: string | null;
  /** Where the CRT home is read from (`CRT_HOME`); the process's own by default. */
  env?: NodeJS.ProcessEnv;
  /** The clock for a priority change's `updated:` and Log stamp (tests). */
  now?: () => Date;
}

/** One per server: `/__crt/review` and everything under it. */
export class ReviewRoute {
  constructor(private readonly opts: ReviewRouteOptions) {}

  handles(path: string): boolean {
    return path === REVIEW_PATH || path.startsWith(REVIEW_PATH + "/");
  }

  private current(): Review | null {
    return currentReview(this.opts.projectRoot, this.opts.env);
  }

  private payload(): ReviewPagePayload {
    return reviewPayload(this.opts.projectRoot, this.current());
  }

  async handle(path: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!reviewRequestAllowed(req)) {
      json(res, 403, { ok: false, error: "the review is read and edited from its own page only" });
      return;
    }
    const method = req.method ?? "GET";
    const read = method === "GET" || method === "HEAD";
    if (path === REVIEW_PATH || path === REVIEW_PATH + "/") {
      if (!read) return notAllowed(res, "GET, HEAD", `GET ${REVIEW_PATH}`);
      const page = Buffer.from(renderReviewPage({ version: this.opts.version, projectRoot: this.opts.projectRoot }));
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "content-length": String(page.length),
        "cache-control": "no-store",
        "content-security-policy": REVIEW_PAGE_CSP,
        "x-content-type-options": "nosniff",
      });
      res.end(method === "HEAD" ? undefined : page);
      return;
    }
    if (path === REVIEW_ITEMS_PATH) {
      if (!read) return notAllowed(res, "GET, HEAD", `GET ${REVIEW_ITEMS_PATH}`);
      json(res, 200, this.payload());
      return;
    }
    if (path.startsWith(REVIEW_ITEMS_PATH + "/")) {
      if (method !== "PATCH") return notAllowed(res, "PATCH", `PATCH ${REVIEW_ITEMS_PATH}/<id> { keep?, priority?, move? }`);
      await this.patchItem(segments(path.slice(REVIEW_ITEMS_PATH.length + 1)), req, res);
      return;
    }
    if (path === REVIEW_GROUPS_PATH) {
      if (method !== "PATCH") return notAllowed(res, "PATCH", `PATCH ${REVIEW_GROUPS_PATH} { route, move }`);
      await this.patchGroup(req, res);
      return;
    }
    if (path.startsWith(REVIEW_ASSETS_PATH + "/")) {
      if (!read) return notAllowed(res, "GET, HEAD", `GET ${REVIEW_ASSETS_PATH}/<id>/<file>`);
      this.asset(segments(path.slice(REVIEW_ASSETS_PATH.length + 1)), res, method === "HEAD");
      return;
    }
    json(res, 404, { ok: false, error: `no such review route: ${path}` });
  }

  private async patchItem(parts: string[] | null, req: IncomingMessage, res: ServerResponse): Promise<void> {
    const id = parts?.length === 1 ? parts[0]! : "";
    if (!TASK_ID_RE.test(id)) {
      json(res, 404, { ok: false, error: "no such item" });
      return;
    }
    const body = await readJson(req, MAX_BODY);
    if (!body.ok) {
      json(res, body.status, { ok: false, error: body.error });
      return;
    }
    const patch = parseItemPatch(body.value);
    if (typeof patch === "string") {
      json(res, 400, { ok: false, error: patch });
      return;
    }
    const review = this.current();
    const view = review ? reviewView(review) : null;
    if (!review || !view?.items.some((i) => i.id === id)) {
      json(res, 404, { ok: false, error: review ? `no item ${id} in review ${review.name}` : noReviewLine(this.opts.projectRoot) });
      return;
    }
    // Read, reduce and write in one tick: nothing else in this process can write the manifest in between.
    let items: ReviewEntry[] = view.items;
    if (patch.keep !== undefined) items = setKeep(items, id, patch.keep) ?? items;
    if (patch.move !== undefined) items = moveItem(items, id, patch.move) ?? items;
    if (patch.keep !== undefined || patch.move !== undefined) writeReviewItems(review.dir, items);
    if (patch.priority !== undefined && setTaskPriority(view.tasksDir, id, patch.priority, this.opts.now?.() ?? new Date()) !== null) writeIndex(view.tasksDir);
    json(res, 200, this.payload());
  }

  private async patchGroup(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson(req, MAX_BODY);
    if (!body.ok) {
      json(res, body.status, { ok: false, error: body.error });
      return;
    }
    const b = body.value && typeof body.value === "object" && !Array.isArray(body.value) ? (body.value as Record<string, unknown>) : {};
    if (!(typeof b.route === "string" || b.route === null) || !isDirection(b.move) || Object.keys(b).some((k) => k !== "route" && k !== "move")) {
      json(res, 400, { ok: false, error: 'body: { "route": string | null, "move": "up" | "down" }' });
      return;
    }
    const review = this.current();
    const moved = review ? moveGroup<ReviewEntry>(reviewView(review).items, b.route, b.move) : null;
    if (!review || !moved) {
      json(res, 404, { ok: false, error: review ? `no items for route ${b.route ?? "(none)"} in review ${review.name}` : noReviewLine(this.opts.projectRoot) });
      return;
    }
    writeReviewItems(review.dir, moved);
    json(res, 200, this.payload());
  }

  /** `<review>/tasks/assets/<id>/<file>`: both parts are checked names, so the path cannot leave that folder. */
  private asset(parts: string[] | null, res: ServerResponse, head: boolean): void {
    const [id, file] = parts?.length === 2 ? parts : ["", ""];
    const review = this.current();
    const path = review && TASK_ID_RE.test(id!) && ASSET_FILE_RE.test(file!) ? join(reviewView(review).tasksDir, ASSETS_DIRNAME, id!, file!) : null;
    let body: Buffer | null = null;
    if (path && isFile(path)) {
      try {
        body = readFileSync(path);
      } catch {
        body = null;
      }
    }
    if (!body) {
      json(res, 404, { ok: false, error: "no such screenshot" });
      return;
    }
    res.writeHead(200, {
      "content-type": ASSET_TYPES[file!.slice(file!.lastIndexOf(".") + 1).toLowerCase()] ?? "application/octet-stream",
      "content-length": String(body.length),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    res.end(head ? undefined : body);
  }
}

function notAllowed(res: ServerResponse, allow: string, usage: string): void {
  res.setHeader("allow", allow);
  json(res, 405, { ok: false, error: usage });
}

/** The decoded segments of the rest of a path; null when one does not decode. */
function segments(rest: string): string[] | null {
  try {
    return rest.split("/").map((s) => decodeURIComponent(s));
  } catch {
    return null;
  }
}

function isDirection(value: unknown): value is MoveDirection {
  return value === "up" || value === "down";
}

/** `{ keep?, priority?, move? }` with at least one of them and nothing else; a string says what is wrong. */
export function parseItemPatch(value: unknown): { keep?: boolean; priority?: TaskPriority; move?: MoveDirection } | string {
  const usage = `body: { "keep"?: boolean, "priority"?: ${TASK_PRIORITIES.map((p) => `"${p}"`).join(" | ")}, "move"?: "up" | "down" } with at least one key`;
  if (!value || typeof value !== "object" || Array.isArray(value)) return usage;
  const b = value as Record<string, unknown>;
  const keys = Object.keys(b);
  if (!keys.length || keys.some((k) => k !== "keep" && k !== "priority" && k !== "move")) return usage;
  if (b.keep !== undefined && typeof b.keep !== "boolean") return usage;
  if (b.priority !== undefined && !(TASK_PRIORITIES as readonly unknown[]).includes(b.priority)) return usage;
  if (b.move !== undefined && !isDirection(b.move)) return usage;
  return {
    ...(typeof b.keep === "boolean" ? { keep: b.keep } : {}),
    ...(b.priority !== undefined ? { priority: b.priority as TaskPriority } : {}),
    ...(isDirection(b.move) ? { move: b.move } : {}),
  };
}

// ---------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------

/** Nothing off this origin: its own inline style and script, its own API and its own screenshots; never framed. */
export const REVIEW_PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export interface ReviewPageOptions {
  version: string | null;
  projectRoot: string;
}

export function renderReviewPage(o: ReviewPageOptions): string {
  const T = LANDING_TOKENS;
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    "<title>CRT review</title>",
    `<link rel="icon" href="${FAVICON_PATH}" type="image/svg+xml">`,
    `<style>${css(T)}</style>`,
    "</head>",
    "<body>",
    '<div class="wrap">',
    "<header>",
    `<a class="name" href="${CRT_PREFIX}/">CRT${o.version ? ` <span class="ver">${escapeHtml(o.version)}</span>` : ""}</a>`,
    '<span class="spacer"></span>',
    `<span class="chip" title="${escapeHtml(o.projectRoot)}"><span class="path">${escapeHtml(o.projectRoot)}</span></span>`,
    "</header>",
    '<section class="top">',
    '<h1>Review <span id="name"></span></h1>',
    '<p class="lead">Keep or drop each item, set how urgent it is and put them in order. Nothing reaches the project until you hand the review over.</p>',
    '<p class="totals" id="totals"></p>',
    `<p class="hand">When it reads right: <code id="handoff">${HANDOFF_COMMAND}</code><span id="handoff-to"></span> <button type="button" id="copy">Copy</button></p>`,
    "</section>",
    "<noscript><p>Run <code>crt review</code> in a terminal for this list.</p></noscript>",
    '<p id="status" class="sr" role="status" aria-live="polite"></p>',
    '<main id="review" data-state="loading"></main>',
    "</div>",
    `<script>${script()}</script>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

function css(T: typeof LANDING_TOKENS): string {
  return [
    `:root{--bg:#f6f6f7;--panel:#fff;--ink:${T.INK};--muted:#6b6b73;--line:#e5e5ea;--code:#f1f1f4;--accent:${T.ACCENT}}`,
    "@media (prefers-color-scheme: dark){:root{--bg:#0f0f12;--panel:#17171b;--ink:#f2f2f4;--muted:#9a9aa3;--line:#2a2a30;--code:#202026}}",
    '*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
    "code,.mono{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px}code{background:var(--code);padding:1px 6px;border-radius:5px}.muted{color:var(--muted)}",
    ".wrap{max-width:960px;margin:0 auto;padding:20px 24px 48px}",
    "header{display:flex;align-items:center;gap:12px;padding:6px 0 18px}header .name{font-weight:700;font-size:17px;color:inherit;text-decoration:none}header .ver{color:var(--muted);font-weight:500}header .spacer{flex:1}",
    ".chip{display:inline-flex;align-items:center;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;background:var(--code);color:var(--muted);max-width:60%;min-width:0}.chip .path{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,Menlo,Consolas,monospace}",
    ".top h1{font-size:28px;line-height:1.2;margin:0 0 6px;letter-spacing:-.3px}.lead{margin:0 0 10px;color:var(--muted);max-width:62ch}.totals{margin:0 0 6px;font-weight:600}.hand{margin:0 0 22px;color:var(--muted);font-size:14px}",
    "button,select{font:inherit;font-size:13px;color:var(--ink);background:var(--code);border:1px solid var(--line);border-radius:8px;padding:4px 10px}button{cursor:pointer;font-weight:600}button:hover:not(:disabled),select:hover{border-color:var(--ink)}button:disabled{opacity:.45;cursor:default}",
    ".group{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:14px 18px;margin:0 0 14px}.group h2{font-size:15px;margin:0 0 4px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.group h2 .route{font-family:ui-monospace,Menlo,Consolas,monospace;overflow-wrap:anywhere}.group h2 .count{color:var(--muted);font-weight:500;font-size:13px}.group h2 .gctl{margin-left:auto;display:inline-flex;gap:6px}",
    ".items{list-style:none;margin:0;padding:0}.item{display:grid;grid-template-columns:168px 1fr;gap:16px;padding:14px 0;border-top:1px solid var(--line)}.item:first-child{border-top:0}",
    ".shot{display:block;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--code);aspect-ratio:4/3}.shot img{display:block;width:100%;height:100%;object-fit:cover;object-position:top left}.shot.none{display:grid;place-items:center;color:var(--muted);font-size:12px}",
    ".item h3{font-size:15px;margin:0 0 4px;overflow-wrap:anywhere}.item .id{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;color:var(--muted);margin-right:6px}.item .sum{margin:0 0 6px;color:var(--muted);font-size:14px;overflow-wrap:anywhere}.item .meta{margin:0 0 10px;color:var(--muted);font-size:12px}",
    `.ctl{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.ctl label{font-size:13px;color:var(--muted);display:inline-flex;gap:6px;align-items:center}.tag{display:inline-block;padding:1px 8px;border-radius:999px;font-size:11px;font-weight:700;background:${T.PILL_SKIP[0]};color:${T.PILL_SKIP[1]};margin-left:6px;vertical-align:middle}`,
    ".item.dropped h3,.item.dropped .sum,.item.dropped .meta,.item.dropped .shot{opacity:.5}.item.dropped h3 .title{text-decoration:line-through}",
    ".note{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px;color:var(--muted)}",
    ".sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}",
    ":focus-visible{outline:2px solid var(--accent);outline-offset:2px}",
    "@media (max-width:600px){.item{grid-template-columns:1fr}.shot{max-width:240px}.wrap{padding:16px}.chip{display:none}}",
  ].join("");
}

/**
 * The one inline script: fetch the payload, build the groups, send each change as a PATCH and
 * render what comes back, then put the focus back on the control that was used (or its twin when
 * that one is now disabled) so a keyboard run of changes never loses its place. ES5-ish, no library.
 */
function script(): string {
  return `(function(){
var d=document,main=d.getElementById("review"),ITEMS=${JSON.stringify(REVIEW_ITEMS_PATH)},GROUPS=${JSON.stringify(REVIEW_GROUPS_PATH)},ASSETS=${JSON.stringify(REVIEW_ASSETS_PATH)},PRIOS=${JSON.stringify(TASK_PRIORITIES)},busy=false;
function el(tag,attrs,kids){var n=d.createElement(tag),k;for(k in attrs||{}){if(attrs[k]===false||attrs[k]==null)continue;if(k==="text")n.textContent=attrs[k];else if(k==="class")n.className=attrs[k];else if(attrs[k]===true)n.setAttribute(k,"");else n.setAttribute(k,attrs[k])}(kids||[]).forEach(function(c){if(c)n.appendChild(c)});return n}
function say(t){d.getElementById("status").textContent=t}
function note(state,text){main.setAttribute("data-state",state);main.textContent="";main.appendChild(el("p",{class:"note",text:text}))}
function btn(key,label,name,off){return el("button",{type:"button","data-key":key,"aria-label":name,disabled:!!off,text:label})}
function item(it,i,n){
var shot=it.screenshot?el("a",{class:"shot",href:ASSETS+"/"+encodeURIComponent(it.id)+"/"+encodeURIComponent(it.screenshot),target:"_blank",rel:"noopener"},[el("img",{src:ASSETS+"/"+encodeURIComponent(it.id)+"/"+encodeURIComponent(it.screenshot),alt:"Annotated screenshot for "+it.id,loading:"lazy"})]):el("div",{class:"shot none",text:"no screenshot"});
var sel=el("select",{"data-key":it.id+":priority","aria-label":"Priority of "+it.id},PRIOS.map(function(p){return el("option",{value:p,selected:p===it.priority,text:p})}));
var where=it.commit?"reviewed at "+it.commit.slice(0,7)+(it.branch?" on "+it.branch:""):it.branch?"reviewed on "+it.branch:"";
return el("li",{class:"item"+(it.keep?"":" dropped"),"data-id":it.id,"data-keep":String(it.keep)},[shot,el("div",{},[
el("h3",{},[el("span",{class:"id",text:it.id}),el("span",{class:"title",text:it.title}),it.keep?null:el("span",{class:"tag",text:"dropped"})]),
it.summary?el("p",{class:"sum",text:it.summary}):null,
where?el("p",{class:"meta",text:where}):null,
el("div",{class:"ctl"},[btn(it.id+":keep",it.keep?"Drop":"Keep",(it.keep?"Drop ":"Keep ")+it.id),el("label",{},[d.createTextNode("Priority"),sel]),btn(it.id+":up","Move up","Move "+it.id+" up",i===0),btn(it.id+":down","Move down","Move "+it.id+" down",i===n-1)])
])])}
function render(p){
d.getElementById("name").textContent=p.review||"";d.getElementById("totals").textContent=p.review?p.totalsLine:"";d.getElementById("handoff").textContent=p.handoff;d.getElementById("handoff-to").textContent=p.handoffTo?" \u2014 to "+p.handoffTo:"";
if(!p.review){note("empty",p.message||"No review yet.");return}
if(!p.groups.length){note("empty","Review "+p.review+" has no items yet — send some feedback from the page, then come back.");return}
main.textContent="";
p.groups.forEach(function(g,gi){var name=g.route===null?"(no route)":g.route,key="g:"+gi;
var sec=el("section",{class:"group","data-route":g.route===null?"":g.route},[el("h2",{},[el("span",{class:"route",text:name}),el("span",{class:"count",text:g.items.length+(g.items.length===1?" item":" items")}),el("span",{class:"gctl"},[btn(key+":up","Group up","Move the group "+name+" up",gi===0),btn(key+":down","Group down","Move the group "+name+" down",gi===p.groups.length-1)])]),el("ul",{class:"items"},g.items.map(function(it,i){return item(it,i,g.items.length)}))]);
sec.__route=g.route;main.appendChild(sec)});
main.setAttribute("data-state","ready")}
function focus(key){if(!key)return;var n=main.querySelector('[data-key="'+key+'"]');if(n&&n.disabled){var twin=key.replace(/:(up|down)$/,function(m,w){return":"+(w==="up"?"down":"up")});n=main.querySelector('[data-key="'+twin+'"]')}if(n&&!n.disabled)n.focus()}
function load(key,said){return fetch(ITEMS,{cache:"no-store"}).then(function(r){return r.json()}).then(function(p){if(!p.ok)throw new Error(p.error||"could not read the review");render(p);focus(key);if(said)say(said)}).catch(function(e){note("error","Could not read the review ("+e.message+"). Is CRT still running? Run crt review again.")})}
function send(url,body,key,said){if(busy)return;busy=true;fetch(url,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify(body)}).then(function(r){return r.json()}).then(function(p){busy=false;if(!p.ok){say(p.error||"That change was not saved.");return load(key)}render(p);focus(key);say(said)}).catch(function(){busy=false;say("That change was not saved — is CRT still running?")})}
main.addEventListener("click",function(e){var b=e.target.closest&&e.target.closest("button[data-key]");if(!b||b.disabled)return;var key=b.getAttribute("data-key"),m=/^(.*):(keep|up|down)$/.exec(key);if(!m)return;
if(m[1].indexOf("g:")===0){var sec=b.closest(".group");send(GROUPS,{route:sec.__route,move:m[2]},key.replace(/^g:(\\d+)/,function(x,i){return"g:"+(+i+(m[2]==="up"?-1:1))}),"Group moved "+m[2]+".");return}
var li=b.closest(".item"),id=m[1];
if(m[2]==="keep"){var keep=li.getAttribute("data-keep")!=="true";send(ITEMS+"/"+encodeURIComponent(id),{keep:keep},key,id+(keep?" kept.":" dropped."))}
else send(ITEMS+"/"+encodeURIComponent(id),{move:m[2]},key,id+" moved "+m[2]+".")});
main.addEventListener("change",function(e){var s=e.target;if(!s||s.tagName!=="SELECT")return;var key=s.getAttribute("data-key"),id=key.replace(/:priority$/,"");send(ITEMS+"/"+encodeURIComponent(id),{priority:s.value},key,id+" is now "+s.value+" priority.")});
d.getElementById("copy").addEventListener("click",function(){var b=this,c=d.getElementById("handoff"),done=function(){b.textContent="Copied";say("Copied "+c.textContent)};function pick(){var s=window.getSelection(),r=d.createRange();r.selectNodeContents(c);s.removeAllRanges();s.addRange(r);try{d.execCommand("copy")}catch(e){}done()}if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(c.textContent).then(done,pick);else pick()});
d.getElementById("copy").addEventListener("blur",function(){this.textContent="Copy"});
d.addEventListener("visibilitychange",function(){if(!d.hidden&&!busy){var a=d.activeElement;load(a&&a.getAttribute?a.getAttribute("data-key"):null)}});
load();
})();`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
