import "server-only";
import { configurationLocked, PRE_LAUNCH_STATUSES } from "@/lib/domain/lifecycle-state";
import { playRefusal } from "@/lib/domain/phase-gate";
import { prisma } from "../db";
import { getSession } from "../auth";

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

/**
 * Refuse a structural change to a tournament whose configuration is locked.
 *
 * Locked means live or completed AND not explicitly unlocked. A draft is never
 * locked, because nothing has been played to protect.
 *
 * `what` completes the sentence — "Unlock the tournament to change teams." The
 * three copies differed in exactly that clause and in nothing else, which is
 * why it is a parameter rather than three functions.
 *
 * THROWS rather than returning a refusal, which is what all three copies did.
 * These are structural edits reached from a screen that already hides the
 * control when the tournament is locked, so arriving here is a client out of
 * step with the server rather than a person to be told something useful.
 */
export async function assertUnlocked(
  eventId: string,
  what = "make structural changes",
): Promise<void> {
  const e = await prisma.event.findUnique({
    where: { id: eventId },
    select: { status: true, configUnlocked: true },
  });
  // One definition of "locked", shared with isSetupLocked and LifecycleBar.
  if (e && configurationLocked(e)) {
    throw new Error(`Configuration is locked. Unlock the tournament to ${what}.`);
  }
}

/**
 * Refuse a score on a tournament that has not started, or return null.
 *
 * ONE PLACE, because there are four doors into scoring — the console's
 * `requireScoreEntry`, the play surface, and two in `actions/courses.ts` — and
 * a rule each of them has to remember to call is a rule one of them will
 * forget. That is this codebase's most-repeated defect and `isManualFormat`
 * is the entry CLAUDE.md keeps about it.
 *
 * RETURNS THE REASON rather than throwing, unlike `assertUnlocked` above, and
 * the difference is deliberate. A locked configuration is reached only by a
 * client out of step with the server, so throwing is right there. This one a
 * PERSON hits — a player opening their card on the first tee of a tournament
 * nobody launched — and they need to be told what is wrong and who can fix it.
 *
 * COSTS NOTHING ONCE LAUNCHED. The status is one indexed read, and the two
 * result lookups run only while the tournament is still pre-launch, which is
 * the rare case and never the hot path.
 */
export async function playRefusalFor(eventId: string): Promise<string | null> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { status: true },
  });
  if (!event) return null;
  if (!PRE_LAUNCH_STATUSES.includes(event.status)) return null;

  /**
   * "Any result" over the WHOLE tournament, both sources.
   *
   * A pure stroke tournament has no matches and a pure match one has no cards,
   * so asking either alone answers this wrongly for half the product — the
   * same fault `resultsIn` was written to fix for the dashboard banner, and
   * the reason that function counts both.
   *
   * `matchSettled` is not used: it wants a whole match object and this only
   * needs to know whether anybody has been out on the course. One hole
   * answers that, which is the same line the lifecycle warning draws.
   */
  const [card, match] = await Promise.all([
    prisma.scorecard.findFirst({ where: { eventId }, select: { id: true } }),
    prisma.match.findFirst({
      where: { eventId, NOT: { holes: { equals: "" } } },
      select: { holes: true },
    }),
  ]);
  const played = !!card || !!(match && /[1-9AaBbHh]/.test(match.holes));
  return playRefusal({ status: event.status, anyResult: played });
}

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
