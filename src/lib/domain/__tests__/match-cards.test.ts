import { describe, it, expect } from "vitest";
import {
  matchCardFinished,
  matchStrokeCards,
  withoutSupersededStrokeCards,
  type MatchForCards,
} from "../match-cards";

/**
 * The join, and the line it must not cross.
 *
 * Asserted against the Rules of Golf rather than against what the code
 * currently does — Rule 3.2a(3) for when a match ends, Rule 3.2b for
 * concessions. Two fixtures in this suite once encoded matches that cannot
 * happen, and they survived for a year because the assertions agreed with the
 * implementation instead of with the game.
 */

const strokes = (n: number, holes = 18) => JSON.stringify(new Array(holes).fill(n));

/** A card of 18 hole results from a string, padded with nulls. */
const holesJson = (s: string, total = 18) =>
  JSON.stringify([...s.split(""), ...new Array(Math.max(0, total - s.length)).fill(null)]);

const match = (over: Partial<MatchForCards> = {}): MatchForCards => ({
  id: "m1",
  stageId: "s1",
  playerAId: "pA",
  playerBId: "pB",
  holes: holesJson(""),
  forfeitedBy: "",
  ...over,
});

describe("resolving a match card to a player's card", () => {
  it("maps slot A to player A and slot B to player B, in the match's round", () => {
    const out = matchStrokeCards(
      [
        { matchId: "m1", slot: "A", strokes: strokes(4) },
        { matchId: "m1", slot: "B", strokes: strokes(5) },
      ],
      [match()],
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ playerId: "pA", stageId: "s1", strokes: strokes(4) });
    expect(out[1]).toMatchObject({ playerId: "pB", stageId: "s1", strokes: strokes(5) });
  });

  it("drops a card it cannot place rather than guessing", () => {
    const rows = [
      // A match that is not in this event's list.
      { matchId: "gone", slot: "A", strokes: strokes(4) },
      // `slot` is a string in the database and its "A" | "B" type is erased at
      // runtime, so a third value is reachable.
      { matchId: "m1", slot: "C", strokes: strokes(4) },
      // A bye: the slot exists, the player does not.
      { matchId: "m2", slot: "B", strokes: strokes(4) },
    ];
    const out = matchStrokeCards(rows, [match(), match({ id: "m2", playerBId: "" })]);
    expect(out).toEqual([]);
  });

  it("returns every card a player holds in a round, not just one", () => {
    // A Round Robin stage holds the WHOLE round robin: in a flight of three,
    // one player has two matches inside a single round. Both cards are theirs.
    const out = matchStrokeCards(
      [
        { matchId: "m1", slot: "A", strokes: strokes(4) },
        { matchId: "m2", slot: "A", strokes: strokes(5) },
      ],
      [match(), match({ id: "m2", playerBId: "pC" })],
    );
    expect(out.map((c) => c.playerId)).toEqual(["pA", "pA"]);
    expect(out.every((c) => c.stageId === "s1")).toBe(true);
  });
});

describe("whether a match card can still gain holes", () => {
  it("is finished once the match is decided — Rule 3.2a(3)", () => {
    // A is five up with four to play after the 14th, so the match ends there,
    // 5&4. The last four holes are never played and never will be.
    const m = match({ holes: holesJson("AAAAAHHHHHHHHH") });
    expect(matchCardFinished(m)).toBe(true);
  });

  it("is finished when the match was conceded — Rule 3.2b", () => {
    // A concession has no holes at all, and a conceded match is WON rather
    // than led: nothing more is coming for either card.
    expect(matchCardFinished(match({ holes: holesJson(""), forfeitedBy: "pB" }))).toBe(true);
  });

  it("is finished on a full round that finishes all square", () => {
    expect(matchCardFinished(match({ holes: holesJson("H".repeat(18)) }))).toBe(true);
  });

  it("is not finished while the trailing player can still square it", () => {
    // A one up with two to play: |lead| is not greater than the holes left, so
    // the match is live and both cards can still grow.
    expect(matchCardFinished(match({ holes: holesJson("AHHHHHHHHHHHHHHH") }))).toBe(false);
  });

  it("is not finished for a match nobody has touched", () => {
    // `[]` is the schema default for `Match.holes`, and a halved match over
    // zero holes is what a naive reading of it produces. A match that has
    // never been played has not finished.
    expect(matchCardFinished(match({ holes: "[]" }))).toBe(false);
    expect(matchCardFinished(match({ holes: JSON.stringify(new Array(18).fill(null)) }))).toBe(false);
  });

  it("is not finished when the stored result cannot be read", () => {
    // The safe direction: an unreadable result must not silently declare a
    // card closed and take a player off the board.
    expect(matchCardFinished(match({ holes: "not json" }))).toBe(false);
  });
});

