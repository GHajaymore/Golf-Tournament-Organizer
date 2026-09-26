import { describe, it, expect } from "vitest";
import { roundNumber, roundLabel, roundLabelWith, type NumberedStage } from "../round-label";
import { isPlayingRound } from "@/lib/stage-types";

/**
 * One number for a round, on every screen.
 *
 * The two counts that were in use disagree exactly when a tournament has a cut
 * in it, which is an ordinary club championship rather than an exotic setup.
 */

const stage = (id: string, type: string): NumberedStage => ({ id, type });

/**
 * Round Robin, a stage nobody plays, then the bracket — the shape the two
 * counts disagree on.
 *
 * The middle one used to be a "Qualification Stage", the one type with
 * `isPlayingRound: false`. That type was removed on 2026-09-11 (see
 * `STAGE_TYPES`), so a RETIRED type is now the only way a stage row can fail to
 * be a playing round — which is exactly the case this rule has to survive, and
 * is what a row written by an older build looks like.
 */
const WITH_CUT: NumberedStage[] = [
  stage("rr", "Round Robin"),
  stage("cut", "Retired Stage Type"),
  stage("bracket", "Bracket Stage"),
];

describe("the fixture really is the case the two counts disagree on", () => {
  it("has a stage in the middle that nobody plays", () => {
    // Every assertion below is vacuous if this stops being true — the counts
    // agree on a tournament with no cut in it.
    expect(isPlayingRound("Retired Stage Type")).toBe(false);
    expect(isPlayingRound("Round Robin")).toBe(true);
    expect(isPlayingRound("Bracket Stage")).toBe(true);
  });
});

describe("counting the rounds of golf", () => {
  it("does not count the cut", () => {
    // The defect, stated as the golf: a club that plays two rounds either side
    // of a cut has played two rounds. `stage.position + 1` made this Round 3.
    expect(roundNumber(WITH_CUT, "bracket")).toBe(2);
    expect(roundLabel(WITH_CUT, "bracket")).toBe("Round 2");
  });

  it("numbers the first round 1", () => {
    expect(roundLabel(WITH_CUT, "rr")).toBe("Round 1");
  });

  it("gives the cut itself no number at all", () => {
    // Not "Round 0", and not the number of the round after it. The screen
    // showing a cut knows what to call it; this does not.
    expect(roundNumber(WITH_CUT, "cut")).toBe(0);
    expect(roundLabel(WITH_CUT, "cut")).toBe("");
  });

  it("says nothing about a stage that is not in the list", () => {
    expect(roundLabel(WITH_CUT, "somewhere-else")).toBe("");
    expect(roundLabel(WITH_CUT, "")).toBe("");
    expect(roundLabel([], "rr")).toBe("");
  });

  it("counts several cuts without losing its place", () => {
    const long: NumberedStage[] = [
      stage("r1", "Stroke Play Round"),
      stage("c1", "Retired Stage Type"),
      stage("r2", "Stroke Play Round"),
      stage("c2", "Retired Stage Type"),
      stage("r3", "Bracket Stage"),
    ];
    expect(["r1", "r2", "r3"].map((id) => roundLabel(long, id))).toEqual([
      "Round 1",
      "Round 2",
      "Round 3",
    ]);
  });
});

describe("what list you may hand it", () => {
  it("gives the same answer for the full list and for playing rounds only", () => {
    /**
     * The property that makes the helper safe to call from anywhere. Half the
     * old sites had `state.stages` in scope and half had `playingStages(...)`,
     * and that difference is what produced two answers. Filtering an
     * already-filtered list changes nothing, so it can no longer matter which
     * one a caller happens to hold.
     */
    const played = WITH_CUT.filter((s) => isPlayingRound(s.type));
    for (const id of ["rr", "bracket"]) {
      expect(roundLabel(played, id), id).toBe(roundLabel(WITH_CUT, id));
    }
  });

  it("is wrong if you hand it some OTHER subset, which is why callers pass them all", () => {
    /**
     * Recorded rather than defended against, because it cannot be detected
     * from inside: a list of two rounds is indistinguishable from a tournament
     * of two rounds. Every caller passes the whole stage list — the guard test
     * in `audit-guards.test.ts` is what keeps that true.
     */
    const bracketOnly = [stage("bracket", "Bracket Stage")];
    expect(roundLabel(bracketOnly, "bracket")).toBe("Round 1");
    expect(roundLabel(WITH_CUT, "bracket")).toBe("Round 2");
  });
});

describe("a round labelled with something after it", () => {
  it("joins the number and the suffix", () => {
    expect(roundLabelWith(WITH_CUT, "bracket", "Match Play")).toBe("Round 2 · Match Play");
  });

  it("takes the screen's own separator", () => {
    expect(roundLabelWith(WITH_CUT, "rr", "Match Play", " — ")).toBe("Round 1 — Match Play");
  });

  it("drops the separator when there is nothing to put after it", () => {
    // A round with no format set read "Round 3 — " on one screen.
    expect(roundLabelWith(WITH_CUT, "rr", "")).toBe("Round 1");
    expect(roundLabelWith(WITH_CUT, "rr", "   ")).toBe("Round 1");
  });

  it("falls back to the suffix alone for a stage with no number", () => {
    // A stage nobody plays has a type worth showing and no round number to
    // show with it.
    expect(roundLabelWith(WITH_CUT, "cut", "Retired Stage Type")).toBe("Retired Stage Type");
  });
});

/**
 * THE ROWS ARRIVE IN WHATEVER ORDER THE DATABASE KEEPS THEM.
 *
 * A Prisma `include` with no `orderBy` comes back in physical row order, and
 * Postgres moves a row when it is updated. On 2026-09-26 closing Round 1 of the
 * seeded championship did exactly that, and a member's calendar printed "Sat 22
 * Aug · Round 2" above "Sun 23 Aug · Round 1". The rounds carry their position;
 * the number must come from it, not from where a row happened to land.
 */
describe("a round's number does not depend on the order its rows arrived in", () => {
  const r1 = { id: "r1", type: "Stroke Play Round", position: 0 };
  const r2 = { id: "r2", type: "Stroke Play Round", position: 1 };

  it("numbers by position when Round 1 comes back last", () => {
    expect(roundLabel([r2, r1], "r1")).toBe("Round 1");
    expect(roundLabel([r2, r1], "r2")).toBe("Round 2");
  });

  it("still does not count a cut, however the list is shuffled", () => {
    const shuffled = [
      { id: "bracket", type: "Bracket Stage", position: 2 },
      { id: "rr", type: "Round Robin", position: 0 },
      { id: "cut", type: "Retired Stage Type", position: 1 },
    ];
    expect(roundLabel(shuffled, "rr")).toBe("Round 1");
    expect(roundLabel(shuffled, "bracket")).toBe("Round 2");
    expect(roundLabel(shuffled, "cut")).toBe("");
  });

  it("takes a list with no positions exactly as given (the control)", () => {
    // Callers that already built their own playing order pass bare stages, and
    // must get the count down THAT list — which is also what makes the two
    // cases above a test of the position and not of the ids.
    expect(roundLabel([stage("r2", "Stroke Play Round"), stage("r1", "Stroke Play Round")], "r1")).toBe(
      "Round 2",
    );
  });

  it("leaves the caller's list alone", () => {
    const list = [r2, r1];
    roundLabel(list, "r1");
    expect(list.map((s) => s.id)).toEqual(["r2", "r1"]);
  });
});
