import "server-only";
import { screenName } from "../nav";
import { setupFlow } from "../domain/setup-flow";
import type { LaunchCheck } from "../domain/launch-check";
import { setupFactsFor } from "./tournament-facts";

/*
 * THE RAIL MOVED TO THE STATE MACHINE (PR 3). `setupFlowFor` drew the setup
 * rail from this flow's own step rules, and those rules held a medal with no
 * flights at "Now: Flights" while Launch worked (D1), and ticked a details step
 * with a venue and no dates while Launch refused them (D4). Every set-up
 * screen now asks `setupRailFor` (services/tournament-status.ts), which draws
 * the machine's steps. It was deleted rather than left beside it: a dead twin
 * is a second copy waiting to be used.
 *
 * What is left here is the launch ACTION's gate, which PR 4 moves.
 */

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
