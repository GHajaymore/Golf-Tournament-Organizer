/**
 * Tests written to kill the survivors of a Stryker run on `round-handicap.ts` (J49).
 *
 * Every figure below is worked BY HAND from the Rules of Handicapping, by a route the
 * code does not take (long division on paper, not `courseHandicapExact`):
 *
 *   Rule 6.1   Course Handicap = Index x Slope / 113 + (Course Rating - Par)
 *   Rule 6.2   the Playing Handicap takes the allowance of that EXACT figure; the whole
 *              number is made ONCE, and a half rounds UP (a plus 2.5 is plus 2).
 *   Rule 6.1   nine holes: half the Index, the nine-hole Rating and Par.
 *
 * The resolver is handed the figures; it does not make them. So the worked numbers are the
 * inputs, and what is asserted is which of them the round keeps, and which whole number and
 * which exact figure come out the other end.
 *
 * RUN FIRST, EVERY CALL HELD TO A DEADLINE (2026-11-10). The floor these tests raised was first
 * measured on a scratch config; the nightly measures COLD, with no incremental file, and a cold run
 * reaches a mutant's covering tests in vitest's order — behind `matrix.test.ts` and the other slow
 * files — so a kill made here can end instead as a plain timeout, which the ratchet counts as NOT
 * caught (`scripts/qa/mutation-ratchet.mjs`). That is how the nightly of 10 Nov lost two kills on
 * `handicap.ts`. So this file is named `*.ends.test.ts`, which the mutation run sorts FIRST
 * (`vitest.mutation.config.ts`), and every function of the module below is called through
 * `endsWithin`, as every file of that name must be (`mutation-ratchet.test.ts`).
 */

import { describe, it, expect } from "vitest";
import * as roundHandicap from "../round-handicap";
import { endsWithin } from "../../__tests__/ends-within";

/** The module's own function, every call held to a deadline. */
const held =
  <A extends unknown[], R>(fn: (...args: A) => R) =>
  (...args: A): R =>
    endsWithin(() => fn(...args));

const resolveRoundHandicap = held(roundHandicap.resolveRoundHandicap);
const roundParStrokesOf = held(roundHandicap.roundParStrokesOf);
const roundHandicapExactOf = held(roundHandicap.roundHandicapExactOf);
const handicapToFreeze = held(roundHandicap.handicapToFreeze);
const exactHandicapToFreeze = held(roundHandicap.exactHandicapToFreeze);
const isReturnedCard = held(roundHandicap.isReturnedCard);
const roundHandicapKey = held(roundHandicap.roundHandicapKey);
const acceptsHandicapChange = held(roundHandicap.acceptsHandicapChange);
const { FROZEN_HANDICAP_REFUSAL } = roundHandicap;

// Index 14.2, Slope 131, CR 72.4, Par 71:
//   14.2 x 131 = 1860.2 ; 1860.2 / 113 = 16.461947 (113 x 16 = 1808, 52.2 / 113 = 0.461947)
//   + (72.4 - 71) = 1.4  ->  17.861947 -> 18
const EXACT_18 = 17.861947;
// Index 11.3, Slope 125, CR 72.0, Par 72: 11.3 x 125 = 1412.5 ; / 113 = 12.5 exactly -> 13 (the half goes up)
const EXACT_HALF = 12.5;
// Index +2.5 (a plus handicap), Slope 113, CR = Par: -2.5 -> -2 (Rule 6.2: plus 2.5 is plus 2)
const EXACT_PLUS_HALF = -2.5;
// Nine holes, Index 14.2: 7.1 x 131 / 113 = 930.1 / 113 = 8.231 ; + (36.0 - 35) = 1 -> 9.231 -> 9
const EXACT_NINE = 9.231;

