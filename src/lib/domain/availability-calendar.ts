/**
 * A league season laid out as a calendar.
 *
 * The availability list answers "what am I down for" one row at a time, which
 * is the right shape for the next round and the wrong shape for the question
 * players actually ask in May: am I around for any of this? A twelve-week
 * league is twelve identical rows, and a member checking them against a
 * holiday, a work trip and their daughter's wedding is doing the calendar
 * arithmetic in their head. Golf is played on days; this puts the season back
 * on days.
 *
 * Pure, and given `today` rather than reading a clock — a month grid that
 * depends on when the test runs is a month grid that fails in December.
 *
 * THE GRID ITSELF LIVES IN `month-grid.ts`, shared with the club-wide calendar
 * that carries a member's commitments across every tournament. This file is
 * what sits ON a square for one league; that file is which squares there are.
 * The UTC handling that keeps a US club's Tuesday round off the Monday square
 * moved with it, and its reasoning is written down there.
 */

import { monthGrids, partsOf, WEEKDAY_INITIALS } from "./month-grid";

export { WEEKDAY_INITIALS };

export interface CalendarRound {
  stageId: string;
  /** "Round 7" — the league's own numbering. */
  label: string;
  status: "in" | "out";
  /** Whether that answer was stated, or is the league's default. */
  explicit: boolean;
  /** True once the sign-up window has closed for players. */
  locked: boolean;
  /** The day this round is played, ISO. */
  playedOn: string;
}

export interface CalendarDay {
  /** yyyy-mm-dd, always — including the padding days either side of a month. */
  iso: string;
  /** Day of the month, 1..31. */
  day: number;
  /** False for the days that belong to the neighbouring month. */
  inMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  /** The round played this day, if any. At most one: a league plays a round a
   *  day, and two rounds on one date is a tournament, not a league. */
  round: CalendarRound | null;
}

export interface CalendarMonth {
  /** "2026-05", for a stable React key. */
  key: string;
  /** "May 2026". */
  label: string;
  /** Whole weeks, seven days each, so the grid is always rectangular. */
  weeks: CalendarDay[][];
  /** Rounds this month holds — the count worth putting next to the name. */
  roundCount: number;
  /** How many of them this player is in for. */
  inCount: number;
}

export interface AvailabilityCalendar {
  months: CalendarMonth[];
  /**
   * Rounds with no date.
   *
   * They cannot be placed on a calendar and they must not be silently
   * dropped — a round nobody has dated is exactly the one a player would
   * otherwise never see. The caller lists them beside the grid.
   */
  undated: CalendarRound[];
}

/**
 * The season as months, from the first dated round to the last.
 *
 * Which months appear, and why only those, is `monthGrids`. This adds the one
 * round each square carries.
 */
export function buildAvailabilityCalendar(
  rounds: CalendarRound[],
  todayIso: string,
): AvailabilityCalendar {
  const dated: CalendarRound[] = [];
  const undated: CalendarRound[] = [];

  for (const round of rounds) {
    if (partsOf(round.playedOn)) dated.push(round);
    else undated.push(round);
  }

  if (dated.length === 0) return { months: [], undated };

  const byIso = new Map<string, CalendarRound>();
  for (const round of dated) {
    // First one wins, so a duplicate date can't blank the round already there.
    if (!byIso.has(round.playedOn.trim())) byIso.set(round.playedOn.trim(), round);
  }

  const months: CalendarMonth[] = monthGrids(
    dated.map((r) => r.playedOn),
    todayIso,
  ).map((m) => {
    let roundCount = 0;
    let inCount = 0;
    const weeks: CalendarDay[][] = m.weeks.map((week) =>
      week.map((day) => {
        const round = byIso.get(day.iso) ?? null;
        if (round && day.inMonth) {
          roundCount += 1;
          if (round.status === "in") inCount += 1;
        }
        // A round belongs to the month it is played in, so the padding days
        // show it greyed rather than offering a second copy to tap.
        return { ...day, round };
      }),
    );
    return { key: m.key, label: m.label, weeks, roundCount, inCount };
  });

  return { months, undated };
}

export type DayTone = "in" | "in-default" | "out" | "out-default" | "locked" | "none";

/**
 * How one day should read at a glance.
 *
 * Four states, not two, because "in" and "in because nobody said otherwise"
 * are different promises and the whole feature turns on the difference. A
 * locked round is drawn as neither — it is a fact now, not a question.
 */
export function toneOf(day: CalendarDay): DayTone {
  if (!day.round) return "none";
  return toneFor(day.round);
}

/**
 * The same reading, of an answer rather than of a square.
 *
 * Separate because the club-wide calendar has a LIST per square and so has no
 * single tone to ask `toneOf` for — it tones each commitment on the day. Two
 * copies of these four lines would be two copies of the distinction the whole
 * feature turns on, and the one most likely to be "simplified" to two states
 * by somebody who has not read why it is four.
 */
export function toneFor(round: {
  status: "in" | "out";
  explicit: boolean;
  locked: boolean;
}): DayTone {
  if (round.locked) return "locked";
  if (round.status === "in") return round.explicit ? "in" : "in-default";
  return round.explicit ? "out" : "out-default";
}

/** What that tone means, for the legend and for a screen reader. */
export const TONE_LABEL: Record<DayTone, string> = {
  in: "Playing",
  "in-default": "In by default",
  out: "Not playing",
  "out-default": "Out by default",
  locked: "Closed",
  none: "No round",
};
