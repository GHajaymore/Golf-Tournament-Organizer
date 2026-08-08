import { describe, it, expect } from "vitest";
import {
  scoringGroup,
  matchFor,
  canEnterScoreFor,
  enterableBy,
  attestRequirement,
  isAttested,
  stillNeeded,
  ATTEST_RULES,
  isAttestRule,
  type PlayingContext,
} from "../domain/attest";

/**
 * Who may write a score, and who has to agree it.
 *
 * The case that drives all of this: two matches going out in one foursome.
 * They share a tee time and nothing else, and the second pair has no standing
 * over the first pair's result.
 */

/** One foursome, two singles matches inside it. */
const twoMatches: PlayingContext = {
  foursomes: [["alex", "sam", "raj", "kim"]],
  matches: [
    { id: "m1", sideA: ["alex"], sideB: ["sam"] },
    { id: "m2", sideA: ["raj"], sideB: ["kim"] },
  ],
};

/** One foursome, one four-ball match: two pairs against each other. */
const pairsMatch: PlayingContext = {
  foursomes: [["alex", "sam", "raj", "kim"]],
  matches: [{ id: "m1", sideA: ["alex", "sam"], sideB: ["raj", "kim"] }],
};

/** Stroke play: a foursome and no matches at all. */
const strokePlay: PlayingContext = {
  foursomes: [["alex", "sam", "raj", "kim"], ["lee", "jo"]],
  matches: [],
};

describe("what counts as playing together", () => {
  it("binds a result to the match, not the foursome", () => {
    // The whole point. Alex and Sam's match is theirs; Raj and Kim were on the
    // same tee at the same time and that is all.
    expect(scoringGroup("alex", twoMatches).sort()).toEqual(["alex", "sam"]);
    expect(scoringGroup("raj", twoMatches).sort()).toEqual(["kim", "raj"]);
  });

  it("binds all four when the four of them are the match", () => {
    expect(scoringGroup("alex", pairsMatch).sort()).toEqual(["alex", "kim", "raj", "sam"]);
  });

  it("falls back to the foursome when there is no match", () => {
    // Stroke play — this is the marker system, and the foursome is correct.
    expect(scoringGroup("alex", strokePlay).sort()).toEqual(["alex", "kim", "raj", "sam"]);
    expect(scoringGroup("lee", strokePlay).sort()).toEqual(["jo", "lee"]);
  });

  it("leaves a player in neither on their own", () => {
    expect(scoringGroup("stranger", strokePlay)).toEqual(["stranger"]);
  });

  it("finds the match a player is on either side of", () => {
    expect(matchFor("kim", pairsMatch)?.id).toBe("m1");
    expect(matchFor("nobody", pairsMatch)).toBeNull();
  });
});

describe("who may write a score down", () => {
  it("lets a player enter for their own match", () => {
    expect(canEnterScoreFor("alex", "sam", twoMatches)).toBe(true);
    expect(canEnterScoreFor("alex", "alex", twoMatches)).toBe(true);
  });

  it("refuses the other match in the same foursome", () => {
    // Same tee time, different result. This is the one that matters: without
    // it, anyone off the same tee can overwrite a match they were not in.
    expect(canEnterScoreFor("alex", "raj", twoMatches)).toBe(false);
    expect(canEnterScoreFor("kim", "sam", twoMatches)).toBe(false);
  });

  it("refuses the rest of the field outright", () => {
    expect(canEnterScoreFor("alex", "lee", strokePlay)).toBe(false);
  });

  it("allows all four in a pairs match", () => {
    for (const target of ["alex", "sam", "raj", "kim"]) {
      expect(canEnterScoreFor("alex", target, pairsMatch), target).toBe(true);
    }
  });

  it("allows the foursome in stroke play", () => {
    expect(canEnterScoreFor("alex", "kim", strokePlay)).toBe(true);
    expect(canEnterScoreFor("alex", "jo", strokePlay)).toBe(false);
  });

  it("lists exactly who a player may enter for", () => {
    // What the dictation parser resolves names against. Anything wider and
    // "Sam, five" can land on a Sam in another group.
    expect(enterableBy("alex", twoMatches).sort()).toEqual(["alex", "sam"]);
    expect(enterableBy("stranger", twoMatches)).toEqual(["stranger"]);
  });
});