describe("a half rounds up, on both sides of scratch (Rule 6.2)", () => {
  it("12.5 is 13 and keeps its exact figure", () => {
    const r = resolveRoundHandicap({ member: 13, memberExact: EXACT_HALF });
    expect(r.handicap).toBe(13);
    expect(r.exact).toBe(12.5);
  });

  it("plus 2.5 is plus 2, not plus 3, and keeps its exact figure", () => {
    const r = resolveRoundHandicap({ member: -2, memberExact: EXACT_PLUS_HALF });
    expect(r.handicap).toBe(-2);
    expect(r.exact).toBe(-2.5);
  });

  it("a whole number handed in as a half is made whole the same way", () => {
    expect(resolveRoundHandicap({ member: 12.5 }).handicap).toBe(13);
    expect(resolveRoundHandicap({ member: -2.5 }).handicap).toBe(-2);
    expect(resolveRoundHandicap({ member: -2.6 }).handicap).toBe(-3);
    expect(resolveRoundHandicap({ member: 12.4 }).handicap).toBe(12);
    expect(resolveRoundHandicap({ member: 12.5 }).exact).toBe(12.5);
  });

  it("a figure that rounds to scratch is 0, never -0", () => {
    const r = resolveRoundHandicap({ member: -0.4, override: -0.3, frozen: -0.2 });
    expect(Object.is(r.handicap, 0)).toBe(true);
    expect(Object.is(r.exact, 0)).toBe(true);
    const m = resolveRoundHandicap({ member: -0.4 });
    expect(Object.is(m.handicap, 0)).toBe(true);
    expect(m.exact).toBe(-0.4);
  });

  it("a nine-hole round's exact figure is carried like any other", () => {
    const r = resolveRoundHandicap({ member: 9, memberExact: EXACT_NINE });
    expect(r.handicap).toBe(9);
    expect(r.exact).toBe(9.231);
  });
});

describe("the exact figure is only believed when it describes the same player", () => {
  it("an exact that rounds to a different whole number is ignored", () => {
    // 17.86 rounds to 18, not 17: the pair do not describe one handicap
    expect(resolveRoundHandicap({ member: 17, memberExact: EXACT_18 }).exact).toBe(17);
    // 12.49 rounds to 12, one below 13
    expect(resolveRoundHandicap({ member: 13, memberExact: 12.49 }).exact).toBe(13);
    // and one above
    expect(resolveRoundHandicap({ member: 12, memberExact: 12.5 }).exact).toBe(12);
  });

  it("an exact of the same whole number is used, at its edges", () => {
    expect(resolveRoundHandicap({ member: 18, memberExact: EXACT_18 }).exact).toBe(EXACT_18);
    expect(resolveRoundHandicap({ member: 12, memberExact: 11.5 }).exact).toBe(11.5);
    expect(resolveRoundHandicap({ member: 12, memberExact: 12.49 }).exact).toBe(12.49);
  });

  it("a missing, null or unusable exact falls back to the whole number", () => {
    expect(resolveRoundHandicap({ member: 18 }).exact).toBe(18);
    expect(resolveRoundHandicap({ member: 18, memberExact: null }).exact).toBe(18);
    expect(resolveRoundHandicap({ member: 18, memberExact: undefined }).exact).toBe(18);
    expect(resolveRoundHandicap({ member: 18, memberExact: "17.86" as unknown as number }).exact).toBe(18);
  });

  it("an exact that is not finite is never handed on, even to a scratch player (it rounds to 0)", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const r = resolveRoundHandicap({ member: 0, memberExact: bad });
      expect(r.exact).toBe(0);
      expect(Number.isFinite(r.exact)).toBe(true);
      const f = resolveRoundHandicap({ member: 0, frozen: 0, frozenExact: bad });
      expect(f.exact).toBe(0);
    }
  });

  it("a scratch exact of 0 or a fraction under half is kept for a scratch player", () => {
    expect(resolveRoundHandicap({ member: 0, memberExact: 0.4 }).exact).toBe(0.4);
    expect(resolveRoundHandicap({ member: 0, memberExact: -0.4 }).exact).toBe(-0.4);
    expect(resolveRoundHandicap({ member: 0, memberExact: 0 }).exact).toBe(0);
  });
});

