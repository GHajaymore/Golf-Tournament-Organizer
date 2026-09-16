import { describe, it, expect } from "vitest";
import { roundMoneyFinality } from "@/lib/services/expenses";

/**
 * ONE DEFINITION OF "THIS ROUND'S MONEY IS KNOWABLE", AND IT USED TO BE TWO.
 *
 * The round card above the ledger asked: every card in, or every match OVER,
 * or the organizer closed the tournament. The derived pots below it asked only
 * the first and the last.
 *
 * A match-play round scored as win-and-loss returns NO card rows — the result
 * lives on `Match.holes` — so for such a round the pots' copy saw zero holes
 * returned, forever. The round card said the round was finished; the pot under
 * it waited for the whole tournament to be marked complete.
 *
 * FOUND ON THE SEEDED DEMO, 2026-09-15, by reading `/me/money` as a player.
 * Round 1 is a Round Robin with 47 of 48 matches played and no cards, and the
 * screen said "Round 1 (0/18 holes in)" — zero being the right number for the
 * wrong instrument, and reading as "nobody has teed off".
 *
 * The comment on the pots' copy defended the omission on the grounds that
 * `matchSettled` is satisfied by a match with ONE hole on it and is far too
 * loose to release money. That is true, and it is an argument against
 * `matchSettled` rather than against asking the question — `matchIsOver` is
 * the strict reading, it lives beside `resolveMatch`, and the round card had
 * already adopted it.
 */

const HOLES_18 = 18;
const card = (stageId: string, strokes: (number | null)[]) => ({
  stageId,
  strokes: JSON.stringify(strokes),
});
const full = Array.from({ length: 18 }, () => 4);
const half = [...Array.from({ length: 9 }, () => 4), ...Array.from({ length: 9 }, () => null)];

/** A match A won 5&4: decided, with four holes never played. */
const wonMatch = (stageId: string) => ({
  stageId,
  holes: JSON.stringify([...Array.from({ length: 14 }, () => "A"), null, null, null, null]),
});
/** A match one hole old — started, nowhere near over. */
const startedMatch = (stageId: string) => ({
  stageId,
  holes: JSON.stringify(["A", ...Array.from({ length: 17 }, () => null)]),
});

/**
 * A ROUND WITH FIXTURES IS DECIDED BY ITS FIXTURES, never by its cards.
 *
 * Every cell below this file's original defect passes `cards: []`, because
 * when it was written a match round HAD no cards — the result lived on
 * `Match.holes` and nothing else. That is no longer true: match play can be
 * scored on full gross cards, `roundStrokes` reads `MatchScorecard`, and both
 * money readers now hand those rows to this function.
 *
 * So the instrument that was reading ZERO forever can now read EIGHTEEN early.
 * Five finished matches between them cover every hole of the course, and a
 * round with the sixth pairing still on the 12th reported every hole in and
 * settled. Caught by `match-cards.audit.test.ts` — "one match still out holds
 * the pot open" — which is the same hazard `docs/scoring-input-model.md`
 * predicted, arriving from the opposite direction: not a complete match
 * refused for a short card, but an incomplete ROUND paid out on somebody
 * else's card.
 *
 * `holesReturned` asks "has the field returned its scores". That is the right
 * question for a medal round and a meaningless one for a draw, because a match
 * is over when it is WON — 5&4 leaves four holes unplayed — so no count of
 * holes can tell a finished round from one still being played.
 */
describe("a match round that DOES have cards", () => {
  it("is NOT settled by the cards while a match is still out", () => {
    const r = roundMoneyFinality({
      stageId: "s1",
      holeCount: HOLES_18,
      // Eighteen holes of card, which is exactly what five finished matches
      // leave behind — and not a word about the sixth.
      cards: [card("s1", full), card("s1", full)],
      matches: [wonMatch("s1"), wonMatch("s1"), startedMatch("s1")],
      eventCompleted: false,
    });
    expect(r.matchesOver, "two of the three are over").toBe(2);
    expect(r.matchesTotal).toBe(3);
    expect(r.final, "a full card cannot finish a round with a match still out").toBe(false);
  });

  it("is still FINAL once every match is over", () => {
    /**
     * THE CELL THAT KEEPS THE RULE FROM BEING "NEVER". Refusing the cards is
     * only correct if the fixtures can still settle the round — otherwise a
     * match round carrying cards would never pay at all, which is the defect
     * this whole file was written for, reintroduced by its own fix.
     */
    const r = roundMoneyFinality({
      stageId: "s1",
      holeCount: HOLES_18,
      cards: [card("s1", full), card("s1", full)],
      matches: [wonMatch("s1"), wonMatch("s1")],
      eventCompleted: false,
    });
    expect(r.final, "every match over is what finishes a match round").toBe(true);
  });

  it("leaves a round with NO fixtures settling on its cards, exactly as before", () => {
    /**
     * The control, and the direction that matters most: this rule must reach
     * only rounds that have a draw. A medal round and a four-ball have no
     * `Match` rows at all, and their cards are the ONLY measure they have — so
     * a rule that refused the cards everywhere would stop every stroke round
     * in the app from ever settling.
     */
    const r = roundMoneyFinality({
      stageId: "s1",
      holeCount: HOLES_18,
      cards: [card("s1", full)],
      matches: [],
      eventCompleted: false,
    });
    expect(r.holesReturned).toBe(18);
    expect(r.final, "a stroke round is finished when its cards are in").toBe(true);
  });
});

