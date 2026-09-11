import { describe, it, expect } from "vitest";
import { launchRefusal, finishRefusal } from "../phase-gate";
import { readSource } from "../../__tests__/source";

/**
 * GUIDE WITHIN A PHASE, GATE BETWEEN THEM.
 *
 * The steps inside setting up stay reachable in any order — `setup-flow.ts`
 * decided that deliberately and says why: "an organizer setting up their ninth
 * tournament of the season knows exactly which screen they want and a wizard
 * that will not let them go there is worse than no wizard."
 *
 * The transitions BETWEEN phases had no check at all. `launchTournament` read
 * nothing before going live, and going live clears `configUnlocked` — so a
 * tournament with no rounds and nobody entered would publish itself to its
 * field AND lock its own configuration, leaving the organizer to unlock the
 * thing they had just locked in order to build the tournament they had just
 * published.
 */

describe("going live", () => {
  it("refuses a tournament with nothing to play", () => {
    const r = launchRefusal({ playingRounds: 0, confirmed: 12 });
    expect(r).toContain("no rounds");
    // Every refusal names the screen that fixes it.
    expect(r).toContain("Rounds & formats");
  });

  it("refuses a tournament with nobody to play it", () => {
    const r = launchRefusal({ playingRounds: 2, confirmed: 0 });
    expect(r).toContain("Nobody is in the field");
    expect(r).toContain("Registration & field");
  });

  it("allows the ordinary case", () => {
    expect(launchRefusal({ playingRounds: 1, confirmed: 1 })).toBeNull();
  });

  it("does not demand flights, a venue or a date", () => {
    /**
     * THE MINIMUM, not a checklist of good practice.
     *
     * A medal has no flights and never will. "No fixed course — players
     * choose" is a real answer to the venue question, and a league that fixes
     * its dates a week at a time has none to give. A gate that asked for any
     * of those would refuse tournaments that are perfectly ready, which is the
     * failure mode the course-card rules are written about — "a guard that
     * refuses a real golf course is worse than no guard".
     */
    expect(launchRefusal({ playingRounds: 1, confirmed: 40 })).toBeNull();
  });
});

describe("declaring it finished", () => {
  it("refuses while cards are still waiting to be signed off", () => {
    const r = finishRefusal({ pendingConfirmations: 3 });
    expect(r).toContain("3 cards are still waiting");
    expect(r).toContain("Score entry");
  });

  it("says it in the singular for one card", () => {
    const r = finishRefusal({ pendingConfirmations: 1 });
    expect(r).toContain("1 card is still waiting");
    expect(r).toContain("Approve or correct it");
  });

  it("allows a tournament with nothing outstanding", () => {
    expect(finishRefusal({ pendingConfirmations: 0 })).toBeNull();
  });

  it("does not refuse a tournament nobody played", () => {
    /**
     * A club that abandons a day to weather has to be able to close it. A gate
     * insisting on scores would be the app arguing with the weather, and there
     * is no remedy to name — which is the test of whether a refusal is fair.
     */
    expect(finishRefusal({ pendingConfirmations: 0 })).toBeNull();
  });
});

describe("where the gates are enforced", () => {
  /**
   * BOTH ENDS, and neither is load-bearing alone. A disabled button stops
   * nobody — a `"use server"` export is a public HTTP endpoint — and an action
   * that refuses silently makes the organizer press a thing to discover it
   * will not work.
   */
  it("is checked inside the actions, not only on the screen", () => {
    const actions = readSource("src", "app", "actions", "tournament.ts");
    expect(actions).toMatch(/const refusal = launchRefusal\(/);
    expect(actions).toMatch(/finishRefusal\(\{ pendingConfirmations/);
    // And the refusal is returned rather than thrown away.
    expect(actions).toMatch(/if \(refusal\) return \{ ok: false, error: refusal \}/);
  });

  it("is checked on the screen too, from the same two functions", () => {
    const dash = readSource("src", "app", "(app)", "dashboard", "page.tsx");
    expect(dash).toMatch(/launchRefusal\(\{/);
    expect(dash).toMatch(/finishRefusal\(\{/);
    expect(dash).toMatch(/blockedReason=\{phaseBlock/);
  });

  it("disables the button and shows the reason", () => {
    const bar = readSource("src", "components", "LifecycleBar.tsx");
    expect(bar).toMatch(/disabled=\{pending \|\| !!blockedReason\}/);
    // The reason is rendered, not merely held — a greyed-out button that
    // explains nothing is the worst of both.
    expect(bar).toMatch(/\{refused \|\| blockedReason\}/);
  });

  it("only gates the transitions that change what the field sees", () => {
    /**
     * Moving from draft to "taking entries" is a club saying what it is doing.
     * Gating it would be the wizard this codebase decided against.
     */
    const dash = readSource("src", "app", "(app)", "dashboard", "page.tsx");
    const block = dash.slice(dash.indexOf("const phaseBlock"), dash.indexOf("const phaseBlock") + 500);
    expect(block).not.toMatch(/"draft"/);
  });
});
