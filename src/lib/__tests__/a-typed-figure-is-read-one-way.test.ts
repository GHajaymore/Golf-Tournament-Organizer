import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readSource } from "./source";
import { decimalPoint, figureOr, plainFigure, readDecimal, readWhole } from "../domain/decimal-text";
import { INDEX_MAX, INDEX_MIN, indexRefusal, parseStrokesInput, readHandicapIndex } from "../domain/handicap-label";
import { parseHandicapInput } from "../domain/registration-intake";
import { HANDICAP_MAX, HANDICAP_MIN, parseHandicap } from "../domain/quick-match";

/**
 * A NUMBER SOMEBODY TYPED IS READ ONE WAY, IN EVERY BOX.
 *
 * Step 1 of `docs/one-rule-one-place.md`: what people type. A count on
 * 2026-10-13 found 48 places on the screens that read a typed number their own
 * way, and three readers for a handicap alone:
 *
 *   the entry form and the roster   refused a figure outside +10 to 54
 *   a quick match                   clamped it into the range
 *   a casual round's box            did neither; read an EMPTIED box as nought,
 *                                   which made the player a scratch golfer; and
 *                                   sent 124 to a server that stored it
 *
 * and the server stored whatever finite number any of four actions was handed,
 * because the range was checked in forms and nowhere else.
 *
 * The readers were never compared with each other. Each had its own tests, each
 * passed them, and the cases that told them apart — an empty box, "1e1",
 * "0x10", a Japanese keyboard's digits — were in none. So the axis here is the
 * TEXT, and every reader is put to the same list.
 *
 * WHAT IT CANNOT SEE: that a box on a screen calls the reader (the sweep at the
 * foot covers the three handicap boxes; `docs/one-rule-one-place.md` lists the
 * boxes still to be moved), and that a screen SAYS why it refused
 * (`e2e/casual-round.spec.ts` for the box that used to say nothing).
 */

/** The same figure as a Japanese keyboard types it by default. */
const wide = (ascii: string) =>
  ascii.replace(/[0-9]/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xfee0)).replace(/\./g, "．").replace(/,/g, "，").replace(/\+/g, "＋").replace(/-/g, "－");

describe("what was typed, in plain digits", () => {
  it("spells a Japanese keyboard's figures, and a true minus sign, the way a reader expects", () => {
    expect(plainFigure(wide("12.4"))).toBe("12.4");
    expect(plainFigure(wide("+2,4"))).toBe("+2,4");
    expect(plainFigure(wide("-3"))).toBe("-3");
    expect(plainFigure("−3")).toBe("-3");
    expect(plainFigure("  71.3 ")).toBe("71.3");
    // CONTROL: the keyboard really does type something `Number` cannot read.
    expect(Number.isNaN(Number(wide("12")))).toBe(true);
  });

  it("guesses at nothing else", () => {
    for (const text of ["twelve", "12.4abc", "1,2,3", "12 4", "1e3", "0x10", "", "—"]) expect(plainFigure(text)).toBe(text.trim());
    expect(plainFigure(null)).toBe("");
    expect(plainFigure(undefined)).toBe("");
  });

  it("one comma between digits is a decimal mark, in either kind of digit", () => {
    expect(decimalPoint("12,4")).toBe("12.4");
    expect(decimalPoint(wide("12,4"))).toBe("12.4");
    expect(decimalPoint("1,2,3")).toBe("1,2,3");
  });
});

describe("a figure with a decimal part", () => {
  const READS: [string, number][] = [
    ["12.4", 12.4],
    ["12,4", 12.4],
    [" 71.3 ", 71.3],
    ["0", 0],
    ["-0", 0],
    ["+0", 0],
    ["5", 5],
    ["5.", 5],
    [".5", 0.5],
    ["-2.5", -2.5],
    ["+2.5", 2.5],
    [wide("71.3"), 71.3],
    [wide("71,3"), 71.3],
    ["−2", -2],
  ];
  for (const [text, value] of READS) {
    it(`reads "${text}" as ${value}`, () => {
      expect(readDecimal(text)).toEqual({ kind: "number", value });
      // Nought is nought, not the minus zero a comparison calls another number.
      if (value === 0) expect(Object.is((readDecimal(text) as { value: number }).value, 0)).toBe(true);
    });
  }

  const NOT: string[] = ["72a", "7l.3", "1e3", "0x10", "Infinity", "NaN", "12.4.5", "1,2,3", "1,234.5", "12 4", "--2", "+-2", ".", "+", "-", "twelve"];
  for (const text of NOT) {
    it(`does not read "${text}" as a number`, () => {
      expect(readDecimal(text).kind).toBe("unreadable");
    });
  }

  it("CONTROL: these are the very texts the three built-in readers disagree about", () => {
    expect(parseInt("72a", 10)).toBe(72);
    expect(Number("72a")).toBeNaN();
    expect(parseFloat("7l.3")).toBe(7);
    expect(Number("1e3")).toBe(1000);
    expect(Number("0x10")).toBe(16);
    expect(Number("")).toBe(0);
    expect(parseFloat("12,4")).toBe(12);
  });

  it("an empty box is blank, which is not nought", () => {
    for (const text of ["", "   ", null, undefined]) expect(readDecimal(text as string | null | undefined)).toEqual({ kind: "blank" });
  });
});

