import { describe, it, expect } from "vitest";
import { matchSideLabels, sideMarks, wonBy } from "../match-sides";

/**
 * THE MATCH CARD'S ANSWERS NAME THE SIDES, A FIRST AS DRAWN (2026-11-04) — see
 * `match-sides.ts` for the cup where a card that turned round to face whoever
 * held it put every hole on the board the wrong way round.
 */
describe("what the match card calls its two sides", () => {
  it("a team cup: the two teams, whatever the pairs are called", () => {
    const labels = matchSideLabels({
      side: true,
      aName: "Rakesh Rao & Snehal Shah",
      bName: "Subhas Sen & Prashant Pai",
      aPlayers: ["Rakesh Rao", "Snehal Shah"],
      bPlayers: ["Subhas Sen", "Prashant Pai"],
      aTeam: "CVC",
      bTeam: "CDG",
    });
    expect(labels).toEqual(["CVC", "CDG"]);
    expect(labels.map(wonBy)).toEqual(["CVC won", "CDG won"]);
  });

  it("a cup singles is still the teams", () => {
    expect(matchSideLabels({ aName: "Rakesh Rao", bName: "Subhas Sen", aPlayers: ["Rakesh Rao"], bPlayers: ["Subhas Sen"], aTeam: "CVC", bTeam: "CDG" })).toEqual(["CVC", "CDG"]);
  });

  it("a four-ball between pairs with no team: the pair, by first names", () => {
    const [a, b] = matchSideLabels({
      side: true,
      aName: "Pair one",
      bName: "Pair two",
      aPlayers: ["Rakesh Rao", "Snehal Shah"],
      bPlayers: ["Subhas Sen", "Prashant Pai"],
      aTeam: "",
      bTeam: "",
    });
    expect([wonBy(a), wonBy(b)]).toEqual(["Rakesh & Snehal won", "Subhas & Prashant won"]);
  });

  it("singles: the two players, widened only where their first names clash", () => {
    expect(matchSideLabels({ aName: "Rakesh Rao", bName: "Subhas Sen", aPlayers: ["Rakesh Rao"], bPlayers: ["Subhas Sen"] })).toEqual(["Rakesh", "Subhas"]);
    const [a, b] = matchSideLabels({ aName: "Dave Smith", bName: "Dave Jones", aPlayers: ["Dave Smith"], bPlayers: ["Dave Jones"] });
    expect(a).not.toBe(b);
  });

  it("A is A: the labels follow the sides as given, never whoever holds the phone", () => {
    // The function is not told who holds it — the cup's bug cannot be expressed through it.
    const sides = { aName: "Rakesh Rao", bName: "Subhas Sen", aPlayers: ["Rakesh Rao"], bPlayers: ["Subhas Sen"] };
    expect(matchSideLabels(sides)[0]).toBe("Rakesh");
    expect(matchSideLabels({ ...sides, aName: sides.bName, bName: sides.aName, aPlayers: sides.bPlayers, bPlayers: sides.aPlayers })[0]).toBe("Subhas");
  });

  it("two cup teams with one name are not told apart by it, so the players are used", () => {
    expect(matchSideLabels({ aName: "Rakesh Rao", bName: "Subhas Sen", aPlayers: ["Rakesh Rao"], bPlayers: ["Subhas Sen"], aTeam: "CVC", bTeam: "CVC" })).toEqual(["Rakesh", "Subhas"]);
  });

  it("CONTROL: a card built without its players still names a pair from the side's name", () => {
    expect(matchSideLabels({ side: true, aName: "Ann Lee & Bea Ray", bName: "Cat Doe & Dot Fox" })).toEqual(["Ann & Bea", "Cat & Dot"]);
  });
});

describe("the strip's marks", () => {
  it("the winner's initials, never W and L", () => {
    expect(sideMarks("Rakesh & Snehal", "Subhas & Prashant")).toEqual(["RS", "SP"]);
    expect(sideMarks("Rakesh", "Subhas")).toEqual(["R", "S"]);
  });

  it("widened where the initials clash, and never the same mark for both sides", () => {
    expect(sideMarks("CVC", "CDG")).toEqual(["CV", "CD"]);
    const [x, y] = sideMarks("Ann", "Ann");
    expect(x).not.toBe(y);
  });
});
