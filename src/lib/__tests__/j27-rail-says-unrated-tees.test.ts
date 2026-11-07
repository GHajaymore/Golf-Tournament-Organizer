import { describe, it, expect } from "vitest";
import { tournamentStatus, setupFlowOf, flowFromStatus } from "../domain/tournament-status";
import { unratedTeesTodo, type UnratedTees } from "../domain/launch-check";
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
const TODO = "Add tees with a rating, or net scores use each player's handicap index.";

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

  it("a tee with no Slope: the same words (the raw index is used)", () => {
    expect(eventStep(noSlope).missing).toBe(TODO);
  });

  it("a Slope but no Course Rating: a lesser line that does not claim the raw index", () => {
    const s = eventStep(noRating);
    expect(s.optional).toBe(true);
    expect(s.missing).toMatch(/Course Rating/);
    expect(s.missing).not.toMatch(/handicap index/i);
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
    expect(unratedTeesTodo(noSlope)).toBe(TODO);
    expect(unratedTeesTodo(noRating)).toMatch(/Course Rating/);
  });

  it("never says bet", () => {
    for (const u of [none, noSlope, noRating]) expect(unratedTeesTodo(u)).not.toMatch(/\bbet/i);
  });
});

describe("the organizer's guide says it", () => {
  it("names the Optional to-do about tees on the rail", () => {
    const all = JSON.stringify(GUIDE_STEPS);
    expect(all).toMatch(/Add tees with a rating, or net scores use each player's handicap index/);
  });
});
