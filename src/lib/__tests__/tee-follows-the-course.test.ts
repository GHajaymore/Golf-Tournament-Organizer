import { describe, it, expect } from "vitest";
import { teeForPlay, roundTeeId } from "@/lib/services/handicaps";

/**
 * THE TEES WALK THE SAME CHAIN THE COURSE DOES.
 *
 * `courseForMatch` -> `courseForRound` -> the event has decided WHERE a round
 * is played since the venue library was built. The tees had no such chain:
 * they were an event-level answer with a flight and a player layered over it,
 * and nothing in between. Two things followed, and neither announced itself.
 *
 * A two-venue tournament fell back to the first tee by position across EVERY
 * venue, because `teesForEvent` gathers them course by course — so a
 * member-guest over two clubs scored day two off day one's slope and course
 * rating. A real number, from the wrong course, on a card that named neither
 * until #348.
 *
 * And an open-course league asked the scorer for the tees they played off,
 * validated them, created the row — and then nothing pointed at it.
 *
 * Asserted on the IDENTITY of the chosen set, over a fixture where every rung
 * is a different course and a different tee, so a wrong answer cannot look
 * like a right one. A fixture where two rungs share a tee would pass whatever
 * the precedence was.
 */

/**
 * Two venues, two sets each. Deliberately ordered so `tees[0]` is never the
 * right answer for the second course, and never the configured one.
 *
 * RATED, and with real names, because the fallback goes through
 * `defaultTeeFor` — which sorts by name and prefers a rated set over an
 * unrated one. A fixture of bare ids type-checked against the old signature
 * and crashed inside that sort; the signature is honest now and this is what
 * honest looks like.
 */
const rate = (id: string, courseId: string, name: string, slope: number) => ({
  id,
  courseId,
  name,
  courseRating: 72,
  slopeRating: slope,
  par: 72,
  position: 0,
});
const TEES = [
  rate("a-black", "course-a", "Black", 140),
  rate("a-white", "course-a", "White", 120),
  rate("b-blue", "course-b", "Blue", 118),
  rate("b-red", "course-b", "Red", 105),
];

