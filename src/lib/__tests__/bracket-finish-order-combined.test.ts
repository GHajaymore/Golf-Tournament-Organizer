import { describe, it, expect } from "vitest";
import { bracketFinishOrderCombined } from "../domain/bracket";
import type { BracketView } from "../domain/bracket";

/**
 * A SPLIT knockout has two flights, and the bottom one must not vanish.
 *
 * Split is the default bracket mode: the field is divided by qualifying rank
 * into Flight A (the winners draw) and Flight B (drawn straight into the
 * "consolation" draw — not a plate). Finishing order used to read only the
 * winners draw, so Flight B — half the field — got no finishing position, hence
 * zero season points and a false "entries dropped, no roster link" on the
 * season screen. `bracketFinishOrderCombined` stitches the two together.
 *
 * These build views directly rather than through `buildBracket`, because the
 * rule under test is purely how two finished draws are combined.
 */

const slot = (playerId: string | null, name: string) => ({ playerId, seed: null, name });

/** A one-round (final only) bracket: champ beats loser. Loser ranks 2nd
 *  (2^(1-1-0)+1). A null champ models a flight not yet decided. */
function finalView(kind: BracketView["kind"], champ: string | null, loser: string): BracketView {
  return {
    kind,
    rounds: [
      {
        label: "Final",
        roundIndex: 0,
        matches: [
          {
            key: `${kind}-0-0`,
            roundIndex: 0,
            matchIndex: 0,
            a: slot(champ, (champ ?? "?").toUpperCase()),
            b: slot(loser, loser.toUpperCase()),
            winnerId: champ,
          },
        ],
      },
    ],
    champion: champ ? slot(champ, champ.toUpperCase()) : null,
  };
}

describe("bracketFinishOrderCombined places both flights of a split knockout", () => {
  it("appends the disjoint bottom flight BELOW the top flight", () => {
    const winners = finalView("winners", "p1", "p2");
    const consolation = finalView("consolation", "p5", "p6");

    const order = bracketFinishOrderCombined(winners, consolation);
    // Every one of the four is placed — the bug dropped p5 and p6 entirely.
    expect(order.map((p) => p.playerId)).toEqual(["p1", "p2", "p5", "p6"]);
    // Flight A fills the top two places; Flight B starts below it.
    expect(order.map((p) => p.rank)).toEqual([1, 2, 3, 4]);
  });

  it("leaves plate mode unchanged — a consolation of already-placed players adds nobody", () => {
    const winners = finalView("winners", "p1", "p2");
    // Both consolation players are already placed in the winners draw (the shape
    // a plate has: it is fed by the winners' own losers).
    const consolation = finalView("consolation", "p2", "p1");

    const order = bracketFinishOrderCombined(winners, consolation);
    expect(order.map((p) => p.playerId)).toEqual(["p1", "p2"]);
    expect(order.map((p) => p.rank)).toEqual([1, 2]);
  });

  it("does not place the bottom flight until its own final is decided", () => {
    const winners = finalView("winners", "p1", "p2");
    const consolation = finalView("consolation", null, "p6"); // Flight B unfinished

    const order = bracketFinishOrderCombined(winners, consolation);
    expect(order.map((p) => p.playerId)).toEqual(["p1", "p2"]);
  });

  it("returns nothing while the top flight itself is undecided", () => {
    const winners = finalView("winners", null, "p2");
    const consolation = finalView("consolation", "p5", "p6");

    // No champion up top means no finishing order at all — the caller falls back
    // rather than being handed a guess, exactly as the single-draw reader does.
    expect(bracketFinishOrderCombined(winners, consolation)).toEqual([]);
  });
});
