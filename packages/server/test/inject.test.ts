import { brotliCompressSync, deflateRawSync, deflateSync, gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  decodeBody,
  filterAcceptEncoding,
  injectOverlayTag,
  isHtml,
  OVERLAY_TAG,
  relaxCsp,
} from "../src/inject.js";

describe("injectOverlayTag (F-2)", () => {
  it("inserts before </head> when present", () => {
    const out = injectOverlayTag("<html><head><title>x</title></head><body></body></html>");
    expect(out).toBe(`<html><head><title>x</title>${OVERLAY_TAG}</head><body></body></html>`);
  });

  it("falls back to </body>", () => {
    const out = injectOverlayTag("<html><body><p>hi</p></body></html>");
    expect(out).toBe(`<html><body><p>hi</p>${OVERLAY_TAG}</body></html>`);
  });

  it("appends when neither tag exists", () => {
    expect(injectOverlayTag("<p>fragment</p>")).toBe(`<p>fragment</p>${OVERLAY_TAG}`);
  });

  it("is case-insensitive and tolerates whitespace in the closing tag", () => {
    const out = injectOverlayTag("<HTML><HEAD></HEAD ><BODY></BODY></HTML>");
    expect(out).toBe(`<HTML><HEAD>${OVERLAY_TAG}</HEAD ><BODY></BODY></HTML>`);
  });

  it("is idempotent", () => {
    const once = injectOverlayTag("<head></head>");
    expect(injectOverlayTag(once)).toBe(once);
  });
});

describe("isHtml (F-2)", () => {
  it("matches text/html with or without parameters", () => {
    expect(isHtml("text/html")).toBe(true);
    expect(isHtml("text/html; charset=utf-8")).toBe(true);
    expect(isHtml("TEXT/HTML")).toBe(true);
  });
  it("rejects other types and missing headers", () => {
    expect(isHtml("application/json")).toBe(false);
    expect(isHtml("text/htmlx")).toBe(false);
    expect(isHtml(undefined)).toBe(false);
  });
});

describe("decodeBody (F-2)", () => {
  const html = Buffer.from("<html><head></head><body>ünïcödé</body></html>");
  it("decodes gzip, br and deflate (zlib and raw)", () => {
    expect(decodeBody(gzipSync(html), "gzip")).toEqual(html);
    expect(decodeBody(gzipSync(html), "x-gzip")).toEqual(html);
    expect(decodeBody(brotliCompressSync(html), "br")).toEqual(html);
    expect(decodeBody(deflateSync(html), "deflate")).toEqual(html);
    expect(decodeBody(deflateRawSync(html), "deflate")).toEqual(html);
  });
  it("passes identity through and returns null for unknown encodings", () => {
    expect(decodeBody(html, undefined)).toBe(html);
    expect(decodeBody(html, "identity")).toBe(html);
    expect(decodeBody(html, "zstd")).toBeNull();
  });
});

describe("filterAcceptEncoding (F-2)", () => {
  it("keeps only encodings we can decode", () => {
    expect(filterAcceptEncoding("gzip, deflate, br, zstd")).toBe("gzip, deflate, br");
    expect(filterAcceptEncoding("zstd;q=1.0, gzip;q=0.5")).toBe("gzip");
  });
  it("returns identity when nothing usable is requested, and undefined when absent", () => {
    expect(filterAcceptEncoding("zstd")).toBe("identity");
    expect(filterAcceptEncoding(undefined)).toBeUndefined();
  });
});

describe("relaxCsp (F-2)", () => {
  it("adds 'self' to script-src when missing", () => {
    expect(relaxCsp("default-src 'none'; script-src 'nonce-abc'")).toBe(
      "default-src 'none'; script-src 'nonce-abc' 'self'",
    );
  });
  it("leaves policies that already allow self or * alone", () => {
    expect(relaxCsp("script-src 'self' https://cdn")).toBe("script-src 'self' https://cdn");
    expect(relaxCsp("script-src *")).toBe("script-src *");
  });
  it("adds a script-src when only default-src governs scripts", () => {
    expect(relaxCsp("default-src 'none'")).toBe("default-src 'none'; script-src 'none' 'self'");
  });
  it("prefers script-src-elem when present", () => {
    expect(relaxCsp("script-src 'none'; script-src-elem 'nonce-x'")).toBe(
      "script-src 'none'; script-src-elem 'nonce-x' 'self'",
    );
  });
});
