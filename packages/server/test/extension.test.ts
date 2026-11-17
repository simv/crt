import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildExtension, EXTENSION_ICONS, EXTENSION_SCRIPTS } from "../../overlay/build.mjs";
import { cleaners } from "../../overlay/src/extension/clean.js";
import {
  CONTENT_ID,
  DEFAULT_SERVER,
  isCrtApiPath,
  loopbackServer,
  mismatchLine,
  PROBE_ID,
  sameMinor,
  serverForPort,
  siteOf,
  sitePatterns,
  siteScripts,
  sitesOf,
  sseParser,
} from "../../overlay/src/extension/wire.js";
import { UNKNOWN_COMPONENTS, UNKNOWN_FRAMEWORK } from "../../overlay/src/probe-wire.js";
import * as routes from "../src/routes.js";
import { packageVersion } from "../src/version.js";

// PRD-extension M38: the extension's package and the pure rules its two halves share. What needs a
// browser — the two worlds, the worker, the registrations — is e2e/extension.spec.ts.

const SRC = join(import.meta.dirname, "..", "..", "overlay", "src", "extension");
const code = (f: string) =>
  readFileSync(join(SRC, f), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

describe("the extension package (PRD-extension F-154)", () => {
  let dist: string;
  beforeAll(async () => {
    dist = mkdtempSync(join(tmpdir(), "crt-extension-"));
    await buildExtension(dist, "silent");
  });
  afterAll(() => rmSync(dist, { recursive: true, force: true }));

  it("is a Manifest V3 extension at the package's version, with exactly the permissions of F-154 and never all sites (F-154, N-43)", () => {
    const manifest = JSON.parse(readFileSync(join(dist, "extension", "manifest.json"), "utf8")) as Record<string, unknown>;
    expect(manifest.manifest_version).toBe(3);
    expect(manifest.version).toBe(packageVersion());
    expect(manifest.permissions).toEqual(["activeTab", "scripting", "storage"]);
    expect(manifest.host_permissions).toEqual(["http://localhost/*", "http://127.0.0.1/*"]);
    expect(manifest.optional_host_permissions).toEqual(["http://*/*", "https://*/*"]);
    // Nothing runs anywhere until a site is turned on (F-155): no static content script, no page it can be messaged from.
    for (const key of ["content_scripts", "externally_connectable", "web_accessible_resources", "declarative_net_request", "content_security_policy"]) expect(manifest[key], key).toBeUndefined();
    expect(JSON.stringify(manifest)).not.toContain("<all_urls>");
    expect(manifest.background).toEqual({ service_worker: "worker.js" });
  });

  it("ships its four scripts, the options page and the icons, and nothing fetched at run time (F-154, N-43)", () => {
    const files = readdirSync(join(dist, "extension")).sort();
    expect(files).toEqual([...EXTENSION_SCRIPTS.map((s) => `${s}.js`), ...Object.keys(EXTENSION_ICONS), "manifest.json", "options.html"].sort());
    for (const s of EXTENSION_SCRIPTS) {
      const js = readFileSync(join(dist, "extension", `${s}.js`), "utf8");
      expect(js, `${s}.js: no \`process\` reaches a browser`).not.toMatch(/\bprocess\.env\b/);
      expect(js, `${s}.js: no remote code`).not.toMatch(/\bimportScripts\(|\beval\(|new Function\(/);
    }
    expect(readFileSync(join(dist, "extension", "options.html"), "utf8")).toMatch(/<script src="options\.js"><\/script>/);
    // The page-world half carries no extension API and no way to the server.
    const probe = readFileSync(join(dist, "extension", "probe.js"), "utf8");
    expect(probe).not.toMatch(/chrome\.(runtime|storage|tabs|scripting)/);
  });

  it("requests nothing but the configured loopback server, changes no header and keeps nothing in the site's storage (N-43, N-44)", () => {
    const files = readdirSync(SRC).filter((f) => f.endsWith(".ts") && f !== "chrome.d.ts");
    const using = (re: RegExp) => files.filter((f) => re.test(code(f))).sort();
    expect(using(/\bfetch\(/)).toEqual(["worker.ts"]);
    // Both requests in the worker go to `(await server()) + <a checked /__crt/ path>`.
    expect(code("worker.ts").match(/\bfetch\(([^,]+),/g)).toEqual(["fetch((await server()) + path,", "fetch((await server()) + open.path,"]);
    expect(using(/declarativeNetRequest|webRequest|\bcookies\b|XMLHttpRequest|WebSocket|sendBeacon/)).toEqual([]);
    expect(using(/\b(localStorage|sessionStorage)\b/)).toEqual([]);
    expect(using(/https?:\/\/(?!localhost)/)).toEqual([]);
  });
});

describe("the rules the content script and the worker share (PRD-extension §5.3, §5.4)", () => {
  it("takes a CRT server on a loopback host and nothing else (N-43)", () => {
    expect(DEFAULT_SERVER).toBe("http://localhost:4400");
    expect(loopbackServer("http://localhost:4401")).toBe("http://localhost:4401");
    expect(loopbackServer(" http://127.0.0.1:4400/x ")).toBe("http://127.0.0.1:4400");
    expect(loopbackServer("https://app.localhost:4400")).toBe("https://app.localhost:4400");
    for (const bad of ["http://example.com:4400", "http://192.168.1.4:4400", "http://localhost.evil.com:4400", "ftp://localhost", "localhost:4400x", "", null, 4400, undefined]) expect(loopbackServer(bad), String(bad)).toBeNull();
    expect(serverForPort("4401")).toBe("http://localhost:4401");
    expect(serverForPort(4400)).toBe("http://localhost:4400");
    for (const bad of ["0", "65536", "44o1", "", "-1", "http://evil.com", 1.5]) expect(serverForPort(bad), String(bad)).toBeNull();
  });

  it("requests a /__crt/ route for a page and never an internal one or anything that leaves the origin (F-157, N-42)", () => {
    for (const path of [routes.HEALTH_PATH, routes.CAPTURES_PATH + "/", `${routes.SESSIONS_PATH}/s1/events?after=3`, routes.PROVIDERS_PATH + "?refresh=1"]) {
      if (path.startsWith("/__crt/")) expect(isCrtApiPath(path), path).toBe(true);
    }
    expect(isCrtApiPath(routes.HEALTH_PATH)).toBe(true);
    for (const bad of [routes.SHUTDOWN_PATH, routes.INTERNAL_WRITE_TASK_PATH, routes.INTERNAL_BROWSE_PATH, "/__crt", "/", "//evil.com/__crt/health", "/__crt/../etc", "/__crt//evil.com", "http://evil.com/__crt/health", "/__crt/a b", "/__crt/a\\b", null, 1]) {
      expect(isCrtApiPath(bad), String(bad)).toBe(false);
    }
  });

  it("turns a site on by its exact origin: the registration carries the port, the permission the host (F-155)", () => {
    expect(siteOf("http://localhost:3000/shop?x=1#y")).toBe("http://localhost:3000");
    expect(siteOf("https://staging.example.com/")).toBe("https://staging.example.com");
    for (const bad of ["chrome://extensions", "about:blank", "file:///c:/x.html", "chrome-extension://abc/options.html", "", undefined]) expect(siteOf(bad), String(bad)).toBeNull();
    expect(sitePatterns("http://localhost:3000")).toEqual({ permission: "http://localhost/*", match: "http://localhost:3000/*" });
    expect(sitePatterns("https://staging.example.com")).toEqual({ permission: "https://staging.example.com/*", match: "https://staging.example.com/*" });

    const scripts = siteScripts("http://localhost:3000");
    expect(scripts).toEqual([
      { id: `${PROBE_ID}http://localhost:3000`, matches: ["http://localhost:3000/*"], js: ["probe.js"], world: "MAIN", runAt: "document_start", allFrames: false, persistAcrossSessions: true },
      { id: `${CONTENT_ID}http://localhost:3000`, matches: ["http://localhost:3000/*"], js: ["content.js"], world: "ISOLATED", runAt: "document_start", allFrames: false, persistAcrossSessions: true },
    ]);
    // The registrations are the record of which sites are on.
    expect(sitesOf([...scripts, ...siteScripts("https://staging.example.com")])).toEqual(["http://localhost:3000", "https://staging.example.com"]);
    expect(sitesOf([])).toEqual([]);
  });

  it("mounts only against a server of its own major.minor, and says the command that fixes it otherwise (N-45)", () => {
    expect(sameMinor("0.10.0", "0.10.3")).toBe(true);
    expect(sameMinor("0.10.0", "0.11.0")).toBe(false);
    expect(sameMinor("1.10.0", "0.10.0")).toBe(false);
    for (const bad of [null, undefined, "", "0.10", "dev"]) expect(sameMinor("0.10.0", bad), String(bad)).toBe(false);
    expect(mismatchLine("0.10.0", "0.11.2")).toBe("CRT extension 0.10.0 and CRT server 0.11.2 do not match — run `crt extension`, then Reload it in chrome://extensions");
    expect(mismatchLine("0.10.0", null)).toContain("CRT server (unknown version)");
  });

  it("reads a session stream as it arrives: events split across chunks, named events, ids kept, comments dropped (F-25, F-157)", () => {
    const p = sseParser();
    expect(p.push("id: 1\ndata: {\"a\":")).toEqual([]);
    expect(p.push("1}\n\n: keep-alive\n\nevent: live\ndata: \n\n")).toEqual([
      { type: "message", id: "1", data: '{"a":1}' },
      { type: "live", id: "1", data: "" },
    ]);
    expect(p.push("id: 2\r\ndata: x\r\ndata: y\r\n\r\nretry: 10\n\ndata:z\n\n")).toEqual([
      { type: "message", id: "2", data: "x\ny" },
      { type: "message", id: "2", data: "z" },
    ]);
    expect(p.lastId()).toBe("2");
  });
});

describe("what the page's world says is data (PRD-extension N-42)", () => {
  const entry = { level: "error", message: "boom", stack: null, timestamp: "2026-11-17T00:00:00.000Z", url: "http://localhost:3000/" };
  const failure = { method: "GET", url: "/api", status: 500, error: null, via: "fetch", durationMs: 3, timestamp: "2026-11-17T00:00:00.000Z" };

  it("keeps the entries that fit the capture schema and drops the rest, to the logs' own limits (F-20, F-21, N-42)", () => {
    expect(cleaners.console([entry, { ...entry, level: "shout" }, { message: "x" }, "send()", null, { ...entry, message: "y".repeat(2001) }])).toEqual([entry]);
    expect(cleaners.console("not a list")).toEqual([]);
    expect(cleaners.console(Array.from({ length: 80 }, (_, i) => ({ ...entry, message: String(i) })))).toHaveLength(50);
    expect(cleaners.network([failure, { ...failure, via: "beacon" }, { ...failure, status: "500" }])).toEqual([failure]);
  });

  it("gives the unknown value for a component or framework answer of the wrong shape (F-18, F-22, N-42)", () => {
    const source = { file: "src/Cart.tsx", line: 12, column: 3, via: "debug_source" };
    const good = { framework: "react", components: [{ name: "Cart", kind: "function" }], source: null };
    expect(cleaners.components(good)).toEqual(good);
    expect(cleaners.components({ framework: "ember", components: [{ name: "Cart", kind: "function" }, { name: 1 }, "x"], source: { file: 1 } })).toEqual({ framework: "unknown", components: [{ name: "Cart", kind: "function" }], source: null });
    expect(cleaners.components({ ...good, components: Array.from({ length: 9 }, (_, i) => ({ name: `C${i}`, kind: "function" })) }).components).toHaveLength(5);
    expect(cleaners.components(null)).toEqual(UNKNOWN_COMPONENTS);
    expect(cleaners.components({ ...good, source }).source === null || cleaners.components({ ...good, source }).source!.file === "src/Cart.tsx").toBe(true);
    const fw = { name: "next", version: "15.0.0", bundler: "webpack", route: "/shop", hints: ["window.next"] };
    expect(cleaners.framework(fw)).toEqual(fw);
    expect(cleaners.framework({ ...fw, hints: "window.next" })).toEqual(UNKNOWN_FRAMEWORK);
    expect(cleaners.framework(undefined)).toEqual(UNKNOWN_FRAMEWORK);
  });
});
