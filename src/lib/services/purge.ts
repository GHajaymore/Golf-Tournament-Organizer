import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isKnockoutRound } from "@/lib/stage-types";

/**
 * DELETING A ROUND OR A TOURNAMENT IS A PURGE (Ajay, 2026-11-07).
 *
 * "Make sure delete round or tournament should clear all traces." Most of a
 * tournament goes by `onDelete: Cascade`; the rest carries a bare `eventId` or
 * `stageId` with NO foreign key, so it was left behind, still naming people.
 * This file is the one place that removes those, in the same transaction as the
 * row they hang from, and `delete-purges-everything.test.ts` reads the schema
 * and fails when a model gains an `eventId` or `stageId` this file (or the
 * cascade) does not handle.
 *
 * Every delete path asks it: `deleteEvent`, the Free plan's deletion, the
 * archive sweep, the casual-round sweep and the par sweep.
 */

/**
 * CLUB- AND PERSON-LEVEL MODELS A PURGE MUST NEVER REACH (Ajay, 2026-11-07:
 * "make sure it doesnt delete the member record/entry").
 *
 * A tournament's `Player` is an ENTRY; the `Member` it points to is the club's
 * roster record, with the handicap and history that outlive any one event. The
 * link is `Player.memberId -> Member` with `onDelete: SetNull` on the Member
 * side, so deleting an entry never touches the Member. `delete-purges-
 * everything.test.ts` fails if any of these can be reached by a cascade from
 * Event or Stage, or is deleted in this file.
 * `Account` is NOT here: it is the tournament's own access list (`eventId`,
 * cascade) and holds no password; the sign-in is the `User`.
 */
export const NEVER_PURGED: Record<string, string> = {
  Member: "the club's roster record: handicap, GHIN, history",
  User: "a person's sign-in",
  Organization: "the club itself",
  OrganizationMember: "who belongs to the club and in what role",
  JoinRequest: "a person asking to join a club",
  Subscription: "the club's plan and billing record",
  Series: "the club's season, which tournaments belong to",
  Course: "the club's course library",
  Tee: "a course's tees",
  Integration: "the club's association credentials",
  KnownDevice: "a person's trusted browser",
  PasswordResetToken: "a person's sign-in",
  EmailCode: "a person's sign-in",
  PushSubscription: "a person's device",
};

/**
 * Models with an `eventId` that are KEPT when the event goes, with the reason.
 * Empty on purpose: the owner ruled that nothing of a purged tournament stays.
 * (The one trace he allows, a club's audit line saying it was deleted and by
 * whom, has no table that can outlive the event yet: `AuditLog.eventId` is
 * required and cascades. A club-level audit table is a separate migration.)
 */
export const KEPT_ON_EVENT_DELETE: Record<string, string> = {};

/**
 * Models with a `stageId` that are KEPT when a round goes. Empty for the same
 * reason.
 */
export const KEPT_ON_ROUND_DELETE: Record<string, string> = {};

/**
 * Models whose `eventId` has no foreign key (or none to Event), so the cascade
 * does not reach them and they are deleted here by hand.
 */
export const EVENT_ROWS_WITHOUT_A_CASCADE = ["HonoursEntry", "SmsDelivery", "EmailFailure"] as const;

/**
 * Models whose `stageId` has no foreign key to Stage, deleted by hand with the
 * round. (A child of one of these, e.g. ExpenseShare, goes by its own cascade.)
 */
export const ROUND_ROWS_WITHOUT_A_CASCADE = [
  "Scorecard",
  "TeamScorecard",
  "RoundHandicap",
  "HandicapPost",
  "Expense",
  "Contest",
  "SideGame",
  "TournamentFund",
] as const;

/**
 * WHEN A TOURNAMENT'S HONOURS ENTRY GOES (ruled 2026-11-08).
 *
 * The club's honours-board line for a tournament is KEPT when the tournament is
 * removed by an automatic sweep (the Free plan's 15 days after completion, a
 * lapsed club's archive) and goes only when a person pressed Delete
 * (`deleteEvent` -> `purgeEvents(..., { deliberate: true })`). The board is the
 * club's history. Decided by the team under Ajay's standing delegation.
 * The other value, `"every-delete"`, would take the line with the tournament
 * however it went; the ruling is this one line.
 */
export const HONOURS_GO_WITH: "every-delete" | "deliberate-delete-only" = "deliberate-delete-only";

