import { addDays, cleanIsoDate, daysBetween } from "./round-dates";
import { parseDeadlineIso } from "../deadline";

/**
 * THE DATES OF A COPIED TOURNAMENT, FROM THE DAY THE SECRETARY PICKS
 * (the secretary's home, 2026-10-24 — "copy last event").
 *
 * Last year's dates are never this year's (`clone.ts` says so for every one of
 * them), so a copy used to start with none at all and the secretary dated it
 * field by field afterwards: the tournament, the entry window, every round.
 * Now the copy asks for its first day, and everything else that is a DAY is
 * set from it — by the same distance it stood from the original's first day:
 *
 *   entries close   the original closed them 9 days before it started, so the
 *                   copy does too
 *   entries open    the same
 *   each round      Round 2 was the day after Round 1, so it still is
 *
 * Nothing is carried AS a date. A day the arithmetic puts in the past at the
 * club — `today` is `clubToday(zone)`, never the server's — is left empty
 * rather than stored, because a deadline already gone closes entries on a
 * tournament nobody has opened, and an opening day already gone is the same
 * as "open as soon as you publish the link", which empty already says.
 *
 * Pure: the action reads the club's day and hands it in.
 */

export interface CopyCalendarSource {
  /** The original's first day, `yyyy-mm-dd`, or "". */
  startOn: string;
  /** Its sign-up deadline as stored — ISO, or the app's older "Jun 1, 2026". */
  regDeadline: string;
  /** The first day it took entries, or "". */
  regOpens: string;
  /** Its rounds, with the day each was played on ("" for none). */
  rounds: readonly { id: string; playedOn: string }[];
}

export type CopyCalendar =
  | {
      ok: true;
      startOn: string;
      endOn: string;
      regDeadline: string;
      regOpens: string;
      /** The copy's day for each ORIGINAL round id, "" where there is none. */
      playedOn: Record<string, string>;
    }
  | { ok: false; error: string };

export const COPY_DAY_GONE = "That day has already gone at your club. Pick today or a later day.";

export function copiedCalendar(input: {
  source: CopyCalendarSource;
  /** The first day the secretary picked. Empty: the copy starts with no dates. */
  startOn: string;
  /** The last day, or "" for a one-day tournament. */
  endOn: string;
  /** Today AT THE CLUB — `clubToday(zone)`. Required: there is no other clock here. */
  today: string;
}): CopyCalendar {
  const none = Object.fromEntries(input.source.rounds.map((r) => [r.id, ""]));
  const start = cleanIsoDate(input.startOn);
  if (!start) {
    // A copy made without a day keeps the old behaviour exactly: no dates.
    return { ok: true, startOn: "", endOn: "", regDeadline: "", regOpens: "", playedOn: none };
  }
  if (start < input.today) return { ok: false, error: COPY_DAY_GONE };
  const end = cleanIsoDate(input.endOn);
  // An end before the start is a one-day tournament — the rule `setTournamentDates` keeps.
  const endOn = end && end >= start ? end : start;

  /**
   * WHERE THE ORIGINAL STARTED, so every other day can keep its distance from
   * it. Its own first day, or else its earliest dated round — a club that dated
   * the rounds and never the tournament still has a first day.
   */
  const roundDays = input.source.rounds.map((r) => cleanIsoDate(r.playedOn)).filter(Boolean).sort();
  const was = cleanIsoDate(input.source.startOn) || roundDays[0] || "";
  const shift = was ? daysBetween(was, start) : null;

  const moved = (day: string): string => {
    if (shift === null || !day) return "";
    const at = addDays(day, shift);
    return at >= input.today ? at : "";
  };

  const deadline = moved(parseDeadlineIso(input.source.regDeadline));
  const opens = moved(parseDeadlineIso(input.source.regOpens));
  return {
    ok: true,
    startOn: start,
    endOn,
    regDeadline: deadline,
    // Opening today is opening as soon as the link is up, which "" already says.
    regOpens: opens && opens > input.today ? opens : "",
    playedOn: Object.fromEntries(input.source.rounds.map((r) => [r.id, moved(cleanIsoDate(r.playedOn))])),
  };
}
