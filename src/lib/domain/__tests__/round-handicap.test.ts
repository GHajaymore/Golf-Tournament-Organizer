import { describe, it, expect } from "vitest";
import {
  resolveRoundHandicap,
  handicapToFreeze,
  acceptsHandicapChange,
} from "../round-handicap";

/**
 * What a player plays off in one round, and why it cannot move afterwards.
 *
 * The requirement, in Ajay's words on 2026-08-22:
 *
 *   "If the round is complete and the member handicap changes on the Member
 *    screen, the closed round should not be affected and should keep the old
 *    handicap — but as soon as the member gets a new handicap assigned (or
 *    their GHIN changes), the next round should use the new one."
 *
 * Asserted against that, not against what the code happens to do.
 */

describe("a round that has been played", () => {
  it("keeps what it was played off when the roster changes underneath it", () => {
    // Round 1 was scored off 18. The member is re-rated to 12 in October.
    // Round 1 does not move: a settled cut and a paid-out pot depend on it.
    const r = resolveRoundHandicap({ frozen: 18, member: 12 });
    expect(r.handicap).toBe(18);
    expect(r.source).toBe("frozen");
  });

  it("refuses further changes rather than accepting one that does nothing", () => {
    // Hiding a control stops nobody from calling the action, so the rule that
    // hides it and the rule that refuses the write are the same rule.
    expect(resolveRoundHandicap({ frozen: 18, member: 12 }).editable).toBe(false);
    expect(acceptsHandicapChange(true)).toBe(false);
  });

  it("says how far it has drifted from today's figure", () => {
    // Not an error and nothing to correct. It is the honest answer to "why is
    // my net different in round one" — and without it somebody eventually
    // decides the app is wrong and re-enters the round.
    expect(resolveRoundHandicap({ frozen: 18, member: 12 }).differsFromCurrent).toBe(12);
    expect(resolveRoundHandicap({ frozen: 12, member: 12 }).differsFromCurrent).toBeNull();
  });

  it("outranks an override set after the cards came in", () => {
    // An organizer changing an override afterwards has changed their mind. A
    // round already played is not something anyone gets to change their mind
    // about.
    const r = resolveRoundHandicap({ frozen: 18, override: 9, member: 12 });
    expect(r.handicap).toBe(18);
    expect(r.source).toBe("frozen");
  });
});

describe("a round that has not started", () => {
  it("picks up a new member handicap the moment it is assigned", () => {
    // The second half of the requirement. Nothing is frozen, so nothing is
    // stale: the next round reads today's truth with no action from anyone.
    expect(resolveRoundHandicap({ member: 12 }).handicap).toBe(12);
    expect(resolveRoundHandicap({ member: 12 }).source).toBe("member");
  });

  it("takes the committee's override over the roster", () => {
    const r = resolveRoundHandicap({ override: 9, member: 12 });
    expect(r.handicap).toBe(9);
    expect(r.source).toBe("override");
    expect(r.editable).toBe(true);
  });

  it("keeps an override when the roster later changes", () => {
    // The consequence of "apply to the rest of the tournament": those rounds
    // hold a decision somebody made on purpose, and a roster edit does not
    // silently undo it.
    expect(resolveRoundHandicap({ override: 12, member: 20 }).handicap).toBe(12);
  });
});

describe("freezing a round", () => {
  it("freezes exactly what the board was already using", () => {
    // A freeze that computed something different would re-score the very card
    // that triggered it.
    expect(handicapToFreeze({ member: 12 })).toBe(12);
    expect(handicapToFreeze({ override: 9, member: 12 })).toBe(9);
  });

  it("is a no-op for a round whose first card is still to come", () => {
    expect(acceptsHandicapChange(false)).toBe(true);
  });
});

describe("numbers that are not numbers", () => {
  it("treats a missing member handicap as scratch rather than NaN", () => {
    // A NaN handicap propagates into every net score on the board and shows up
    // as a blank column nobody can explain.
    expect(resolveRoundHandicap({ member: NaN }).handicap).toBe(0);
    expect(resolveRoundHandicap({ member: undefined as unknown as number }).handicap).toBe(0);
  });

  it("ignores a null override rather than reading it as scratch", () => {
    // null means "not set". Reading it as 0 would hand a 22-handicapper a
    // scratch card, which is the most expensive possible way to be wrong.
    expect(resolveRoundHandicap({ override: null, member: 22 }).handicap).toBe(22);
    expect(resolveRoundHandicap({ frozen: null, override: null, member: 22 }).handicap).toBe(22);
  });

  it("keeps a genuine scratch handicap of zero", () => {
    // 0 is a real handicap and must not be confused with "not set".
    expect(resolveRoundHandicap({ override: 0, member: 22 }).handicap).toBe(0);
    expect(resolveRoundHandicap({ override: 0, member: 22 }).source).toBe("override");
    expect(resolveRoundHandicap({ frozen: 0, member: 22 }).handicap).toBe(0);
  });

  it("rounds a fractional handicap rather than carrying it into allocation", () => {
    // holeStrokesReceived walks whole shots; a 12.4 would allocate 12 on some
    // holes and 13 on others depending on float comparison.
    expect(resolveRoundHandicap({ member: 12.4 }).handicap).toBe(12);
    expect(resolveRoundHandicap({ member: 12.6 }).handicap).toBe(13);
  });
});

describe("supplying nothing changes nothing", () => {
  it("hands back the member's handicap untouched when it is a whole number", () => {
    // The hook was added to a resolver every net score in the app goes
    // through. Absent, it must be the identity — otherwise adding the feature
    // re-scored every card in every tournament before anyone used it.
    for (const h of [0, 1, 7, 12, 18, 22, 36, 54]) {
      expect(resolveRoundHandicap({ member: h }).handicap, `member ${h}`).toBe(h);
    }
  });

  it("rounds a fractional Course Handicap to the shot it allocates", () => {
    // holeStrokesReceived walks whole shots. A 12.4 carried through would give
    // 12 on some holes and 13 on others by float comparison, which is how a
    // player ends up with a stroke on the wrong hole.
    expect(resolveRoundHandicap({ member: 12.5 }).handicap).toBe(13);
    expect(resolveRoundHandicap({ member: -0.4 }).handicap).toBe(-0);
  });

  it("keeps a plus handicap negative rather than clamping it to scratch", () => {
    // A +2 player gives shots back. Clamping to 0 would quietly hand the best
    // golfer in the field two strokes they are not entitled to.
    expect(resolveRoundHandicap({ member: -2 }).handicap).toBe(-2);
    expect(resolveRoundHandicap({ frozen: -2, member: 5 }).handicap).toBe(-2);
  });
});
