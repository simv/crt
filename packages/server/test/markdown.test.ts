import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../../overlay/src/chat.js";
import { STUB_PROPOSALS } from "../src/providers/stub.js";

// F-25: the chat's markdown-ish renderer, pinned before N-3 (CRT-0039) moved it to one render per
// frame while a message streams. Pure: a string in, an HTML string out, no DOM.

describe("renderMarkdown (F-25)", () => {
  it("joins lines into paragraphs with <br> and splits paragraphs on blank lines", () => {
    expect(renderMarkdown("one\ntwo\n\nthree")).toBe("<p>one<br>two</p><p>three</p>");
    expect(renderMarkdown("")).toBe("");
  });

  it("renders # to ### as headings and anything deeper as text", () => {
    expect(renderMarkdown("# A\n## B\n### C\n#### D")).toBe("<h1>A</h1><h2>B</h2><h3>C</h3><p>#### D</p>");
  });

  it("renders bullet and numbered lists, a new list when the kind changes, and checkboxes as disabled inputs", () => {
    expect(renderMarkdown("- a\n* b\n1. c\n2) d")).toBe("<ul><li>a</li><li>b</li></ul><ol><li>c</li><li>d</li></ol>");
    expect(renderMarkdown("- [ ] open\n- [x] done")).toBe(
      '<ul><li class="task"><input type="checkbox" disabled> open</li><li class="task"><input type="checkbox" disabled checked> done</li></ul>',
    );
    expect(renderMarkdown("intro\n- item\nafter")).toBe("<p>intro</p><ul><li>item</li></ul><p>after</p>");
  });

  it("renders fences verbatim and escaped, and an unterminated fence runs to the end", () => {
    expect(renderMarkdown("```ts\nconst a = 1 < 2 && `x`;\n```\ntext")).toBe("<pre><code>const a = 1 &lt; 2 &amp;&amp; `x`;</code></pre><p>text</p>");
    expect(renderMarkdown("before\n```\n**not bold**")).toBe("<p>before</p><pre><code>**not bold**</code></pre>");
  });

  it("renders inline code, bold and emphasis, leaves snake_case alone, and escapes HTML everywhere", () => {
    expect(renderMarkdown("Use `a<b>` with **care** and _some_ *style*.")).toBe(
      "<p>Use <code>a&lt;b&gt;</code> with <strong>care</strong> and <em>some</em> <em>style</em>.</p>",
    );
    expect(renderMarkdown("call snake_case_name now")).toBe("<p>call snake_case_name now</p>");
    expect(renderMarkdown('<img src=x onerror="alert(1)"> & \'q\'')).toBe("<p>&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;q&#39;</p>");
  });

  it("renders the stub's proposal: the restatement, the checklist and the closing line", () => {
    expect(renderMarkdown(STUB_PROPOSALS.deny)).toBe(
      "<p>Understood, I won&#39;t run tests.</p><p>Proposed definition of done:</p>" +
        '<ul><li class="task"><input type="checkbox" disabled> Cart total applies the promo discount</li></ul>' +
        "<p>Accept as-is, or tell me what to change, and I&#39;ll write the task.</p>",
    );
  });

  // CRT-0043: renderMarkdown is the overlay's XSS boundary — agent text becomes innerHTML. The only
  // tags it may emit are its own, with no attribute but the checkbox's, and none from the input.
  it("never lets a tag or an attribute through: <script>, event handlers and quotes are escaped in every block kind", () => {
    const attacks = ["<script>alert(1)</script>", '"><img src=x onerror=alert(1)>', "<svg/onload=alert(1)>", "' onmouseover='alert(1)"];
    for (const a of attacks) {
      for (const src of [a, `# ${a}`, `- ${a}`, `1. ${a}`, `- [x] ${a}`, `**${a}**`, `_${a}_`, `\`${a}\``, `\`\`\`\n${a}\n\`\`\``]) {
        const html = renderMarkdown(src);
        expect(html, src).not.toMatch(/<(script|img|svg)\b/i);
        // Every tag in the output is one the renderer writes itself, so no attribute came from the input.
        for (const tag of html.match(/<[^>]+>/g) ?? []) {
          expect(tag, src).toMatch(/^<\/?(p|br|h[1-3]|ul|ol|li|li class="task"|pre|code|strong|em)>$|^<input type="checkbox" disabled( checked)?>$/);
        }
      }
    }
  });

  it("drops a fence's info string rather than putting it in an attribute", () => {
    expect(renderMarkdown('```js" onload="alert(1)\nx\n```')).toBe("<pre><code>x</code></pre>");
  });

  it("renders no links: Markdown links, raw anchors and bare URLs stay text (no javascript: URL can reach an href)", () => {
    expect(renderMarkdown("[click](javascript:alert(1))")).toBe("<p>[click](javascript:alert(1))</p>");
    expect(renderMarkdown('<a href="javascript:alert(1)">x</a>')).toBe("<p>&lt;a href=&quot;javascript:alert(1)&quot;&gt;x&lt;/a&gt;</p>");
    expect(renderMarkdown("see https://example.com/?a=1&b=2")).toBe("<p>see https://example.com/?a=1&amp;b=2</p>");
    expect(renderMarkdown("![img](https://example.com/x.png)")).not.toContain("<img");
  });

  it("renders every prefix of a streamed message without throwing (a frame can land mid-fence or mid-emphasis, N-3)", () => {
    const text = "## Plan\nSome **bold** and `code`.\n\n```js\nlet x = 1;\n```\n- [ ] one\n- [x] two\n\n1. first\n2. second\n";
    for (let i = 0; i <= text.length; i++) expect(() => renderMarkdown(text.slice(0, i))).not.toThrow();
  });
});
