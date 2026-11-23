import { describe, it, expect } from "vitest";
import { playersWithNoCard, noCardReturnedWords, noCardReturnedLabel, closingState } from "../missing-cards";
import { closingWords, closingTickShown } from "../closing-words";
import { unplacedWorking, CITE } from "../figure-working";
import { scoreEntryAsksWhere } from "../venue";
import { releaseView, RELEASE_VERB } from "../release-results";

/**
 * CLOSING A ROUND ON SCORE ENTRY (R12): the words and the small rules the redesigned screens read, each worked from what the
 * Rules and the board say rather than from the code's own route.
 */

const field = [
  { id: "a", name: "Zz Ann" },
  { id: "b", name: "Zz Bo" },
  { id: "c", name: "Zz Cy" },
  { id: "d", name: "Zz Di" },
];

describe("who is still owed a card", () => {
  it("is the field, less those who hold a card with a hole on it, less those marked out for the week", () => {
    const owed = playersWithNoCard(field, new Set(["a"]), new Set(["d"]));
    expect(owed.map((p) => p.id)).toEqual(["b", "c"]);
  });

  it("is nobody when every card is in (the control: the same field with none in is all of it)", () => {
    expect(playersWithNoCard(field, new Set(field.map((p) => p.id)), new Set())).toEqual([]);
    expect(playersWithNoCard(field, new Set(), new Set()).map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps the order of the field it was handed", () => {
    const owed = playersWithNoCard([field[2], field[0], field[1]], new Set(), new Set());
    expect(owed.map((p) => p.id)).toEqual(["c", "a", "b"]);
  });
});

describe("No card returned is the board's own sentence, with its Rule", () => {
  it("says what unplacedWorking says for a player with no card in a closed round", () => {
    const board = unplacedWorking({ ranked: false, thru: 0, missedRound: "Round 2" });
    expect(board).not.toBeNull();
    const panel = noCardReturnedWords("Round 2");
    expect(panel.says).toBe(board!.says);
    expect(panel.cite).toBe(board!.cite);
    // Rule 3.3b: a card must be returned and certified; none returned, no score for the round.
    expect(panel.cite).toBe(CITE.noReturn);
    expect(panel.says).toContain("No card was returned for Round 2");
  });

  it("labels the line with the round, so two rounds are never confused", () => {
    expect(noCardReturnedLabel("Round 2")).toBe("No card returned: Round 2");
    expect(noCardReturnedLabel("Round 1")).not.toBe(noCardReturnedLabel("Round 2"));
  });
});

describe("the close section's state, said on its folded line", () => {
  it("says closed, then how many cards are to come, then that they are in", () => {
    expect(closingState(true, 3, "Round 1")).toBe("Round 1 is closed");
    expect(closingState(false, 1, "Round 1")).toBe("1 card to come");
    expect(closingState(false, 2, "Round 1")).toBe("2 cards to come");
    expect(closingState(false, 0, "Round 1")).toBe("Cards are in");
  });
});

describe("what the tick says about itself", () => {
  it("keeps the old screen's whole paragraph word for word, and the short line is a line of it", () => {
    const stroke = closingWords(false);
    expect(stroke.whole).toBe(
      "Tell the board the round is over, which makes its result official — the public board reads Final rather than All in. Anybody without a complete card for it is then shown without a place, the same as a card that stopped short — they have not completed the competition. Leave it unticked while cards are still coming in.",
    );
    expect(stroke.short.length).toBeLessThan(stroke.whole.length);
    expect(stroke.whole.startsWith(stroke.short.replace(/\.$/, ""))).toBe(true);
    const points = closingWords(true);
    expect(points.whole).toContain("changes nobody's position");
    expect(points.whole.startsWith(points.short.replace(/\.$/, ""))).toBe(true);
  });

  it("is offered for a round with a place to take, and not for a bracket or a round of match points", () => {
    expect(closingTickShown({ type: "Stroke Play Round", format: "Stroke Play", scoringBasis: "gross" })).toBe(true);
    expect(closingTickShown({ type: "Bracket Stage", format: "Match Play", scoringBasis: "gross" })).toBe(false);
    expect(closingTickShown({ type: "Round Robin", format: "Match Play", scoringBasis: "gross" })).toBe(false);
  });
});

describe("Played at is asked where each pairing arranges its own venue", () => {
  it("is not asked of a fixed course on the redesigned screen, and is asked of an open one", () => {
    expect(scoreEntryAsksWhere({ onlyForOpenCourse: true, openCourse: false })).toBe(false);
    expect(scoreEntryAsksWhere({ onlyForOpenCourse: true, openCourse: true })).toBe(true);
  });

  it("CONTROL: the old screen asks as it always did, whatever the course mode", () => {
    expect(scoreEntryAsksWhere({ onlyForOpenCourse: false, openCourse: false })).toBe(true);
    expect(scoreEntryAsksWhere({ onlyForOpenCourse: false, openCourse: true })).toBe(true);
  });
});

describe("Results has one verb for releasing", () => {
  const complete = { kind: "complete" as const, href: "/dashboard", enabled: true, disabledBecause: null, asks: null };

  it("offers the one verb, pointing at the machine's press, once play is over", () => {
    const v = releaseView("play-over", complete);
    expect(v.kind).toBe("ready");
    if (v.kind === "ready") {
      expect(v.verb).toBe(RELEASE_VERB);
      expect(v.href).toBe("/dashboard");
    }
  });

  it("says the machine's own reason when it is refused, and offers no verb", () => {
    const v = releaseView("play-over", { ...complete, enabled: false, disabledBecause: "A result is disputed." });
    expect(v).toEqual({ kind: "blocked", says: "A result is disputed." });
  });

  it("carries the machine's question, so the card can say that it asks first", () => {
    const v = releaseView("play-over", { ...complete, asks: "Round 2 has no scores." });
    expect(v.kind === "ready" && v.asks).toBe("Round 2 has no scores.");
  });

  it("offers no verb while there is golf to close, and says when it will", () => {
    for (const step of ["setting-up", "live"] as const) {
      const v = releaseView(step, null);
      expect(v.kind).toBe("later");
      expect(v.says).toContain(RELEASE_VERB);
    }
  });

  it("says the results are released once completed, with the way back to correct a card", () => {
    const v = releaseView("completed", { kind: "reopen", href: "/dashboard", enabled: true, disabledBecause: null, asks: null });
    expect(v.kind).toBe("released");
    expect(v.kind === "released" && v.reopen?.href).toBe("/dashboard");
    // The control: a completed tournament that may not be reopened offers no way back.
    const locked = releaseView("completed", { kind: "reopen", href: "/dashboard", enabled: false, disabledBecause: "x", asks: null });
    expect(locked.kind === "released" && locked.reopen).toBeNull();
  });
});
