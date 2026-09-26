import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { cardPoints } from "@/lib/domain/card-points";
import { ScorecardTable } from "@/components/ScorecardTable";

/**
 * A STABLEFORD CARD SHOWS ITS POINTS.
 *
 * The player's card showed gross, to par and net and, on a Stableford round,
 * no points at all — the only figure that round is decided on. Walked as a
 * member of the seeded Twilight Nine on 2026-09-26: "Net 37" on the card, 13
 * points on Today. Now both read 13.
 *
 * The points are asserted against the Stableford table itself (net par 2,
 * birdie 3, bogey 1, double or worse 0 — R&A Rules of Golf, Rule 21.1), not
 * against what the code happens to produce.
 */
const PARS = [4, 4, 3, 5];

describe("cardPoints", () => {
  it("scores each hole off its par and the shots received there", () => {
    // Net par, net birdie, net bogey, net double — 2 + 3 + 1 + 0.
    expect(cardPoints([4, 3, 4, 7], PARS, [0, 0, 0, 0], "standard")).toBe(6);
    // A shot received on the 1st turns a gross bogey into a net par: 2 points.
    expect(cardPoints([5, null, null, null], PARS, [1, 0, 0, 0], "standard")).toBe(2);
  });

  it("adds nothing for a hole with no score", () => {
    expect(cardPoints([null, null, null, null], PARS, [0, 0, 0, 0], "standard")).toBe(0);
  });

  it("uses the modified table on a Modified Stableford round", () => {
    // Birdie 2, par 0, bogey -1, double -3 on the usual modified scale.
    expect(cardPoints([3, 4, 4, 7], PARS, [0, 0, 0, 0], "modified")).toBe(2 + 0 - 1 - 3);
  });
});

describe("the full card's totals", () => {
  const props = {
    holes: 4,
    pars: PARS,
    strokes: [4, 3, 4, 7] as (number | null)[],
    shotsPerHole: [0, 0, 0, 0],
    playingHandicap: 0,
  };

  it("shows Points, not To par, on a points round", () => {
    const html = renderToStaticMarkup(<ScorecardTable {...props} pointsTable="standard" />);
    expect(html).toContain("Points");
    expect(html).not.toContain("To par");
  });

  it("shows To par on a strokes round (control)", () => {
    const html = renderToStaticMarkup(<ScorecardTable {...props} />);
    expect(html).toContain("To par");
    expect(html).not.toContain("Points");
  });
});
