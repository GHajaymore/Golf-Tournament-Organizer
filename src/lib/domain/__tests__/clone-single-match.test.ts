import { describe, it, expect } from "vitest";
import {
  cloneSingleMatchRule,
  parseSingleMatchRule,
  resolveSingleMatch,
  type SingleMatchContext,
} from "../single-match";

/**
 * A copied final knows which rounds it is waiting on.
 *
 * The rule stores HOW to pick the two players rather than which two, which is
 * what keeps it honest as scores are corrected. But two of the three kinds are
 * made of ids, and ids belong to the tournament they were written in — so
 * copying the JSON across gave the new tournament a final pointing into the
 * old one, and saying so in words that named the wrong culprit.
 *
 * What makes it worth a test rather than a fix: BOTH failures look exactly
 * like the ordinary not-ready state. "Waiting on the earlier rounds" is what a
 * final correctly says for most of a tournament.
 */

/** Last year's ids on the left, this year's on the right. */
const MAP: Record<string, string> = { "old-r1": "new-r1", "old-r2": "new-r2", "old-r3": "new-r3" };
const remap = (id: string) => MAP[id] ?? null;

const json = (o: unknown) => JSON.stringify(o);

describe("a seeds rule", () => {
  it("copies across untouched", () => {
    // It names positions in a standing, and the copy has standings of its own.
    const out = cloneSingleMatchRule(json({ kind: "seeds", a: 1, b: 2 }), remap);
    expect(parseSingleMatchRule(out)).toEqual({ kind: "seeds", a: 1, b: 2 });
  });

  it("keeps a rule that is not first against second", () => {
    const out = cloneSingleMatchRule(json({ kind: "seeds", a: 3, b: 4 }), remap);
    expect(parseSingleMatchRule(out)).toEqual({ kind: "seeds", a: 3, b: 4 });
  });
});

describe("a stage-winners rule", () => {
  it("points at the COPY's rounds, not last year's", () => {
    /**
     * The defect. `winnerOfStage("old-r1")` in the new tournament returns null
     * because no such round is in it, so the final read "Waiting on the earlier
     * rounds — one hasn't finished" from the day it was created. Playing both
     * of this year's rounds out changed nothing: it was not waiting on them.
     */
    const out = cloneSingleMatchRule(json({ kind: "stage-winners", a: "old-r1", b: "old-r2" }), remap);
    expect(parseSingleMatchRule(out)).toEqual({ kind: "stage-winners", a: "new-r1", b: "new-r2" });
  });

  it("remaps a rule that names a LATER round as well as an earlier one", () => {
    // A play-off against the winner of a plate that is drawn after it. Remapped
    // in a second pass for exactly this reason: doing it as each round is
    // created would be right only by luck of ordering.
    const out = cloneSingleMatchRule(json({ kind: "stage-winners", a: "old-r3", b: "old-r1" }), remap);
    expect(parseSingleMatchRule(out)).toEqual({ kind: "stage-winners", a: "new-r3", b: "new-r1" });
  });

  it("is dropped when one of the rounds was not copied", () => {
    // Half a rule is not better than none: it would still never resolve, and
    // it would still say it was waiting.
    expect(cloneSingleMatchRule(json({ kind: "stage-winners", a: "old-r1", b: "gone" }), remap)).toBe("");
  });
});

describe("a named rule", () => {
  it("is dropped, because the field is not copied", () => {
    // There is nothing in the copy to remap a player id onto — players are
    // never carried across. Left as it was, it accused the new tournament of a
    // withdrawal that never happened.
    expect(cloneSingleMatchRule(json({ kind: "named", a: "old-ann", b: "old-bea" }), remap)).toBe("");
  });
});

describe("a rule that could not be read in the first place", () => {
  it("stays unset rather than becoming the default", () => {
    // Falling back to "1 v 2" would quietly run a different match from the one
    // the committee announced — the same reason `parseSingleMatchRule` refuses
    // to guess.
    for (const bad of ["", "   ", "not json", json({ kind: "seeds", a: 1, b: 1 }), json({ kind: "what" })]) {
      expect(cloneSingleMatchRule(bad, remap), bad).toBe("");
    }
  });
});

describe("what the copied round then says", () => {
  const ctx = (over: Partial<SingleMatchContext> = {}): SingleMatchContext => ({
    standingIds: [],
    winnerOfStage: () => null,
    fieldIds: [],
    ...over,
  });

  it("a remapped stage-winners rule actually pairs, once the copy's rounds finish", () => {
    // The assertion that matters. Checking the JSON alone would pass for a
    // remap onto ids nothing recognises.
    const out = cloneSingleMatchRule(json({ kind: "stage-winners", a: "old-r1", b: "old-r2" }), remap);
    const winners: Record<string, string> = { "new-r1": "ann", "new-r2": "bea" };
    const res = resolveSingleMatch(
      parseSingleMatchRule(out),
      ctx({ winnerOfStage: (id) => winners[id] ?? null, fieldIds: ["ann", "bea"] }),
    );
    expect(res.pairing).toEqual({ playerAId: "ann", playerBId: "bea" });
  });

  it("the copied-verbatim rule would have waited on last year's rounds forever", () => {
    /**
     * The before-state, kept as a test so the reason for the remap survives the
     * fix. This year's rounds are finished and this year's field is present;
     * the rule still cannot resolve, and the sentence it produces sends an
     * organizer to look at rounds that are not the problem.
     */
    const stale = parseSingleMatchRule(json({ kind: "stage-winners", a: "old-r1", b: "old-r2" }));
    const winners: Record<string, string> = { "new-r1": "ann", "new-r2": "bea" };
    const res = resolveSingleMatch(stale, ctx({ winnerOfStage: (id) => winners[id] ?? null, fieldIds: ["ann", "bea"] }));
    expect(res.pairing).toBeNull();
    expect(res.problem).toContain("Waiting on the earlier rounds");
  });

  it("a dropped rule asks to be set instead of reporting a withdrawal", () => {
    // The named case, end to end. "No pairing rule set — choose who plays it"
    // is a sentence an organizer can act on; "one of the players is no longer
    // in the field" is one they cannot, because it is not true.
    const out = cloneSingleMatchRule(json({ kind: "named", a: "old-ann", b: "old-bea" }), remap);
    const res = resolveSingleMatch(parseSingleMatchRule(out), ctx({ fieldIds: ["ann", "bea"] }));
    expect(res.pairing).toBeNull();
    expect(res.problem).toContain("no pairing rule set");

    // And what it used to say, for contrast.
    const stale = parseSingleMatchRule(json({ kind: "named", a: "old-ann", b: "old-bea" }));
    expect(resolveSingleMatch(stale, ctx({ fieldIds: ["ann", "bea"] })).problem).toContain(
      "no longer in the field",
    );
  });
});
