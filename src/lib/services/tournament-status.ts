import "server-only";
import { cache } from "react";
import { prisma } from "../db";
import { isLaunched } from "../domain/lifecycle-state";
import { tournamentStatus, setupFlowOf, playRefusalOf, type TournamentFacts, type TournamentStatus } from "../domain/tournament-status";
import type { SetupFlow } from "../domain/setup-flow";
import { setupSideFactsFor, tournamentFactsFor } from "./tournament-facts";
import { todayForEvent } from "./club-clock";

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
 * WHAT AN ACTION ASKS OF A TOURNAMENT (PR 4) — the same answer the screen
 * drew, on the club's own day. `launchTournament` and `setEventStatus` refuse
 * exactly what the dashboard's button refuses, in the same words, because they
 * read the same `refusals`.
 */
export async function tournamentStatusNow(eventId: string): Promise<{ facts: TournamentFacts; status: TournamentStatus } | null> {
  return tournamentStatusFor(eventId, await todayForEvent(eventId));
}

/**
 * MAY A SCORE BE ENTERED HERE — the machine's play refusal (`refusals.play`,
 * through `playRefusalOf`), for every door into scoring: the console's score
 * entry, the five round-code saves, keeping a group's card and a reported tie.
 *
 * It replaces `playRefusalFor`, which counted its own four tables for "has
 * anybody played" and so differed from the machine's `hasResult` on a forfeit,
 * a match card and a winner recorded with no knockout round (D2).
 *
 * COSTS ONE READ ONCE LAUNCHED, which is every save on the course: a launched
 * tournament is never refused, so the rounds are not read for one. Before
 * launch — the rare case — the rounds come from the facts' own batch.
 */
export async function playRefusedBecause(eventId: string): Promise<string | null> {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { status: true } });
  if (!event) return null;
  if (isLaunched(event.status)) return playRefusalOf({ status: event.status, rounds: [] });
  const facts = await setupSideFactsFor(eventId);
  return facts ? playRefusalOf(facts) : null;
}

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