describe("who has to agree it", () => {
  it("never lets the person who entered it also confirm it", () => {
    // A card signed only by whoever wrote it is not attested, it is asserted.
    for (const rule of ["marker", "opponent", "all"] as const) {
      const req = attestRequirement("alex", "alex", pairsMatch, rule);
      expect(req.candidates, rule).not.toContain("alex");
    }
  });

  it("asks one playing partner under the marker rule", () => {
    const req = attestRequirement("alex", "alex", strokePlay, "marker");
    expect(req.needed).toBe(1);
    expect(req.candidates.sort()).toEqual(["kim", "raj", "sam"]);
  });

  it("asks the opposing side under the opponent rule", () => {
    // The people with a reason to check it.
    const req = attestRequirement("alex", "alex", pairsMatch, "opponent");
    expect(req.needed).toBe(1);
    expect(req.candidates.sort()).toEqual(["kim", "raj"]);
  });

  it("treats the opponent rule as one partner in stroke play", () => {
    // There is no opposing side on a medal card, so the nearest equivalent is
    // a marker rather than nothing at all.
    const req = attestRequirement("alex", "alex", strokePlay, "opponent");
    expect(req.needed).toBe(1);
    expect(req.candidates).toContain("sam");
  });

  it("falls back when the opponent is the one who entered it", () => {
    // Raj wrote Alex's card. Raj cannot then be the opponent confirming it.
    const req = attestRequirement("raj", "alex", pairsMatch, "opponent");
    expect(req.candidates).not.toContain("raj");
    expect(req.candidates).toContain("kim");
  });

  it("asks everyone bound into the result under the all rule", () => {
    const req = attestRequirement("alex", "alex", pairsMatch, "all");
    expect(req.needed).toBe(3);
    expect(req.candidates.sort()).toEqual(["kim", "raj", "sam"]);
  });

  it("only ever asks inside the scoring group", () => {
    // Never the other match sharing the tee time.
    const req = attestRequirement("alex", "alex", twoMatches, "all");
    expect(req.candidates).toEqual(["sam"]);
  });
});

describe("whether a card is signed off", () => {
  const req = attestRequirement("alex", "alex", pairsMatch, "all");

  it("needs every named player under the all rule", () => {
    expect(isAttested(["sam", "raj"], req)).toBe(false);
    expect(isAttested(["sam", "raj", "kim"], req)).toBe(true);
  });

  it("ignores approvals from people who were not asked", () => {
    // An approval from outside the match is not an approval.
    expect(isAttested(["lee", "jo", "stranger"], req)).toBe(false);
  });

  it("does not count the same person twice", () => {
    expect(isAttested(["sam", "sam", "sam"], req)).toBe(false);
  });

  it("is never satisfied when there is nobody to ask", () => {
    // A lone player cannot attest their own round into the record, whatever
    // the tournament is configured to want. That is staff's call.
    const alone = attestRequirement("solo", "solo", { foursomes: [], matches: [] }, "all");
    expect(alone.needed).toBe(0);
    expect(isAttested(["solo"], alone)).toBe(false);
  });

  it("says who is still outstanding", () => {
    expect(stillNeeded(["sam"], req).sort()).toEqual(["kim", "raj"]);
    expect(stillNeeded(["sam", "raj", "kim"], req)).toEqual([]);
  });
});

describe("the tournament-level setting", () => {
  it("describes all three, and rejects anything else", () => {
    expect(ATTEST_RULES).toHaveLength(3);
    for (const r of ATTEST_RULES) {
      expect(isAttestRule(r.key), r.key).toBe(true);
      expect(r.blurb.length, r.key).toBeGreaterThan(30);
    }
    expect(isAttestRule("everyone")).toBe(false);
    expect(isAttestRule("")).toBe(false);
  });
});
