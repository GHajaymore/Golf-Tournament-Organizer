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

/** Round Robin, a cut, then the bracket. The shape the two counts disagree on. */
const WITH_CUT: NumberedStage[] = [
  stage("rr", "Round Robin"),
  stage("cut", "Qualification Stage"),
  stage("bracket", "Bracket Stage"),
];

describe("the fixture really is the case the two counts disagree on", () => {
  it("has a stage in the middle that nobody plays", () => {
    // Every assertion below is vacuous if this stops being true — the counts
    // agree on a tournament with no cut in it.
    expect(isPlayingRound("Qualification Stage")).toBe(false);
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
      stage("c1", "Qualification Stage"),
      stage("r2", "Stroke Play Round"),
      stage("c2", "Qualification Stage"),
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
    // A cut has a type worth showing and no round number to show with it.
    expect(roundLabelWith(WITH_CUT, "cut", "Qualification Stage")).toBe("Qualification Stage");
  });
});