/** A lapsed club's archive can hold many tournaments; Prisma's default of 5 s would fail it every night. */
const PURGE_TX = { timeout: 60_000, maxWait: 10_000 } as const;

type Tx = Prisma.TransactionClient;

async function deleteRoundRows(tx: Tx, eventId: string, stageIds: string[]) {
  if (stageIds.length === 0) return;
  const where = { eventId, stageId: { in: stageIds } };
  await tx.scorecard.deleteMany({ where });
  await tx.teamScorecard.deleteMany({ where });
  await tx.roundHandicap.deleteMany({ where });
  await tx.handicapPost.deleteMany({ where });
  await tx.expense.deleteMany({ where });
  await tx.contest.deleteMany({ where });
  await tx.sideGame.deleteMany({ where });
  await tx.tournamentFund.deleteMany({ where });
}

/**
 * Delete one round and everything tied to it, in one transaction. Scoped by the
 * event, so a round id from another tournament deletes nothing. Returns whether
 * the round existed.
 */
export async function purgeRound(eventId: string, stageId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const stage = await tx.stage.findFirst({ where: { id: stageId, eventId }, select: { id: true, type: true } });
    if (!stage) return false;
    await deleteRoundRows(tx, eventId, [stageId]);
    await tx.stage.deleteMany({ where: { id: stageId, eventId } });
    // A bracket's results are keyed "{winners|consolation}-{round}-{match}" with
    // no stage id, so the cascade from the Stage cannot reach them: they go with
    // the knockout round, and a stored draw with no bracket left goes too.
    if (isKnockoutRound(stage.type)) {
      await tx.bracketWinner.deleteMany({ where: { eventId } });
      await tx.bracketReport.deleteMany({ where: { eventId } });
      const left = await tx.stage.findMany({ where: { eventId }, select: { type: true } });
      if (!left.some((s) => isKnockoutRound(s.type))) {
        await tx.event.update({ where: { id: eventId }, data: { bracketDraw: "" } });
      }
    }
    return true;
  }, PURGE_TX);
}

const filled = (v: unknown): boolean => typeof v === "string" && v.length > 0;
const named = (v: unknown): boolean => {
  if (filled(v)) return true;
  if (typeof v !== "object" || v === null) return false;
  const o = v as { equals?: unknown; in?: unknown };
  return filled(o.equals) || (Array.isArray(o.in) && o.in.length > 0);
};

/**
 * Why a filter may not reach a purge: it must name a club (`organizationId`) or
 * explicit tournaments (`id`), else `{}` or `{ archivedAt: { not: null } }`
 * would match every tournament in every club. Null when the filter is scoped.
 */
export function purgeScopeRefusal(where: Prisma.EventWhereInput): string | null {
  if (named(where.organizationId) || named(where.id)) return null;
  return "A purge needs a club (organizationId) or explicit tournament ids; an unscoped filter would match every tournament.";
}

/**
 * Delete every tournament matching `where`, and everything tied to it, in one
 * transaction. `where` is re-applied to the delete, so a sweep's "still due"
 * condition holds at the moment of deletion. Returns how many went.
 * `deliberate` means a person pressed Delete (see `HONOURS_GO_WITH`).
 */
export async function purgeEvents(where: Prisma.EventWhereInput, opts: { deliberate?: boolean } = {}): Promise<number> {
  const refusal = purgeScopeRefusal(where);
  if (refusal) throw new Error(refusal);
  return prisma.$transaction(async (tx) => {
    const ids = (await tx.event.findMany({ where, select: { id: true } })).map((e) => e.id);
    if (ids.length === 0) return 0;
    // The rest of the tournament hangs off the event by a cascade.
    const gone = await tx.event.deleteMany({ where: { AND: [{ id: { in: ids } }, where] } });
    // Only for events that really went: a sweep's `where` may have stopped
    // matching a row between the select and the delete.
    const still = new Set((await tx.event.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((e) => e.id));
    const goneIds = ids.filter((id) => !still.has(id));
    const byEvent = { eventId: { in: goneIds } };
    if (HONOURS_GO_WITH === "every-delete" || opts.deliberate) await tx.honoursEntry.deleteMany({ where: byEvent });
    await tx.smsDelivery.deleteMany({ where: byEvent });
    await tx.emailFailure.deleteMany({ where: byEvent });
    return gone.count;
  }, PURGE_TX);
}

/** One tournament. */
export async function purgeEvent(eventId: string, opts: { deliberate?: boolean } = {}): Promise<boolean> {
  return (await purgeEvents({ id: eventId }, opts)) > 0;
}
