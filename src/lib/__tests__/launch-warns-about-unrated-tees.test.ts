import { describe, it, expect } from "vitest";
import { setupFlow, type SetupFacts } from "../domain/setup-flow";
import { unratedTeesFact, warningText } from "../domain/launch-check";
import { courseHandicapExact } from "../domain/handicap";
import { screenName } from "../nav";

/**
 * LAUNCH SAYS WHEN A TEE CANNOT GIVE A FULL COURSE HANDICAP (setup audit item 5).
 *
 * The rule the app really applies (`courseHandicapExact`), and the words say
 * exactly this and no more:
 *   no Slope                  the raw Handicap Index is used
 *   Slope but no Course Rating  scaled by Slope, without the Course Rating minus Par adjustment
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
const unratedWarning = (f: SetupFacts) => warnings(f).find((x) => x.href === "/event" && /Slope|tees/i.test(x.says));
const tee = (name: string, slopeRating: number, courseRating: number) => ({ name, slopeRating, courseRating });

describe("the words follow the real handicap rule", () => {
  it("CONTROL: the app really does fall back to the index with no slope, and scales by slope alone with no rating", () => {
    expect(courseHandicapExact(10, { slopeRating: 0, courseRating: 72, par: 72 })).toBe(10);
    expect(courseHandicapExact(10, { slopeRating: 130, courseRating: 0, par: 72 })).toBeCloseTo(10 * (130 / 113), 6);
  });
});

describe("the pure fact", () => {
  const net = [{ label: "Round 1", scoringBasis: "net" }];

  it("is nothing while every round is gross: a gross round needs no handicap", () => {
    expect(unratedTeesFact({ rounds: [{ label: "Round 1", scoringBasis: "gross" }], tees: [tee("Blue", 0, 0)] })).toBeNull();
  });

  it("is nothing when every tee has both its Slope and its Course Rating", () => {
    expect(unratedTeesFact({ rounds: net, tees: [tee("Blue", 125, 71.5)] })).toBeNull();
  });

  it("separates a tee with no Slope (raw index) from one with a Slope and no Course Rating", () => {
    expect(
      unratedTeesFact({
        rounds: [...net, { label: "Round 2", scoringBasis: "stableford" }, { label: "Round 3", scoringBasis: "gross" }],
        tees: [tee("Blue", 125, 71.5), tee("White", 0, 70), tee("Red", 120, 0)],
      }),
    ).toEqual({ rounds: ["Round 1", "Round 2"], noSlope: ["White"], noRating: ["Red"], noTees: false });
  });

  it("says so when there are no tees at all", () => {
    expect(unratedTeesFact({ rounds: net, tees: [] })).toEqual({ rounds: ["Round 1"], noSlope: [], noRating: [], noTees: true });
  });
});

describe("the launch dialog", () => {
  const base = { rounds: ["Round 1", "Round 2"], noSlope: [] as string[], noRating: [] as string[], noTees: false };

  it("no Slope: says the raw Handicap Index is used, and hedges the direction", () => {
    const w = unratedWarning(facts({ unratedTees: { ...base, noSlope: ["White"] } }));
    expect(w, "launch did not warn about a tee with no Slope").toBeTruthy();
    const text = warningText(w!);
    expect(text).toContain("White");
    expect(text).toContain("Round 1 and Round 2");
    expect(text).toMatch(/no Slope/);
    expect(text).toMatch(/raw Handicap Index/);
    expect(text).toMatch(/usually understates strokes on a hard course and overstates them on an easy one/);
    expect(w!.afterLaunch).toBe("open");
  });

  it("Slope but no Course Rating: does NOT say the raw index is used", () => {
    const w = unratedWarning(facts({ unratedTees: { ...base, noRating: ["Red"] } }));
    expect(w, "launch did not warn about a tee with no Course Rating").toBeTruthy();
    expect(w!.says).toContain("Red");
    expect(w!.says).toMatch(/no Course Rating/);
    expect(w!.says).toMatch(/Slope alone/);
    expect(w!.says).not.toMatch(/raw Handicap Index/);
  });

  it("is a warning only: it never refuses a launch", () => {
    const round = { label: "Round 1", drawsPairings: false, scheduled: true, scorable: true, cutFed: false, matches: 0 };
    const launch = setupFlow(facts({ unratedTees: { ...base, noSlope: ["White"] }, rounds: [round], playingRounds: 1 }), screenName).launch;
    expect(launch.refusal, "an unrated tee refused a launch").toBeNull();
    expect(launch.warnings.some((w) => /Slope/.test(w.says))).toBe(true);
  });

  it("is quiet when the tees are rated (control)", () => {
    expect(unratedWarning(facts({ unratedTees: null }))).toBeUndefined();
    expect(unratedWarning(facts())).toBeUndefined();
  });

  it("says there are no tees when there are none", () => {
    const w = unratedWarning(facts({ unratedTees: { ...base, noTees: true } }));
    expect(w?.says).toMatch(/no tees/i);
  });
});
