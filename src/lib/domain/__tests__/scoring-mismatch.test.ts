import { describe, it, expect } from "vitest";
import { scoringMismatch } from "../scoring-mismatch";

/**
 * The tournament's Scoring and its rounds, disagreeing.
 *
 * See the header of `scoring-mismatch.ts` for the tournament this was measured
 * on: four cards returned at 71, 72, 74 and 76, and a match-points leaderboard
 * of zeroes above them with the player who shot 71 in second place.
 */

const stroke = { type: "Stroke Play Round", headToHead: false };
const roundRobin = { type: "Round Robin", headToHead: true };
const bracket = { type: "Bracket Stage", headToHead: true };

describe("a medal set to match play", () => {
  it("is reported, because nothing in it can be ranked", () => {
    const m = scoringMismatch("match", [stroke]);
    expect(m).not.toBeNull();
    expect(m!.scoring).toBe("match");
    // The remedy, named. A warning that says only that something is wrong
    // leaves the reader exactly where they were.
    expect(m!.message).toContain("Stroke play");
    expect(m!.message).toContain("Tournament details");
  });

  it("and is not reported once the setting is corrected", () => {
    // The assertion that makes the message above true rather than merely
    // stern: following it clears the warning.
    expect(scoringMismatch("stroke", [stroke])).toBeNull();
  });
});

describe("a match-play tournament set to stroke play", () => {
  it("is reported too — the mistake runs both ways", () => {
    /**
     * Not symmetry for its own sake. `isStroke` sends the standings looking
     * for `Scorecard` rows, and a match round writes its results on the match
     * — so a round robin under stroke scoring is just as blank, and blank for
     * the mirror-image reason.
     */
    const m = scoringMismatch("stroke", [roundRobin]);
    expect(m).not.toBeNull();
    expect(m!.message).toContain("Match play");
    expect(scoringMismatch("match", [roundRobin])).toBeNull();
  });

  it("counting a bracket as head to head", () => {
    // A knockout draws no pairings from the flights and is nothing but
    // opponents all the same — the distinction `isHeadToHead` exists for.
    expect(scoringMismatch("stroke", [bracket])).not.toBeNull();
    expect(scoringMismatch("match", [bracket])).toBeNull();
  });
});

describe("what it refuses to complain about", () => {
  it("says nothing about a tournament with no rounds yet", () => {
    // Mid-setup. The rail is already saying "add at least one round", and a
    // second voice about a round that does not exist is noise.
    expect(scoringMismatch("match", [])).toBeNull();
    expect(scoringMismatch("stroke", [])).toBeNull();
  });

  it("says nothing about a MIXED tournament", () => {
    /**
     * THE ASSERTION THAT STOPS THIS BECOMING A NAG.
     *
     * A round robin feeding a stroke-play final has rounds of both kinds, and
     * neither Scoring setting ranks both — which is a real limit of one column
     * doing this job, and not something the organizer can fix by pressing the
     * other radio button. Telling them to would be advice that does not work,
     * on a tournament that is set up correctly.
     */
    expect(scoringMismatch("match", [roundRobin, stroke])).toBeNull();
    expect(scoringMismatch("stroke", [roundRobin, stroke])).toBeNull();
    expect(scoringMismatch("match", [stroke, bracket])).toBeNull();
  });

  it("treats an unrecognised setting as match play, which is what the column does", () => {
    // `isStroke` is `event.format === "stroke"` and nothing else, so anything
    // that is not that string IS match play as far as the engine is concerned.
    // Reading it any other way here would report the opposite of the truth.
    expect(scoringMismatch("", [stroke])).not.toBeNull();
    expect(scoringMismatch("nonsense", [stroke])!.scoring).toBe("match");
    expect(scoringMismatch("nonsense", [roundRobin])).toBeNull();
  });
});
