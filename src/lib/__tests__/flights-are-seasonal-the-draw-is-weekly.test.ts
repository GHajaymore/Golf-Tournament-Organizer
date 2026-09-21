import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * TWO AXES THAT LOOK LIKE ONE.
 *
 *     a FLIGHT      a season-long division, drawn on handicap.
 *                   `Player.groupId`, event-level.
 *     a TEE SHEET   this week's draw, from whoever is playing this week.
 *                   `RoundAttendance`, per round.
 *
 * Ajay's ruling, 2026-09-21, asked directly: "I am not sure if flights are
 * based on the weekly opt in/out so use what the standard golf clubs uses. but
 * yes for foursomes/teesheets."
 *
 * The danger is entirely one-directional and it is why this file exists.
 * `regroup.ts` contains no reference to attendance, which READS like an
 * oversight — it was nearly "fixed" on the day this test was written, by
 * someone who had just measured that six players said OUT of a round whose
 * flights still held all twenty. Redrawing divisions around a weekly reply
 * would move players between divisions week to week and make a season table
 * meaningless.
 *
 * So this pins the shape rather than the wording: the seasonal draw must not
 * learn about attendance, and the weekly draw must not forget it.
 */

const REGROUP = "src/lib/services/regroup.ts";
const FOURSOMES = "src/app/(app)/foursomes/page.tsx";

describe("flights are seasonal", () => {
  it("draws divisions from the confirmed field, not from this week's replies", () => {
    const src = readSource(REGROUP);
    expect(src, "regroup still has to draw somebody").toMatch(
      /status: "confirmed"/,
    );
    expect(
      src,
      "regroup.ts learned about attendance — divisions would move week to week; see its own note",
    ).not.toMatch(/roundAttendance|resolveAttendance|RoundAttendance/);
  });
});

describe("the weekly draw is weekly", () => {
  const src = readSource(FOURSOMES);

  it("resolves who is in before it draws", () => {
    expect(src).toMatch(/resolveAttendance\(/);
    expect(src).toMatch(/tracksPerRound\(/);
  });

  it("hands the DRAW the filtered field, not the whole roster", () => {
    /**
     * The assertion that matters. Reading attendance and then drawing from
     * `state.confirmed` anyway would satisfy the test above and lose the point
     * entirely — a sheet with six absentees on it.
     */
    expect(src, "the field is no longer narrowed to who is in").toMatch(
      /field = state\.confirmed\.filter\(\(p\) => inIds\.has\(p\.id\)\)/,
    );
    expect(src, "the draw is being handed something other than the narrowed field").toMatch(
      /players=\{field\.map\(/,
    );
  });

  it("still notices a published sheet that has gone out of step", () => {
    // A member who opts out AFTER the sheet went up is the case a filter alone
    // cannot catch, because the sheet is already written down.
    expect(src).toMatch(/teeSheetDrift\(/);
  });
});
