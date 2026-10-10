import { describe, it, expect } from "vitest";
import { cardsForReview, reviewCards, needsAttention } from "@/lib/domain/card-approval";

/**
 * THE APPROVAL PANEL REVIEWS THE FIELD'S CARDS ONLY (2026-10-09).
 *
 * Walked on a 120-player championship: a player disqualified for not holing out
 * left twelve holes on the round, and the panel listed them as "Unknown player
 * — Holes missing", the one card it said needed attention. Nothing anyone could
 * do with it would change a result: the disqualification already had.
 */
const full = new Array(18).fill(4);
const twelve = [...new Array(12).fill(4), ...new Array(6).fill(null)];

describe("cardsForReview", () => {
  const field = [
    { id: "ann", name: "Ann" },
    { id: "bob", name: "Bob" },
  ];
  const cards = { ann: full, bob: full, dq: twelve };
  const status = { ann: "approved", bob: "certified", dq: "entered" };

  it("leaves out a card whose player is no longer in the field", () => {
    const out = cardsForReview(cards, status, field, 18);
    expect(out.map((c) => c.playerName)).toEqual(["Ann", "Bob"]);
    expect(needsAttention(reviewCards(out))).toEqual([]);
  });

  it("CONTROL: the same card, its player back in the field, does need attention", () => {
    const out = cardsForReview(cards, status, [...field, { id: "dq", name: "Dee" }], 18);
    expect(needsAttention(reviewCards(out)).map((v) => v.playerName)).toEqual(["Dee"]);
  });

  it("reads an unknown status as entered, and keeps the round's length", () => {
    const [ann] = cardsForReview({ ann: full }, {}, field, 9);
    expect(ann).toMatchObject({ status: "entered", holes: 9, playerName: "Ann" });
  });
});
