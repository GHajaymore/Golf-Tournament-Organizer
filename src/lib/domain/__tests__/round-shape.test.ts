import { describe, it, expect } from "vitest";
import { roundShapeMismatch } from "../round-shape";
import { GOLF_FORMATS } from "@/lib/formats";
import { STAGE_TYPE_INFO } from "@/lib/stage-types";

/**
 * A round's type and its format, agreeing about whether anybody plays anybody.
 *
 * The rule covers less than it could, deliberately, and the tests that matter
 * most here are the ones proving what it stays OUT of: a four-ball is a match
 * between two pairs and equally a better-ball medal, and only the type says
 * which. A rule that decided for it would refuse real golf, which is the
 * mistake `course-cards` has a whole section of CLAUDE.md about.
 */
describe("a round that cannot produce a result", () => {
  it("refuses a card format on a type that draws opponents", () => {
    // The pair two templates held: a full round-robin schedule for a medal.
    for (const format of ["Stroke Play", "Stableford", "Modified Stableford"]) {
      expect(roundShapeMismatch("Round Robin", format), format).not.toBeNull();
    }
  });

  it("and a match format on a type that draws none", () => {
    // The mirror, which is the half that produces an empty leaderboard rather
    // than a phantom schedule.
    for (const format of ["Match Play", "Nassau"]) {
      expect(roundShapeMismatch("Stroke Play Round", format), format).not.toBeNull();
    }
  });

  it("says what to do instead, not only that something is wrong", () => {
    const bad = roundShapeMismatch("Round Robin", "Stroke Play");
    expect(bad?.message).toContain("Stroke Play Round");
  });
});

describe("what it deliberately does not judge", () => {
  it("leaves a four-ball alone, on either kind of round", () => {
    /**
     * THE ASSERTION THAT STOPS THIS BECOMING "MATCH THE FAMILY TO THE TYPE".
     *
     * A member-guest round robin is four-ball MATCHES; a society better-ball
     * day is four-ball CARDS. Both are real golf, both are in this product —
     * `member-guest-rr` is five nine-hole four-ball matches — and the type is
     * the only thing that distinguishes them. A rule with an opinion here
     * would refuse one of them.
     */
    expect(roundShapeMismatch("Round Robin", "Four-Ball")).toBeNull();
    expect(roundShapeMismatch("Stroke Play Round", "Four-Ball")).toBeNull();
    expect(roundShapeMismatch("Round Robin", "Scramble")).toBeNull();
    expect(roundShapeMismatch("Stroke Play Round", "Scramble")).toBeNull();
  });

  it("has no opinion about a format it does not recognise", () => {
    /**
     * `lookupFormat`, not `findFormat`. The latter falls back to
     * `GOLF_FORMATS[0]` — Match Play — so an unrecognised name would be judged
     * as a match format and refused for having no opponent: a round the
     * organizer typed by hand, or a name from an older release, reported as
     * broken because the app did not know it.
     */
    expect(roundShapeMismatch("Stroke Play Round", "Bloggs Cup Rules")).toBeNull();
    expect(roundShapeMismatch("Round Robin", "")).toBeNull();
  });

  it("and none about a type it does not recognise", () => {
    // Unknown types read as not head-to-head, so this is the direction that
    // could produce a false refusal — of a match format on a type the app has
    // not heard of. Named rather than left to chance.
    expect(roundShapeMismatch("Something Else Entirely", "Four-Ball")).toBeNull();
  });
});

describe("the whole grid, swept", () => {
  /**
   * Every stage type against every format, which is the combination sweep
   * CLAUDE.md asks for on scoring changes — the defects live in COMBINATIONS
   * nobody has a test for, and this rule is nothing but combinations.
   */
  const pairs = STAGE_TYPE_INFO.flatMap((t) => GOLF_FORMATS.map((f) => [t.key, f.name] as const));

  it("returns a message or nothing, never a half-built object", () => {
    for (const [type, format] of pairs) {
      const r = roundShapeMismatch(type, format);
      if (r === null) continue;
      expect(r.message.length, `${type} + ${format}`).toBeGreaterThan(20);
      // The refusal names both halves, or it is not about this round.
      expect(r.message, `${type} + ${format}`).toContain(format);
      expect(r.message, `${type} + ${format}`).toContain(type);
    }
  });

  it("refuses a minority of the grid, not most of it", () => {
    /**
     * A rule that clears a large slice is wrong about golf, not right about
     * the data — the lesson the course-card guards were written from, where
     * four plausible checks would each have thrown away real courses.
     *
     * Most pairs are fine and several are deliberate, so the expected shape is
     * a small refused corner. Bounded on BOTH sides: zero would mean the rule
     * had stopped seeing anything.
     */
    const refused = pairs.filter(([t, f]) => roundShapeMismatch(t, f) !== null).length;
    expect(refused).toBeGreaterThan(0);
    expect(refused).toBeLessThan(pairs.length / 2);
  });
});
