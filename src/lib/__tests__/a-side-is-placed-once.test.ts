import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readSource } from "./source";

/**
 * A SIDE IS PLACED ONCE: `TeamStanding.place`, decided by `teamStandings`.
 *
 * Six readers numbered the sides themselves with
 * `placesByValue(rows, (r) => teamPlaceValue(basis, r), …)` — the figure alone,
 * no countback — so a team board shared a place the individual board would
 * have separated (`a-side-is-placed-by-countback.audit.test.ts`). They print the
 * row's place now. The one numbering left is the pairs' total over a season's
 * rounds (`pairTotalPlaces`, which `PairTotalsTable` and the final report both
 * print), which has no single card to count back on.
 */
describe("a side's place", () => {
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
  const NUMBERED_HERE = /\bteamPlaceValue\(/g;

  it("CONTROL: the sweep recognises the reading it replaced", () => {
    const old = "const places = placeTexts(placesByValue(rows, (r) => teamPlaceValue(basis, r), (r) => r.played > 0));";
    expect(old.match(NUMBERED_HERE)?.length).toBe(1);
    expect("const places = placeTexts(rows.map((r) => r.place));".match(NUMBERED_HERE)).toBeNull();
  });

  it("and a Modified Stableford card's is decided by its board, not by its readers", () => {
    // `ModStablefordRow.place`, countback and all
    // (`a-points-board-is-placed-by-countback.audit.test.ts`). The three readers
    // numbered on points alone, while the board broke a tie on the lower gross.
    const POINTS_ONLY = /placesByValue\(\s*\w+,\s*\(r\) => r\.points,\s*\(r\) => r\.played > 0\)/;
    expect(POINTS_ONLY.test("placeTexts(placesByValue(rows, (r) => r.points, (r) => r.played > 0))"), "CONTROL").toBe(true);
    const strays = sources("src").filter((f) => POINTS_ONLY.test(readSource(f)));
    expect(strays, "print ModStablefordRow.place").toEqual([]);
  });

  it("is numbered by the pairs' season total and nowhere else", () => {
    const calls = sources("src").flatMap((f) => {
      const code = readSource(f).replace(/export function teamPlaceValue\(/g, "");
      return (code.match(NUMBERED_HERE) ?? []).map(() => f);
    });
    // ONE numbering of the pairs' totals, `pairTotalPlaces`, which the board's
    // totals table and the final report both print (2026-10-19). It lived
    // inside `PairTotalsTable` until the report needed the same places.
    expect(calls, "print TeamStanding.place").toEqual(["src/lib/domain/pair-totals.ts"]);
    expect(readSource("src/lib/domain/pair-totals.ts")).toMatch(/export function pairTotalPlaces[\s\S]*teamPlaceValue\(basis, r\)/);
    expect(readSource("src/components/TeamLeaderboard.tsx")).toMatch(/export function PairTotalsTable[\s\S]*pairTotalPlaces\(rows, basis\)/);
  });
});
