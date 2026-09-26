import { describe, expect, it } from "vitest";
import { buildBracket, type BracketView } from "../bracket";
import { bracketDraws, myTie, myTieLine } from "../my-tie";
import { yourCardNote } from "../your-card";
import type { Player } from "../types";

/**
 * A knockout player's "who am I playing", read off the draw.
 *
 * Eight invented players, seeded 1..8 — seed 1 meets seed 8 in the first
 * quarter-final, seed 4 meets seed 5 in the second, and those two winners
 * meet in the first semi-final.
 */
const field = ["Ada", "Bea", "Cy", "Dot", "Eve", "Fay", "Gus", "Hal"].map(
  (name, i) => ({ id: `p${i + 1}`, name }) as unknown as Player,
);
const draw = (winners: Record<string, string>): BracketView => buildBracket("winners", field, winners);
const one = (view: BracketView) => [{ label: "", view }];

describe("myTie", () => {
  it("names the opponent of a tie still to be played", () => {
    const t = myTie(one(draw({})), "p1");
    expect(t).toMatchObject({ state: "to-play", round: "Quarterfinals", opponent: "Hal" });
    expect(myTieLine(t!)).toBe("Quarterfinal v Hal");
  });

  it("says which tie decides an opponent not yet known", () => {
    // Ada is through; the other half of her semi is Dot v Eve, unplayed.
    const t = myTie(one(draw({ "winners-0-0": "p1" })), "p1");
    expect(t).toMatchObject({ state: "to-play", round: "Semifinals", opponent: "" });
    expect(myTieLine(t!)).toBe("Semifinal v the winner of Dot v Eve");
  });

  it("reports the round a player went out in, who beat them and by how much", () => {
    const view = draw({ "winners-0-0": "p1", "winners-0-1": "p4", "winners-1-0": "p4" });
    const t = myTie(one(view), "p1", { "winners-1-0": "19th" });
    expect(t).toMatchObject({ state: "out", round: "Semifinals", opponent: "Dot" });
    // "19th" is the hole it was settled on, not a margin.
    expect(myTieLine(t!)).toBe("Out in the semifinal · lost to Dot at the 19th");
    expect(myTieLine(myTie(one(view), "p1", { "winners-1-0": "2&1" })!)).toBe(
      "Out in the semifinal · lost to Dot 2&1",
    );
  });

  it("the winner of a tie is not out of it", () => {
    // The control on the case above: Dot WON that semi-final.
    const view = draw({ "winners-0-0": "p1", "winners-0-1": "p4", "winners-1-0": "p4" });
    expect(myTie(one(view), "p4")).toMatchObject({ state: "to-play", round: "Final" });
  });

  it("calls the loser of the final the runner-up, and its winner the champion", () => {
    const view = draw({
      "winners-0-0": "p1",
      "winners-0-1": "p4",
      "winners-0-2": "p3",
      "winners-0-3": "p2",
      "winners-1-0": "p1",
      "winners-1-1": "p2",
      "winners-2-0": "p2",
    });
    expect(myTieLine(myTie(one(view), "p1", { "winners-2-0": "1 up" })!)).toBe(
      "Runner-up · lost the final to Bea 1 up",
    );
    expect(myTie(one(view), "p2")!.state).toBe("champion");
    expect(myTieLine(myTie(one(view), "p2")!)).toBe("Champion");
  });

  it("is null for somebody the draw does not hold", () => {
    expect(myTie(one(draw({})), "nobody")).toBeNull();
    expect(myTie(one(draw({})), "")).toBeNull();
  });

  it("finds a player in the SECOND draw and names it", () => {
    const main = buildBracket("winners", field.slice(0, 4), {});
    const plate = buildBracket("consolation", field.slice(4), {});
    const draws = bracketDraws({ winners: main, consolation: plate, mainLabel: "Flight A", secondLabel: "Flight B" });
    const t = myTie(draws, "p5");
    expect(t).toMatchObject({ draw: "Flight B", opponent: "Hal" });
    expect(myTieLine(t!)).toBe("Semifinal (Flight B) v Hal");
  });

  it("does not search a second draw the mode does not have", () => {
    const consolation = buildBracket("consolation", field.slice(4), {});
    const draws = bracketDraws({ winners: buildBracket("winners", field.slice(0, 4), {}), consolation, secondLabel: "" });
    expect(draws).toHaveLength(1);
    expect(myTie(draws, "p5")).toBeNull();
  });
});

describe("yourCardNote on a knockout", () => {
  it("sends the player to the draw, not to a card or the qualifying board", () => {
    const note = yourCardNote({ side: null, holes: 18, round: true, knockout: true });
    expect(note).toMatch(/on the draw/);
    expect(note).not.toMatch(/as soon as it’s in/);
    // Control: a plain match round keeps its own sentence.
    expect(yourCardNote({ side: null, holes: 18, round: true })).toMatch(/against your opponent/);
  });
});
