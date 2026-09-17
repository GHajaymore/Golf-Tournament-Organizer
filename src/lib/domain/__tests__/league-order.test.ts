import { describe, it, expect } from "vitest";
import { clubOrderNote, meansSomethingForAClub, orderClubs, type ClubRecord, type HeadToHead } from "../league-order";
import { tiebreakerLabel, type TiebreakerKey } from "../types";

/**
 * A LEAGUE TABLE IS NOT ORDERED BY THE ALPHABET.
 *
 * The committee sets a tiebreak chain for the tournament; the league table was
 * written without it and went straight to the club's name. These cells are
 * built so the wrong answer looks different: in every one, the alphabet and
 * the chain disagree.
 */

const club = (name: string, over: Partial<ClubRecord> = {}): ClubRecord => ({
  clubId: name.toLowerCase(),
  name,
  points: 10,
  played: 3,
  won: 1,
  holesWon: 20,
  holesLost: 20,
  ...over,
});

const h2h = (pairs: Array<[string, string, number]>): HeadToHead => {
  const m: HeadToHead = new Map();
  const put = (a: string, b: string, v: number) => {
    if (!m.has(a)) m.set(a, new Map());
    m.get(a)!.set(b, v);
  };
  for (const [a, b, v] of pairs) {
    put(a, b, v);
    put(b, a, -v);
  }
  return m;
};

const names = (rows: ClubRecord[]) => rows.map((r) => r.name);

describe("ordering the clubs", () => {
  it("puts more points first, whatever the chain says", () => {
    const rows = [club("Ashridge", { points: 10 }), club("Zebra", { points: 12 })];
    expect(names(orderClubs(rows, ["most-wins"], h2h([])))).toEqual(["Zebra", "Ashridge"]);
  });

  it("breaks a tie on the committee's head-to-head, not the name", () => {
    // Ashridge is first alphabetically and lost the meeting.
    const rows = [club("Ashridge"), club("Zebra")];
    const met = h2h([["zebra", "ashridge", 1]]);
    expect(names(orderClubs(rows, ["head-to-head"], met))).toEqual(["Zebra", "Ashridge"]);
  });

  it("falls through a key that decides nothing to the next one", () => {
    // They never met, so head-to-head says nothing; Zebra won more meetings.
    const rows = [club("Ashridge", { won: 1 }), club("Zebra", { won: 3 })];
    expect(names(orderClubs(rows, ["head-to-head", "most-wins"], h2h([])))).toEqual(["Zebra", "Ashridge"]);
  });

  it("ranks on hole differential where the chain asks for it", () => {
    const rows = [
      club("Ashridge", { holesWon: 30, holesLost: 30 }),
      club("Zebra", { holesWon: 40, holesLost: 20 }),
    ];
    expect(names(orderClubs(rows, ["holes-won-ratio"], h2h([])))).toEqual(["Zebra", "Ashridge"]);
  });

  it("ranks on fewest holes lost, and on winning percentage, where asked", () => {
    const lost = [club("Ashridge", { holesLost: 40 }), club("Zebra", { holesLost: 10 })];
    expect(names(orderClubs(lost, ["fewest-holes-lost"], h2h([])))).toEqual(["Zebra", "Ashridge"]);

    // Zebra has won 2 of 2; Ashridge 2 of 6.
    const pct = [club("Ashridge", { won: 2, played: 6 }), club("Zebra", { won: 2, played: 2 })];
    expect(names(orderClubs(pct, ["win-percentage"], h2h([])))).toEqual(["Zebra", "Ashridge"]);
  });

  it("skips the keys that say nothing about a club", () => {
    /**
     * A countback reads ONE player's card and a club fields twelve; a club has
     * no handicap. Both decide nothing rather than being reinterpreted, which
     * is what the player chain already does with a countback and no stroke
     * index.
     */
    for (const key of ["toughest-6", "toughest-3", "lower-handicap"] as TiebreakerKey[]) {
      expect(meansSomethingForAClub(key), key).toBe(false);
    }
    const rows = [club("Zebra"), club("Ashridge")];
    // Nothing usable in the chain, so the name is all that is left.
    expect(names(orderClubs(rows, ["toughest-6", "lower-handicap"], h2h([])))).toEqual([
      "Ashridge",
      "Zebra",
    ]);
  });

  it("uses the chain in the order the committee wrote it", () => {
    // Ashridge won the meeting; Zebra won more meetings overall. Whichever key
    // comes first decides.
    const rows = [club("Ashridge", { won: 1 }), club("Zebra", { won: 3 })];
    const met = h2h([["ashridge", "zebra", 1]]);
    expect(names(orderClubs(rows, ["head-to-head", "most-wins"], met))).toEqual(["Ashridge", "Zebra"]);
    expect(names(orderClubs(rows, ["most-wins", "head-to-head"], met))).toEqual(["Zebra", "Ashridge"]);
  });

  it("says what decided the order, in the committee's own words", () => {
    expect(clubOrderNote(["head-to-head", "most-wins"], tiebreakerLabel)).toBe(
      "Ranked on points, then head-to-head result, then most match wins, then by name.",
    );
    // A chain of nothing usable says so rather than naming a rule it ignores.
    expect(clubOrderNote(["toughest-6"], tiebreakerLabel)).toBe(
      "Ranked on points. Clubs level on points are listed by name.",
    );
  });
});
