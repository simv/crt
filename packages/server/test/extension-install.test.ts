// PRD-extension M39: `crt extension` (F-161) and what the server knows of the extension (F-162).
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { EXTENSION_DIRNAME, extensionDir, extensionSeen, manifestVersion, PAGE_HEADER, rememberExtension, runExtension, VIA_EXTENSION, VIA_HEADER } from "../src/extension.js";
import { projectReviewsDir } from "../src/home.js";
import { createProxyServer, pageOrigin } from "../src/proxy.js";
import { PAGE_HEADER as WIRE_PAGE_HEADER, VIA_EXTENSION as WIRE_VIA_EXTENSION, VIA_HEADER as WIRE_VIA_HEADER } from "../../overlay/src/extension/wire.js";
import { listen0 } from "./helpers/http.js";

const tmp = mkdtempSync(join(tmpdir(), "crt-ext-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** A built extension of one version, as `dist/extension/` holds it. */
function built(name: string, version: string, extra: Record<string, string> = {}): string {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({ manifest_version: 3, version }) + "\n");
  writeFileSync(join(dir, "worker.js"), `// ${version}\n`);
  for (const [file, text] of Object.entries(extra)) writeFileSync(join(dir, file), text);
  return dir;
}

describe("crt extension (PRD-extension F-161)", () => {
  it("copies the built extension to <home>/extension and prints the folder and the three steps (F-161)", () => {
    const home = join(tmp, "home-a");
    const env = { CRT_HOME: home };
    const r = runExtension({ sourceDir: built("v1", "0.10.0", { "gone.js": "old\n" }), env });
    expect(r.action).toBe("installed");
    expect(r.dir).toBe(join(home, EXTENSION_DIRNAME));
    expect(manifestVersion(r.dir)).toBe("0.10.0");
    expect(r.lines[0]).toBe(`crt: copied the extension 0.10.0 to ${r.dir}`);
    expect(r.lines.slice(1, 4).map((l) => l.trim().slice(0, 2))).toEqual(["1.", "2.", "3."]);
    expect(r.lines.join("\n")).toContain("chrome://extensions");
    expect(r.lines.join("\n")).toContain("edge://extensions");
    expect(r.lines.join("\n")).toContain(`choose ${r.dir}`);
    // It writes nowhere else: the home holds the one folder.
    expect(readdirSync(home)).toEqual([EXTENSION_DIRNAME]);
  });

  it("refreshes the copy on a later version, drops what that version dropped, and says to reload (F-161)", () => {
    const env = { CRT_HOME: join(tmp, "home-a") };
    const r = runExtension({ sourceDir: built("v2", "0.10.1"), env });
    expect(r.action).toBe("refreshed");
    expect(r.lines[0]).toBe(`crt: updated the extension in ${r.dir} (0.10.0 → 0.10.1)`);
    expect(r.lines[1]).toContain("Reload");
    expect(readFileSync(join(r.dir, "worker.js"), "utf8")).toBe("// 0.10.1\n");
    expect(existsSync(join(r.dir, "gone.js"))).toBe(false);
    // The same version again: still there, and the steps are repeated for a second browser.
    const again = runExtension({ sourceDir: built("v2", "0.10.1"), env });
    expect(again.action).toBe("current");
    expect(again.lines[0]).toBe(`crt: the extension 0.10.1 is in ${again.dir}`);
  });

  it("--path prints the folder and writes nothing; a package without the extension is one line (F-161)", () => {
    const home = join(tmp, "home-b");
    const env = { CRT_HOME: home };
    expect(runExtension({ sourceDir: built("v1", "0.10.0"), env, pathOnly: true })).toEqual({ dir: extensionDir(env), action: "path", lines: [extensionDir(env)] });
    expect(existsSync(home)).toBe(false);
    expect(() => runExtension({ sourceDir: join(tmp, "nowhere"), env })).toThrow(/the extension is missing from this package/);
    expect(existsSync(home)).toBe(false);
  });
});

describe("the server knows the extension (PRD-extension F-162)", () => {
  it("uses the header names the worker sends (F-162)", () => {
    expect([VIA_HEADER, PAGE_HEADER, VIA_EXTENSION]).toEqual([WIRE_VIA_HEADER, WIRE_PAGE_HEADER, WIRE_VIA_EXTENSION]);
  });

  it("counts the extension's health calls, logs the first with the page's origin and remembers it for the project (F-162)", async () => {
    const root = join(tmp, "project");
    mkdirSync(root, { recursive: true });
    const env = { CRT_HOME: join(tmp, "home-c") };
    const log: string[] = [];
    const server = await listen0(createProxyServer({ target: null, mode: "embedded", projectRoot: root, overlayPath: join(tmp, "overlay.js"), env, log: (l) => log.push(l) }));
    try {
      const health = async (headers: Record<string, string> = {}) => ((await (await fetch(server.origin + "/__crt/health", { headers })).json()) as { overlay: { extension: number } }).overlay.extension;
      expect(await health()).toBe(0);
      expect(extensionSeen(root, env)).toBe(false);
      const via = { [VIA_HEADER]: VIA_EXTENSION, [PAGE_HEADER]: "https://app.example.test" };
      expect(await health(via)).toBe(1);
      expect(await health(via)).toBe(2);
      // A plain health call (the loader's, `crt doctor`'s) is not the extension.
      expect(await health()).toBe(2);
      expect(log.filter((l) => l.includes("overlay loaded"))).toEqual(["crt: overlay loaded in the browser (the extension, on https://app.example.test)"]);
      // N-34: the first thing created under the home is announced, once.
      expect(log.filter((l) => l.startsWith("crt: created "))).toHaveLength(1);
      expect(extensionSeen(root, env)).toBe(true);
      expect(readdirSync(projectReviewsDir(root, env))).toEqual(["extension.json"]);
    } finally {
      await server.close();
    }
  });

  it("prints only an http(s) origin from the page header (N-42: what the page supplies is data)", () => {
    const at = (page?: string) => pageOrigin({ headers: page === undefined ? {} : { [PAGE_HEADER]: page } });
    expect(at("https://shop.example.test/cart?x=1")).toBe("https://shop.example.test");
    expect(at("http://localhost:3000")).toBe("http://localhost:3000");
    expect(at("javascript:alert(1)")).toBe("an unknown page");
    expect(at("crt: forged line\n")).toBe("an unknown page");
    expect(at()).toBe("an unknown page");
  });

  it("rememberExtension writes once and never throws (F-162)", () => {
    const root = join(tmp, "project-2");
    const env = { CRT_HOME: join(tmp, "home-d") };
    rememberExtension(root, env, undefined, new Date("2026-11-17T10:00:00Z"));
    rememberExtension(root, env, undefined, new Date("2026-11-18T10:00:00Z"));
    expect(JSON.parse(readFileSync(join(projectReviewsDir(root, env), "extension.json"), "utf8"))).toEqual({ seen: "2026-11-17T10:00:00.000Z" });
    const file = join(tmp, "a-file");
    writeFileSync(file, "");
    expect(() => rememberExtension(root, { CRT_HOME: join(file, "under") })).not.toThrow();
  });
});
