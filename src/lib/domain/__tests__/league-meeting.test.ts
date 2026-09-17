import { describe, it, expect } from "vitest";
import {
  pairingPoints,
  meetingPoints,
  meetingsIn,
  LEAGUE_POINTS_SYSTEMS,
  LEAGUE_POINTS_LABEL,
  DEFAULT_MATCH_BONUS,
  type LeaguePointsSystem,
  type PairingResult,
} from "../league-meeting";
import type { HoleResult } from "../types";

/**
 * A WEEK OF AN INTERCLUB LEAGUE, SCORED FOUR WAYS.
 *
 * Twelve club teams, six four-balls each, round robin. The golf is ordinary —
 * a pairing is a four-ball match and every part of that already worked. What
 * is new is six results becoming one team's points, and the rule that does it
 * being a CHOICE.
 *
 * THE SAME SIX RESULTS SCORE DIFFERENTLY UNDER EACH SYSTEM, which is the whole
 * reason it is a setting. A suite that only ever exercised one would pass on an
 * engine that ignored the parameter entirely.
 */

/** A card where A wins `a` holes, B wins `b`, and `h` are halved. */
function card(a: number, b: number, h: number, unplayed = 0): HoleResult[] {
  return [
    ...new Array(a).fill("A"),
    ...new Array(b).fill("B"),
    ...new Array(h).fill("H"),
    ...new Array(unplayed).fill(null),
  ] as HoleResult[];
}

describe("one pairing, under each system", () => {
  /**
   * A wins 5, B wins 3, 10 halved — eighteen holes, and A is 2 up at the last,
   * so the match is decided but was played out. Deliberately not a closeout:
   * the closeout case is its own cell below, because it is where "holes won"
   * and "holes available" come apart.
   */
  const played = card(5, 3, 10);

  it("match play pays one point, to the winner", () => {
    expect(pairingPoints(played, "match")).toEqual([1, 0]);
  });

  it("holes only pays the holes, halves split", () => {
    // 5 + 10/2 = 10 against 3 + 10/2 = 8.
    expect(pairingPoints(played, "holes")).toEqual([10, 8]);
  });

  it("holes and match adds the bonus on top", () => {
    expect(pairingPoints(played, "holes-and-match")).toEqual([10 + DEFAULT_MATCH_BONUS, 8]);
  });

  it("nassau pays three segments", () => {
    /**
     * Front nine A 4 / B 1, back nine A 1 / B 2, overall A 5 / B 3. So A takes
     * the front and the overall, B takes the back.
     */
    const holes = [
      ..."AAAABHHHH".split(""),
      ..."ABBHHHHHH".split(""),
    ] as HoleResult[];
    expect(pairingPoints(holes, "nassau")).toEqual([2, 1]);
  });

  it("every system is a DIFFERENT answer on the same card", () => {
    /**
     * THE CELL THAT MAKES THE REST MEAN SOMETHING, and it had to be tightened
     * before it did.
     *
     * It first asked for "more than two" distinct answers, and a mutation
     * disabling the holes-and-match branch left it GREEN: that system fell
     * through to match play, so four systems produced three distinct values
     * and the loose bar was still cleared. A control that survives the defect
     * it exists for is decoration.
     *
     * All four differ on this fixture — 1, 12, 10 and 2.5 — so any system
     * collapsing into another fails here rather than only in its own cell.
     */
    const answers = LEAGUE_POINTS_SYSTEMS.map((s) => pairingPoints(played, s)[0]);
    expect(
      new Set(answers).size,
      `two systems agree, which means one is being ignored: ${answers.join(", ")}`,
    ).toBe(LEAGUE_POINTS_SYSTEMS.length);
  });
});

describe("a halved pairing", () => {
  const halved = card(4, 4, 10);

  it("splits the point under match play", () => {
    expect(pairingPoints(halved, "match")).toEqual([0.5, 0.5]);
  });

  it("splits the bonus too", () => {
    const [a, b] = pairingPoints(halved, "holes-and-match");
    expect(a).toBe(b);
    // 4 + 5 holes, plus half the bonus each.
    expect(a).toBe(9 + DEFAULT_MATCH_BONUS / 2);
  });

  it("is why a league table is full of halves", () => {
    // 187.50 and 170.50 on a real league table are this, six pairings at a time.
    expect(pairingPoints(halved, "match")[0] % 1).toBe(0.5);
  });
});

describe("a match closed out early", () => {
  /**
   * A wins the first 10, then four holes nobody walked. A is 10 up with 8 to
   * play, so it ended 10&8.
   */
  const closeout = card(10, 0, 0, 8);

  it("is a win under match play", () => {
    expect(pairingPoints(closeout, "match")).toEqual([1, 0]);
  });

  it("pays only the holes that were PLAYED, not the ones conceded", () => {
    /**
     * The difference between "holes won" and "holes available". Paying for the
     * eight nobody walked would reward conceding, and would make a 10&8 worth
     * more than an 18-hole thrashing of the same margin.
     */
    expect(pairingPoints(closeout, "holes")).toEqual([10, 0]);
  });
});

