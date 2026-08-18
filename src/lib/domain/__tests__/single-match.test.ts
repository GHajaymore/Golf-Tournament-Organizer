import { describe, it, expect } from "vitest";
import {
  parseSingleMatchRule,
  resolveSingleMatch,
  describeSingleMatchRule,
  DEFAULT_SINGLE_MATCH_RULE,
} from "@/lib/domain/single-match";

const ctx = (over: Partial<Parameters<typeof resolveSingleMatch>[1]> = {}) => ({
  standingIds: ["p1", "p2", "p3"],
  winnerOfStage: (id: string) => (id === "s1" ? "p1" : id === "s2" ? "p2" : null),
  fieldIds: ["p1", "p2", "p3", "p4"],
  ...over,
});

describe("reading a stored rule", () => {
  it("takes the three shapes it knows", () => {
    expect(parseSingleMatchRule('{"kind":"seeds","a":1,"b":2}')).toEqual({ kind: "seeds", a: 1, b: 2 });
    expect(parseSingleMatchRule('{"kind":"stage-winners","a":"s1","b":"s2"}')).toEqual({
      kind: "stage-winners", a: "s1", b: "s2",
    });
    expect(parseSingleMatchRule('{"kind":"named","a":"p1","b":"p2"}')).toEqual({
      kind: "named", a: "p1", b: "p2",
    });
  });

  it("refuses a rule that pairs somebody with themselves", () => {
    expect(parseSingleMatchRule('{"kind":"seeds","a":1,"b":1}')).toBeNull();
    expect(parseSingleMatchRule('{"kind":"named","a":"p1","b":"p1"}')).toBeNull();
  });

  it("refuses nonsense rather than falling back to a default", () => {
    /**
     * Deliberate. Defaulting an unreadable rule to "first against second"
     * would quietly run a different match from the one the committee
     * announced, and the screen would look perfectly normal.
     */
    expect(parseSingleMatchRule('{"kind":"wheelbarrow"}')).toBeNull();
    expect(parseSingleMatchRule("not json")).toBeNull();
    expect(parseSingleMatchRule("")).toBeNull();
    expect(parseSingleMatchRule('{"kind":"seeds","a":0,"b":2}')).toBeNull();
  });
});

describe("first against second", () => {
  it("pairs the top two of the standings", () => {
    const r = resolveSingleMatch(DEFAULT_SINGLE_MATCH_RULE, ctx());
    expect(r.pairing).toEqual({ playerAId: "p1", playerBId: "p2" });
    expect(r.problem).toBe("");
  });

  it("takes any two seeds, not just the top", () => {
    const r = resolveSingleMatch({ kind: "seeds", a: 2, b: 3 }, ctx());
    expect(r.pairing).toEqual({ playerAId: "p2", playerBId: "p3" });
  });

  it("waits rather than guessing when the standings are short", () => {
    // The ordinary state for most of a tournament: a final cannot know its
    // players until the rounds before it are done.
    const r = resolveSingleMatch({ kind: "seeds", a: 1, b: 2 }, ctx({ standingIds: ["p1"] }));
    expect(r.pairing).toBeNull();
    expect(r.problem).toMatch(/only 1 player has a score/);
  });

  it("reads the standings as they are NOW, not as they were", () => {
    // The whole reason the pairing is derived rather than stored: correcting
    // an upstream score has to change who plays the final.
    const before = resolveSingleMatch(DEFAULT_SINGLE_MATCH_RULE, ctx());
    const after = resolveSingleMatch(DEFAULT_SINGLE_MATCH_RULE, ctx({ standingIds: ["p3", "p1", "p2"] }));
    expect(before.pairing).toEqual({ playerAId: "p1", playerBId: "p2" });
    expect(after.pairing).toEqual({ playerAId: "p3", playerBId: "p1" });
  });
});

describe("winner against winner", () => {
  it("pairs the winners of two earlier rounds", () => {
    const r = resolveSingleMatch({ kind: "stage-winners", a: "s1", b: "s2" }, ctx());
    expect(r.pairing).toEqual({ playerAId: "p1", playerBId: "p2" });
  });

  it("waits when one of them has not finished", () => {
    const r = resolveSingleMatch({ kind: "stage-winners", a: "s1", b: "s9" }, ctx());
    expect(r.pairing).toBeNull();
    expect(r.problem).toMatch(/one hasn't finished/);
  });

  it("says so when the same player won both", () => {
    // Real, and not something to paper over by inventing an opponent.
    const r = resolveSingleMatch(
      { kind: "stage-winners", a: "s1", b: "s2" },
      ctx({ winnerOfStage: () => "p1" }),
    );
    expect(r.pairing).toBeNull();
    expect(r.problem).toMatch(/nobody for them to play/);
  });
});

describe("two players an organizer picked", () => {
  it("pairs them", () => {
    const r = resolveSingleMatch({ kind: "named", a: "p1", b: "p4" }, ctx());
    expect(r.pairing).toEqual({ playerAId: "p1", playerBId: "p4" });
  });

  it("refuses once one of them has left the field", () => {
    const r = resolveSingleMatch({ kind: "named", a: "p1", b: "gone" }, ctx());
    expect(r.pairing).toBeNull();
    expect(r.problem).toMatch(/no longer in the field/);
  });
});

describe("with no rule at all", () => {
  it("asks for one instead of picking", () => {
    const r = resolveSingleMatch(null, ctx());
    expect(r.pairing).toBeNull();
    expect(r.problem).toMatch(/choose who plays it/);
  });
});

describe("how it reads on screen", () => {
  const nameOf = (id: string) => ({ p1: "Tom Halloran", p2: "Priya Nair" })[id] ?? id;
  const roundOf = (id: string) => ({ s1: "Round 1", s2: "Round 2" })[id] ?? id;

  it("says what a committee would say", () => {
    expect(describeSingleMatchRule(DEFAULT_SINGLE_MATCH_RULE, nameOf, roundOf))
      .toBe("First against second in the standings");
    expect(describeSingleMatchRule({ kind: "stage-winners", a: "s1", b: "s2" }, nameOf, roundOf))
      .toBe("Winner of Round 1 against winner of Round 2");
    expect(describeSingleMatchRule({ kind: "named", a: "p1", b: "p2" }, nameOf, roundOf))
      .toBe("Tom Halloran against Priya Nair");
  });
});