describe("one round is counted once", () => {
  /**
   * The two card tables are normally exclusive, and nothing enforces it.
   *
   * A stage that draws pairings can legitimately use STROKE entry — EntryModes
   * falls to "stroke" when the round's format is a stroke one, and the
   * organizer can switch the mode by hand — so a Round Robin scored as a medal
   * writes `Scorecard` rows while its matches exist. Changing a round's Format
   * after cards are in leaves the old rows behind too: only `clearRoundScores`
   * ever deletes a card, and Format stays editable while setup is unlocked.
   *
   * Before match cards were read at all this could not bite. Now both lists
   * reach `aggregateStroke`, which adds gross and holesOwed once per card and
   * cannot tell a duplicate from the several cards a Round Robin player
   * legitimately returns.
   */
  const joined = (playerId: string, stageId: string) => ({
    playerId, stageId, strokes: "[4,4,4]", finished: true,
  });

  it("drops a stroke card for a round the player also has match cards in", () => {
    const rows = [{ playerId: "p1", stageId: "s1", strokes: "[5,5,5]" }];
    expect(withoutSupersededStrokeCards(rows, [joined("p1", "s1")])).toEqual([]);
  });

  it("keeps a stroke card for a round with no match cards", () => {
    // The Round-Robin-scored-as-a-medal case: pairings exist, nobody used
    // match entry, and the medal cards are the only record there is. Dropping
    // them would lose a whole round.
    const rows = [{ playerId: "p1", stageId: "s2", strokes: "[5,5,5]" }];
    expect(withoutSupersededStrokeCards(rows, [joined("p1", "s1")])).toEqual(rows);
  });

  it("is per player as well as per round", () => {
    // One player entered by match, another by card, in the same round.
    const rows = [
      { playerId: "p1", stageId: "s1", strokes: "[5,5,5]" },
      { playerId: "p2", stageId: "s1", strokes: "[6,6,6]" },
    ];
    expect(withoutSupersededStrokeCards(rows, [joined("p1", "s1")])).toEqual([rows[1]]);
  });

  it("leaves everything alone when there are no match cards at all", () => {
    // Every pure stroke event in the database. This must be a no-op for them.
    const rows = [{ playerId: "p1", stageId: "s1", strokes: "[5,5,5]" }];
    expect(withoutSupersededStrokeCards(rows, [])).toBe(rows);
  });

  it("does not touch the several cards a round robin legitimately returns", () => {
    // Three matches in one stage is three cards for one player, and none of
    // them is a duplicate of another.
    const three = [joined("p1", "s1"), joined("p1", "s1"), joined("p1", "s1")];
    expect(withoutSupersededStrokeCards([], three)).toEqual([]);
    expect(three).toHaveLength(3);
  });
});

describe("the dedupe key cannot collide", () => {
  it("does not run two ids together", () => {
    // Found the hard way: the separator between the two ids was lost, leaving
    // `${playerId}${stageId}`. Then player "ab" in round "c" and player "a" in
    // round "bc" share one key, and one of them loses a card that is not a
    // duplicate of anything.
    const rows = [{ playerId: "a", stageId: "bc", strokes: "[4]" }];
    const joined = [{ playerId: "ab", stageId: "c", strokes: "[4]", finished: true }];
    expect(withoutSupersededStrokeCards(rows, joined)).toEqual(rows);
  });
});
