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
      aName: "Sam Hill & Alex Lake",
      bName: "Jo Park & Max Dale",
      aPlayers: ["Sam Hill", "Alex Lake"],
      bPlayers: ["Jo Park", "Max Dale"],
      aTeam: "Oaks",
      bTeam: "Pines",
    });
    expect(labels).toEqual(["Oaks", "Pines"]);
    expect(labels.map(wonBy)).toEqual(["Oaks won", "Pines won"]);
  });

  it("a cup singles is still the teams", () => {
    expect(matchSideLabels({ aName: "Sam Hill", bName: "Jo Park", aPlayers: ["Sam Hill"], bPlayers: ["Jo Park"], aTeam: "Oaks", bTeam: "Pines" })).toEqual(["Oaks", "Pines"]);
  });

  it("a four-ball between pairs with no team: the pair, by first names", () => {
    const [a, b] = matchSideLabels({
      side: true,
      aName: "Pair one",
      bName: "Pair two",
      aPlayers: ["Sam Hill", "Alex Lake"],
      bPlayers: ["Jo Park", "Max Dale"],
      aTeam: "",
      bTeam: "",
    });
    expect([wonBy(a), wonBy(b)]).toEqual(["Sam & Alex won", "Jo & Max won"]);
  });

  it("singles: the two players, widened only where their first names clash", () => {
    expect(matchSideLabels({ aName: "Sam Hill", bName: "Jo Park", aPlayers: ["Sam Hill"], bPlayers: ["Jo Park"] })).toEqual(["Sam", "Jo"]);
    const [a, b] = matchSideLabels({ aName: "Dave Smith", bName: "Dave Jones", aPlayers: ["Dave Smith"], bPlayers: ["Dave Jones"] });
    expect(a).not.toBe(b);
  });

  it("A is A: the labels follow the sides as given, never whoever holds the phone", () => {
    // The function is not told who holds it — the cup's bug cannot be expressed through it.
    const sides = { aName: "Sam Hill", bName: "Jo Park", aPlayers: ["Sam Hill"], bPlayers: ["Jo Park"] };
    expect(matchSideLabels(sides)[0]).toBe("Sam");
    expect(matchSideLabels({ ...sides, aName: sides.bName, bName: sides.aName, aPlayers: sides.bPlayers, bPlayers: sides.aPlayers })[0]).toBe("Jo");
  });

  it("two cup teams with one name are not told apart by it, so the players are used", () => {
    expect(matchSideLabels({ aName: "Sam Hill", bName: "Jo Park", aPlayers: ["Sam Hill"], bPlayers: ["Jo Park"], aTeam: "Oaks", bTeam: "Oaks" })).toEqual(["Sam", "Jo"]);
  });

  it("CONTROL: a card built without its players still names a pair from the side's name", () => {
    expect(matchSideLabels({ side: true, aName: "Ann Lee & Bea Ray", bName: "Cat Doe & Dot Fox" })).toEqual(["Ann & Bea", "Cat & Dot"]);
  });
});

describe("the strip's marks", () => {
  it("the winner's initials, never W and L", () => {
    expect(sideMarks("Sam & Alex", "Jo & Max")).toEqual(["SA", "JM"]);
    expect(sideMarks("Sam", "Jo")).toEqual(["S", "J"]);
  });

  it("widened where the initials clash, and never the same mark for both sides", () => {
    expect(sideMarks("Cedars", "Cypress")).toEqual(["CE", "CY"]);
    const [x, y] = sideMarks("Ann", "Ann");
    expect(x).not.toBe(y);
  });
});
