import { describe, expect, it } from "vitest";
import { CrtError } from "../src/errors.js";
import { bindPort, chooseTarget, type CrtHealth, isYes, type PortInput, type Prompter, sameProject, since, type StartDeps, type TargetInput, type WaitOutcome } from "../src/start.js";
import type { ProbeHit } from "../src/target.js";

// PRD-setup §5.1 / F-90: every §6.1 transcript (F-70…F-73, F-79) as a row over the pure state
// machine with stubbed probes and a scripted prompter, interactive and `--yes` (non-interactive).

const PORTS = [3000, 5173, 8080, 4200, 8000, 3001] as const;
const L3000 = "http://localhost:3000";
const L3100 = "http://localhost:3100";
const L5173 = "http://localhost:5173";

interface World {
  interactive: boolean;
  /** Origins that answer HTTP. */
  up?: string[];
  /** What `probeAll` finds (defaults to the `up` origins on the well-known ports, unlabelled). */
  hits?: ProbeHit[];
  /** Scripted answers, consumed in order: strings for `ask`, outcomes for `waitFor`. */
  answers?: Array<string | WaitOutcome>;
  /** Ports that cannot be bound. */
  busy?: number[];
  /** Health per busy port; a busy port without one is "not a CRT". */
  health?: Record<number, CrtHealth>;
  /** `replace(port)` fails with this reason. */
  replaceFails?: string;
}

interface Run {
  deps: StartDeps;
  logs: string[];
  questions: string[];
  waits: string[];
  replaced: number[];
  bound: number[];
  beforePrompt: number;
}

function world(w: World): Run {
  const up = new Set(w.up ?? []);
  const busy = new Set(w.busy ?? []);
  const answers = [...(w.answers ?? [])];
  const run: Run = { logs: [], questions: [], waits: [], replaced: [], bound: [], beforePrompt: 0, deps: undefined as unknown as StartDeps };
  const prompt: Prompter = {
    ask: async (q) => {
      run.questions.push(q);
      const a = answers.shift();
      if (typeof a !== "string") throw new Error(`no scripted answer for ${JSON.stringify(q)}`);
      return a;
    },
    waitFor: async (line, check) => {
      run.waits.push(line);
      const a = answers.shift();
      if (typeof a !== "object") throw new Error(`no scripted wait outcome for ${JSON.stringify(line)}`);
      // A `ready` outcome means the re-probe saw it come up: make it so.
      if (a.kind === "ready") {
        const origin = line.slice(0, line.indexOf(" "));
        up.add(origin);
        expect(await check()).toBe(true);
      }
      return a;
    },
  };
  run.deps = {
    interactive: w.interactive,
    log: (line) => run.logs.push(line),
    prompt,
    isReachable: async (origin) => up.has(origin),
    probeAll: async () => w.hits ?? PORTS.map((p) => `http://localhost:${p}`).filter((o) => up.has(o)).map((origin) => ({ origin, label: null })),
    health: async (port) => w.health?.[port] ?? null,
    isFree: async (port) => !busy.has(port),
    listen: async (port) => {
      if (busy.has(port)) return "in-use";
      run.bound.push(port);
      return "ok";
    },
    replace: async (port) => {
      run.replaced.push(port);
      if (w.replaceFails) return { ok: false, reason: w.replaceFails };
      busy.delete(port);
      return { ok: true };
    },
    beforePrompt: async () => {
      run.beforePrompt++;
    },
  };
  return run;
}

const target = (over: Partial<TargetInput> = {}): TargetInput => ({ positional: null, flag: null, config: { target: null, source: null }, hasDevScript: false, ports: PORTS, ...over });
const port = (over: Partial<PortInput> = {}): PortInput => ({ port: 4400, explicit: false, replace: false, projectRoot: "C:\\my-app", target: L3000, version: "0.3.0", open: true, ...over });
const mine = (over: Partial<CrtHealth> = {}): CrtHealth => ({ version: "0.3.0", startedAt: "2026-09-16T09:12:00+08:00", target: L3000, projectRoot: "C:\\my-app", sessions: 1, ...over });
const other = (over: Partial<CrtHealth> = {}): CrtHealth => mine({ target: L5173, projectRoot: "C:\\other-app", ...over });