describe("a whole number", () => {
  it("reads one, in either kind of digit", () => {
    expect(readWhole("72")).toEqual({ kind: "number", value: 72 });
    expect(readWhole(" 113 ")).toEqual({ kind: "number", value: 113 });
    expect(readWhole(wide("72"))).toEqual({ kind: "number", value: 72 });
    expect(readWhole("-3")).toEqual({ kind: "number", value: -3 });
    expect(readWhole("0")).toEqual({ kind: "number", value: 0 });
  });

  it("does not read a decimal, a typo, or a number too large to be one", () => {
    for (const text of ["4.5", "4.0", "4,0", "72a", "7 2", "1e3", "0x10", "99999999999999999999"]) expect(readWhole(text).kind, text).toBe("unreadable");
    expect(readWhole("")).toEqual({ kind: "blank" });
  });

  it("a box whose blank and whose typo mean the same to it says what it uses instead", () => {
    expect(figureOr(readWhole("410"), 0)).toBe(410);
    expect(figureOr(readWhole(""), 0)).toBe(0);
    expect(figureOr(readWhole("41o"), 0)).toBe(0);
    expect(figureOr(readDecimal("71,3"), 0)).toBe(71.3);
  });
});

/**
 * THE HANDICAP, AND ITS THREE BOXES. Each row: what was typed, and what it IS.
 * The boxes differ in what they DO with a blank, a typo and an impossible
 * figure, and in nothing else — so where a figure is accepted, all three hold
 * the same number.
 */
describe("a handicap index, as a golfer writes one", () => {
  type Kind = "blank" | "index" | "unreadable" | "out-of-range";
  const ROWS: [string, Kind, number?][] = [
    ["12.4", "index", 12.4],
    ["12,4", "index", 12.4],
    ["0", "index", 0],
    ["+2.4", "index", -2.4],
    ["+2,4", "index", -2.4],
    ["-2.4", "index", -2.4],
    ["+0", "index", 0],
    ["54", "index", 54],
    ["+10", "index", -10],
    [wide("12.4"), "index", 12.4],
    [wide("+2"), "index", -2],
    ["", "blank"],
    ["   ", "blank"],
    ["12.4abc", "unreadable"],
    ["1e1", "unreadable"],
    ["0x10", "unreadable"],
    ["twelve", "unreadable"],
    ["+-2", "unreadable"],
    ["++2", "unreadable"],
    ["+", "unreadable"],
    ["1,2,3", "unreadable"],
    ["54.1", "out-of-range", 54.1],
    ["124", "out-of-range", 124],
    ["+10.1", "out-of-range", -10.1],
    ["-11", "out-of-range", -11],
    ["999", "out-of-range", 999],
  ];

  for (const [text, kind, value] of ROWS) {
    it(`"${text}" is ${kind}${value === undefined ? "" : ` (${value})`}`, () => {
      const read = readHandicapIndex(text);
      expect(read.kind).toBe(kind);
      if (value !== undefined) expect((read as { value: number }).value).toBeCloseTo(value, 9);

      // The entry form and the roster: a blank is no index; a typo and an impossible figure are refused.
      const form = parseHandicapInput(text);
      if (kind === "blank") expect(form).toEqual({ ok: true, value: 0, source: "none" });
      if (kind === "index") expect(form).toEqual({ ok: true, value: (read as { value: number }).value, source: "manual" });
      if (kind === "unreadable") expect(form).toMatchObject({ ok: false, why: "not-a-number" });
      if (kind === "out-of-range") expect(form).toMatchObject({ ok: false, why: "out-of-range" });

      // A quick match: nothing typed, or a typo, plays level; an impossible figure is brought into range.
      const match = parseHandicap(text);
      if (kind === "blank" || kind === "unreadable") expect(match).toBe(0);
      if (kind === "index") expect(match).toBeCloseTo(value!, 9);
      if (kind === "out-of-range") expect(match).toBe(value! > INDEX_MAX ? INDEX_MAX : INDEX_MIN);
    });
  }

  it("CONTROL: the list holds every kind, and a figure the old readers got wrong each way", () => {
    expect(new Set(ROWS.map((r) => r[1]))).toEqual(new Set(["blank", "index", "unreadable", "out-of-range"]));
    // What the casual round's box did with an emptied box, and with a typo of 12.4.
    expect(Number("")).toBe(0);
    expect(Number.isFinite(Number("124"))).toBe(true);
    // What the form's old reader did with an exponent and with hex: read them.
    expect(Number("1e1")).toBe(10);
    expect(Number("0x10")).toBe(16);
  });

  it("the range is one range, wherever it is named", () => {
    expect([INDEX_MIN, INDEX_MAX]).toEqual([-10, 54]);
    expect([HANDICAP_MIN, HANDICAP_MAX]).toEqual([INDEX_MIN, INDEX_MAX]);
    const sources = ["src/lib/domain/registration-intake.ts", "src/lib/domain/quick-match.ts"].map((f) => readSource(f));
    for (const src of sources) expect(src).not.toMatch(/=\s*-10\s*;|=\s*54\s*;/);
  });

  it("a round's whole strokes are read by the same reader, and still say why a decimal is not one", () => {
    expect(parseStrokesInput("12")).toEqual({ ok: true, value: 12 });
    expect(parseStrokesInput("+2")).toEqual({ ok: true, value: -2 });
    expect(parseStrokesInput(wide("12"))).toEqual({ ok: true, value: 12 });
    expect(parseStrokesInput("scratch")).toEqual({ ok: true, value: 0 });
    expect(parseStrokesInput("12.4")).toMatchObject({ ok: false });
    expect((parseStrokesInput("12.4") as { error: string }).error).toMatch(/whole strokes/);
    for (const text of ["", "1e1", "0x10", "12a", "+-2"]) expect(parseStrokesInput(text), text).toMatchObject({ ok: false });
    expect(parseStrokesInput("55")).toMatchObject({ ok: false });
  });
});

