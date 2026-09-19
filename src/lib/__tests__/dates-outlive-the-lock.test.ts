import { describe, it, expect } from "vitest";
import { readSource } from "./source";

/**
 * A TENTATIVE DATE CAN BE CONFIRMED AFTER LAUNCH.
 *
 * Launching requires dates (`launchRefusal`), and the honest answer for a club
 * that has not settled them is "tentative". Those dates become fixed WEEKS
 * LATER — by which time the tournament is live and its configuration locked,
 * and `saveEvent` refuses every field on the setup screen.
 *
 * Found by trying it on 2026-09-19 rather than by reading: ticking the box on
 * a live tournament threw "Configuration is locked" into the server log and
 * changed nothing on screen. Without `setTournamentDates` outside the lock,
 * the whole feature is a flag nobody can ever clear.
 *
 * Read through `readSource`, which strips comments — the prose above the
 * action names both the action and the guard, and would otherwise satisfy
 * every assertion here on its own.
 */

const actions = readSource("src", "app", "actions", "tournament.ts");

/** The body of one exported action, up to the next export. */
function body(name: string): string {
  const start = actions.indexOf(`export async function ${name}(`);
  expect(start, `${name} is not in tournament.ts — this sweep is measuring nothing`).toBeGreaterThan(-1);
  const next = actions.indexOf("\nexport ", start + 1);
  return actions.slice(start, next === -1 ? undefined : next);
}

describe("the tournament's dates", () => {
  it("are written by an action of their own", () => {
    expect(body("setTournamentDates")).toMatch(/datesTentative/);
  });

  it("are not behind the setup lock", () => {
    // The whole point. `assertUnlocked` here would refuse every live
    // tournament, which is every tournament whose dates are worth confirming.
    expect(body("setTournamentDates")).not.toMatch(/assertUnlocked/);
  });

  it("are still an organizer's to change, not anybody's", () => {
    /**
     * Off the lock is not off the guard. A `"use server"` export is a public
     * HTTP endpoint, and this one decides what a whole membership is told
     * about when they are playing.
     */
    expect(body("setTournamentDates")).toMatch(/requireAdminEvent\(\)/);
  });

  it("keeps the control the organizer uses off the lock too", () => {
    // The screen calls the unlocked action rather than the locked bulk save,
    // or the button is there and does nothing on a live tournament.
    const setup = readSource("src", "components", "EventSetupClient.tsx");
    expect(setup).toMatch(/setTournamentDates\(f\.startOn, f\.endOn, f\.datesTentative, f\.dates\)/);
  });

  it("is what the launch gate reads, so the two cannot drift", () => {
    // `dated` comes off the same column the action writes.
    expect(actions).toMatch(/launchRefusal\(\{[^}]*dated: !!event\?\.dates\.trim\(\)/);
  });
});
