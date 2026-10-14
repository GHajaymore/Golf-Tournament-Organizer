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
 * row's place now. The one reader left is the pairs' total over a season's
 * rounds (`PairTotalsTable`), which has no single card to count back on.
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

  it("is numbered by the pairs' season total and nowhere else", () => {
    const calls = sources("src").flatMap((f) => {
      const code = readSource(f).replace(/export function teamPlaceValue\(/g, "");
      return (code.match(NUMBERED_HERE) ?? []).map(() => f);
    });
    expect(calls, "print TeamStanding.place").toEqual(["src/components/TeamLeaderboard.tsx"]);
    expect(readSource("src/components/TeamLeaderboard.tsx")).toMatch(/export function PairTotalsTable[\s\S]*teamPlaceValue\(basis, r\)/);
  });
});
