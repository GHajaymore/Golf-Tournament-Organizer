import { describe, it, expect } from "vitest";
import { readdirSync } from "node:fs";
import { readSource } from "./source";

/**
 * EVERY HOLE NUMBER ON A CARD GOES THROUGH `holeNumber` (2026-09-29).
 *
 * A back-nine round is holes 10-18, stored at indexes 0-8, and every screen
 * printed `index + 1` — "Hole 1" on the 10th tee. #707 fixed eleven screens and
 * missed the Round Code screen's match grid, found by a sweep an hour later. A
 * hand list is how that happens, so this reads every component that draws a
 * card and refuses a hole printed as `i + 1` / `hole + 1`.
 *
 * A COMPONENT DRAWS A CARD when it renders par beside a hole — the signature
 * every scorecard-shaped screen shares. Controls: the sweep finds the known
 * card components, and it catches the raw spelling when it is there.
 */

const RAW_HOLE = [
  /\{\s*(i|hole|c\.i|idx|h)\s*\+\s*1\s*\}/, // JSX: {i + 1}
  /[Hh]ole \$\{\s*(i|hole|c\.i|idx|h)\s*\+\s*1\s*\}/, // template: `Hole ${i + 1}`
];

function components(dir = "src/components", out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) components(rel, out);
    else if (e.name.endsWith(".tsx")) out.push(rel);
  }
  return out;
}

/** Draws a card: prints a par against a hole index. */
const drawsACard = (src: string) => /pars\[(i|hole|c\.i)\]/.test(src);

describe("hole numbers on a card go through one rule", () => {
  const cards = components().filter((f) => drawsACard(readSource(f)));

  it("CONTROL: finds the components that draw a card", () => {
    for (const known of ["ScorecardTable.tsx", "HoleByHoleCard.tsx", "TeeSheetPrint.tsx", "PlayClient.tsx", "CardConflict.tsx"]) {
      expect(cards.some((f) => f.endsWith(known)), `${known} not recognised as drawing a card`).toBe(true);
    }
  });

  it("CONTROL: the raw spelling is caught when it is there", () => {
    expect(RAW_HOLE.some((re) => re.test("<th>{i + 1}</th>"))).toBe(true);
    expect(RAW_HOLE.some((re) => re.test("aria-label={`Hole ${hole + 1}`}"))).toBe(true);
    expect(RAW_HOLE.some((re) => re.test("{holeNumber(i, firstHole)}"))).toBe(false);
  });

  it("no card prints a hole as its index plus one", () => {
    const offenders = cards.filter((f) => RAW_HOLE.some((re) => re.test(readSource(f))));
    expect(offenders, "print it with holeNumber(i, firstHole) so a back nine reads 10-18").toEqual([]);
  });
});