const NO_DEV_SERVER = "no dev server found on ports 3000, 5173, 8080, 4200, 8000, 3001 — start it, or run `crt <port>`";
const WAIT_3100 = "http://localhost:3100 is not responding yet — start it, then press Enter to retry (type another URL to change, Ctrl+C to quit)";

async function fails(p: Promise<unknown>, message: string, exitCode = 1): Promise<void> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(CrtError);
  expect((err as CrtError).message).toBe(message);
  expect((err as CrtError).exitCode).toBe(exitCode);
}

describe("chooseTarget — explicit targets (F-71, F-72)", () => {
  it.each([
    ["positional", { positional: "3100" }, "positional", true],
    ["--target flag", { flag: "localhost:3100" }, "flag", false],
    ["remembered (config.local.json)", { config: { target: L3100, source: "local" as const } }, "local", false],
    [".crt/config.json", { config: { target: "3100", source: "project" as const } }, "project", false],
  ])("%s that responds is used at once, no prompt, no probe; only the positional is remembered", async (_name, input, source, remember) => {
    for (const interactive of [true, false]) {
      const r = world({ interactive, up: [L3100, L3000] });
      expect(await chooseTarget(target(input), r.deps)).toEqual({ origin: L3100, source, remember });
      expect(r.logs).toEqual([]);
      expect(r.questions).toEqual([]);
      expect(r.beforePrompt).toBe(0);
    }
  });

  it("positional or --target wins over the config files (F-71 order)", async () => {
    const r = world({ interactive: false, up: [L3100, L3000] });
    expect(await chooseTarget(target({ positional: "3100", flag: "3000", config: { target: L3000, source: "local" } }), r.deps)).toMatchObject({ origin: L3100, source: "positional" });
    expect(await chooseTarget(target({ flag: "3100", config: { target: L3000, source: "local" } }), r.deps)).toMatchObject({ origin: L3100, source: "flag" });
  });

  it("a value that is not a URL fails with the F-1 line before any probe", async () => {
    const r = world({ interactive: true });
    await fails(chooseTarget(target({ positional: "http://" }), r.deps), 'target "http://" is not a valid URL — use e.g. --target http://localhost:3000');
    await fails(chooseTarget(target({ config: { target: "ftp://x", source: "project" } }), r.deps), 'target "ftp://x" must be http:// or https://');
  });

  it("--yes: an explicit or remembered target that is down fails with the F-71 line", async () => {
    const r = world({ interactive: false, up: [L3000] });
    await fails(chooseTarget(target({ config: { target: L3100, source: "local" } }), r.deps), "target http://localhost:3100 is not responding — start your dev server there, or run `crt <port>`");
    expect(r.questions).toEqual([]);
  });

  it("interactive: a remembered target that is down while another answers offers the other; Y uses it without remembering (F-71, F-72)", async () => {
    const r = world({ interactive: true, up: [L3000], answers: [""] });
    expect(await chooseTarget(target({ config: { target: L3100, source: "local" } }), r.deps)).toEqual({ origin: L3000, source: "alternative", remember: false });
    expect(r.questions).toEqual(["http://localhost:3100 (remembered) is not responding, but http://localhost:3000 is. Use 3000? [Y/n]"]);
    expect(r.beforePrompt).toBe(1);
    // `n` → the wait loop on the remembered target; Enter after starting it → still not remembered again.
    const n = world({ interactive: true, up: [L3000], answers: ["n", { kind: "ready" }] });
    expect(await chooseTarget(target({ config: { target: L3100, source: "local" } }), n.deps)).toEqual({ origin: L3100, source: "local", remember: false });
    expect(n.waits).toEqual([WAIT_3100]);
    // A .crt/config.json value is labelled as such; a positional gets no label.
    const p = world({ interactive: true, up: [L3000], answers: ["y"] });
    await chooseTarget(target({ config: { target: L3100, source: "project" } }), p.deps);
    expect(p.questions[0]).toBe("http://localhost:3100 (.crt/config.json) is not responding, but http://localhost:3000 is. Use 3000? [Y/n]");
    const q = world({ interactive: true, up: [L3000], answers: ["yes"] });
    await chooseTarget(target({ positional: "3100" }), q.deps);
    expect(q.questions[0]).toBe("http://localhost:3100 is not responding, but http://localhost:3000 is. Use 3000? [Y/n]");
  });

  it("interactive: a positional that is down waits for it, then remembers it (F-71 wait loop, F-72)", async () => {
    const r = world({ interactive: true, answers: [{ kind: "ready" }] });
    expect(await chooseTarget(target({ positional: "3100" }), r.deps)).toEqual({ origin: L3100, source: "positional", remember: true });
    expect(r.questions).toEqual([]);
    expect(r.waits).toEqual([WAIT_3100]);
  });
});