describe("what the server will store as an index", () => {
  it("is a figure a golfer can have", () => {
    for (const n of [-10, -2.4, 0, 12.4, 54]) expect(indexRefusal(n), String(n)).toBeNull();
    for (const n of [-10.1, 54.1, 124, 999, -500, 1e9]) expect(indexRefusal(n), String(n)).toMatch(/\+10 to 54/);
    for (const n of [Number.NaN, Number.POSITIVE_INFINITY, "12" as unknown, null, undefined]) expect(indexRefusal(n), String(n)).toMatch(/as a number/);
  });

  /** The body of one exported action, to the next export. */
  const actionOf = (file: string, name: string) => {
    const src = readSource(file);
    const at = src.indexOf(`export async function ${name}(`);
    expect(at, `${name} is not in ${file}`).toBeGreaterThan(0);
    const next = src.indexOf("\nexport ", at + 10);
    return src.slice(at, next < 0 ? undefined : next);
  };

  it("every action that stores a typed index asks before it writes", () => {
    const DOORS: [string, string, RegExp][] = [
      ["src/app/actions/tournament.ts", "addSignup", /prisma\.player\.create\(/],
      ["src/app/actions/tournament.ts", "updateSignup", /prisma\.player\.update\(/],
      ["src/app/actions/roster.ts", "addMember", /prisma\.member\.(create|update|upsert)\(/],
      ["src/app/actions/roster.ts", "updateMember", /prisma\.member\.update\(/],
    ];
    for (const [file, name, write] of DOORS) {
      const body = actionOf(file, name);
      const asks = body.indexOf("indexRefusal(");
      const writes = body.search(write);
      expect(asks, `${name} stores a handicap without asking whether it is one`).toBeGreaterThan(0);
      expect(writes, `${name} no longer writes where this test looks, so it asserts nothing`).toBeGreaterThan(0);
      expect(asks, `${name} asks after it has written`).toBeLessThan(writes);
    }
  });

  it("the casual round's box reads through the one reader, and an emptied box is not nought", () => {
    const panel = readSource("src/components/CasualRoundPanel.tsx");
    expect(panel).toContain("readHandicapIndex(e.target.value)");
    expect(panel).not.toMatch(/Number\(raw/);
    expect(panel).toMatch(/read\.kind === "blank"\) return putBack\(/);
    expect(panel).toMatch(/read\.kind === "out-of-range"\) return putBack\(/);
    // And a refusal from the server is shown, not dropped.
    expect(panel).toMatch(/if \(!res\.ok\) return putBack\(/);
  });
});

/**
 * NO SCREEN READS A TYPED NUMBER ITS OWN WAY.
 *
 * `parseFloat`, `parseInt` and `Number(` on what somebody typed are how the 48
 * came to be. Each is refused on a screen and in an action, except for the
 * lines below, where the text was never typed by anybody: a dropdown's value
 * (the app wrote the options), a slider, a length off a stylesheet, the digits
 * of a label being sorted, and a NUMBER handed to an action and then checked.
 * A new line has to be one of those and be put here with its reason — or go
 * through `readDecimal` / `readWhole`.
 */
describe("no screen reads a typed number its own way", () => {
  function sources(dir: string, out: string[] = []): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) {
        if (e.name === "__tests__" || e.name === "node_modules") continue;
        sources(rel, out);
      } else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) out.push(rel);
    }
    return out;
  }
  // Every screen: the components and the pages. NOT the actions: an action is
  // handed a number, coerces it and range-checks it, and what it is handed was
  // read by one of the screens here.
  const files = [...sources("src/components"), ...sources("src/app")].filter((f) => !f.startsWith("src/app/actions/") && !f.startsWith("src/app/api/"));
  // ANY use of the three, not a guess at which arguments look typed: the first
  // version of this matched `Number(e.target.value)` and its like, and walked
  // past `Number(hole)`, `Number(prices[t.key])` and four more.
  const BUILT_IN = /(^|[^A-Za-z_.])(parseFloat|parseInt|Number)\(/;

  /** The line, and why it is not somebody's typing. */
  const NOT_TYPED: [string, string][] = [
    ["setRoundIdx(parseInt(e.target.value, 10))", "a dropdown of rounds"],
    ["commitCarry(true, parseInt(e.target.value, 10))", "a slider"],
    ["setBulkHoles(holesPlayed(parseInt(e.target.value, 10)))", "a dropdown: 9 or 18"],
    ["setInterval(parseInt(e.target.value, 10))", "a dropdown of minutes"],
    ["parseFloat(getComputedStyle(row).columnGap", "a length off the stylesheet"],
    ['parseInt(a.replace(/\\D/g, ""), 10)', "the digits of a label, to sort flights by number"],
    ['parseInt(b.replace(/\\D/g, ""), 10)', "the digits of a label, to sort flights by number"],
    ["setToFlight(Number(e.target.value))", "a dropdown of flights"],
    ["setPlayoffSize(Number(e.target.value) as LeaguePlayoffSize)", "a dropdown of play-off sizes"],
    ["const v = Number(e.target.value);", "a dropdown of paces"],
    ["setEvery(Number(e.target.value))", "a dropdown of intervals"],
    ['a: side === "a" ? Number(e.target.value) : seedA,', "a dropdown of seeds"],
    ['b: side === "b" ? Number(e.target.value) : seedB,', "a dropdown of seeds"],
    ["setGroupIdx(Number(e.target.value))", "a dropdown of groups"],
    [".sort((a, b) => Number(b[0]) - Number(a[0]))", "the keys of a count of group sizes"],
    ["sizeName[Number(s)]", "the key of a count of group sizes"],
    ["const to = Number(el.dataset.to);", "a figure the front door's own markup carries"],
    ["divide(Number(range.value));", "the front door's slider"],
    ["at = Number(range.value);", "the front door's slider"],
    ["indexFigure(Number(r.exact.toFixed(2)))", "a figure the app computed, shortened to print"],
  ];

  it("CONTROL: the sweep reads the screens and recognises the lines it replaced", () => {
    expect(files.length).toBeGreaterThan(250);
    for (const old of [
      "courseRating: parseFloat(decimalPoint(draft.courseRating)) || 0,",
      "slopeRating: parseInt(draft.slopeRating, 10) || 0,",
      "const typed = parseFloat(e.target.value);",
      "const n = raw.startsWith(\"+\") ? -Number(raw.slice(1)) : Number(raw);",
      "weight: Math.max(0, Math.round(Number(typed[playerId] ?? \"\") || 0))",
    ]) {
      expect(BUILT_IN.test(old), old).toBe(true);
    }
    expect(BUILT_IN.test("figureOr(readWhole(e.target.value), 1)")).toBe(false);
    expect(BUILT_IN.test("hole: contestHasHole(kind) ? Number(hole) || 0 : 0,")).toBe(true);
    expect(BUILT_IN.test("const n = Number(prices[t.key]);")).toBe(true);
    // And it is not fooled by a longer name, or by a method of Number.
    expect(BUILT_IN.test("{holeNumber(i, firstHole)}")).toBe(false);
    expect(BUILT_IN.test("if (!Number.isFinite(n)) return;")).toBe(false);
  });

  it("every built-in reader left on a screen is on the list of lines nobody typed", () => {
    const strays: string[] = [];
    const seen = new Set<string>();
    for (const f of files) {
      for (const line of readSource(f).split("\n")) {
        if (!BUILT_IN.test(line)) continue;
        const known = NOT_TYPED.find(([text]) => line.includes(text));
        if (known) seen.add(known[0]);
        else strays.push(`${f}: ${line.trim().slice(0, 110)}`);
      }
    }
    expect(strays, "read it with readDecimal / readWhole, or say here why nobody typed it").toEqual([]);
    // And the list holds nothing that has since gone: a stale line is a hole in the sweep.
    expect(NOT_TYPED.map(([text]) => text).filter((text) => !seen.has(text))).toEqual([]);
  });
});
