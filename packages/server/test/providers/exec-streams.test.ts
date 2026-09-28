import { once } from "node:events";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { type Executable, LineBuffer, lineReader, parseJsonLine, spawnProvider, STDERR_TAIL_LINES, StderrTail } from "../../src/providers/exec.js";

// The process plumbing every CLI driver shares (PRD-providers F-53, F-54, F-111, N-7, N-10): how an
// agent is started, how its stdout becomes lines and JSON objects, and how its stderr is kept.

const node: Executable = { command: process.execPath, args: [], via: "path", found: process.execPath };

describe("lineReader (F-53)", () => {
  it("joins lines split across chunks and delivers each once", () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    lineReader(stream, (l) => lines.push(l));
    stream.write('{"type":"a"');
    stream.write('}\n{"type"');
    expect(lines).toEqual(['{"type":"a"}']);
    stream.write(':"b"}\nthird\n');
    expect(lines).toEqual(['{"type":"a"}', '{"type":"b"}', "third"]);
  });

  it("drops the \\r of CRLF endings, even when the \\n comes in the next chunk", () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    lineReader(stream, (l) => lines.push(l));
    stream.write("one\r\ntwo\r");
    stream.write("\n\r\n");
    expect(lines).toEqual(["one", "two", ""]);
  });

  it("delivers a final line with no newline when the stream ends, and drops a blank rest", async () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    lineReader(stream, (l) => lines.push(l));
    stream.end("done\nlast");
    await once(stream, "end");
    expect(lines).toEqual(["done", "last"]);

    const blank = new PassThrough();
    const none: string[] = [];
    lineReader(blank, (l) => none.push(l));
    blank.end("x\n  ");
    await once(blank, "end");
    expect(none).toEqual(["x"]);
  });

  it("decodes a UTF-8 character split across chunks", () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    lineReader(stream, (l) => lines.push(l));
    const bytes = Buffer.from("café — ok\n", "utf8");
    stream.write(bytes.subarray(0, 4));
    stream.write(bytes.subarray(4));
    expect(lines).toEqual(["café — ok"]);
  });

  it("flush() hands over the rest once, for drivers that see exit before end", () => {
    const lines: string[] = [];
    const buffer = new LineBuffer((l) => lines.push(l));
    buffer.push("a\nb");
    buffer.flush();
    buffer.flush();
    expect(lines).toEqual(["a", "b"]);
    expect(() => lineReader(null, () => undefined).flush()).not.toThrow();
  });
});

describe("parseJsonLine (F-53)", () => {
  it("returns the object on a line, trimmed", () => {
    expect(parseJsonLine('  {"type":"turn.started"}\r')).toEqual({ type: "turn.started" });
    expect(parseJsonLine('{"jsonrpc":"2.0","id":1,"result":null}')).toEqual({ jsonrpc: "2.0", id: 1, result: null });
  });

  it("returns null for anything that is not one JSON object, and never throws", () => {
    for (const line of ["", "   ", "not json", "2026-09-15T10:00:00Z INFO codex", "[1,2]", "null", '"text"', "{broken", '{"a":1} trailing']) {
      expect(parseJsonLine(line)).toBeNull();
    }
  });
});

describe("StderrTail (N-7)", () => {
  it("keeps the last 30 non-blank lines of what arrived, CRLF or not", () => {
    const tail = new StderrTail();
    expect(tail.push("first\r\n\r\n  \nsecond\n")).toEqual(["first", "second"]);
    for (let i = 0; i < STDERR_TAIL_LINES; i++) tail.push(`line ${i}\n`);
    expect(STDERR_TAIL_LINES).toBe(30);
    expect(tail.lines()).toHaveLength(30);
    expect(tail.lines()[0]).toBe("line 0");
    expect(tail.lines().at(-1)).toBe("line 29");
  });

  it("brief() is the last lines that are not noise; noise still counts in lines()", () => {
    const tail = new StderrTail(/^\d{4}-\d\d-\d\dT/);
    tail.push("Error: bad flag\n2026-09-15T10:00:00Z WARN retrying\nusage: codex exec\n2026-09-15T10:00:01Z INFO bye\n");
    expect(tail.brief()).toBe("Error: bad flag | usage: codex exec");
    expect(tail.brief(1)).toBe("usage: codex exec");
    expect(tail.lines()).toHaveLength(4);
    expect(new StderrTail(/^warning:/i).brief()).toBe("");
    const plain = new StderrTail();
    plain.push("a\nb\nc");
    expect(plain.brief()).toBe("b | c");
  });

  it("lines() is a copy", () => {
    const tail = new StderrTail();
    tail.push("x");
    tail.lines().push("y");
    expect(tail.lines()).toEqual(["x"]);
  });
});

describe("spawnProvider (N-10)", () => {
  it("runs exe + args without a shell, with piped stdio, cwd and env", async () => {
    const script = [
      'process.stdout.write(JSON.stringify({ cwd: process.cwd(), marker: process.env.CRT_TEST_MARKER, argv: process.argv.slice(1) }) + "\\r\\n");',
      'process.stderr.write("warn one\\nwarn two\\n");',
      'process.stdin.on("data", (d) => process.stdout.write("echo " + d));',
    ].join("\n");
    const child = spawnProvider({ ...node, args: ["-e", script] }, ["flag", "a b"], { cwd: tmpdir(), env: { ...process.env, CRT_TEST_MARKER: "m" } });
    const lines: string[] = [];
    lineReader(child.stdout, (l) => lines.push(l));
    const stderr = new StderrTail();
    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (c: string) => stderr.push(c));
    child.stdin?.end("ping");
    const [code] = (await once(child, "close")) as [number | null];
    expect(code).toBe(0);
    const first = parseJsonLine(lines[0] ?? "");
    expect(first).toMatchObject({ marker: "m", argv: ["flag", "a b"] });
    expect(realpathSync.native(String(first?.cwd))).toBe(realpathSync.native(tmpdir()));
    expect(lines[1]).toBe("echo ping");
    expect(stderr.lines()).toEqual(["warn one", "warn two"]);
  });
});
