import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readSource } from "./source";
import { isStroke, MAX_STROKES_PER_HOLE } from "../domain/score-payload";

/**
 * WHAT A STROKE ON ONE HOLE CAN BE IS ASKED ONE WAY: `isStroke`, in
 * `domain/score-payload.ts`, beside the ceiling it reads.
 *
 * Measured 2026-10-14: 28,395 stored cards and not one holds a 0 or anything
 * outside 1 to 30, so the card loops that test a played hole as `s == null` and
 * the ones that test `s <= 0` cannot disagree on what is stored. That holds
 * only while every writer asks the same question. The typed card, a score box
 * and a spoken score read `MAX_STROKES_PER_HOLE`; a file of cards wrote the
 * range out twice, with its own 30. This refuses the range written by hand.
 */
describe("a stroke on one hole", () => {
  it("is a whole number from 1 to the ceiling, and nothing else", () => {
    expect(MAX_STROKES_PER_HOLE).toBe(30);
    for (const v of [1, 4, 30]) expect(isStroke(v), String(v)).toBe(true);
    for (const v of [0, -1, 31, 4.5, Number.NaN, Number.POSITIVE_INFINITY, "4", null, undefined]) {
      expect(isStroke(v), String(v)).toBe(false);
    }
  });

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
  /** A lower bound of one and an upper bound of the ceiling, on one value, in one expression. */
  const BY_HAND = /[\w.]+\s*>=\s*1\s*&&\s*[\w.]+\s*<=\s*(30|MAX_STROKES_PER_HOLE)\b|[\w.]+\s*<\s*1\s*\|\|\s*[\w.]+\s*>\s*(30|MAX_STROKES_PER_HOLE)\b/;

  it("CONTROL: the sweep recognises the spellings it replaced", () => {
    expect(BY_HAND.test('.map((v) => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 30 ? v : null));')).toBe(true);
    expect(BY_HAND.test("      if (who && read.value >= 1 && read.value <= MAX_STROKES_PER_HOLE) out[who] = read.value;")).toBe(true);
    expect(BY_HAND.test("    if (v < 1 || v > MAX_STROKES_PER_HOLE) return null;")).toBe(true);
    expect(BY_HAND.test(".map((v) => (isStroke(v) ? v : null));")).toBe(false);
  });

  it("is asked in score-payload.ts and nowhere else", () => {
    const files = sources("src");
    const home = files.find((f) => f.endsWith("lib/domain/score-payload.ts"));
    expect(home && BY_HAND.test(readSource(home)), "the sweep reads the file the rule lives in").toBe(true);
    const strays = files.filter((f) => f !== home && BY_HAND.test(readSource(f)));
    expect(strays, "ask isStroke(v)").toEqual([]);
  });
});
