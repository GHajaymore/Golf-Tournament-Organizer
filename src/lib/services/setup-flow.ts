import "server-only";
import { screenName } from "../nav";
import { setupFlow, type SetupFlow } from "../domain/setup-flow";
import type { LaunchCheck } from "../domain/launch-check";
import { setupFactsFor } from "./tournament-facts";

/**
 * The setup flow for one tournament, read once per screen.
 *
 * THROUGH THE STATE MACHINE'S ONE READER (proposal 3 Nov, PR 2). This file had
 * its own read of the tournament (`setupFactsFor`, eight counts and a list),
 * beside `tournamentFactsFor`'s, each spelling "confirmed", "dated", "a saved
 * tee sheet" for itself. It now takes the setup side of that batch
 * (`setupFactsFor` in services/tournament-facts.ts, through `setupFactsOf`),
 * which is request-cached, so the dashboard asking both the flow and the gate
 * reads the tournament once. `the-setup-flow-reads-the-facts.audit.test.ts`
 * was run against the old read first and held every answer across the switch.
 *
 * One round of queries rather than a screen's worth: the rail appears on every
 * Set-up screen, and a screen that already loads the whole event state should
 * not pay for a second build of it to draw a progress bar.
 *
 * Returns NULL for a match. Two people playing each other have no tournament
 * to set up — the match screen created the whole thing in one step — so
 * putting a progress rail over it would invent work that does not
 * exist. Answered from the event's shape, so it cannot drift from the sidebar,
 * which hides the same screens for the same reason.
 */
export async function setupFlowFor(eventId: string): Promise<SetupFlow | null> {
  const read = await setupFactsFor(eventId);
  if (!read || read.match) return null;
  return setupFlow(read.facts, screenName);
}

/**
 * WHAT LAUNCH SAYS about this tournament — the refusal and the warnings — from
 * the very flow the rail draws (gap G3, 2026-10-31). The dashboard's Launch
 * button and `launchTournament` both ask this, so the button, the action and
 * the rail are one verdict. A match is asked too: it has no rail, and it still
 * goes through the gate.
 */
export async function launchCheckFor(eventId: string): Promise<LaunchCheck> {
  const read = await setupFactsFor(eventId);
  if (!read) return { refusal: "This tournament could not be found.", warnings: [], stepsOpen: 0, steps: 0 };
  return setupFlow(read.facts, screenName).launch;
}
