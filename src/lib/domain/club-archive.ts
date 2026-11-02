/**
 * A LAPSED PAID CLUB'S TOURNAMENTS ARE A READ-ONLY ARCHIVE FOR TWELVE MONTHS
 * (Ajay, 2026-10-21, decisions review A4 and A8: "go with your recommendations").
 *
 * What it replaced, measured from the code that day:
 *
 *   - an ended subscription held every tournament for 30 days (`retainUntil`),
 *     and then Par's terms applied to tournaments that were never on Par: the
 *     daily sweep stamped a 14-day clock from the FIRST golf — months ago, for a
 *     season-long league — so the club's active league was deleted on the next
 *     run after the hold ran out;
 *   - a COMPLETED tournament got no clock at all (the stamp skips completed
 *     ones), so it was kept for ever while the terms said 30 days;
 *   - `unpaid` — Stripe giving up after its retries — kept the paid plan for ever.
 *
 * THE RULE NOW, in one place:
 *
 *   - when a paid plan LAPSES (Stripe says `canceled` or `unpaid`), every
 *     tournament the club holds at that moment is stamped with the instant
 *     (`Event.archivedAt`), completed and unfinished alike;
 *   - stamped, it is READ-ONLY: boards, reports, results, money records and
 *     exports stay; nothing can be changed or scored, and an unfinished one is
 *     paused where it stands;
 *   - resubscribing at any point clears every stamp, and everything carries on;
 *   - twelve months from the lapse it is deleted, after the owners have been told
 *     30 days before and 7 days before;
 *   - a tournament made AFTER the lapse is an ordinary Par tournament with Par's
 *     own terms. The archive's tournaments are not Par's: its sweep never touches
 *     them and its limits do not count them.
 *
 * Pure, and every function takes the instant it is asked about, so the rule is
 * proved on either side of each date without a database or a clock.
 */

export const ARCHIVE_MONTHS = 12;

/** The two notices before the archive goes, in days. */
export const ARCHIVE_NOTICE_DAYS = [30, 7] as const;

const DAY = 24 * 3600 * 1000;

/**
 * Twelve calendar months after the lapse, at the same time of day.
 *
 * Calendar months rather than 365 days, because the sentence a club reads is
 * "until 3 Nov 2027" and that must be the day it goes. A lapse on 29 February
 * runs to 28 February: the day a month does not have is not a later one.
 */
export function archiveEndsAt(lapsedAt: Date): Date {
  const y = lapsedAt.getUTCFullYear();
  const m = lapsedAt.getUTCMonth() + ARCHIVE_MONTHS;
  const targetYear = y + Math.floor(m / 12);
  const targetMonth = m % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(lapsedAt.getUTCDate(), lastDay),
      lapsedAt.getUTCHours(),
      lapsedAt.getUTCMinutes(),
      lapsedAt.getUTCSeconds(),
      lapsedAt.getUTCMilliseconds(),
    ),
  );
}

export type ArchiveState =
  | { archived: false }
  | {
      archived: true;
      /** When the club's paid plan ended. */
      lapsedAt: Date;
      /** The day it is kept until. The delete is never earlier (`archiveStep`). */
      until: Date;
      /** Not completed: play is paused where it stands. */
      unfinished: boolean;
    };

/**
 * IS THIS TOURNAMENT ARCHIVED, UNTIL WHEN, AND WHY — the one answer every door
 * that edits a tournament asks (`services/club-archive.ts`).
 *
 * Every argument is required: the stamp, the status, and the instant. A
 * tournament stays archived after `until` until the sweep has deleted it — a
 * late sweep must not hand an expired archive back to the club as editable.
 */
export function archiveState(event: { archivedAt: Date | null; status: string }, now: Date): ArchiveState {
  void now; // the state does not end on its own; the sweep ends it. Taken so no caller can forget the clock.
  if (!event.archivedAt) return { archived: false };
  const lapsedAt = new Date(event.archivedAt);
  return { archived: true, lapsedAt, until: archiveEndsAt(lapsedAt), unfinished: event.status !== "completed" };
}

export type ArchiveAudience = "organizer" | "player";

/**
 * Why this tournament cannot be changed, in the club's words, or null when it
 * can. The days come already worded at the club (`clubDayInWords`): this file
 * has no locale and no zone.
 */
export function archiveRefusal(
  state: ArchiveState,
  words: { lapsed: string; until: string },
  who: ArchiveAudience,
): string | null {
  if (!state.archived) return null;
  if (who === "player") {
    return state.unfinished
      ? `This tournament is paused: the club's subscription ended on ${words.lapsed}. Its board and results stay open to view until ${words.until}, but nothing can be scored or changed unless the club renews.`
      : `The club's subscription ended on ${words.lapsed}. This tournament's board and results stay open to view until ${words.until}, but nothing in it can be changed unless the club renews.`;
  }
  return state.unfinished
    ? `This club's subscription ended on ${words.lapsed}, so this tournament is paused where it stands. Its tournaments are kept read-only until ${words.until}, then deleted. Resubscribe in Club settings to carry on from where it stopped.`
    : `This club's subscription ended on ${words.lapsed}. Its tournaments are kept read-only until ${words.until}, then deleted. Resubscribe in Club settings to carry on.`;
}

/** What the daily sweep does about one lapsed club today. */
export interface ArchiveStep {
  /** The notice to send now, or null. */
  notice: 30 | 7 | null;
  /** Delete the club's archived tournaments now. */
  delete: boolean;
}

/**
 * THE NOTICES AND THE DELETE, for one lapsed club, at `now`.
 *
 *   - within 30 days of the end and no notice yet: the 30-day notice;
 *   - within 7 days and the 7-day notice not sent: the 7-day notice (a sweep
 *     that missed the 30-day window sends this one only — a "30 days" after a
 *     "7 days" would be a lie told in the wrong order);
 *   - the delete waits for the end AND for seven days after the 7-day notice,
 *     so the owners are always given the week they were promised. Late towards
 *     keeping, never early.
 */
export function archiveStep(
  club: { lapsedAt: Date; notice30At: Date | null; notice7At: Date | null },
  now: Date,
): ArchiveStep {
  const until = archiveEndsAt(new Date(club.lapsedAt)).getTime();
  const t = now.getTime();
  if (club.notice7At) {
    const deletable = Math.max(until, new Date(club.notice7At).getTime() + 7 * DAY);
    return { notice: null, delete: t >= deletable };
  }
  if (t >= until - 7 * DAY) return { notice: 7, delete: false };
  if (t >= until - 30 * DAY && !club.notice30At) return { notice: 30, delete: false };
  return { notice: null, delete: false };
}
