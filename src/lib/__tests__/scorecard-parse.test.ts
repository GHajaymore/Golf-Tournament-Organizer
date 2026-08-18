import { describe, it, expect } from "vitest";
import { parseCardRow, validateCard, parseCard } from "../domain/scorecard-parse";

/**
 * Reading a course card, and checking it.
 *
 * The numbers can arrive typed, pasted from a club website, or extracted from
 * a photograph. The parser doesn't care which — the validator is what makes
 * any of those safe, and the stroke index is the row that can actually be
 * proved wrong.
 */

const PARS = [4, 5, 3, 4, 4, 4, 3, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4];
const SI = [7, 3, 11, 1, 15, 5, 17, 9, 13, 8, 4, 12, 2, 16, 6, 18, 10, 14];
const YARDS = [412, 528, 168, 445, 389, 401, 205, 378, 511, 396, 434, 181, 452, 540, 366, 194, 420, 383];

describe("pulling values out of a row", () => {
  it("reads a plain row of eighteen", () => {
    expect(parseCardRow(PARS.join(" ")).values).toEqual(PARS);
  });

  it("strips OUT, IN and the grand total", () => {
    // How a club website almost always renders it.
    const row = `${PARS.slice(0, 9).join(" ")} 36 ${PARS.slice(9).join(" ")} 35 71`;
    const r = parseCardRow(row);
    expect(r.values).toEqual(PARS);
    expect(r.strippedTotals).toEqual([36, 35, 71]);
  });

  it("strips a grand total on its own", () => {
    const r = parseCardRow(`${PARS.join(" ")} 71`);
    expect(r.values).toEqual(PARS);
    expect(r.strippedTotals).toEqual([71]);
  });

  it("removes totals by position, not by size", () => {
    // A par-36 nine and a 36-yard hole are both plausible in isolation, so
    // guessing at magnitude would strip real holes from a short par-3 course.
    const short = new Array(18).fill(36);
    expect(parseCardRow(short.join(" ")).values).toEqual(short);
  });

  it("copes with commas, tabs and table markup", () => {
    expect(parseCardRow("4,5,3,4,4,4,3,4,5,4,4,3,4,5,4,3,4,4").values).toEqual(PARS);
    expect(parseCardRow(PARS.join("\t")).values).toEqual(PARS);
    expect(parseCardRow(PARS.map((p) => `<td>${p}</td>`).join("")).values).toEqual(PARS);
  });

  it("handles a nine-hole row with its total", () => {
    const r = parseCardRow(`${PARS.slice(0, 9).join(" ")} 36`, 9);
    expect(r.values).toEqual(PARS.slice(0, 9));
    expect(r.strippedTotals).toEqual([36]);
  });

  it("hands back anything it can't make sense of, rather than guessing", () => {
    // The validator says what's wrong far more usefully than a guess here.
    expect(parseCardRow("4 5 3").values).toEqual([4, 5, 3]);
  });
});

describe("checking the stroke index", () => {
  it("accepts a real one", () => {
    expect(validateCard(PARS, YARDS, SI).ok).toBe(true);
  });

  it("catches a duplicate — the classic misread", () => {
    // OCR reading an 8 as a 6 leaves two 6s and no 8. This is the check that
    // makes an extracted card safe to trust, because a wrong stroke index is
    // otherwise invisible: it just allocates shots to the wrong holes.
    const bad = [...SI];
    bad[9] = 6;
    const r = validateCard(PARS, YARDS, bad);
    expect(r.ok).toBe(false);
    const dup = r.problems.find((p) => p.message.includes("more than once"));
    expect(dup).toBeTruthy();
    expect(dup!.holes).toContain(10);
    expect(dup!.holes).toContain(15);
  });

  it("names the index that went missing", () => {
    const bad = [...SI];
    bad[9] = 6;
    const r = validateCard(PARS, YARDS, bad);
    expect(r.problems.some((p) => p.message.includes("8 missing"))).toBe(true);
  });

  it("rejects an index outside 1–18", () => {
    const bad = [...SI];
    bad[0] = 24;
    expect(validateCard(PARS, YARDS, bad).ok).toBe(false);
  });

  it("checks 1–9 on a nine-hole card", () => {
    const nine = [7, 3, 9, 1, 5, 4, 8, 2, 6];
    expect(validateCard(PARS.slice(0, 9), [], nine, 9).ok).toBe(true);
    const bad = [...nine];
    bad[0] = 11;
    expect(validateCard(PARS.slice(0, 9), [], bad, 9).ok).toBe(false);
  });
});

