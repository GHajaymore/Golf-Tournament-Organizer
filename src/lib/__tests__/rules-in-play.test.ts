import { describe, it, expect } from "vitest";
import { RULES, rulesInPlay, ruleForFormat, tournamentTerms } from "../rules";

/**
 * THE PLAYER'S RULES SCREEN SHOWS THE RULES THE ROUND IS UNDER.
 *
 * It listed all eight, so a stroke-play medal offered Four-Ball, Foursomes and
 * Match Play — three that cannot apply to the card in the player's hand — with
 * the two that do buried among them. Walked at phone width on 2026-09-19.
 *
 * Asserted against what the TERMS cite rather than against a hand-kept list,
 * which is the point of the split: a format added to the catalogue is covered
 * the day its terms point at a rule.
 */

const medal = tournamentTerms({
  format: "Stroke Play",
  type: "Stroke Play Round",
  holes: 18,
  scoringBasis: "net",
  handicapAllowance: 95,
  countBest: 0,
  tiebreakers: ["toughest-6"],
  cutEnabled: false,
  cutMode: "",
  cutCount: 0,
  cutPercent: 0,
  carryForwardEnabled: false,
  carryForwardPct: 0,
}).map((t) => t.rule);

describe("the rules a tournament is under", () => {
  it("keeps the ones its own terms cite", () => {
    const { inPlay } = rulesInPlay(medal);
    const keys = inPlay.map((r) => r.key);
    // A medal is certified under 3.3b and its ties decided under 5A.
    expect(keys).toContain("scorecardCertification");
    expect(keys).toContain("decidingTies");
  });

  it("leaves the formats that are not being played out of the first list", () => {
    const { inPlay, rest } = rulesInPlay(medal);
    const keys = inPlay.map((r) => r.key);
    expect(keys).not.toContain("fourBall");
    expect(keys).not.toContain("foursomes");
    expect(keys).not.toContain("matchPlay");
    // But still reachable — a rule the app hides is one a player cannot look up.
    expect(rest.map((r) => r.key)).toEqual(expect.arrayContaining(["fourBall", "foursomes", "matchPlay"]));
  });

  it("adds a rule when the tournament has a round in that format", () => {
    // The second round of this one is a four-ball, so Rule 23 is in play even
    // though today's board shows the medal.
    const { inPlay } = rulesInPlay([...medal, ruleForFormat("Four-Ball")]);
    expect(inPlay.map((r) => r.key)).toContain("fourBall");
  });

  it("loses nothing: every rule is in exactly one of the two lists", () => {
    const { inPlay, rest } = rulesInPlay(medal);
    expect([...inPlay, ...rest].map((r) => r.key).sort()).toEqual(Object.keys(RULES).sort());
    for (const r of inPlay) expect(rest).not.toContain(r);
  });

  it("ignores a key that is not a rule, rather than showing a blank row", () => {
    const { inPlay, rest } = rulesInPlay([undefined, "", "notARule"]);
    expect(inPlay).toEqual([]);
    expect(rest).toHaveLength(Object.keys(RULES).length);
  });
});
