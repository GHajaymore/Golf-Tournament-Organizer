import { describe, it, expect } from "vitest";
import { assignCardRows, parseCard } from "../scorecard-parse";

/**
 * Which pasted row is the par, which the stroke index, which the yardage.
 *
 * This was positional — line one par, line two stroke index, line three
 * yardage — which assumed somebody selected exactly three rows in exactly that
 * order. The ordinary thing to do with a table on a club's website is select
 * the whole thing.
 */

const PAR = "Par 4 5 4 4 3 5 3 4 4 36 4 4 3 4 5 4 4 3 5 36 72";
const SI = "S.I. 6 10 12 16 14 2 18 4 8 3 9 17 7 1 13 11 15 5";
const YDS = "Yards 378 509 397 333 189 498 107 416 483 3310 444 370 202 401 559 393 400 182 541 3492";
const HOLES = "Hole 1 2 3 4 5 6 7 8 9 OUT 10 11 12 13 14 15 16 17 18 IN";

describe("reading a whole table off a club's website", () => {
  it("drops the hole-number header instead of reading it as the pars", () => {
    // The failure this fixes: the header became the pars and the paste was
    // refused with "every hole needs a par between 3 and 6" — true, and no
    // help at all in working out what went wrong.
    const rows = assignCardRows([HOLES, PAR, YDS, SI].join("\n"));
    expect(rows.byLabel).toBe(true);
    const card = parseCard(rows, 18);
    expect(card.ok).toBe(true);
    if (!card.ok) return;
    expect(card.pars[0]).toBe(4);
    expect(card.strokeIndex[0]).toBe(6);
    expect(card.yards[0]).toBe(378);
  });

  it("does not care what order the rows come in", () => {
    for (const order of [
      [PAR, SI, YDS],
      [YDS, SI, PAR],
      [SI, YDS, PAR],
      [HOLES, YDS, PAR, SI],
    ]) {
      const card = parseCard(assignCardRows(order.join("\n")), 18);
      expect(card.ok, order.join(" | ").slice(0, 40)).toBe(true);
      if (!card.ok) continue;
      expect(card.pars[1]).toBe(5);
      expect(card.strokeIndex[1]).toBe(10);
    }
  });

  it("takes the many names clubs give the stroke index", () => {
    // Nobody agrees what to call it, and getting it wrong is the one that
    // silently allocates handicap strokes to the wrong holes.
    for (const label of ["S.I.", "SI", "Index", "HCP", "Hdcp", "Handicap", "Stroke Index"]) {
      const rows = assignCardRows([PAR, `${label} 6 10 12 16 14 2 18 4 8 3 9 17 7 1 13 11 15 5`].join("\n"));
      expect(rows.strokeIndex, label).toContain("6 10 12");
    }
  });

  it("takes the first yardage row when a card prints one per tee", () => {
    const rows = assignCardRows([PAR, SI, YDS, "Yards 350 480 370 310 170 470 100 390 450 3090 420 350 190 380 530 370 380 170 510 3300"].join("\n"));
    expect(rows.yards).toContain("378");
  });
});

describe("the three-row paste this replaced", () => {
  it("still works with no labels at all, by position", () => {
    // The old contract: par, stroke index, yardage, one row each. It has to
    // keep working — it is what the placeholder still shows.
    const bare = [
      "4 5 4 4 3 5 3 4 4 36 4 4 3 4 5 4 4 3 5 36 72",
      "6 10 12 16 14 2 18 4 8 3 9 17 7 1 13 11 15 5",
      "378 509 397 333 189 498 107 416 483 444 370 202 401 559 393 400 182 541",
    ].join("\n");
    const rows = assignCardRows(bare);
    expect(rows.byLabel).toBe(false);
    const card = parseCard(rows, 18);
    expect(card.ok).toBe(true);
    if (!card.ok) return;
    expect(card.pars[0]).toBe(4);
    expect(card.strokeIndex[0]).toBe(6);
  });

  it("keeps a genuine 1-18 stroke index when there is nothing else it could be", () => {
    // A 1..18 ascending row is usually a hole header, but a card really can
    // carry that stroke index — so it is only dropped where enough other rows
    // remain to fill the card.
    const rows = assignCardRows(
      ["4 5 4 4 3 5 3 4 4 4 4 3 4 5 4 4 3 5", "1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18"].join("\n"),
    );
    const card = parseCard(rows, 18);
    expect(card.ok).toBe(true);
    if (!card.ok) return;
    expect(card.strokeIndex[0]).toBe(1);
    expect(card.strokeIndex[17]).toBe(18);
  });

  it("says nothing was found for an empty paste rather than throwing", () => {
    const rows = assignCardRows("   \n\n  ");
    expect(rows.pars).toBe("");
    expect(rows.strokeIndex).toBe("");
  });
});
