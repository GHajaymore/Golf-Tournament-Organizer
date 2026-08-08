import { describe, it, expect } from "vitest";
import { setupChecklist, isUnstarted, type ChecklistState } from "../services/checklist";

/**
 * The setup checklist, and the question it answers on the dashboard: is this
 * tournament built yet?
 *
 * It matters because a brand-new organizer lands on the dashboard straight
 * after creating a tournament. Before this existed they were shown a wall of
 * zeroes — "0 players", "0/0 matches complete", "0 of 0 advancing" — every one
 * of them true and none of them useful.
 */

const empty: ChecklistState = {
  confirmed: [],
  waitlist: [],
  stages: [],
  groups: [],
  matches: [],
  accounts: [{}], // the organizer's own account always exists
};

const ready: ChecklistState = {
  confirmed: new Array(24).fill({}),
  waitlist: [],
  stages: new Array(2).fill({}),
  groups: new Array(4).fill({}),
  matches: new Array(12).fill({}),
  accounts: [{}, {}],
};

describe("is this tournament built yet", () => {
  it("calls a tournament with no field unstarted", () => {
    expect(isUnstarted(empty)).toBe(true);
  });

  it("stops calling it unstarted the moment a field exists", () => {
    // The field is the first real step: rounds, flights and scores all need
    // it, so it is the honest test for "there is something to show".
    expect(isUnstarted({ ...empty, confirmed: [{}] })).toBe(false);
  });

  it("does not treat a configured-but-empty tournament as started", () => {
    // Rounds exist from creation — the create action makes the opening one —
    // so rounds alone must not count as progress.
    expect(isUnstarted({ ...empty, stages: [{}] })).toBe(true);
  });
});

describe("what the checklist says", () => {
  it("marks nothing done on a fresh tournament, and says what to do", () => {
    const items = setupChecklist(empty);
    expect(items.map((i) => i.done)).toEqual([false, false, false, false]);
    expect(items[0].detail).toContain("No players yet");
    expect(items[1].detail).toContain("No rounds yet");
    expect(items[2].detail).toContain("No flights yet");
  });

  it("marks the work done once it is", () => {
    const items = setupChecklist(ready);
    expect(items[0].done).toBe(true);
    expect(items[0].detail).toContain("24 confirmed");
    expect(items[1].detail).toContain("2 rounds");
    expect(items[2].done).toBe(true);
    expect(items[2].detail).toContain("schedule generated");
  });

  it("does not count flights done until the schedule is generated", () => {
    // Flights without a draw are a list of names, not a playable round — the
    // step is only finished when there are matches to play.
    const items = setupChecklist({ ...ready, matches: [] });
    expect(items[2].done).toBe(false);
    expect(items[2].detail).toContain("schedule not generated yet");
  });

  it("mentions the waitlist only when someone is on it", () => {
    expect(setupChecklist(ready)[0].detail).not.toContain("waitlisted");
    expect(setupChecklist({ ...ready, waitlist: [{}, {}] })[0].detail).toContain("2 waitlisted");
  });

  it("keeps staff optional — one person can run a tournament", () => {
    const staff = setupChecklist(empty).find((i) => i.label === "Access & staff");
    expect(staff?.optional).toBe(true);
    expect(staff?.detail).toContain("Just you so far");
  });

  it("points every step at the screen that completes it", () => {
    expect(setupChecklist(empty).map((i) => i.href)).toEqual([
      "/registration",
      "/stages",
      "/grouping",
      "/access",
    ]);
  });
});
