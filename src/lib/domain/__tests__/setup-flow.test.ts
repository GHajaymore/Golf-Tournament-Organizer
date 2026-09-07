import { describe, it, expect } from "vitest";
import { setupFlow, positionOf, canAdvance, type SetupFacts } from "../setup-flow";
import { screenName } from "@/lib/nav";

/** Nothing done — a tournament the moment it is created. */
const BLANK: SetupFacts = {
  confirmed: 0,
  stages: 0,
  groups: 0,
  matches: 0,
  named: false,
  dated: false,
  venued: false,
  launched: false,
};

const flowOf = (over: Partial<SetupFacts> = {}) => setupFlow({ ...BLANK, ...over }, screenName);

describe("the order setup is guided in", () => {
  it("asks what the tournament is, then what is played, then who plays, then how they are divided", () => {
    // The order IS the product decision, so it is asserted rather than left to
    // whatever the array happens to contain. It is deliberately not the
    // checklist's order: deciding the field before deciding whether this is a
    // medal or a knockout is the way round that had somebody adding players
    // before finding out the format was wrong.
    expect(flowOf().steps.map((s) => s.href)).toEqual([
      "/event",
      "/stages",
      "/registration",
      "/grouping",
    ]);
  });

  it("calls each screen what the sidebar calls it", () => {
    // Read from the nav rather than written out again — the same rule that
    // produced a checklist row reading "Rounds & format" for a screen called
    // "Rounds & formats".
    const labels = flowOf().steps.map((s) => s.label);
    expect(labels).toEqual([
      screenName("/event"),
      screenName("/stages"),
      screenName("/registration"),
      screenName("/grouping"),
    ]);
    expect(labels).not.toContain("/event");
  });
});

describe("what counts as done", () => {
  it("needs a name and either a date or a venue — never both", () => {
    // A league that plays somewhere new every week has no venue; a club still
    // arguing about the date has no date. Demanding both leaves each of them
    // stuck on step one.
    expect(flowOf({ named: true }).steps[0].done).toBe(false);
    expect(flowOf({ named: true, dated: true }).steps[0].done).toBe(true);
    expect(flowOf({ named: true, venued: true }).steps[0].done).toBe(true);
    // And a name is not optional: a date with no name is a diary entry.
    expect(flowOf({ dated: true, venued: true }).steps[0].done).toBe(false);
  });

  it("needs flights AND a schedule, not just flights", () => {
    // The one that would pass on shape alone. Generating produces both, but
    // flights built and then left is a tournament with groups, no fixtures,
    // and nothing to score — and it reads as finished.
    const flightsOnly = flowOf({ named: true, dated: true, stages: 1, confirmed: 4, groups: 1 });
    expect(flightsOnly.steps[3].done).toBe(false);
    expect(flightsOnly.steps[3].missing).toMatch(/no pairings/i);

    const drawn = flowOf({ named: true, dated: true, stages: 1, confirmed: 4, groups: 1, matches: 6 });
    expect(drawn.steps[3].done).toBe(true);
    expect(drawn.complete).toBe(true);
  });

  it("counts what is finished rather than how far along you are", () => {
    expect(flowOf().doneCount).toBe(0);
    expect(flowOf({ named: true, dated: true }).doneCount).toBe(1);
    expect(flowOf({ named: true, dated: true, stages: 1 }).doneCount).toBe(2);
  });
});

describe("where the guide points", () => {
  it("points at the FIRST gap, not past it", () => {
    /**
     * The case that separates a guide from a counter. Somebody who reaches
     * Rounds first — which is where a newly created tournament already has a
     * round — has step 2 done and step 1 not. Pointing at "the one after the
     * last finished" would send them to Registration and past the gap they
     * left, which is the one thing a guide must never do.
     */
    const jumped = flowOf({ stages: 1 });
    expect(jumped.steps[1].done).toBe(true);
    expect(jumped.current?.href).toBe("/event");
    expect(jumped.current?.href).not.toBe("/registration");
  });

  it("has no current step once everything is done", () => {
    const done = flowOf({ named: true, venued: true, stages: 1, confirmed: 2, groups: 1, matches: 1 });
    expect(done.complete).toBe(true);
    expect(done.current).toBeNull();
  });

  it("marks exactly one step as current", () => {
    const states = flowOf({ named: true, dated: true }).steps.map((s) => s.state);
    expect(states.filter((s) => s === "current")).toHaveLength(1);
    expect(states).toEqual(["done", "current", "todo", "todo"]);
  });
});

describe("moving between steps", () => {
  it("knows what is either side of each screen", () => {
    const flow = flowOf();
    expect(positionOf(flow, "/event").back).toBeNull();
    expect(positionOf(flow, "/event").next?.href).toBe("/stages");
    expect(positionOf(flow, "/registration").back?.href).toBe("/stages");
    expect(positionOf(flow, "/registration").next?.href).toBe("/grouping");
    expect(positionOf(flow, "/grouping").next).toBeNull();
  });

  it("says nothing about a screen that is not part of setup", () => {
    // The rail renders on four screens; asked about a fifth it must decline
    // rather than guess an index.
    const at = positionOf(flowOf(), "/leaderboard");
    expect(at.step).toBeNull();
    expect(at.back).toBeNull();
    expect(at.next).toBeNull();
  });

  it("waits for the current step to be finished before offering the next", () => {
    const flow = flowOf({ named: true });
    const here = positionOf(flow, "/event").step;
    expect(canAdvance(here)).toBe(false);

    const ready = positionOf(flowOf({ named: true, dated: true }), "/event").step;
    expect(canAdvance(ready)).toBe(true);
  });

  it("never blocks going back to a step that is already finished", () => {
    // Revisiting Tournament details to change the date is exactly what "back"
    // is for, and a guide that argues about it is worse than no guide.
    const flow = flowOf({ named: true, dated: true, stages: 1 });
    const finished = positionOf(flow, "/event").step;
    expect(finished?.done).toBe(true);
    expect(canAdvance(finished)).toBe(true);
  });

  it("advances freely from a screen the flow does not cover", () => {
    expect(canAdvance(null)).toBe(true);
  });
});

describe("the hand-off from setting up to running", () => {
  const finished = { named: true, venued: true, stages: 1, confirmed: 2, groups: 1, matches: 1 };

  it("says setup is done while the field still cannot see any of it", () => {
    /**
     * The gap this closes. The rail guided an organizer through four steps and
     * then vanished at the exact moment the tournament became real — nothing
     * said they were finished, and nothing said that until it is launched
     * nobody in the field can see their schedule, their card or the
     * leaderboard. The existing warning about that fires only once a SCORE has
     * been entered, which is the morning of.
     */
    const ready = flowOf({ ...finished, launched: false });
    expect(ready.complete).toBe(true);
    expect(ready.readyToLaunch).toBe(true);
  });

  it("clears itself the moment the tournament is launched", () => {
    // What makes it worth showing at all: it is true for the few minutes
    // between finishing setup and launching, and false forever after. A
    // banner that stays is furniture.
    const live = flowOf({ ...finished, launched: true });
    expect(live.complete).toBe(true);
    expect(live.readyToLaunch).toBe(false);
  });

  it("never offers a launch before setup is finished", () => {
    // Launching hands out player access and locks configuration. Offering it
    // over a tournament with no field would be offering to publish an empty
    // one.
    const halfway = flowOf({ named: true, dated: true, stages: 1, launched: false });
    expect(halfway.complete).toBe(false);
    expect(halfway.readyToLaunch).toBe(false);
  });
});
