import { describe, it, expect } from "vitest";
import { tournamentStatus, setupFlowOf, flowFromStatus } from "../domain/tournament-status";
import { readFileSync } from "node:fs";
import { unratedTeesTodo, unratedTiers, unratedTeesFact, hasTypedCard, warningText, type UnratedTees } from "../domain/launch-check";
import { facts } from "../domain/__tests__/tournament-facts-fixtures";
import { GUIDE_STEPS } from "../guide-steps";

/**
 * J27: THE SETUP RAIL SAYS WHEN NET SCORES WILL USE THE HANDICAP INDEX.
 *
 * The launch dialog already warns (`launch-warns-about-unrated-tees.test.ts`).
 * The rail and the checklist now carry the same fact as an OPTIONAL to-do on
 * Tournament details: never a hold, so a scratch or gross-only event, and an
 * event with unrated tees, still launches.
 */

const none: UnratedTees = { rounds: ["Round 1"], noSlope: [], noRating: [], noTees: true };
const noSlope: UnratedTees = { rounds: ["Round 1"], noSlope: ["White"], noRating: [], noTees: false };
const noRating: UnratedTees = { rounds: ["Round 1"], noSlope: [], noRating: ["Red"], noTees: false };
const TODO = "Add tees with their Course Rating and Slope, or players get strokes off their raw Handicap Index.";
const SLOPE = "Add the Slope Rating to the tees, or players get strokes off their raw Handicap Index.";
const RATING = "Add the Course Rating to the tees, or players' strokes are a little off.";

const eventStep = (u: UnratedTees | null, over = {}) =>
  tournamentStatus(facts({ unratedTees: u, ...over })).setup.steps.find((s) => s.key === "event")!;

describe("the to-do on the rail", () => {
  it("CONTROL: with rated tees (or none to speak of) Tournament details is simply done", () => {
    const s = eventStep(null);
    expect(s.done).toBe(true);
    expect(s.optional).toBe(false);
  });

  it("no tees: an optional to-do, in the words", () => {
    const s = eventStep(none);
    expect(s).toMatchObject({ done: false, holds: false, optional: true, missing: TODO });
  });

  it("a tee with no Slope: names the Slope (the raw index is used)", () => {
    expect(eventStep(noSlope).missing).toBe(SLOPE);
  });

  it("a Slope but no Course Rating: a lesser line that does not claim the raw index", () => {
    const s = eventStep(noRating);
    expect(s.optional).toBe(true);
    expect(s.missing).toMatch(/Course Rating/);
    expect(s.missing).toBe(RATING);
    expect(s.missing).not.toMatch(/Handicap Index/);
  });

  it("never holds launch: setup is complete and ready, and Launch is allowed", () => {
    const st = tournamentStatus(facts({ unratedTees: none }));
    expect(st.setup.current).toBeNull();
    expect(st.refusals.launch).toBeNull();
    expect(st.nextAction?.enabled).toBe(true);
    const flow = flowFromStatus(st, false)!;
    expect(flow.readyToLaunch).toBe(true);
    expect(flow.launchBlocked).toBeNull();
    expect(flow.steps.find((s) => s.key === "event")?.optional).toBe(true);
  });

  it("the rail, the footer and the checklist read one answer (setupFlowOf)", () => {
    const { unratedTees: _u, today: _t, knockout: _k, cupDecided: _c, review: _r, ...side } = facts({ unratedTees: none });
    const flow = setupFlowOf({ ...side, unratedTees: none })!;
    expect(flow.steps.find((s) => s.key === "event")).toMatchObject({ done: false, optional: true, missing: TODO });
  });

  it("an undated event keeps its date as the thing it is waiting for", () => {
    const s = eventStep(none, { dated: false, startOn: "", endOn: "" });
    expect(s.holds).toBe(true);
    expect(s.missing).toMatch(/dates/);
  });
});

describe("the words", () => {
  it("unratedTeesTodo is null for no fact and says one thing for each fault", () => {
    expect(unratedTeesTodo(null)).toBeNull();
    expect(unratedTeesTodo(none)).toBe(TODO);
    expect(unratedTeesTodo(noSlope)).toBe(SLOPE);
    expect(unratedTeesTodo(noRating)).toBe(RATING);
  });

  it("never says bet", () => {
    for (const u of [none, noSlope, noRating]) expect(unratedTeesTodo(u)).not.toMatch(/\bbet/i);
  });
});

describe("the organizer's guide says it", () => {
  it("names the Optional to-do about tees on the rail", () => {
    const all = JSON.stringify(GUIDE_STEPS);
    expect(all).toContain("Add tees with their Course Rating and Slope, or players get strokes off their raw Handicap Index.");
  });
});

describe("the finished and the classifier", () => {
  it("says nothing once the tournament is finished", () => {
    expect(eventStep(none, { status: "completed" }).done).toBe(true);
  });

  it("one classifier: the worst fault leads, and no fault is none", () => {
    expect(unratedTiers(none)).toEqual(["noTees"]);
    expect(unratedTiers({ ...noSlope, noRating: ["Red"] })).toEqual(["noSlope", "noRating"]);
    expect(unratedTiers(null)).toEqual([]);
  });

  it("never says net scores (Stableford gives points)", () => {
    for (const u of [none, noSlope, noRating]) expect(unratedTeesTodo(u)).not.toMatch(/net scores/i);
  });
});

describe("a typed-in card with no saved course", () => {
  const net = [{ label: "Round 1", scoringBasis: "net" }];
  const typed = () => unratedTeesFact({ rounds: net, tees: [], fixedCourse: false, typedCard: true });

  it("a card is typed only when pars are: a venue name alone is not a card", () => {
    expect(hasTypedCard("")).toBe(false);
    expect(hasTypedCard("  ")).toBe(false);
    expect(hasTypedCard("[]")).toBe(false);
    expect(hasTypedCard(JSON.stringify(new Array(18).fill(4)))).toBe(true);
  });

  it("the reader derives typedCard from the pars, not the venue name", () => {
    const src = readFileSync("src/lib/services/tournament-facts.ts", "utf8");
    expect(src).toContain("hasTypedCard(e.customPars)");
    expect(src).not.toMatch(/typed\s*=[^;]*e\.course/);
  });

  it("speaks when a card was typed and players are not choosing", () => {
    expect(typed()).toMatchObject({ typedCard: true, noTees: false });
    expect(unratedTiers(typed())).toEqual(["typedCard"]);
  });

  it("stays silent for players-choose-course or no venue yet (typedCard false), and for a gross round", () => {
    expect(unratedTeesFact({ rounds: net, tees: [], fixedCourse: false, typedCard: false })).toBeNull();
    expect(unratedTeesFact({ rounds: net, tees: [], fixedCourse: false })).toBeNull();
    expect(unratedTeesFact({ rounds: [{ label: "Round 1", scoringBasis: "gross" }], tees: [], fixedCourse: false, typedCard: true })).toBeNull();
  });

  it("the launch warning and the rail say it, and it holds nothing", () => {
    const warnings = tournamentStatus(facts({ unratedTees: typed() })).warnings.map((w) => warningText({ ...w }));
    expect(warnings.join(" | ")).toContain("The card was typed in without tees, so players get strokes off their raw Handicap Index.");
    const s = eventStep(typed());
    expect(s).toMatchObject({ done: false, holds: false, optional: true });
    expect(s.missing).toMatch(/raw Handicap Index/);
  });
});
