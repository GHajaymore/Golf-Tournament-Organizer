import "server-only";
import { prisma } from "../db";
import { getSession } from "../auth";
import { roundLabel } from "@/lib/domain/round-label";

/**
 * The two things nearly every server action does, written once.
 *
 * Both were copied instead: `assertUnlocked` into three action files and the
 * audit writer into six. A guard in three copies is a guard that will be
 * changed in two of them, and the audit log is the RECORD — this app calculates
 * money and never moves it, so the record is the whole of what it promises.
 *
 * IN `services/` RATHER THAN IN `actions/`, and `audit-idor.test.ts` already
 * says why: "a `use server` file cannot export a helper without publishing it
 * as an HTTP endpoint, so sharing it meant moving it". The shared access reader
 * moved here for that reason and this belongs beside it. Putting it in
 * `actions/` also puts it under the IDOR and guard sweeps, which walk that
 * directory and would have to be taught that one file in it is not an action —
 * an exemption where a directory move does the job.
 */

/*
 * `assertUnlocked` AND `lockedRefusal` LIVED HERE until the state machine's PR
 * 5b. The first THREW "Configuration is locked" (38 sites), and a throw inside
 * a transition is "This screen didn't load"; the second returned the same
 * blanket sentence. Every structural action now asks its SCOPE's lock and
 * returns the machine's reason and way out (`refuseIfLocked` in
 * services/tournament-status.ts, reading `locksFor`). Deleted rather than left
 * beside it: a dead twin is a second copy waiting to be used.
 */

/*
 * `playRefusalFor` LIVED HERE until the state machine's PR 4. It counted its own
 * four tables for "has anybody played" and differed from the machine's one
 * definition (`hasResult`) on a forfeit, a match card and a winner recorded with
 * no knockout round — D2 of the proposal. Every door into scoring now asks
 * `playRefusedBecause` (services/tournament-status.ts), which is the machine's
 * `refusals.play`. Deleted rather than left beside it: a dead twin is a second
 * copy waiting to be used.
 */

/**
 * Write one line into the tournament's audit log.
 *
 * `actor` comes from the session unless the caller passes one. `money-setup.ts`
 * is the reason for the override: it already has the actor in hand and does not
 * want a second session read, which is how its copy came to have a different
 * signature from the other three.
 *
 * `matchId` is null for anything that is not about a single match — every money
 * line, every setting. The four `logMoney` copies hard-coded that null; keeping
 * it as a parameter is what lets this replace `logAudit` as well, rather than
 * being a sixth variant beside it.
 */
export async function logAudit(
  eventId: string,
  action: string,
  detail: string,
  opts: { matchId?: string | null; actor?: string } = {},
): Promise<void> {
  const actor = opts.actor || (await getSession())?.name || "system";
  await prisma.auditLog.create({
    data: { eventId, matchId: opts.matchId ?? null, actor, action, detail },
  });
}

/**
 * A round as an audit line names it — its own description, or "Round 2".
 *
 * NOT its id. `recentChanges` turns every id in a line that is not a player's
 * into "someone no longer in the field", so a line carrying a round's id read
 * "Card disputed — round someone no longer in the field".
 */
export async function roundWordsFor(eventId: string, stageId: string): Promise<string> {
  const stages = await prisma.stage.findMany({
    where: { eventId },
    orderBy: { position: "asc" },
    select: { id: true, type: true, position: true, description: true },
  });
  const stage = stages.find((s) => s.id === stageId);
  return stage?.description || roundLabel(stages, stageId) || "a round";
}
