import { describe, it, expect } from "vitest";
import {
  planMatch,
  parseHandicap,
  matchNeedsCard,
  matchTitle,
  HANDICAP_MIN,
  HANDICAP_MAX,
} from "../quick-match";
import { resolveMatch } from "../match";
import { isMatch, capabilitiesOf, shapeOption, isTournamentShape } from "@/lib/tournament-shape";

/**
 * The whole of the decision this screen makes, asserted against VALUES.
 *
 * Shape assertions are what this file must not settle for — a plan with two
 * players and eighteen holes is satisfied by almost any wrong answer, and the
 * matrix suite has four documented cases where exactly that passed. So every
 * case below either names the number it expects or is built so the wrong
 * answer looks different from the right one.
 */
describe("planning a match", () => {
  it("takes two names and nothing else", () => {
    const r = planMatch({ players: [{ name: "Alex" }, { name: "Sam" }] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.players.map((p) => p.name)).toEqual(["Alex", "Sam"]);
    expect(r.plan.name).toBe("Alex v Sam");
    expect(r.plan.holes).toBe(18);
    expect(r.plan.format).toBe("Match Play");
    // Level, because nobody asked for strokes. A net match with two zeros is a
    // level match wearing the wrong label, and it is the label the card and
    // the leaderboard read.
    expect(r.plan.scoringBasis).toBe("gross");
    expect(r.plan.courseId).toBeNull();
  });

  it("refuses one player, and says what is missing", () => {
    const r = planMatch({ players: [{ name: "Alex" }, { name: "  " }] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/two players/i);
  });

  it("refuses two players with the same name", () => {
    // Not pedantry: the match is stored as A against B and read back as a name
    // on each side of a card, so two identical names produce a scorecard on
    // which no hole can be attributed. Case-insensitive, because "sam" and
    // "Sam" are one person typing quickly.
    const r = planMatch({ players: [{ name: "Sam" }, { name: "sam" }] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/same name/i);
  });

  it("refuses a third player rather than dropping them silently", () => {
    const r = planMatch({ players: [{ name: "A" }, { name: "B" }, { name: "C" }] });
    expect(r.ok).toBe(false);
  });

  it("gives shots only when asked, and calls that net", () => {
    const level = planMatch({ players: [{ name: "A" }, { name: "B" }], useHandicaps: false });
    const net = planMatch({ players: [{ name: "A" }, { name: "B" }], useHandicaps: true });
    expect(level.ok && level.plan.scoringBasis).toBe("gross");
    expect(net.ok && net.plan.scoringBasis).toBe("net");
    // The two answers must differ, or a passing test proves nothing about
    // which branch produced them.
    expect(level.ok && net.ok && level.plan.scoringBasis).not.toBe(net.ok && net.plan.scoringBasis);
  });

  it("only a net match needs the course's card", () => {
    expect(matchNeedsCard({ scoringBasis: "net" })).toBe(true);
    // Gross match play is the one format that genuinely needs no par and no
    // stroke index: who won the hole is not a question the card answers.
    expect(matchNeedsCard({ scoringBasis: "gross" })).toBe(false);
  });

  it("forces 'which nine' to full over eighteen holes", () => {
    // A stored "back" on an eighteen-hole round is not a preference; it is a
    // contradiction that reaches the scorecard as holes scored against the
    // wrong stroke indexes.
    const eighteen = planMatch({ players: [{ name: "A" }, { name: "B" }], holes: 18, nine: "back" });
    expect(eighteen.ok && eighteen.plan.nine).toBe("full");
    const nine = planMatch({ players: [{ name: "A" }, { name: "B" }], holes: 9, nine: "back" });
    expect(nine.ok && nine.plan.holes).toBe(9);
    expect(nine.ok && nine.plan.nine).toBe("back");
  });

  it("takes a title when given one, and names the match after the players when not", () => {
    const given = planMatch({ players: [{ name: "A" }, { name: "B" }], name: "  The Ryder Mug " });
    expect(given.ok && given.plan.name).toBe("The Ryder Mug");
    expect(matchTitle("A", "B")).toBe("A v B");
  });

  it("seeds the two players in the order they were entered", () => {
    // Seed decides which side of the card each name appears on, so it must not
    // depend on anything but the order they were typed.
    const r = planMatch({ players: [{ name: "Zed" }, { name: "Abe" }] });
    expect(r.ok && r.plan.players.map((p) => p.seed)).toEqual([1, 2]);
    expect(r.ok && r.plan.players[0].name).toBe("Zed");
  });
});

describe("reading a handicap somebody typed", () => {
  it("reads a plus-handicap as better than scratch", () => {
    // The one that matters. A +2 player is two shots BETTER than scratch, and
    // reading "+2" as 2 hands two shots to the best player in the match — a
    // wrong result that looks completely normal on the card.
    expect(parseHandicap("+2")).toBe(-2);
    expect(parseHandicap("+1.4")).toBe(-1.4);
    expect(parseHandicap("2")).toBe(2);
    // And the two readings must differ, or the assertion above is satisfied by
    // a parser that ignores the sign entirely.
    expect(parseHandicap("+2")).not.toBe(parseHandicap("2"));
  });

  it("treats an unknown handicap as zero rather than refusing", () => {
    // Half the people who play a Sunday match do not know their index, and
    // stopping the setup to demand one is the obstacle this whole path exists
    // to remove. Zero is a level match, which is what happens on the tee.
    expect(parseHandicap("")).toBe(0);
    expect(parseHandicap(null)).toBe(0);
    expect(parseHandicap("no idea")).toBe(0);
  });

  it("clamps a typo instead of allocating a stroke and a half a hole", () => {
    expect(parseHandicap("180")).toBe(HANDICAP_MAX);
    expect(parseHandicap("-99")).toBe(HANDICAP_MIN);
    expect(parseHandicap(12.44)).toBe(12.4);
  });
});

describe("a match is not a tournament", () => {
  it("is recorded as its own shape", () => {
    expect(isTournamentShape("match")).toBe(true);
    expect(isMatch("match")).toBe(true);
    expect(isMatch("series")).toBe(false);
    // An unknown value still falls back to a tournament rather than to a
    // match: guessing "match" would take a tournament's controls away.
    expect(isMatch("nonsense")).toBe(false);
    expect(isMatch(null)).toBe(false);
  });

  it("chains no rounds, so two friends are never offered a cut line", () => {
    const c = capabilitiesOf("match");
    expect(c.chainsRounds).toBe(false);
    expect(c.multipleRounds).toBe(false);
    expect(c.hasBracket).toBe(false);
    // Not the fallback's answer. `capabilitiesOf` ends in a `default` that
    // returns the series capabilities, so a missing case here would silently
    // report a match as a season.
    expect(c).not.toEqual(capabilitiesOf("series"));
  });

  it("describes itself rather than falling through to a series", () => {
    const opt = shapeOption("match");
    expect(opt.key).toBe("match");
    expect(opt.openingRound.format).toBe("Match Play");
    expect(opt.openingRound.type).not.toBe("Bracket Stage");
  });
});

describe("a match that has not been played", () => {
  it("is not finished, and is not a half", () => {
    /**
     * The column default for `Match.holes` is `"[]"`, and `resolveMatch` reads
     * an empty array as nought played out of nought remaining — a COMPLETE,
     * halved match. A match created on that default therefore arrived on the
     * dashboard already halved, already awaiting review, and already counted
     * as a result in, before either player had left the first tee.
     *
     * So the setup writes one null per hole, as every other path that creates
     * a match does. This asserts the difference between the two, because the
     * bug is invisible from the plan alone.
     */
    const asDefault = resolveMatch(JSON.parse("[]"));
    expect(asDefault.complete).toBe(true);

    const asCreated = resolveMatch(JSON.parse(JSON.stringify(new Array(18).fill(null))));
    expect(asCreated.complete).toBe(false);
    expect(asCreated.winner).toBeNull();
  });
});
