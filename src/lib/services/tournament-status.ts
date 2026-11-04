import "server-only";
import { cache } from "react";
import { tournamentStatus, setupFlowOf, type TournamentFacts, type TournamentStatus } from "../domain/tournament-status";
import type { SetupFlow } from "../domain/setup-flow";
import { setupSideFactsFor, tournamentFactsFor } from "./tournament-facts";

/**
 * WHAT A SCREEN ASKS OF A TOURNAMENT (state machine PR 3): its facts, read
 * once, and the machine's one answer about them — the step, the chip, the setup
 * steps, the one next action and its refusal, the locks and the warnings.
 *
 * Request-cached, so the layout's context bar and the dashboard beneath it ask
 * once between them. `today` is the club's day (`state.today`,
 * `todayForEvent`), never the server's — required, so the compiler lists every
 * caller the day the rule grows.
 */
export const tournamentStatusFor = cache(
  async (eventId: string, today: string): Promise<{ facts: TournamentFacts; status: TournamentStatus } | null> => {
    const facts = await tournamentFactsFor(eventId, today);
    return facts ? { facts, status: tournamentStatus(facts) } : null;
  },
);

/**
 * THE SETUP RAIL for a set-up screen — the machine's setup steps drawn as the
 * rail, its footer and the checklist read them (`setupFlowOf`). It replaces
 * `setupFlowFor`, which drew the rail from the setup flow's own rules, so a
 * medal with no flights sat at "Now: Flights" while Launch worked (D1).
 *
 * Null for a casual round, which has nothing to set up, and for a tournament
 * that does not exist.
 */
export async function setupRailFor(eventId: string): Promise<SetupFlow | null> {
  const facts = await setupSideFactsFor(eventId);
  return facts ? setupFlowOf(facts) : null;
}