describe("a match round with no cards at all", () => {
  it("is FINAL once every match is over", () => {
    /**
     * The defect. Cards alone say zero holes in, forever, because a win-and-
     * loss round has no cards to count.
     */
    const r = roundMoneyFinality({
      stageId: "s1",
      holeCount: HOLES_18,
      cards: [],
      matches: [wonMatch("s1"), wonMatch("s1"), wonMatch("s1")],
      eventCompleted: false,
    });
    expect(r.holesReturned, "a win-and-loss round returns no cards").toBe(0);
    expect(r.final, "every match is over and the pot still would not settle").toBe(true);
    expect(r.matchesOver).toBe(3);
    expect(r.matchesTotal).toBe(3);
  });

  it("is NOT final while one match is still out", () => {
    /**
     * The other half, and the one that matters more: money must not be
     * released early. This is the seeded demo's exact shape — 47 of 48 done.
     */
    const r = roundMoneyFinality({
      stageId: "s1",
      holeCount: HOLES_18,
      cards: [],
      matches: [wonMatch("s1"), wonMatch("s1"), startedMatch("s1")],
      eventCompleted: false,
    });
    expect(r.final, "a round with a match still out paid out").toBe(false);
    expect(r.matchesOver).toBe(2);
    expect(r.matchesTotal).toBe(3);
  });

  it("does not treat a match one hole old as finished", () => {
    /**
     * `matchSettled` would. It is satisfied by a single hole, which is loose
     * enough for "which round are we on" and far too loose to release money —
     * the reason the pots' copy omitted the question in the first place.
     */
    const r = roundMoneyFinality({
      stageId: "s1",
      holeCount: HOLES_18,
      cards: [],
      matches: [startedMatch("s1")],
      eventCompleted: false,
    });
    expect(r.final).toBe(false);
  });

  it("counts a forfeit as over, because it is", () => {
    const r = roundMoneyFinality({
      stageId: "s1",
      holeCount: HOLES_18,
      cards: [],
      matches: [{ ...startedMatch("s1"), forfeitedBy: "p1" }],
      eventCompleted: false,
    });
    expect(r.final, "a conceded match is a result").toBe(true);
  });
});

describe("a stroke round, which has no fixtures", () => {
  it("is final when every hole is in", () => {
    const r = roundMoneyFinality({
      stageId: "s1",
      holeCount: HOLES_18,
      cards: [card("s1", full)],
      matches: [],
      eventCompleted: false,
    });
    expect(r.final).toBe(true);
    expect(r.matchesTotal, "a stroke round has no fixtures to report").toBe(0);
  });

  it("is not final on a partial card", () => {
    const r = roundMoneyFinality({
      stageId: "s1",
      holeCount: HOLES_18,
      cards: [card("s1", half)],
      matches: [],
      eventCompleted: false,
    });
    expect(r.final).toBe(false);
    expect(r.holesReturned).toBe(9);
  });

  it("an empty round is never final by having no matches", () => {
    /**
     * `matchesDone` requires fixtures to EXIST. Without that guard, "every
     * match is over" is vacuously true of a round with none, and a stroke
     * round nobody has started would settle its pot immediately.
     */
    const r = roundMoneyFinality({
      stageId: "s1",
      holeCount: HOLES_18,
      cards: [],
      matches: [],
      eventCompleted: false,
    });
    expect(r.final, "a round with nothing in it paid out").toBe(false);
  });
});

describe("what the two readers now share", () => {
  it("reads only its OWN round", () => {
    // Both call sites pass every card and every match in the tournament, so a
    // round that filtered loosely would settle on another round's results.
    const r = roundMoneyFinality({
      stageId: "s1",
      holeCount: HOLES_18,
      cards: [card("s2", full)],
      matches: [wonMatch("s2")],
      eventCompleted: false,
    });
    expect(r.holesReturned, "counted another round's cards").toBe(0);
    expect(r.matchesTotal, "counted another round's fixtures").toBe(0);
    expect(r.final).toBe(false);
  });

  it("the organizer closing the tournament still finishes it", () => {
    // The escape hatch for a day abandoned to weather: a club has to be able
    // to close an event and settle what was played.
    const r = roundMoneyFinality({
      stageId: "s1",
      holeCount: HOLES_18,
      cards: [],
      matches: [startedMatch("s1")],
      eventCompleted: true,
    });
    expect(r.final).toBe(true);
  });

  it("an unreadable card does not end a round", () => {
    // Reading a parse error as a finished match would settle money on a row
    // nobody can read.
    const r = roundMoneyFinality({
      stageId: "s1",
      holeCount: HOLES_18,
      cards: [],
      matches: [{ stageId: "s1", holes: "not json" }],
      eventCompleted: false,
    });
    expect(r.final).toBe(false);
  });
});
