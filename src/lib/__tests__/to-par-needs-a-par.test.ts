import { describe, it, expect } from "vitest";
import { toParCell, rankedScore } from "@/lib/domain/ranked-score";

/**
 * A TO-PAR IS ONLY A TO-PAR WHEN THERE IS A PAR.
 *
 * `toPar` is `gross - parThru`, so a round with no course card behind it
 * returns the GROSS score unchanged. A column headed "To par" then carries a
 * 71 as "+71" — in the accent colour, on a board a reader takes at face value.
 *
 * Reachable, measured against real rows rather than argued: an event created
 * without a course card gives `gross=72 toPar=72 parKnown=false thru=18`, and
 * `me/card/page.tsx` deliberately passes `pars={known ? ... : []}`.
 *
 * The organizer's table was taught to refuse it on 2026-09-09, off a real
 * tournament whose venue had been set by ticking it in the club's course
 * library — which attaches the course for the venue picker and leaves the ids
 * everything actually scores against null. The fix went to the table that was
 * reported and stopped there, so the console printed "—" and the share link a
 * spectator opens printed "+71" about the same round.
 */

const row = (over: Partial<{ toPar: number; parKnown: boolean }> = {}) => ({
  toPar: 0,
  ...over,
});

describe("the cell every table prints a to-par through", () => {
  it("refuses a gross dressed as a to-par", () => {
    expect(toParCell(row({ toPar: 71, parKnown: false }))).toBe("—");
  });

  it("prints level par, which is a real answer", () => {
    /**
     * THE CONTROL, and the one that makes this more than "hide the column". A
     * rule written as "suppress it when it is falsy" would swallow this, and
     * the round that looks most like nothing is the one somebody shot exactly
     * to par.
     */
    expect(toParCell(row({ toPar: 0, parKnown: true }))).toBe("E");
  });

  it("prints under and over par", () => {
    expect(toParCell(row({ toPar: -4, parKnown: true }))).toBe("-4");
    expect(toParCell(row({ toPar: 3, parKnown: true }))).toBe("+3");
  });

  it("treats an absent flag as known", () => {
    // Every existing caller passes a row that has it; a caller written later
    // against a source that genuinely has par is not made to prove it.
    expect(toParCell(row({ toPar: -4 }))).toBe("-4");
  });

  it("takes the caller's own placeholder", () => {
    // The tables already use different dashes, and changing one would be a
    // copy change with nothing behind it.
    expect(toParCell(row({ toPar: 71, parKnown: false }), "–")).toBe("–");
  });
});

describe("the ranked number behind the player's board, Today, and the public link", () => {
  const base = { pts: "", points: 0, toPar: 0, thru: 18, holesOwed: 18, started: true };

  it("says nothing rather than reporting the gross as a to-par", () => {
    const r = rankedScore({ ...base, toPar: 71, parKnown: false }, { isStroke: true });
    expect(r.text, "the gross wearing a plus sign").not.toBe("+71");
    expect(r.text).toBe("–");
    expect(r.label, "how far round is still a fact").toBe("Final");
  });

  it("still prints level par", () => {
    expect(rankedScore({ ...base, toPar: 0, parKnown: true }, { isStroke: true }).text).toBe("E");
  });

  it("leaves a Stableford board alone — points need no par of their own", () => {
    const r = rankedScore(
      { ...base, points: 38, parKnown: false },
      { isStroke: true, isStableford: true },
    );
    expect(r.text, "points suppressed by a rule about par").toBe("38");
  });

  it("leaves a match board alone, which was never reading par", () => {
    const r = rankedScore({ ...base, pts: "10.5", parKnown: false }, { isStroke: false });
    expect(r.text).toBe("10.5");
  });

  it("still says nothing at all for a player who has not started", () => {
    const r = rankedScore({ ...base, started: false, parKnown: true }, { isStroke: true });
    expect(r.text).toBe("–");
    expect(r.label).toBe("Not started");
  });
});