describe("what is frozen beats what is chosen beats what is on the roster", () => {
  it("a frozen round keeps its whole number AND its exact figure over a live roster and an override", () => {
    const r = resolveRoundHandicap({
      frozen: 18,
      frozenExact: EXACT_18,
      override: 10,
      member: 12,
      memberExact: 11.6,
    });
    expect(r.handicap).toBe(18);
    expect(r.exact).toBe(EXACT_18);
    expect(r.source).toBe("frozen");
    expect(r.editable).toBe(false);
    // today it would use the committee's 10, not the roster's 12
    expect(r.differsFromCurrent).toBe(10);
  });

  it("a frozen round with no exact figure keeps exactly the whole number, whatever the roster now says", () => {
    const r = resolveRoundHandicap({ frozen: 18, override: null, member: 18, memberExact: 17.9 });
    expect(r.exact).toBe(18);
    expect(r.source).toBe("frozen");
  });

  it("a frozen exact for a different whole number is ignored", () => {
    expect(resolveRoundHandicap({ frozen: 18, frozenExact: 16.2, member: 18, memberExact: 17.9 }).exact).toBe(18);
  });

  it("an override of zero is a real figure, not an absent one", () => {
    const r = resolveRoundHandicap({ frozen: 5, override: 0, member: 9 });
    expect(r.differsFromCurrent).toBe(0);
    const o = resolveRoundHandicap({ override: 0, member: 9, memberExact: 9.2 });
    expect(o.handicap).toBe(0);
    expect(o.exact).toBe(0);
    expect(o.source).toBe("override");
    expect(o.editable).toBe(true);
  });

  it("a frozen scratch round is frozen, not absent", () => {
    const r = resolveRoundHandicap({ frozen: 0, override: 4, member: 9 });
    expect(r.source).toBe("frozen");
    expect(r.handicap).toBe(0);
    expect(r.differsFromCurrent).toBe(4);
  });

  it("a frozen round that agrees with today says nothing; one that disagrees names today's figure", () => {
    expect(resolveRoundHandicap({ frozen: 12, member: 12 }).differsFromCurrent).toBeNull();
    expect(resolveRoundHandicap({ frozen: 12, override: 12, member: 3 }).differsFromCurrent).toBeNull();
    expect(resolveRoundHandicap({ frozen: 12, member: 13 }).differsFromCurrent).toBe(13);
    expect(resolveRoundHandicap({ frozen: 12, override: 7, member: 12 }).differsFromCurrent).toBe(7);
    expect(resolveRoundHandicap({ frozen: -2, member: 2 }).differsFromCurrent).toBe(2);
  });

  it("today's figure, when the roster's is fractional, is the rounded one", () => {
    // 17.86 is 18 today; the round was frozen at 18
    expect(resolveRoundHandicap({ frozen: 18, member: 17.861947 }).differsFromCurrent).toBeNull();
    expect(resolveRoundHandicap({ frozen: 17, member: 17.861947 }).differsFromCurrent).toBe(18);
  });

  it("an override is a whole number by decree: it ignores the roster's exact figure and rounds a fraction once", () => {
    const r = resolveRoundHandicap({ override: 10, member: 9, memberExact: 9.4 });
    expect(r.handicap).toBe(10);
    expect(r.exact).toBe(10);
    expect(r.differsFromCurrent).toBeNull();
    const f = resolveRoundHandicap({ override: 10.5, member: 9 });
    expect(f.handicap).toBe(11);
    expect(f.exact).toBe(11);
    const p = resolveRoundHandicap({ override: -1.5, member: 9 });
    expect(p.handicap).toBe(-1);
    expect(p.exact).toBe(-1);
  });

  it("the roster's figure is the default, editable, and differs from nothing", () => {
    const r = resolveRoundHandicap({ member: 18, memberExact: EXACT_18 });
    expect(r.source).toBe("member");
    expect(r.editable).toBe(true);
    expect(r.differsFromCurrent).toBeNull();
  });
});

describe("figures that are not figures are treated as absent", () => {
  const bad: Array<[string, number | null | undefined]> = [
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
    ["-Infinity", Number.NEGATIVE_INFINITY],
    ["null", null],
    ["undefined", undefined],
    ["a string", "7" as unknown as number],
  ];

  for (const [label, value] of bad) {
    it(`a frozen of ${label} does not freeze the round`, () => {
      const r = resolveRoundHandicap({ frozen: value, override: 6, member: 9 });
      expect(r.source).toBe("override");
      expect(r.handicap).toBe(6);
    });

    it(`an override of ${label} is not an override`, () => {
      const r = resolveRoundHandicap({ override: value, member: 9 });
      expect(r.source).toBe("member");
      expect(r.handicap).toBe(9);
    });

    it(`a member of ${label} is scratch, not NaN`, () => {
      const r = resolveRoundHandicap({ member: value as number });
      expect(r.handicap).toBe(0);
      expect(r.exact).toBe(0);
      expect(r.source).toBe("member");
    });
  }

  it("an unusable member does not borrow the exact figure of a different player", () => {
    expect(resolveRoundHandicap({ member: Number.NaN, memberExact: 7.2 }).exact).toBe(0);
  });
});

