import "server-only";
import { cache } from "react";
import { prisma } from "../db";
import { isLaunched } from "../domain/lifecycle-state";
import {
  tournamentStatus,
  setupFlowOf,
  playRefusalOf,
  locksFor,
  scopeLockOf,
  lockRefusalWords,
  type LockScope,
  type ScopeLock,
  type TournamentFacts,
  type TournamentStatus,
} from "../domain/tournament-status";
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
 *
 * WHAT THAT RARE CASE COSTS, said plainly: a tournament under way but never
 * launched (the D2 population — play let through because it had begun) pays
 * the WHOLE setup-side batch (`readCore`: about fourteen grouped queries, the
 * card check and, with a round off a handicap, the tee read) on EVERY save,
 * where `playRefusalFor` paid four `findFirst`s. Accepted rather than given a
 * narrower read of its own, because a second read of "has anybody played" is
 * exactly the copy D2 was; the population only shrinks (every tournament
 * begun since the gate must launch before its first score), and launching it
 * takes every save back to the one read above. If a club ever plays a whole
 * day unlaunched and the saves slow, the fix is to launch it, or to give
 * `readCore` a rounds-only mode — not a private rule here.
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

/**
 * THE LOCK ON ONE SCOPE, as the machine states it (`locksFor`, PR 5a) — for a
 * screen's `ScopeLockBanner` and for the action behind it, which ask the same
 * rule of the same setup-side read, so the banner and the refusal are one
 * answer. `cache` is per request: on a page the read is shared with the rail
 * (`setupRailFor`); a press is its own request and makes the read once.
 */
export async function scopeLockFor(eventId: string, scope: LockScope): Promise<ScopeLock | null> {
  const facts = await setupSideFactsFor(eventId);
  return facts ? scopeLockOf(locksFor(facts), scope) : null;
}

/** A refused structural change: the sentence, and the lock it came from for the screen to draw. */
export interface LockRefusal {
  ok: false;
  error: string;
  lock: ScopeLock;
}

/**
 * REFUSE A CHANGE TO A LOCKED SCOPE — RETURNED, NEVER THROWN (J10, PR 5a).
 *
 * It replaces `assertUnlocked` in the actions that called it. That THREW, and a
 * throw inside a transition is "This screen didn't load" — in production Next
 * blanks a thrown message anyway — so a press on a screen drawn before the lock
 * (another tab launched the tournament, or locked setup again) took the whole
 * screen down. This RETURNS `{ ok: false, error, lock }`: the reason and the
 * way out in words (`lockRefusalWords`), and the lock itself, so the screen can
 * catch up with it.
 *
 * `what` finishes the way out — "… Unlock it on the dashboard to change teams."
 *
 * WHAT IT COSTS: the setup side of the facts (`setupSideFactsFor`, one batch of
 * grouped queries) where `assertUnlocked` read one row. Accepted rather than
 * given a narrower read of its own, because a second spelling of "is it locked"
 * is the copy the scoped locks exist to retire; these are organizer presses,
 * never a save on the course.
 */
export async function refuseIfLocked(eventId: string, scope: LockScope, what: string): Promise<LockRefusal | null> {
  const lock = await scopeLockFor(eventId, scope);
  return lock ? { ok: false, error: lockRefusalWords(lock, what), lock } : null;
}
