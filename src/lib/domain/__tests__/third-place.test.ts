import { describe, it, expect } from "vitest";
import { resolveThirdPlace, semiFinalRound } from "@/lib/domain/third-place";
import type { BracketView } from "@/lib/domain/bracket";

const slot = (playerId: string) => ({ playerId, name: playerId, seed: 0 }) as never;

/** A draw of four: one semi-final round of two, then the final. */
const view = (over: { w1?: string | null; w2?: string | null } = {}): BracketView =>
  ({
    kind: "winners",
    champion: null,
    rounds: [
      {
        label: "Semifinals",
        roundIndex: 0,
        matches: [
          { key: "w-0-0", roundIndex: 0, matchIndex: 0, a: slot("p1"), b: slot("p2"), winnerId: "w1" in over ? over.w1 : "p1" },
          { key: "w-0-1", roundIndex: 0, matchIndex: 1, a: slot("p3"), b: slot("p4"), winnerId: "w2" in over ? over.w2 : "p3" },
        ],
      },
      {
        label: "Final",
        roundIndex: 1,
        matches: [
          { key: "w-1-0", roundIndex: 1, matchIndex: 0, a: slot("p1"), b: slot("p3"), winnerId: null },
        ],
      },
    ],
  }) as unknown as BracketView;

describe("finding the semi-finals", () => {
  it("takes the round before the final, by position not by label", () => {
    // A draw of eight and a draw of thirty-two call that round different
    // things; its position is the only stable answer.
    expect(semiFinalRound(view())?.label).toBe("Semifinals");
  });

  it("has none in a draw with only a final", () => {
    const justFinal = { ...view(), rounds: [view().rounds[1]] } as BracketView;
    expect(semiFinalRound(justFinal)).toBeNull();
  });
});

describe("who plays for third", () => {
  it("is the two beaten semi-finalists", () => {
    const r = resolveThirdPlace(view());
    expect(r.pairing?.a.playerId).toBe("p2");
    expect(r.pairing?.b.playerId).toBe("p4");
    expect(r.problem).toBe("");
  });

  it("follows the result rather than the draw position", () => {
    // The loser is whoever did not win, not whoever was listed second.
    const r = resolveThirdPlace(view({ w1: "p2", w2: "p4" }));
    expect(r.pairing?.a.playerId).toBe("p1");
    expect(r.pairing?.b.playerId).toBe("p3");
  });

  it("waits while a semi-final is unfinished", () => {
    /**
     * The important refusal. A pairing invented from an unplayed semi would
     * name two players who might both still reach the Final.
     */
    const r = resolveThirdPlace(view({ w2: null }));
    expect(r.pairing).toBeNull();
    expect(r.problem).toMatch(/Waiting on the semi-finals/);
  });

  it("refuses a draw too small to have semi-finals", () => {
    const justFinal = { ...view(), rounds: [view().rounds[1]] } as BracketView;
    expect(resolveThirdPlace(justFinal).problem).toMatch(/too small/);
  });

  it("refuses a penultimate round that is not two matches", () => {
    // Four matches there means quarter-finalists, not beaten semi-finalists.
    const wide = view();
    const rounds = [
      { ...wide.rounds[0], matches: [...wide.rounds[0].matches, ...wide.rounds[0].matches] },
      wide.rounds[1],
    ];
    expect(resolveThirdPlace({ ...wide, rounds } as BracketView).problem).toMatch(/exactly two semi-finals/);
  });

  it("says so when a semi-final was a bye", () => {
    const bye = view();
    bye.rounds[0].matches[1] = {
      ...bye.rounds[0].matches[1],
      b: slot(""),
      winnerId: "p3",
    };
    const r = resolveThirdPlace(bye);
    expect(r.pairing).toBeNull();
    expect(r.problem).toMatch(/bye/);
  });

  it("has nothing to say without a bracket", () => {
    expect(resolveThirdPlace(null).problem).toMatch(/no bracket yet/);
  });
});