describe("the strokes for tees of a higher par (Rule 6.2b)", () => {
  it("a round with no row yet is the field's own answer today", () => {
    expect(roundParStrokesOf(null, 2)).toBe(2);
    expect(roundParStrokesOf(undefined, 3)).toBe(3);
    expect(roundParStrokesOf(null, -1)).toBe(-1);
    expect(roundParStrokesOf(null, 0)).toBe(0);
  });

  it("a row that has not frozen reads the field today, whatever par strokes it holds", () => {
    expect(roundParStrokesOf({ frozen: null, frozenParStrokes: 5 }, 2)).toBe(2);
    expect(roundParStrokesOf({ override: 12, frozenParStrokes: 5 }, 2)).toBe(2);
    expect(roundParStrokesOf({}, 4)).toBe(4);
  });

  it("a frozen row keeps what it froze, not what the roster says now", () => {
    expect(roundParStrokesOf({ frozen: 18, frozenParStrokes: 1 }, 3)).toBe(1);
    expect(roundParStrokesOf({ frozen: 18, frozenParStrokes: -1 }, 3)).toBe(-1);
  });

  it("a frozen row that froze none reads nought and keeps the nets it was given", () => {
    expect(roundParStrokesOf({ frozen: 18 }, 3)).toBe(0);
    expect(roundParStrokesOf({ frozen: 18, frozenParStrokes: null }, 3)).toBe(0);
    expect(roundParStrokesOf({ frozen: 18, frozenParStrokes: Number.NaN }, 3)).toBe(0);
    expect(roundParStrokesOf({ frozen: 18, frozenParStrokes: Number.POSITIVE_INFINITY }, 3)).toBe(0);
  });

  it("a scratch frozen row is frozen, and a frozen nought is kept", () => {
    expect(roundParStrokesOf({ frozen: 0, frozenParStrokes: 0 }, 3)).toBe(0);
    expect(roundParStrokesOf({ frozen: 0, frozenParStrokes: 2 }, 3)).toBe(2);
    expect(roundParStrokesOf({ frozen: 0 }, 3)).toBe(0);
  });

  it("a live figure that is not a number reads nought", () => {
    expect(roundParStrokesOf(null, Number.NaN)).toBe(0);
    expect(roundParStrokesOf(null, Number.POSITIVE_INFINITY)).toBe(0);
    expect(roundParStrokesOf({ frozen: null }, Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe("the figure an allowance is taken of", () => {
  it("is the roster's exact figure when nothing is frozen or chosen", () => {
    expect(roundHandicapExactOf(null, 18, EXACT_18)).toBe(EXACT_18);
    expect(roundHandicapExactOf(undefined, 13, EXACT_HALF)).toBe(12.5);
    expect(roundHandicapExactOf({}, -2, EXACT_PLUS_HALF)).toBe(-2.5);
  });

  it("is the whole number where the caller has no exact one", () => {
    expect(roundHandicapExactOf(null, 18)).toBe(18);
    expect(roundHandicapExactOf(null, 18, null)).toBe(18);
  });

  it("is the committee's figure where one was set, not the roster's exact", () => {
    expect(roundHandicapExactOf({ override: 10 }, 18, EXACT_18)).toBe(10);
    expect(roundHandicapExactOf({ override: 0 }, 18, EXACT_18)).toBe(0);
  });

  it("is the frozen exact figure over a later override and a later roster", () => {
    expect(roundHandicapExactOf({ frozen: 18, frozenExact: EXACT_18, override: 10 }, 12, 11.6)).toBe(EXACT_18);
  });

  it("is the frozen whole number where the round kept no exact one", () => {
    expect(roundHandicapExactOf({ frozen: 18, frozenExact: null }, 12, 11.6)).toBe(18);
    expect(roundHandicapExactOf({ frozen: 18 }, 18, 17.9)).toBe(18);
  });
});

describe("what a round freezes is what the board was already using", () => {
  it("freezes the roster's rounded figure, the override when there is one, and ignores any frozen figure handed in", () => {
    expect(handicapToFreeze({ member: 18, memberExact: EXACT_18 })).toBe(18);
    expect(handicapToFreeze({ member: 13, memberExact: EXACT_HALF })).toBe(13);
    expect(handicapToFreeze({ member: -2, memberExact: EXACT_PLUS_HALF })).toBe(-2);
    expect(handicapToFreeze({ member: 18, override: 10 })).toBe(10);
    expect(handicapToFreeze({ member: 18, override: 0 })).toBe(0);
    // a caller that smuggles in an old frozen figure does not move the new one
    const withOld = { member: 18, frozen: 3, frozenExact: 2.6 } as unknown as Parameters<typeof handicapToFreeze>[0];
    expect(handicapToFreeze(withOld)).toBe(18);
    expect(exactHandicapToFreeze(withOld)).toBeNull();
  });

  it("freezes the unrounded figure beside it only where there is one to keep", () => {
    expect(exactHandicapToFreeze({ member: 18, memberExact: EXACT_18 })).toBe(EXACT_18);
    expect(exactHandicapToFreeze({ member: 13, memberExact: EXACT_HALF })).toBe(12.5);
    expect(exactHandicapToFreeze({ member: -2, memberExact: EXACT_PLUS_HALF })).toBe(-2.5);
    expect(exactHandicapToFreeze({ member: 9, memberExact: EXACT_NINE })).toBe(9.231);
  });

  it("freezes no exact figure for a whole roster figure, an absent one, or a committee's figure", () => {
    expect(exactHandicapToFreeze({ member: 18, memberExact: 18 })).toBeNull();
    expect(exactHandicapToFreeze({ member: 18 })).toBeNull();
    expect(exactHandicapToFreeze({ member: 18, memberExact: null })).toBeNull();
    expect(exactHandicapToFreeze({ member: 18, memberExact: EXACT_18, override: 10 })).toBeNull();
    expect(exactHandicapToFreeze({ member: 0, memberExact: 0 })).toBeNull();
  });

  it("freezes the pair of one handicap: the exact always rounds to the whole", () => {
    for (const [member, exact] of [
      [18, EXACT_18],
      [13, EXACT_HALF],
      [-2, EXACT_PLUS_HALF],
      [9, EXACT_NINE],
      [0, -0.4],
    ] as const) {
      const whole = handicapToFreeze({ member, memberExact: exact });
      const kept = exactHandicapToFreeze({ member, memberExact: exact });
      expect(whole).toBe(member);
      expect(Math.round((kept ?? whole) + 1e-9) + 0).toBe(whole);
    }
  });
});

describe("a card is returned when one stroke is on it", () => {
  it("an empty card, a card of blanks and a card of nought are not returned", () => {
    expect(isReturnedCard([])).toBe(false);
    expect(isReturnedCard([null, null, null])).toBe(false);
    expect(isReturnedCard([0, 0, null])).toBe(false);
    expect(isReturnedCard([-1])).toBe(false);
  });

  it("one stroke, anywhere on the card, returns it", () => {
    expect(isReturnedCard([null, null, 4])).toBe(true);
    expect(isReturnedCard([1])).toBe(true);
    expect(isReturnedCard([0, null, 5, null])).toBe(true);
    expect(isReturnedCard([4, 5, 4, 3, 5, 4, 4, 3, 4])).toBe(true);
  });

  it("something that is not a number is not a stroke", () => {
    expect(isReturnedCard(["4" as unknown as number])).toBe(false);
    expect(isReturnedCard([Number.NaN])).toBe(false);
  });
});

describe("the key, the refusal and the gate", () => {
  it("a key is the round then the player, in the database's own order", () => {
    expect(roundHandicapKey("stage-a", "player-b")).toBe("stage-a:player-b");
    expect(roundHandicapKey("player-b", "stage-a")).toBe("player-b:stage-a");
    expect(roundHandicapKey("", "")).toBe(":");
  });

  it("the refusal says why and what to do next", () => {
    expect(FROZEN_HANDICAP_REFUSAL).toContain("Cards are in for this round");
    expect(FROZEN_HANDICAP_REFUSAL).toContain("keeps the handicaps it was scored against");
    expect(FROZEN_HANDICAP_REFUSAL).toContain("Clear the round's scores to score it again.");
    expect(FROZEN_HANDICAP_REFUSAL.length).toBeGreaterThan(80);
  });

  it("a round accepts a change until a card is returned", () => {
    expect(acceptsHandicapChange(false)).toBe(true);
    expect(acceptsHandicapChange(true)).toBe(false);
  });
});
