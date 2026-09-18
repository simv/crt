import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { HtmlTagDescriptor, IndexHtmlTransformContext, ResolvedConfig } from "vite";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { crt, loaderModule, PLUGIN_NAME, resolvePort } from "../src/integrations/vite.js";

// PRD-embedded F-97: `crt()` is a dev-only Vite plugin (`apply: "serve"`) whose `transformIndexHtml`
// prepends one inline module to <head>; the port is `options.port`, else `.crt/config.local.json`,
// else `.crt/config.json` of the nearest project root, else 4400. The real dev server and
// `vite build` are exercised in production-guard.test.ts; this file pins the shape and the order.

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "crt-vite-"));
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, "app", "src"), { recursive: true });
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

afterEach(() => vi.unstubAllEnvs());

/** The plugin's handler, called the way Vite does, with `config.root` resolved first when given. */
function transform(plugin: ReturnType<typeof crt>, viteRoot?: string): HtmlTagDescriptor[] | undefined {
  const hook = plugin.transformIndexHtml as { order: string; handler: (html: string, ctx: IndexHtmlTransformContext) => HtmlTagDescriptor[] | undefined };
  if (viteRoot !== undefined) (plugin.configResolved as (c: ResolvedConfig) => void).call({} as never, { root: viteRoot } as ResolvedConfig);
  return hook.handler.call({} as never, "<html><head></head><body></body></html>", { path: "/index.html", filename: "index.html" } as IndexHtmlTransformContext);
}

describe("claude-review-tool/vite (F-97)", () => {
  it("is named claude-review-tool, applies in serve only, and transforms index.html with order pre (F-97, F-98 layer 4)", () => {
    const plugin = crt();
    expect(plugin.name).toBe(PLUGIN_NAME);
    expect(plugin.name).toBe("claude-review-tool");
    expect(plugin.apply).toBe("serve");
    expect(plugin.transformIndexHtml).toMatchObject({ order: "pre", handler: expect.any(Function) });
  });

  it("returns one inline module tag, head-prepend, importing mountCrt from claude-review-tool/loader with the port (F-97)", () => {
    const tags = transform(crt({ port: 4412 }));
    expect(tags).toEqual([{ tag: "script", attrs: { type: "module" }, children: 'import { mountCrt } from "claude-review-tool/loader"; mountCrt({ port: 4412 })', injectTo: "head-prepend" }]);
    expect(loaderModule(4400)).toBe('import { mountCrt } from "claude-review-tool/loader"; mountCrt({ port: 4400 })');
  });

  it("port: options.port, then .crt/config.local.json, then .crt/config.json, then 4400 (F-97)", () => {
    const app = join(root, "app");
    expect(resolvePort(undefined, app)).toBe(4400);
    expect(transform(crt(), app)![0]!.children).toContain("port: 4400");
    mkdirSync(join(root, ".crt"), { recursive: true });
    writeFileSync(join(root, ".crt", "config.json"), JSON.stringify({ port: 4401 }));
    expect(resolvePort(undefined, app)).toBe(4401); // found from Vite's root, up to the .git project root
    expect(resolvePort(undefined, join(app, "src"))).toBe(4401);
    writeFileSync(join(root, ".crt", "config.local.json"), JSON.stringify({ port: 4402 }));
    expect(resolvePort(undefined, app)).toBe(4402);
    expect(resolvePort({ root: app }, join(tmpdir()))).toBe(4402); // options.root wins over Vite's root
    expect(resolvePort({ port: 4403, root: app }, app)).toBe(4403);
    expect(resolvePort({ port: 0 }, app)).toBe(4402); // junk port: fall through
    expect(transform(crt(), app)![0]!.children).toContain("port: 4402");
    expect(transform(crt({ port: 4404 }), app)![0]!.children).toContain("port: 4404");
    rmSync(join(root, ".crt"), { recursive: true, force: true });
  });

  it("the handler returns nothing under NODE_ENV=production, on top of apply: serve (F-98 layer 2)", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(transform(crt({ port: 4412 }))).toBeUndefined();
    vi.stubEnv("NODE_ENV", "development");
    expect(transform(crt({ port: 4412 }))).toHaveLength(1);
  });
});