describe("chooseTarget — probing (F-71, F-72)", () => {
  it("one responder → `Found …`, used, not remembered (both modes)", async () => {
    for (const interactive of [true, false]) {
      const r = world({ interactive, up: [L5173] });
      expect(await chooseTarget(target(), r.deps)).toEqual({ origin: L5173, source: "probe", remember: false });
      expect(r.logs).toEqual(["Found http://localhost:5173."]);
      expect(r.questions).toEqual([]);
    }
  });

  it("several responders, --yes → the first and the `crt:` line", async () => {
    const r = world({ interactive: false, up: [L3000, L5173] });
    expect(await chooseTarget(target(), r.deps)).toEqual({ origin: L3000, source: "probe", remember: false });
    expect(r.logs).toEqual(["crt: found 2 dev servers (http://localhost:3000, http://localhost:5173); using http://localhost:3000 — run `crt <port>` to pick another"]);
  });

  it("several responders, interactive → numbered list with labels, `Which one? [1]`, the pick is remembered", async () => {
    const hits = [
      { origin: L3000, label: "Trial app" },
      { origin: L5173, label: null },
    ];
    const r = world({ interactive: true, hits, answers: ["2"] });
    expect(await chooseTarget(target(), r.deps)).toEqual({ origin: L5173, source: "picked", remember: true });
    expect(r.logs).toEqual(["Found 2 dev servers:", "  1) http://localhost:3000 — Trial app", "  2) http://localhost:5173"]);
    expect(r.questions).toEqual(["Which one? [1]"]);
    expect(r.beforePrompt).toBe(1);
    // Enter → 1; out of range or not a number → re-asked.
    const d = world({ interactive: true, hits, answers: ["9", "x", ""] });
    expect(await chooseTarget(target(), d.deps)).toEqual({ origin: L3000, source: "picked", remember: true });
    expect(d.questions).toEqual(["Which one? [1]", "Which one? [1]", "Which one? [1]"]);
    expect(d.logs.filter((l) => l === "Answer 1–2.")).toHaveLength(2);
  });

  it("nothing found, --yes → the F-71 line (today's line with the new hint)", async () => {
    const r = world({ interactive: false });
    await fails(chooseTarget(target(), r.deps), NO_DEV_SERVER);
  });

  it("nothing found, interactive → the prompt with the dev-script hint, validation, then remembered (F-71, F-72)", async () => {
    const r = world({ interactive: true, up: [L3100], answers: ["", "abc", "3100"] });
    expect(await chooseTarget(target({ hasDevScript: true }), r.deps)).toEqual({ origin: L3100, source: "typed", remember: true });
    expect(r.logs).toEqual(["No dev server on ports 3000, 5173, 8080, 4200, 8000, 3001.", "(This project has `npm run dev`.)", '"abc" is not a URL or port — try 3000, localhost:3000 or http://…']);
    expect(r.questions).toEqual(["Dev server URL or port:", "Dev server URL or port:", "Dev server URL or port:"]);
    expect(r.beforePrompt).toBe(1);
    const plain = world({ interactive: true, up: [L3100], answers: ["localhost:3100"] });
    await chooseTarget(target(), plain.deps);
    expect(plain.logs).toEqual(["No dev server on ports 3000, 5173, 8080, 4200, 8000, 3001."]);
  });

  it("typed target not up yet → wait loop: ready on its own, Enter retries, another URL switches, junk is refused", async () => {
    // Re-probe sees it come up.
    const ready = world({ interactive: true, answers: ["3100", { kind: "ready" }] });
    expect(await chooseTarget(target(), ready.deps)).toEqual({ origin: L3100, source: "typed", remember: true });
    expect(ready.waits).toEqual([WAIT_3100]);
    // Enter while still down → the line again; Enter once up → done.
    const enter = world({ interactive: true, answers: ["3100", { kind: "answer", text: "" }, { kind: "ready" }] });
    expect(await chooseTarget(target(), enter.deps)).toEqual({ origin: L3100, source: "typed", remember: true });
    expect(enter.waits).toEqual([WAIT_3100, WAIT_3100]);
    // Another URL that is up → switched and remembered.
    const change = world({ interactive: true, up: [L5173], hits: [], answers: ["3100", { kind: "answer", text: "5173" }] });
    expect(await chooseTarget(target(), change.deps)).toEqual({ origin: L5173, source: "typed", remember: true });
    // Another URL that is down → waited on instead.
    const changeDown = world({ interactive: true, answers: ["3100", { kind: "answer", text: "5173" }, { kind: "ready" }] });
    expect(await chooseTarget(target(), changeDown.deps)).toEqual({ origin: L5173, source: "typed", remember: true });
    expect(changeDown.waits[1]).toBe("http://localhost:5173 is not responding yet — start it, then press Enter to retry (type another URL to change, Ctrl+C to quit)");
    // Junk → the validation line and the wait line again.
    const junk = world({ interactive: true, answers: ["3100", { kind: "answer", text: "abc" }, { kind: "ready" }] });
    await chooseTarget(target(), junk.deps);
    expect(junk.logs).toContain('"abc" is not a URL or port — try 3000, localhost:3000 or http://…');
    expect(junk.waits).toHaveLength(2);
  });

  it("Ctrl+C at a prompt propagates as `cancelled`, exit 130 (F-77)", async () => {
    const r = world({ interactive: true });
    r.deps.prompt.ask = () => Promise.reject(new CrtError("cancelled", 130));
    await fails(chooseTarget(target(), r.deps), "cancelled", 130);
  });
});

