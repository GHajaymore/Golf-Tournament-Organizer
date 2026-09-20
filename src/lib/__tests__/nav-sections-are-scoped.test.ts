import { describe, it, expect } from "vitest";
import { NAV, navForRole, ROUND_SECTION } from "../nav";

/**
 * EVERY SECTION OF THE SIDEBAR ANSWERS "WHAT DOES THIS CHANGE", AND THE
 * SECTIONS READ IN THE ORDER THE WORK HAPPENS.
 *
 * The grouping this replaced named the organizer's PHASE — Overview, Set up,
 * Manage, Results, Money — while the items inside mixed three different
 * scopes. Read off the running console on 2026-09-20:
 *
 *   Live leaderboard   one round, right now      under "Overview"
 *   Score entry        the SAME round            under "Manage"
 *   Bracket            the same round again      under "Manage"
 *   This week          the same round again      under "Overview"
 *
 * Four screens describing one round, in two sections, and nothing anywhere on
 * the page said WHICH round. That is tolerable while every round of a
 * tournament is the same format and becomes nonsense the moment they differ —
 * which is the model the rest of this work is moving to.
 *
 * Nothing in 8,188 tests could see any of it. The nav suite asserted tiers,
 * icons, duplicate hrefs, the guided setup order and what a casual round
 * hides; no test asserted which SECTION a screen sits in, so the grouping was
 * free to say anything. This is that missing axis.
 *
 * Each block below was mutated and watched go red before being kept — see the
 * note on each for what the mutation was.
 */

const sectionOf = (key: string) =>
  NAV.find((s) => s.items.some((i) => i.key === key))?.label;

/**
 * The five screens that describe ONE round. Not a restatement of the section's
 * contents — it is the list of screens whose answer changes when the organizer
 * changes which round they are looking at, derived from what each one renders.
 */
const ROUND_SCOPED = ["foursomes", "entry", "leaderboard", "bracket", "week"] as const;

/** Screens that are true of the whole tournament, or of the club above it. */
const NOT_ROUND_SCOPED = [
  "dashboard",
  "event",
  "stages",
  "registration",
  "grouping",
  "teams",
  "access",
  "tournaments",
  "roster",
  "series",
  "organization",
  "reports",
  "prizes",
] as const;

describe("a screen sits in the section that says what it changes", () => {
  /**
   * MUTATION: move `leaderboard` back to the Overview section — which is
   * exactly where it was — and this fails naming it. That is the defect this
   * file exists for, so it is the one that had to fail first.
   */
  it("puts every round-scoped screen in one section, and it is the round's", () => {
    for (const key of ROUND_SCOPED) {
      expect(sectionOf(key), `${key} describes one round`).toBe(ROUND_SECTION);
    }
  });

  /**
   * THE CONTROL, and it is not decoration. Without it the assertion above is
   * satisfied perfectly by putting the ENTIRE sidebar in the round's section —
   * every round-scoped screen would be there, and so would everything else.
   *
   * MUTATION: move `stages` into the round section and this fails.
   */
  it("keeps everything else out of it", () => {
    for (const key of NOT_ROUND_SCOPED) {
      expect(sectionOf(key), `${key} is not about one round`).not.toBe(ROUND_SECTION);
    }
  });

  it("files every nav item under exactly one section", () => {
    const keys = NAV.flatMap((s) => s.items.map((i) => i.key));
    expect(new Set(keys).size, "a key appears in two sections").toBe(keys.length);
  });

  it("gives every section a distinct heading", () => {
    const labels = NAV.map((s) => s.label);
    expect(new Set(labels).size, labels.join(" · ")).toBe(labels.length);
  });
});

describe("the sections read in the order the work happens", () => {
  /**
   * Ajay, 2026-09-20: "line up everything sequentially". A club picks a
   * tournament, sets it up, plays a round, tells the field, and settles up
   * afterwards. A reader going down the sidebar should be going forwards.
   *
   * Asserted on the SCREENS rather than on the section names, so renaming a
   * heading cannot silently drop the guarantee — the thing that must stay true
   * is that you meet Tournaments before Rounds & formats before Score entry
   * before Prizes, whatever the headings above them say.
   *
   * MUTATION: move the Afterwards section above the round's and this fails.
   */
  it("meets choosing, then setting up, then playing, then settling", () => {
    const order = NAV.flatMap((s) => s.items.map((i) => i.key));
    const at = (key: string) => {
      const i = order.indexOf(key);
      expect(i, `${key} is not in the sidebar at all`).toBeGreaterThan(-1);
      return i;
    };
    expect(at("tournaments"), "the club comes before its tournament's setup").toBeLessThan(at("stages"));
    expect(at("stages"), "setting up comes before playing").toBeLessThan(at("entry"));
    expect(at("entry"), "playing comes before settling up").toBeLessThan(at("prizes"));
    expect(at("reports"), "the golf comes before the money").toBeLessThan(at("prizes"));
  });

  it("keeps no section long enough to be a wall", () => {
    /**
     * Six is the largest that exists (Set up), and it is the one section whose
     * length is a guided sequence rather than a bag. The bound is here so the
     * next screen added lands in a section deliberately instead of on the end
     * of whichever one is nearest.
     */
    for (const s of NAV) {
      expect(s.items.length, `${s.label} has ${s.items.length} entries`).toBeLessThanOrEqual(6);
    }
  });
});

describe("the round's section says which round", () => {
  const round = (opts: Parameters<typeof navForRole>[2]) =>
    navForRole("admin", undefined, opts).map((s) => s.label);

  /**
   * MUTATION: drop the `nameRound` step from `navForRole` and this fails,
   * leaving the fallback heading in place.
   */
  it("wears the round's own name when the caller knows it", () => {
    const labels = round({ isPlayerToo: true, roundName: "Round 2 of 4 · Stableford" });
    expect(labels).toContain("Round 2 of 4 · Stableford");
    expect(labels, "both headings would be two names for one section").not.toContain(ROUND_SECTION);
  });

  /**
   * A tournament with no rounds has no round in play, and saying so is a real
   * answer. The heading must not invent a number it has not been given.
   */
  it("falls back to a heading that claims no round at all", () => {
    const labels = round({ isPlayerToo: true });
    expect(labels).toContain(ROUND_SECTION);
    expect(ROUND_SECTION, "the fallback names a round it does not know").not.toMatch(/[0-9]/);
  });

  /**
   * THE ORDER INVARIANT, and it is the one this nearly got wrong.
   *
   * `forMatch` renames this section to "Playing" for a casual round, because
   * two friends have one round between them and numbering it is the
   * filing-cabinet wording that rename exists to undo. `nameRound` matches on
   * `ROUND_SECTION`, so it must run AFTER that rename and find nothing.
   *
   * MUTATION: swap the two in `navForRole` and this fails — a Sunday fourball
   * is told it is on "Round 1 of 1".
   */
  it("still says Playing for a casual round, even handed a round name", () => {
    const labels = round({ isPlayerToo: true, isMatch: true, roundName: "Round 1 of 1 · Medal" });
    expect(labels, "a casual round was given a tournament's heading").not.toContain("Round 1 of 1 · Medal");
    expect(labels).toContain("Playing");
  });
});