describe("a pairing still out on the course", () => {
  const unfinished = card(2, 1, 1, 14);

  it("is worth nothing yet under match play", () => {
    // Money and points both wait for a result. A match 2 up after four holes
    // has not been won by anybody.
    expect(pairingPoints(unfinished, "match")).toEqual([0, 0]);
  });

  it("but holes already won are already won", () => {
    expect(pairingPoints(unfinished, "holes")).toEqual([2.5, 1.5]);
  });

  it("and the bonus is not paid until it is decided", () => {
    expect(pairingPoints(unfinished, "holes-and-match")).toEqual([2.5, 1.5]);
  });
});

describe("a whole meeting of six four-balls", () => {
  const SCHMIT = "team-schmit";
  const CARTER = "team-carter";

  /** Six pairings: Schmit wins three, Carter two, one halved. */
  const six: PairingResult[] = [
    { parentA: SCHMIT, parentB: CARTER, holes: card(5, 3, 10) },
    { parentA: SCHMIT, parentB: CARTER, holes: card(6, 2, 10) },
    { parentA: SCHMIT, parentB: CARTER, holes: card(5, 4, 9) },
    { parentA: SCHMIT, parentB: CARTER, holes: card(3, 5, 10) },
    { parentA: SCHMIT, parentB: CARTER, holes: card(2, 6, 10) },
    { parentA: SCHMIT, parentB: CARTER, holes: card(4, 4, 10) },
  ];

  it("adds the pairings up to the club teams", () => {
    const rows = meetingPoints(six, "match");
    const by = new Map(rows.map((r) => [r.teamId, r.points]));
    // Three wins and a half against two wins and a half.
    expect(by.get(SCHMIT)).toBe(3.5);
    expect(by.get(CARTER)).toBe(2.5);
  });

  it("puts one point per pairing at stake under match play", () => {
    const total = meetingPoints(six, "match").reduce((s, r) => s + r.points, 0);
    expect(total, "six four-balls, six points").toBe(6);
  });

  it("ranks the winner first", () => {
    expect(meetingPoints(six, "match")[0].teamId).toBe(SCHMIT);
  });

  it("names the meeting from the pairs that played", () => {
    expect(meetingsIn(six)).toEqual([[SCHMIT, CARTER]]);
  });

  it("does not invent a meeting out of pairs with no club", () => {
    /**
     * THE CONTROL. A four-ball in an ordinary tournament has no parent at all,
     * and must not be read as a league meeting of nobody against nobody — which
     * is what an engine keying on empty strings would do.
     */
    const ordinary: PairingResult[] = [{ parentA: "", parentB: "", holes: card(5, 3, 10) }];
    expect(meetingsIn(ordinary), "not league play").toEqual([]);
    expect(meetingPoints(ordinary, "match"), "and worth nothing to anybody").toEqual([]);
  });

  it("keeps two meetings on the same night apart", () => {
    /**
     * Six meetings run at once on a shotgun — twelve teams, 144 players. A
     * rule that pooled every pairing in the round would hand one team the
     * league.
     */
    const night: PairingResult[] = [
      ...six,
      { parentA: "team-kienle", parentB: "team-deuel", holes: card(9, 0, 9) },
    ];
    expect(meetingsIn(night)).toHaveLength(2);
    const by = new Map(meetingPoints(night, "match").map((r) => [r.teamId, r.points]));
    expect(by.get("team-kienle")).toBe(1);
    expect(by.get(SCHMIT), "untouched by the other meeting").toBe(3.5);
  });
});

describe("the systems on offer", () => {
  it("every one has a label and a sentence explaining it", () => {
    // A setting a club has to choose is a setting the screen has to explain.
    for (const s of LEAGUE_POINTS_SYSTEMS) {
      expect(LEAGUE_POINTS_LABEL[s as LeaguePointsSystem], s).toBeTruthy();
    }
  });

  it("has more than one, which is the point of it being a setting", () => {
    expect(LEAGUE_POINTS_SYSTEMS.length).toBeGreaterThan(1);
  });
});

describe("a pairing with no card at all", () => {
  it("is worth nothing under any system, not a half each", () => {
    // `resolveMatch([])` has no holes left and calls that complete and halved;
    // a round whose course card is missing would hand every club half a point.
    for (const s of LEAGUE_POINTS_SYSTEMS) {
      expect(pairingPoints([], s as LeaguePointsSystem, 2), s).toEqual([0, 0]);
    }
  });
});
