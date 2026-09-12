import "server-only";
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
  if (e && (e.status === "live" || e.status === "completed") && !e.configUnlocked) {
    throw new Error(`Configuration is locked. Unlock the tournament to ${what}.`);
  }
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
