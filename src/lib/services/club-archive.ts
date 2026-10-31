import "server-only";
import { prisma } from "../db";
import {
  archiveEndsAt,
  archiveRefusal,
  archiveState,
  archiveStep,
  type ArchiveAudience,
  type ArchiveState,
} from "../domain/club-archive";
import { clubDayInWords } from "../domain/club-clock";

/**
 * THE ARCHIVE OF A LAPSED PAID CLUB — the I/O half. The rule, and what it
 * replaced, is in `domain/club-archive.ts`.
 *
 * EVERY DOOR THAT EDITS A TOURNAMENT ASKS `assertEventWritable` (it throws, for
 * the staff gates) or `archiveRefusalFor` (it returns the sentence, for an
 * action that says its refusals). `the-archive-is-asked-at-every-door.test.ts`
 * holds every server action to it, so a new action cannot edit an archived
 * tournament by forgetting.
 */

export interface EventArchive {
  state: Extract<ArchiveState, { archived: true }>;
  /** The two days, in the club's words, at the club's clock. */
  words: { lapsed: string; until: string };
}

/** The archive this tournament is in, or null when it is not in one. */
export async function archiveOf(eventId: string, now: Date = new Date()): Promise<EventArchive | null> {
  if (!eventId) return null;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      archivedAt: true,
      status: true,
      organization: { select: { timeZone: true, locale: true } },
    },
  });
  if (!event) return null;
  const state = archiveState({ archivedAt: event.archivedAt, status: event.status }, now);
  if (!state.archived) return null;
  const { timeZone, locale } = event.organization;
  return {
    state,
    words: {
      lapsed: clubDayInWords(timeZone, locale, state.lapsedAt),
      until: clubDayInWords(timeZone, locale, state.until),
    },
  };
}

/** Why this tournament cannot be changed, in words, or null when it can. */
export async function archiveRefusalFor(eventId: string, who: ArchiveAudience = "organizer"): Promise<string | null> {
  const a = await archiveOf(eventId);
  return a ? archiveRefusal(a.state, a.words, who) : null;
}

type Tx = Pick<typeof prisma, "event" | "subscription">;

/**
 * LIFT A CLUB'S ARCHIVE — it is paying again (resubscribed through Stripe, or
 * a plan the owner arranged directly). Every tournament carries on exactly as
 * it was, and a later lapse starts its own twelve months and its own notices.
 * Run inside the caller's transaction with the plan change, so a club is never
 * paying and archived, or unarchived and on Par, in between.
 */
export async function liftArchive(tx: Tx, organizationId: string): Promise<void> {
  await tx.event.updateMany({ where: { organizationId, archivedAt: { not: null } }, data: { archivedAt: null } });
  await tx.subscription.updateMany({
    where: { organizationId },
    data: { lapsedAt: null, archiveNotice30At: null, archiveNotice7At: null },
  });
}

/** What `assertEventWritable` throws, so an action that says its refusals can say this one. */
export class ArchivedTournament extends Error {}

/**
 * Refuse any change to an archived tournament — for the staff gates, which
 * throw (`assertUnlocked` explains why a gate throws). The screens of an
 * archived tournament say the same sentence across the top
 * (`ArchiveBanner`), so the reason is on the screen however the press ends;
 * an action that returns its refusals catches this one by its class
 * (`archiveRefusalOf`) and returns it in words.
 */
export async function assertEventWritable(eventId: string): Promise<void> {
  const refusal = await archiveRefusalFor(eventId);
  if (refusal) throw new ArchivedTournament(refusal);
}

/** The archive's sentence when `e` is its refusal, or null for anything else. */
export function archiveRefusalOf(e: unknown): string | null {
  return e instanceof ArchivedTournament ? e.message : null;
}

/**
 * A CARD STRIPE IS STILL RETRYING (decision A8): the plan is kept, and the
 * club's owners and admins — the people who can change the card — are told on
 * the console, as well as on the plan screen. Nobody else is: a player or an
 * assistant cannot act on it, and it is the club's business.
 */
export const PAYMENT_DUE =
  "The last payment for this club's plan didn't go through. Update the card in Club settings, under Your plan, with Manage billing — Stripe will try it again, and nothing changes meanwhile.";

