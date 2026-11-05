import { describe, it, expect } from "vitest";
import { setupFlow, type SetupFacts } from "../domain/setup-flow";
import { unratedTeesFact, warningText } from "../domain/launch-check";
import { screenName } from "../nav";

/**
 * LAUNCH SAYS WHEN A TEE HAS NO RATING (setup sequencing audit, item 5, 5 Nov).
 *
 * With no Course Rating and Slope on a tee, the app cannot work out a Course
 * Handicap (World Handicap System, Rule 6.1: Handicap Index x Slope / 113, plus
 * Course Rating minus Par), so every player on it is scored off the raw index.
 * A net medal can then have the wrong winner, found on the day. The only notice
 * was on Rounds & formats; Launch, the one moment everybody passes, said nothing.
 * It is a warning, never a refusal.
 */

const facts = (over: Partial<SetupFacts> = {}): SetupFacts => ({
  confirmed: 12,
  rounds: [],
  groups: 0,
  named: true,
  dated: true,
  venued: true,
  moneyAnswered: true,
  launched: false,
  ...over,
});

const warnings = (f: SetupFacts) => setupFlow(f, screenName).launch.warnings;

describe("the pure fact", () => {
  const net = [{ label: "Round 1", scoringBasis: "net" }];

  it("is nothing while every round is gross: a gross round needs no handicap", () => {
    expect(unratedTeesFact({ rounds: [{ label: "Round 1", scoringBasis: "gross" }], tees: [{ name: "Blue", rated: false }] })).toBeNull();
  });

  it("is nothing when every tee is rated", () => {
    expect(unratedTeesFact({ rounds: net, tees: [{ name: "Blue", rated: true }] })).toBeNull();
  });

  it("names the unrated tees and the rounds that score off a handicap", () => {
    expect(
      unratedTeesFact({
        rounds: [...net, { label: "Round 2", scoringBasis: "stableford" }, { label: "Round 3", scoringBasis: "gross" }],
        tees: [{ name: "Blue", rated: true }, { name: "White", rated: false }],
      }),
    ).toEqual({ rounds: ["Round 1", "Round 2"], tees: ["White"], noTees: false });
  });

  it("says so when there are no tees at all", () => {
    expect(unratedTeesFact({ rounds: net, tees: [] })).toEqual({ rounds: ["Round 1"], tees: [], noTees: true });
  });
});

describe("the launch dialog", () => {
  const unrated = { rounds: ["Round 1", "Round 2"], tees: ["White"], noTees: false };

  it("warns, names the rounds and the tee, and says what it means", () => {
    const w = warnings(facts({ unratedTees: unrated })).find((x) => x.href === "/event" && /rating/i.test(x.says));
    expect(w, "launch did not warn about a tee with no rating").toBeTruthy();
    const text = warningText(w!);
    expect(text).toContain("White");
    expect(text).toContain("Round 1 and Round 2");
    expect(text).toMatch(/Course Rating and Slope/);
    expect(text).toMatch(/raw Handicap Index/);
    expect(w!.afterLaunch).toBe("open");
  });

  it("is a warning only: it never refuses a launch", () => {
    const round = { label: "Round 1", drawsPairings: false, scheduled: true, scorable: true, cutFed: false, matches: 0 };
    const launch = setupFlow(facts({ unratedTees: unrated, rounds: [round], playingRounds: 1 }), screenName).launch;
    expect(launch.refusal, "an unrated tee refused a launch").toBeNull();
    expect(launch.warnings.some((w) => /Course Rating and Slope/.test(w.says))).toBe(true);
  });

  it("is quiet when the tees are rated (control)", () => {
    expect(warnings(facts({ unratedTees: null })).some((x) => /rating/i.test(x.says))).toBe(false);
    expect(warnings(facts()).some((x) => /rating/i.test(x.says))).toBe(false);
  });

  it("says there are no tees when there are none", () => {
    const w = warnings(facts({ unratedTees: { rounds: ["Round 1"], tees: [], noTees: true } })).find((x) => /rating/i.test(x.says));
    expect(w?.says).toMatch(/no tees/i);
  });
});
