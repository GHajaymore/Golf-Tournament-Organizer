import { describe, it, expect } from "vitest";
import { setupFlow, type SetupFacts, type SetupRound } from "../setup-flow";
import { screenName } from "@/lib/nav";

/**
 * A TEAM EVENT IS TOLD TO MAKE ITS SIDES.
 *
 * Found 2026-09-26 creating a Scramble the way a non-golfer would and following
 * only the guide: details → rounds → field → flights → money, never a word about
 * teams, while the dashboard read "Sides in 0/0". A scramble cannot be scored
 * without sides, so the guide could reach "5 of 5 done" on a tournament nobody
 * could play — and the step it pointed at, Flights, previews "Flight 1: four
 * names", which a newcomer takes for a team.
 *
 * The fixture is a tournament otherwise COMPLETELY set up (named, dated, a
 * scheduled medal round, a field, a flight, money answered), so the only thing
 * that can hold the guide back is the sides — and a medal with the same facts
 * is the control that must read complete.
 */

const medalRound: SetupRound = { label: "Round 1", drawsPairings: false, scheduled: true, cutFed: false, matches: 0 };

const READY: SetupFacts = {
  confirmed: 8,
  rounds: [medalRound],
  groups: 1,
  named: true,
  dated: true,
  venued: true,
  moneyAnswered: true,
  launched: false,
};

const flow = (teams?: SetupFacts["teams"]) => setupFlow({ ...READY, teams }, screenName);

describe("the sides step", () => {
  it("does not exist for a medal — the control", () => {
    const f = flow({ needed: false, sides: 0, unsided: 8 });
    expect(f.steps.map((s) => s.href)).not.toContain("/teams");
    expect(f.complete).toBe(true);
    // And a caller that never passes `teams` gets exactly the five steps.
    expect(flow(undefined).steps).toHaveLength(5);
  });

  it("holds an otherwise-finished team event until sides exist", () => {
    const f = flow({ needed: true, sides: 0, unsided: 8 });
    expect(f.complete).toBe(false);
    expect(f.current?.href).toBe("/teams");
    expect(f.current?.missing).toMatch(/No sides yet/);
    expect(f.steps).toHaveLength(6);
  });

  it("is not done while anybody is left off a side", () => {
    const f = flow({ needed: true, sides: 2, unsided: 1 });
    expect(f.current?.href).toBe("/teams");
    expect(f.current?.missing).toBe("1 player is not on a side yet.");
    expect(flow({ needed: true, sides: 2, unsided: 3 }).current?.missing).toBe("3 players are not on a side yet.");
  });

  it("is done when every player is on a side", () => {
    const f = flow({ needed: true, sides: 2, unsided: 0 });
    expect(f.complete).toBe(true);
    expect(f.doneCount).toBe(6);
  });

  it("sits after the field and before the flights", () => {
    // Sides are made FROM the field, and the flight preview is what a newcomer
    // mistakes for the teams — so the real question comes first.
    const hrefs = flow({ needed: true, sides: 0, unsided: 8 }).steps.map((s) => s.href);
    expect(hrefs.indexOf("/teams")).toBe(hrefs.indexOf("/registration") + 1);
    expect(hrefs.indexOf("/teams")).toBeLessThan(hrefs.indexOf("/grouping"));
  });
});
