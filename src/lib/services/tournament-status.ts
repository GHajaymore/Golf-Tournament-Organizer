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
  addRoundLockOf,
  type CorrectionFacts,
  type LockBy,
  type LockReader,
  type LockScope,
  type ScopeLock,
  type TournamentFacts,
  type TournamentStatus,
} from "../domain/tournament-status";
import type { SetupFlow } from "../domain/setup-flow";
import { lockFactsFor, setupSideFactsFor, tournamentFactsFor } from "./tournament-facts";
import { todayForEvent } from "./club-clock";
import { getSession } from "../auth";

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
 * screen's `ScopeLockBanner` and for the action behind it. Read NARROWLY since
 * PR 5b (`lockFactsFor`: the row, the rounds' kinds, and results only where a
 * lock turns on them), because a server action is its own request and the
 * screen's cached batch is not there to share; the banner reads the same
 * narrow facts, so the banner and the refusal are one answer.
 */
export async function scopeLockFor(eventId: string, scope: LockScope): Promise<ScopeLock | null> {
  const facts = await lockFactsFor(eventId);
  return facts ? scopeLockOf(locksFor(facts), scope) : null;
}

/** A refused structural change: the sentence, and the lock it came from for the screen to draw. */
export interface LockRefusal {
  ok: false;
  error: string;
  lock: ScopeLock;
}

/** Who is pressing, for the refusal's words: the Organizer, or anybody else. */
async function readerNow(): Promise<LockReader> {
  const session = await getSession();
  return session?.role === "admin" ? "organizer" : "staff";
}

/**
 * REFUSE A CHANGE TO A LOCKED SCOPE — RETURNED, NEVER THROWN (J10, PR 5a; every
 * remaining site in PR 5b).
 *
 * It replaces `assertUnlocked`, now deleted. That THREW, and a throw inside a
 * transition is "This screen didn't load" — in production Next blanks a thrown
 * message anyway — so a press on a screen drawn before the lock (another tab
 * launched the tournament) took the whole screen down. This RETURNS
 * `{ ok: false, error, lock }`: the reason and the way out in words
 * (`lockRefusalWords`, which knows whether the presser can take that way out),
 * and the lock itself, so the screen can catch up with it (`useAction`).
 *
 * `what` finishes the way out — "… Make a committee correction to change teams."
 *
 * `except`: the locks this press is the WAY OUT of, and so must not be refused
 * by. Confirming or reopening the draw and renaming a flight ask the flights
 * scope `except: ["draw"]` — a confirmed draw locks moving a player, not the
 * button that reopens it.
 */
export async function refuseIfLocked(
  eventId: string,
  scope: LockScope,
  what: string,
  opts: { except?: readonly LockBy[] } = {},
): Promise<LockRefusal | null> {
  const lock = await scopeLockFor(eventId, scope);
  if (!lock || opts.except?.includes(lock.by)) return null;
  return { ok: false, error: lockRefusalWords(lock, what, await readerNow()), lock };
}

/**
 * ADDING A ROUND asks one rule for both doors — the round card's Add and the
 * described tournament (`applySetupProposal`) — and that rule refuses only a
 * completed tournament (TD ruling, 5a review; `addRoundLockOf`).
 */
export async function refuseIfAddingARoundIsLocked(eventId: string): Promise<LockRefusal | null> {
  const facts = await lockFactsFor(eventId);
  const lock = facts ? addRoundLockOf(locksFor(facts)) : null;
  return lock ? { ok: false, error: lockRefusalWords(lock, "add a round", await readerNow()), lock } : null;
}

/**
 * WHAT A SCREEN'S BANNER DRAWS (PR 5b): the locks on the scopes its controls
 * ask, in that order, and the committee correction if one is open on any of
 * them — so the banner can say the scope is open for a correction, and offer
 * Done. Null facts (no tournament) draws nothing.
 */
export async function screenLocksFor(
  eventId: string,
  scopes: readonly LockScope[],
): Promise<{ locks: ScopeLock[]; correction: CorrectionFacts | null }> {
  const facts = await lockFactsFor(eventId);
  if (!facts) return { locks: [], correction: null };
  const all = locksFor(facts);
  const locks = scopes.map((s) => scopeLockOf(all, s)).filter((l): l is ScopeLock => l !== null);
  const correction = facts.correction && scopes.includes(facts.correction.scope) ? facts.correction : null;
  return { locks, correction };
}

