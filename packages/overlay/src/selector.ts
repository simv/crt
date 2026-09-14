/**
 * Unique CSS selector and XPath generation (PRD F-17). Pure DOM functions; exercised through
 * `window.__crt.selectorFor` / `xpathFor` by the Playwright capture spec.
 *
 * Selector strategy, shortest-first: `#id` when unique; otherwise build a path upward where each
 * step is `tag`, `tag.class…` or `tag:nth-of-type(n)`, stopping as soon as the path matches exactly
 * one element in the document. Ids and classes that look generated (CSS-modules hashes, emotion,
 * numeric suffixes) are skipped in favour of structural steps, so the selector stays meaningful
 * across HMR reloads.
 */

const HOST_ID = "crt-host";

const cssEscape = (s: string): string =>
  typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(s)
    : s.replace(/([^\w-])/g, "\\$1");

/** Heuristic: hashed/generated tokens make brittle selectors. */
export function looksGenerated(token: string): boolean {
  if (/^[a-zA-Z_-]*[0-9a-f]{6,}$/i.test(token)) return true; // hash suffix (css-modules, emotion, tailwind arbitrary)
  if (/^(css|sc|jss|svelte|ng)-[\w-]+$/i.test(token)) return true;
  if (/^_[\w-]*\d{3,}/.test(token)) return true;
  if (/\d{4,}/.test(token)) return true; // long numeric runs
  if (/^:r[0-9a-z]+:$/.test(token)) return true; // React useId
  return false;
}

function idSelector(el: Element): string | null {
  const id = el.getAttribute("id");
  if (!id || looksGenerated(id)) return null;
  const sel = `#${cssEscape(id)}`;
  return isUnique(sel) ? sel : null;
}

function isUnique(selector: string): boolean {
  try {
    return document.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function step(el: Element): string {
  const tag = el.localName;
  const parent = el.parentElement;
  const classes = Array.from(el.classList).filter((c) => !looksGenerated(c));
  if (parent) {
    const siblings = Array.from(parent.children);
    const sameTag = siblings.filter((s) => s.localName === tag);
    if (sameTag.length === 1) return tag;
    // A class that distinguishes it from its same-tag siblings.
    for (const c of classes) {
      if (sameTag.filter((s) => s.classList.contains(c)).length === 1) return `${tag}.${cssEscape(c)}`;
    }
    return `${tag}:nth-of-type(${sameTag.indexOf(el) + 1})`;
  }
  return tag;
}

/** A selector that matches exactly `el` in the current document. */
export function selectorFor(el: Element): string {
  const own = idSelector(el);
  if (own) return own;
  const steps: string[] = [];
  let cur: Element | null = el;
  while (cur && cur !== document.documentElement) {
    const anchor = idSelector(cur);
    if (anchor && cur !== el) {
      steps.unshift(anchor);
      break;
    }
    steps.unshift(step(cur));
    const candidate = steps.join(" > ");
    if (isUnique(candidate)) return candidate;
    cur = cur.parentElement;
  }
  const full = (cur === document.documentElement ? "html > " : "") + steps.join(" > ");
  return isUnique(full) ? full : steps.join(" > ");
}

/** Absolute XPath like `/html/body/div[2]/span[1]`. */
export function xpathFor(el: Element): string {
  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === Node.ELEMENT_NODE) {
    const parent: Element | null = cur.parentElement;
    const tag = cur.localName;
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const sameTag = Array.from(parent.children).filter((s) => s.localName === tag);
    parts.unshift(sameTag.length > 1 ? `${tag}[${sameTag.indexOf(cur) + 1}]` : tag);
    cur = parent;
  }
  return "/" + parts.join("/");
}

/** True for the overlay's own host element (never annotate ourselves). */
export function isOverlayNode(node: Node | null): boolean {
  return node instanceof Element && node.id === HOST_ID;
}
