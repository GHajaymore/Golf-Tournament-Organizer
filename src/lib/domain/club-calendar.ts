/**
 * A member's commitments across the whole club, laid out as a calendar.
 *
 * The sibling `availability-calendar.ts` answers "am I around for this ONE
 * league", a round a day, one square one round. This answers the question a
 * member actually asks in April — "what golf have I got on, across everything
 * the club runs" — so a square can carry MORE than one round: the Tuesday
 * league and a member-guest can fall on the same Saturday, and a calendar that
 * showed one of them would be worse than none.
 *
 * THE GRID ITSELF IS `month-grid.ts`, shared with that sibling and built for
 * exactly this second reader — see its own note. This file is what sits ON a
 * square when there can be several things on it; that file is which squares
 * there are. The four-state reading of one commitment is `toneFor`, reused
 * rather than re-spelled, because "in" and "in by default" are the distinction
 * the whole availability feature turns on and a second copy would drift.
 *
 * Pure, and given `today` rather than reading a clock: a month grid that
 * depends on when the test runs is one that fails in December.
 */

import { monthGrids, partsOf, WEEKDAY_INITIALS } from "./month-grid";
import { toneFor, TONE_LABEL, type DayTone } from "./availability-calendar";

export { WEEKDAY_INITIALS, TONE_LABEL, toneFor };
export type { DayTone };

/**
 * One round, in one tournament, that this member is entered in.
 *
 * `canAnswer` is separate from `locked` on purpose. `locked` is how the square
 * READS — a firm fact rather than a live question — and drives `toneFor`.
 * `canAnswer` is whether this member may still change it from here, which is a
 * narrower thing: only a league that asks players, before its deadline. A plain
 * tournament round is `locked: false` (it reads as a normal commitment, not a
 * greyed-out closed one) yet `canAnswer: false` (there is no weekly question to
 * answer) — the member is simply in it because they entered.
 */
export interface Commitment {
  eventId: string;
  /** The tournament's name, for the row beside the square. */
  eventName: string;
  stageId: string;
  /** "Round 3", or "" for a one-round tournament that needs no number. */
  roundLabel: string;
  /** The day it is played, ISO. Empty ones are collected in `undated`. */
  playedOn: string;
  /** "Tue 19 May", pre-formatted on the server. */
  dateLabel: string;
  status: "in" | "out";
  /** Whether that answer was stated, or is the mode's default. */
  explicit: boolean;
  /** True for a fact the member cannot change from here — see the note above. */
  locked: boolean;
  /** Whether this member may still toggle their own in/out for it, here. */
  canAnswer: boolean;
}

export interface CommitmentDay {
  /** yyyy-mm-dd, always — including the padding days either side of a month. */
  iso: string;
  day: number;
  /** False for the days that belong to the neighbouring month. */
  inMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  /**
   * Every commitment played this day, tournament then round order.
   *
   * Only ever populated on an in-month day. A commitment belongs to the month
   * it is played in, and listing it again on the neighbouring month's padding
   * square would double it — the sibling greys the padding copy because it has
   * exactly one, but a LIST that repeated its rows across a month boundary
   * would read as two separate commitments. So padding days stay empty.
   */
  commitments: Commitment[];
}

export interface CommitmentMonth {
  /** "2026-05", for a stable React key. */
  key: string;
  /** "May 2026". */
  label: string;
  weeks: CommitmentDay[][];
  /** How many commitments this month holds — the count worth putting by the name. */
  count: number;
  /** How many of them the member is in for. */
  inCount: number;
}

export interface ClubCalendar {
  months: CommitmentMonth[];
  /**
   * Commitments with no date.
   *
   * A round nobody has dated cannot go on a grid and must not be dropped — it
   * is exactly the one a member would otherwise never see. The screen lists
   * them beside the calendar.
   */
  undated: Commitment[];
}

/** Tournament name, then round, so a day's list is stable and readable. */
function byNameThenRound(a: Commitment, b: Commitment): number {
  const n = a.eventName.localeCompare(b.eventName);
  if (n !== 0) return n;
  return a.roundLabel.localeCompare(b.roundLabel);
}

/**
 * The member's commitments as months, from the first dated one to the last.
 *
 * Which months appear, and why only those, is `monthGrids`. This adds the list
 * each square carries.
 */
export function buildClubCalendar(
  commitments: readonly Commitment[],
  todayIso: string,
): ClubCalendar {
  const dated: Commitment[] = [];
  const undated: Commitment[] = [];
  for (const c of commitments) {
    if (partsOf(c.playedOn)) dated.push(c);
    else undated.push(c);
  }
  undated.sort(byNameThenRound);

  if (dated.length === 0) return { months: [], undated };

  const byIso = new Map<string, Commitment[]>();
  for (const c of dated) {
    const key = c.playedOn.trim();
    const list = byIso.get(key);
    if (list) list.push(c);
    else byIso.set(key, [c]);
  }
  for (const list of byIso.values()) list.sort(byNameThenRound);

  const months: CommitmentMonth[] = monthGrids(
    dated.map((c) => c.playedOn),
    todayIso,
  ).map((m) => {
    let count = 0;
    let inCount = 0;
    const weeks: CommitmentDay[][] = m.weeks.map((week) =>
      week.map((day) => {
        // Only in-month days carry the list — see the note on `commitments`.
        const commitments = day.inMonth ? byIso.get(day.iso) ?? [] : [];
        if (day.inMonth && commitments.length) {
          count += commitments.length;
          inCount += commitments.filter((c) => c.status === "in").length;
        }
        return { ...day, commitments };
      }),
    );
    return { key: m.key, label: m.label, weeks, count, inCount };
  });

  return { months, undated };
}