describe("bindPort — a busy port is diagnosed (F-73, F-79)", () => {
  it("a free port is bound, nothing said (F-73)", async () => {
    const r = world({ interactive: true });
    expect(await bindPort(port(), r.deps)).toEqual({ kind: "bound", port: 4400 });
    expect(r.logs).toEqual([]);
    expect(r.bound).toEqual([4400]);
  });

  it("held by a CRT for this project and target → reuse, exit path, both modes, whether or not --port was given", async () => {
    for (const interactive of [true, false]) {
      for (const explicit of [false, true]) {
        const r = world({ interactive, busy: [4400], health: { 4400: mine() } });
        const out = await bindPort(port({ explicit }), r.deps);
        expect(out).toMatchObject({ kind: "reused", port: 4400, url: "http://localhost:4400" });
        expect(r.logs).toHaveLength(1);
        expect(r.logs[0]).toMatch(/^CRT 0\.3\.0 is already serving http:\/\/localhost:3000 for this project at http:\/\/localhost:4400 \(since \d\d:\d\d\) — opened it\.$/);
        expect(r.questions).toEqual([]);
        expect(r.bound).toEqual([]);
      }
    }
    const noOpen = world({ interactive: false, busy: [4400], health: { 4400: mine({ startedAt: null }) } });
    await bindPort(port({ open: false }), noOpen.deps);
    expect(noOpen.logs).toEqual(["CRT 0.3.0 is already serving http://localhost:3000 for this project at http://localhost:4400 — open it in your browser."]);
  });

  it("same project, older version: interactive asks to replace (Y replaces, n reuses); --yes reuses and says so", async () => {
    const yes = world({ interactive: true, busy: [4400], health: { 4400: mine({ version: "0.2.0" }) }, answers: [""] });
    expect(await bindPort(port(), yes.deps)).toEqual({ kind: "bound", port: 4400 });
    expect(yes.questions).toEqual(["That is CRT 0.2.0; this is 0.3.0. Replace it? [Y/n]"]);
    expect(yes.replaced).toEqual([4400]);
    expect(yes.logs).toEqual(["Stopped CRT 0.2.0 on port 4400."]);
    expect(yes.beforePrompt).toBe(1);
    const no = world({ interactive: true, busy: [4400], health: { 4400: mine({ version: "0.2.0" }) }, answers: ["n"] });
    expect(await bindPort(port(), no.deps)).toMatchObject({ kind: "reused" });
    expect(no.replaced).toEqual([]);
    const auto = world({ interactive: false, busy: [4400], health: { 4400: mine({ version: "0.2.0" }) } });
    expect(await bindPort(port(), auto.deps)).toMatchObject({ kind: "reused" });
    expect(auto.logs[1]).toBe("crt: that is CRT 0.2.0, this is 0.3.0 — run `crt --replace` to swap it");
  });

  it("held by another CRT, --yes → the next free port in 4401…4409 with the `crt:` line", async () => {
    const r = world({ interactive: false, busy: [4400], health: { 4400: other() } });
    expect(await bindPort(port(), r.deps)).toEqual({ kind: "bound", port: 4401 });
    expect(r.logs).toEqual(["crt: port 4400 is held by another CRT (→ http://localhost:5173, project C:\\other-app); using 4401"]);
    const two = world({ interactive: false, busy: [4400, 4401], health: { 4400: other() } });
    expect(await bindPort(port(), two.deps)).toEqual({ kind: "bound", port: 4402 });
    expect(two.logs).toEqual(["crt: port 4400 is held by another CRT (→ http://localhost:5173, project C:\\other-app); using 4402"]);
  });

  it("held by another CRT, interactive → the three-way question; 1 steps (the default), 2 replaces, 3 quits", async () => {
    const step = world({ interactive: true, busy: [4400], health: { 4400: other() }, answers: [""] });
    expect(await bindPort(port(), step.deps)).toEqual({ kind: "bound", port: 4401 });
    expect(step.logs[0]).toMatch(/^Port 4400 is held by another CRT: → http:\/\/localhost:5173, project C:\\other-app, since \d\d:\d\d, 1 session open\.$/);
    expect(step.logs[1]).toBe("1) Start this one on 4401  2) Replace it  3) Quit");
    expect(step.questions).toEqual(["Which? [1]"]);
    expect(step.beforePrompt).toBe(1);
    // The option names the port that is actually free.
    const busyNext = world({ interactive: true, busy: [4400, 4401], health: { 4400: other({ sessions: 2, startedAt: null }) }, answers: ["1"] });
    expect(await bindPort(port(), busyNext.deps)).toEqual({ kind: "bound", port: 4402 });
    expect(busyNext.logs[0]).toBe("Port 4400 is held by another CRT: → http://localhost:5173, project C:\\other-app, 2 sessions open.");
    expect(busyNext.logs[1]).toBe("1) Start this one on 4402  2) Replace it  3) Quit");
    const replace = world({ interactive: true, busy: [4400], health: { 4400: other() }, answers: ["x", "2"] });
    expect(await bindPort(port(), replace.deps)).toEqual({ kind: "bound", port: 4400 });
    expect(replace.replaced).toEqual([4400]);
    expect(replace.logs).toContain("Answer 1, 2 or 3.");
    const quit = world({ interactive: true, busy: [4400], health: { 4400: other() }, answers: ["3"] });
    await fails(bindPort(port(), quit.deps), "cancelled", 130);
  });

  it("not a CRT, --yes → the next free port with the `crt:` line", async () => {
    const r = world({ interactive: false, busy: [4400] });
    expect(await bindPort(port(), r.deps)).toEqual({ kind: "bound", port: 4401 });
    expect(r.logs).toEqual(["crt: port 4400 is in use by a process that is not CRT; using 4401"]);
  });

  it("not a CRT, interactive → `Start on 4401 instead? [Y/n]`; n stops with the fix", async () => {
    const yes = world({ interactive: true, busy: [4400], answers: [""] });
    expect(await bindPort(port(), yes.deps)).toEqual({ kind: "bound", port: 4401 });
    expect(yes.questions).toEqual(["Port 4400 is in use by something that is not CRT. Start on 4401 instead? [Y/n]"]);
    const no = world({ interactive: true, busy: [4400], answers: ["n"] });
    await fails(bindPort(port(), no.deps), "port 4400 is in use by a process that is not CRT — stop it, or run `crt --port 4401`");
  });

  it("an explicit --port is never stepped around: the F-1 line, extended with what health found (F-73)", async () => {
    const plain = world({ interactive: true, busy: [4400] });
    await fails(bindPort(port({ explicit: true }), plain.deps), "port 4400 is already in use by a process that is not CRT — stop the other process or pass --port <n>");
    const crt = world({ interactive: false, busy: [4400], health: { 4400: other({ version: "0.1.0" }) } });
    await fails(bindPort(port({ explicit: true }), crt.deps), "port 4400 is already in use by CRT 0.1.0 (→ http://localhost:5173, project C:\\other-app) — stop the other process, run `crt --replace`, or pass --port <n>");
    expect(crt.questions).toEqual([]);
    expect(crt.bound).toEqual([]);
  });

  it("--replace stops any CRT on the port through F-79, then binds it; failures print the line with the reason", async () => {
    for (const health of [mine(), other()]) {
      const r = world({ interactive: false, busy: [4400], health: { 4400: health } });
      expect(await bindPort(port({ replace: true }), r.deps)).toEqual({ kind: "bound", port: 4400 });
      expect(r.replaced).toEqual([4400]);
      expect(r.bound).toEqual([4400]);
    }
    const refused = world({ interactive: false, busy: [4400], health: { 4400: mine() }, replaceFails: "no answer from its shutdown route" });
    await fails(bindPort(port({ replace: true }), refused.deps), "could not stop the CRT on port 4400 (no answer from its shutdown route) — stop it yourself, or run `crt --port 4401`");
    const stuck = world({ interactive: false, busy: [4400], health: { 4400: mine() } });
    stuck.deps.replace = async () => ({ ok: true }); // acknowledged, but the port never frees
    await fails(bindPort(port({ replace: true }), stuck.deps), "could not stop the CRT on port 4400 (still listening after 5 s) — stop it yourself, or run `crt --port 4401`");
    // --replace against a non-CRT occupant is meaningless: the normal fallback applies.
    const notCrt = world({ interactive: false, busy: [4400] });
    expect(await bindPort(port({ replace: true }), notCrt.deps)).toEqual({ kind: "bound", port: 4401 });
    expect(notCrt.replaced).toEqual([]);
  });

  it("every port in 4400…4409 held → one line with the fix (F-73, N-17)", async () => {
    const r = world({ interactive: false, busy: [4400, 4401, 4402, 4403, 4404, 4405, 4406, 4407, 4408, 4409] });
    await fails(bindPort(port(), r.deps), "ports 4400–4409 are all in use — run `crt --port <n>`");
  });
});

describe("helpers", () => {
  it("sameProject ignores case and trailing separators on Windows, only trailing separators elsewhere (F-73)", () => {
    expect(sameProject("C:\\My-App\\", "c:/my-app", "win32")).toBe(true);
    expect(sameProject("/home/s/app/", "/home/s/app", "linux")).toBe(true);
    expect(sameProject("/home/s/App", "/home/s/app", "linux")).toBe(false);
  });

  it("since() renders local HH:MM and nothing for a missing or bad stamp (F-73)", () => {
    expect(since({ startedAt: "2026-09-16T09:12:00+08:00" })).toMatch(/^ \(since \d\d:\d\d\)$/);
    expect(since({ startedAt: "2026-09-16T09:12:00+08:00" }, ", since ")).toMatch(/^, since \d\d:\d\d$/);
    expect(since({ startedAt: null })).toBe("");
    expect(since({ startedAt: "yesterday" })).toBe("");
  });

  it("isYes: Enter, y, yes in any case (F-71, F-73 [Y/n])", () => {
    for (const a of ["", "y", "Y", "yes", "YES", " y "]) expect(isYes(a), a).toBe(true);
    for (const a of ["n", "no", "x", "1"]) expect(isYes(a), a).toBe(false);
  });
});
