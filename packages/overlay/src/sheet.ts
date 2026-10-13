/**
 * Styles for a CRT shadow root that a strict `style-src` cannot blank (F-2, F-96, CRT-0046). An
 * app whose policy allows styles only from its own origin or with a per-page nonce
 * (`style-src 'self' 'nonce-…'`) blocks an inline `<style>` the overlay adds, so the panel and the
 * pill render unstyled and their buttons collapse. A constructed stylesheet is not an inline
 * style: the policy governs `<style>` elements and `style` attributes, and a script the page
 * already allowed to run may build one. Nothing in the page's policy is loosened. Browsers without
 * constructable stylesheets get the `<style>` element as before. Shared by the overlay and the
 * loader, so it stays tiny (N-20).
 */
export function adoptCss(root: ShadowRoot, css: string): void {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    return;
  } catch {
    // no constructable stylesheets: fall back to the element
  }
  const style = document.createElement("style");
  style.textContent = css;
  root.prepend(style);
}