describe("which tees a round is played from", () => {
  it("takes the match's own set first", () => {
    // A pairing in a league with no fixed venue names its own course at
    // scoring time, and the tees with it.
    expect(
      teeForPlay(TEES, { matchTeeId: "b-red", stageTeeId: "a-white", eventDefaultTeeId: "a-black" }, "course-b"),
    ).toBe("b-red");
  });

  it("then the round's", () => {
    expect(
      teeForPlay(TEES, { matchTeeId: null, stageTeeId: "a-white", eventDefaultTeeId: "a-black" }, "course-a"),
    ).toBe("a-white");
  });

  it("then the tournament's", () => {
    expect(teeForPlay(TEES, { eventDefaultTeeId: "a-black" }, "course-a")).toBe("a-black");
  });

  it("falls back to the first set ON THE COURSE BEING PLAYED", () => {
    /**
     * THE BUG THIS EXISTS FOR. With nothing configured, the old rule took
     * `tees[0]` — "a-black" — whatever course the round was at. A round at
     * course B was then priced off course A's slope and course rating.
     */
    expect(teeForPlay(TEES, {}, "course-b")).toBe("b-blue");
    expect(teeForPlay(TEES, {}, "course-a")).toBe("a-black");
  });

  it("keeps the whole-event fallback when there is no round in hand", () => {
    // `/registration` and `/grouping` price a ROSTER, not a card. Guessing a
    // venue for them would be inventing an answer to a question nobody asked.
    expect(teeForPlay(TEES, {}, null)).toBe("a-black");
  });

  it("steps past a set that is no longer on this tournament's courses", () => {
    /**
     * Every rung, not only the configured one. A tee can be deleted, and a
     * match's tee can point at a venue the round has since been moved off —
     * in both cases the id survives in a column and resolves to nothing.
     *
     * The old rule checked existence for the event default alone, so a stale
     * `Match.teeId` would have priced the card off a set that is not there.
     */
    expect(
      teeForPlay(TEES, { matchTeeId: "deleted", stageTeeId: "a-white" }, "course-a"),
    ).toBe("a-white");
    expect(teeForPlay(TEES, { stageTeeId: "deleted", eventDefaultTeeId: "b-red" }, "course-b")).toBe("b-red");
    // And past ALL of them, to the course being played.
    expect(
      teeForPlay(TEES, { matchTeeId: "gone", stageTeeId: "gone", eventDefaultTeeId: "gone" }, "course-b"),
    ).toBe("b-blue");
  });

  it("steps past a rung that is on ANOTHER of this tournament's courses", () => {
    /**
     * THE HALF THE EXISTENCE CHECK ABOVE COULD NOT SEE, and the commonest state
     * a club is in: `Event.defaultTeeId` set to their own whites, one round away.
     *
     * `live` asked only whether the id resolved to a tee, and it does — a real
     * tee, with a real slope and rating, at the wrong club. So the rung was
     * honoured and the fallback that scopes to `courseId` was never reached: an
     * away round was priced off the home club's ratings on every reader. It
     * needed no stale data and no deletion, which is why the test above did not
     * find it.
     *
     * Measured end to end in `round-handicaps-follow-the-round-venue.audit.test.ts`
     * on a 144-slope host and a 105-slope away course: 18 where 7 is right.
     */
    expect(teeForPlay(TEES, { eventDefaultTeeId: "a-black" }, "course-b")).toBe("b-blue");
    expect(teeForPlay(TEES, { stageTeeId: "a-white", eventDefaultTeeId: "a-black" }, "course-b")).toBe(
      "b-blue",
    );
    // A match naming a set at another venue is the same error one rung along.
    expect(teeForPlay(TEES, { matchTeeId: "a-black", stageTeeId: "b-red" }, "course-b")).toBe("b-red");
  });

  it("still honours every rung that IS on the course being played", () => {
    /**
     * THE CONTROL, and it is what stops the rule above becoming "ignore what
     * anybody configured". Mixed tees within one venue are the case that makes
     * the whole conversion necessary, so a set at the course being played must
     * still beat the fallback — otherwise a club running Championship off the
     * blues and Seniors off the whites is quietly flattened onto one set.
     */
    expect(teeForPlay(TEES, { eventDefaultTeeId: "a-white" }, "course-a")).toBe("a-white");
    expect(teeForPlay(TEES, { stageTeeId: "b-red", eventDefaultTeeId: "a-black" }, "course-b")).toBe(
      "b-red",
    );
  });

  it("prefers a rated set over an unrated one when nobody chose", () => {
    /**
     * Through `defaultTeeFor`, which is the domain's answer to this and was
     * already being asked elsewhere. An unrated set produces no course-handicap
     * conversion at all — `courseHandicap` returns the index as it stands — so
     * falling back to one silently prices the whole field off raw indexes while
     * a rated set sits behind it in the list.
     *
     * The unrated set is FIRST here, so taking `[0]` would pick it.
     */
    const mixed = [
      { ...rate("c-unrated", "course-c", "Members", 0), courseRating: 0 },
      rate("c-rated", "course-c", "Yellow", 121),
    ];
    expect(teeForPlay(mixed, {}, "course-c")).toBe("c-rated");
  });

  it("says nothing when the club has no tees at all", () => {
    // A society on a borrowed card. `courseHandicap` then uses the index as it
    // stands and the card says "unrated" — see #348.
    expect(teeForPlay([], { eventDefaultTeeId: "whatever" }, "course-a")).toBeNull();
  });

  it("falls back across the event when the course being played has no sets", () => {
    // A venue added without ratings. Better a rated set from the tournament's
    // other course than no handicap conversion at all — and the card says
    // which set it was, so the reader can see it is not theirs.
    expect(teeForPlay(TEES, {}, "course-with-no-tees")).toBe("a-black");
  });
});

describe("roundTeeId still answers the event-level question", () => {
  /**
   * It is now one line over `teeForPlay`, and that is the point: two readers
   * of this rule would eventually price the same player two ways in one
   * tournament, which is the sentence `roundTeeId` was written under.
   */
  it("honours a configured set", () => {
    expect(roundTeeId(TEES, "b-red")).toBe("b-red");
  });

  it("falls back to first by position, exactly as before", () => {
    expect(roundTeeId(TEES, null)).toBe("a-black");
    expect(roundTeeId(TEES, "no-such-tee")).toBe("a-black");
  });

  it("agrees with teeForPlay given the same question", () => {
    // The guard against the two drifting apart. If this ever fails, one of
    // them has grown a rule the other has not.
    for (const configured of [null, "b-red", "no-such-tee"]) {
      expect(roundTeeId(TEES, configured)).toBe(
        teeForPlay(TEES, { eventDefaultTeeId: configured }, null),
      );
    }
  });
});