export async function paymentDueNoticeFor(organizationId: string, userId: string): Promise<string | null> {
  if (!organizationId || !userId) return null;
  const [sub, member] = await Promise.all([
    prisma.subscription.findUnique({ where: { organizationId }, select: { status: true, plan: true } }),
    prisma.organizationMember.findFirst({
      where: { organizationId, userId, role: { in: ["owner", "admin"] } },
      select: { id: true },
    }),
  ]);
  return sub?.status === "past_due" && sub.plan !== "free" && member ? PAYMENT_DUE : null;
}

/** For the club's plan screen: the archive it holds, or null. */
export async function clubArchiveSummary(
  organizationId: string,
): Promise<{ lapsed: string; until: string; tournaments: number } | null> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { timeZone: true, locale: true, subscription: { select: { lapsedAt: true } } },
  });
  const lapsedAt = org?.subscription?.lapsedAt;
  if (!org || !lapsedAt) return null;
  const tournaments = await prisma.event.count({ where: { organizationId, archivedAt: { not: null } } });
  if (tournaments === 0) return null;
  return {
    lapsed: clubDayInWords(org.timeZone, org.locale, lapsedAt),
    until: clubDayInWords(org.timeZone, org.locale, archiveEndsAt(lapsedAt)),
    tournaments,
  };
}

/** What the sweep says to a club's owners. */
export interface ArchiveNotice {
  to: string[];
  organizationId: string;
  organizationName: string;
  days: 30 | 7;
  /** The day the archive goes, in the club's words. */
  until: string;
  tournaments: number;
}

export interface ArchiveSweepResult {
  noticed: number;
  deleted: number;
}

/** Never touch more than this many clubs in one pass. */
const SWEEP_LIMIT = 200;

/**
 * THE DAILY PASS OVER LAPSED CLUBS' ARCHIVES (run by the cron beside the Par
 * sweep): send the notices that are due, and delete what has run its course.
 *
 * A notice is marked sent only after `notify` has been called for it, and the
 * delete repeats every condition in its own statement — the club still lapsed
 * on the SAME instant, the tournament still stamped — so a club that
 * resubscribes between the read and the delete keeps everything.
 */
export async function sweepArchives(
  now: Date,
  notify: (n: ArchiveNotice) => Promise<void>,
): Promise<ArchiveSweepResult> {
  const clubs = await prisma.subscription.findMany({
    where: { lapsedAt: { not: null } },
    select: {
      organizationId: true,
      lapsedAt: true,
      archiveNotice30At: true,
      archiveNotice7At: true,
      organization: {
        select: {
          name: true,
          timeZone: true,
          locale: true,
          members: { where: { role: "owner" }, select: { user: { select: { email: true } } } },
        },
      },
    },
    take: SWEEP_LIMIT,
  });
  let noticed = 0;
  let deleted = 0;
  for (const c of clubs) {
    const lapsedAt = c.lapsedAt!;
    const tournaments = await prisma.event.count({ where: { organizationId: c.organizationId, archivedAt: { not: null } } });
    if (tournaments === 0) continue;
    const step = archiveStep({ lapsedAt, notice30At: c.archiveNotice30At, notice7At: c.archiveNotice7At }, now);
    if (step.notice) {
      await notify({
        to: c.organization.members.map((m) => m.user.email).filter(Boolean),
        organizationId: c.organizationId,
        organizationName: c.organization.name,
        days: step.notice,
        until: clubDayInWords(c.organization.timeZone, c.organization.locale, archiveEndsAt(lapsedAt)),
        tournaments,
      });
      // A 7-day notice also stands for a 30-day one the sweep never got to send.
      const r = await prisma.subscription.updateMany({
        where: { organizationId: c.organizationId, lapsedAt },
        data: step.notice === 7 ? { archiveNotice7At: now, archiveNotice30At: c.archiveNotice30At ?? now } : { archiveNotice30At: now },
      });
      noticed += r.count;
    }
    if (step.delete) {
      const d = await prisma.event.deleteMany({
        where: {
          organizationId: c.organizationId,
          archivedAt: { not: null },
          organization: { subscription: { lapsedAt } },
        },
      });
      deleted += d.count;
    }
  }
  return { noticed, deleted };
}