describe("checking pars and yards", () => {
  it("flags a par that isn't golf", () => {
    const bad = [...PARS];
    bad[4] = 9;
    const r = validateCard(bad, YARDS, SI);
    expect(r.ok).toBe(false);
    expect(r.problems.find((p) => p.row === "pars")!.holes).toEqual([5]);
  });

  it("allows a par 6, which some courses really have", () => {
    const six = [...PARS];
    six[4] = 6;
    expect(validateCard(six, YARDS, SI).ok).toBe(true);
  });

  it("treats yards as optional", () => {
    // Plenty of clubs never enter them, and nothing scores off them.
    expect(validateCard(PARS, [], SI).ok).toBe(true);
  });

  it("flags a yardage that can't be a hole", () => {
    const bad = [...YARDS];
    bad[3] = 4;
    const r = validateCard(PARS, bad, SI);
    expect(r.ok).toBe(false);
    expect(r.problems.find((p) => p.row === "yards")!.holes).toEqual([4]);
  });

  it("reports every problem at once", () => {
    // Someone re-typing from a photograph wants the whole list, not one at a
    // time.
    const badPars = [...PARS];
    badPars[0] = 9;
    const badSi = [...SI];
    badSi[1] = 7;
    const r = validateCard(badPars, YARDS, badSi);
    expect(r.problems.length).toBeGreaterThanOrEqual(3);
    expect(new Set(r.problems.map((p) => p.row))).toContain("pars");
    expect(new Set(r.problems.map((p) => p.row))).toContain("strokeIndex");
  });

  it("gives totals to eyeball against the real card", () => {
    const r = validateCard(PARS, YARDS, SI);
    expect(r.totals.par).toBe(71);
    expect(r.totals.outPar).toBe(36);
    expect(r.totals.inPar).toBe(35);
    expect(r.totals.yards).toBe(6803);
  });

  it("says when a row is the wrong length", () => {
    const r = validateCard(PARS.slice(0, 17), [], SI);
    // The message now names the row and says how many holes are missing.
    expect(r.problems.some((p) => p.row === "pars" && /17 numbers for 18 holes/.test(p.message))).toBe(true);
  });
});

describe("a card pasted off a club website", () => {
  it("reads all three rows with their totals", () => {
    const r = parseCard({
      pars: `Par ${PARS.slice(0, 9).join(" ")} 36 ${PARS.slice(9).join(" ")} 35 71`,
      yards: `Yards ${YARDS.slice(0, 9).join(" ")} 3437 ${YARDS.slice(9).join(" ")} 3566 7003`,
      strokeIndex: `S.I. ${SI.slice(0, 9).join(" ")} ${SI.slice(9).join(" ")}`,
    });
    expect(r.ok).toBe(true);
    expect(r.pars).toEqual(PARS);
    expect(r.strokeIndex).toEqual(SI);
  });

  it("does not mistake a row label for a hole", () => {
    // "S.I." has no digits, but "Front 9" does — and a label that contributed
    // a number would shift the whole card by one.
    const r = parseCard({
      pars: `Front 9 ${PARS.join(" ")}`,
      strokeIndex: SI.join(" "),
    });
    // 19 numbers: the leading 9 is treated as a trailing total and stripped,
    // which shifts the card — so the validator has to catch it.
    expect(r.pars).not.toEqual(PARS);
    expect(r.ok).toBe(false);
  });

  it("refuses an empty paste rather than saving a blank card", () => {
    const r = parseCard({ pars: "", strokeIndex: "" });
    expect(r.ok).toBe(false);
  });
});


describe("stripping totals off a pasted row", () => {
  const par = (t: string) => parseCardRow(t).values;

  it("takes a tidy card with every total on it", () => {
    // 9, OUT, 9, IN, TOT — what a club website usually prints.
    const row = "4 5 3 4 4 3 4 4 5 36 4 4 3 4 5 4 3 4 4 35 71";
    expect(par(row)).toEqual([4, 5, 3, 4, 4, 3, 4, 4, 5, 4, 4, 3, 4, 5, 4, 3, 4, 4]);
  });

  it("takes one with no totals at all", () => {
    const row = "4 5 3 4 4 3 4 4 5 4 4 3 4 5 4 3 4 4";
    expect(par(row)).toHaveLength(18);
  });

  it("takes one with only a grand total", () => {
    const row = "4 5 3 4 4 3 4 4 5 4 4 3 4 5 4 3 4 4 71";
    expect(par(row)).toHaveLength(18);
  });

  it("does not mistake a par for a total", () => {
    // The danger of matching sums: an early hole can equal the running sum.
    // A total only counts after a full nine, so this stays 18 holes.
    const row = "4 4 3 4 4 3 4 4 5 4 4 3 4 5 4 3 4 4";
    expect(par(row)).toHaveLength(18);
    expect(par(row)[1]).toBe(4);
  });

  it("refuses to invent a card when a hole is missing", () => {
    /**
     * The reported case. A front nine with one par missing still leaves 20
     * numbers, so reading by POSITION dropped a real par and kept the OUT
     * total as the 9th hole — the screen offered a par 36 and said only that
     * a par must be between 3 and 6.
     */
    const row = "4 5 3 4 4 3 4 5 36 4 4 3 4 5 4 3 4 4 35 71";
    const values = par(row);
    // The guarantee is not that it recovers the missing hole — it cannot, the
    // number is not in the paste. It is that it never hands back a PLAUSIBLE
    // card built from a total. Eighteen values would be accepted and scored.
    expect(values.length).not.toBe(18);
    // The numbers come back whole, so the count is visibly wrong and the
    // message below explains it, rather than a par 36 reaching the boxes.
    expect(values).toHaveLength(20);
  });

  it("says what is wrong rather than just counting", () => {
    const card = parseCard({
      pars: "4 5 3 4 4 3 4 5 36 4 4 3 4 5 4 3 4 4 35 71",
      strokeIndex: "7 3 11 1 15 5 17 9 13 8 4 12 2 16 6 18 10 14",
    });
    const parProblem = card.problems.find((p) => p.row === "pars");
    expect(parProblem?.message).toMatch(/one hole is missing/);
    expect(parProblem?.message).toMatch(/OUT and IN/);
  });

  it("leaves a correct stroke index alone", () => {
    const si = "7 3 11 1 15 5 17 9 13 8 4 12 2 16 6 18 10 14";
    expect(parseCardRow(si).values).toHaveLength(18);
  });
});
