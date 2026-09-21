/**
 * EVERY COMMITMENT A MEMBER HAS, ON ONE CALENDAR.
 *
 * The league calendar (`availability-calendar.ts`) answers "am I around for the
 * Thursday league", which is the right question asked of one tournament and the
 * wrong shape for the question a member actually has in May: what am I down for
 * at this club at all? A member in the Thursday league, the Club Championship
 * and an away match had three calendars and no way to see that two of them fall
 * on the same weekend.
 *
 * Ajay, 2026-09-21, on being shown the single-league calendar: "I am good with
 * the entire club calendar but we need to color code or differentiate it somehow
 * and indicating the events/tournaments."
 *
 * TWO THINGS ARE BEING SAID ON ONE SQUARE, so they use two channels:
 *
 *   - WHICH TOURNAMENT — a per-tournament tint, its initials, and a legend.
 *   - WHAT YOU ANSWERED — the same four-state vocabulary the league calendar
 *     uses, carried by an icon.
 *
 * Colour is never the only carrier of either. Roughly one man in twelve cannot
 * separate red from green, this is read outdoors in sun where a tint is the
 * first thing to go, and — the reason the tint cannot simply be "one hue per
 * tournament" — the palette is the CLUB'S. `themes.ts` ships two accents, a
 * warning and a danger, all of them contrast-checked on both grounds by
 * `themes.test.ts`; inventing six more hues here would put six uncheckable
 * colours on the one screen that has to be legible on the first tee. So the
 * tints are mixes of the club's own tokens, and a club with more tournaments
 * than tints has two of them sharing one — which is why the initials and the
 * legend are not decoration.
 *
 * Pure, and given `today` rather than reading a clock.
 */

import { monthGrids, partsOf, type GridDay } from "./month-grid";
import { type DayTone, toneFor } from "./availability-calendar";

export interface ClubCommitment {
  /** The tournament this round belongs to. */
  eventId: string;
  /** What the club calls it — "Thursday Evening League". */
  eventName: string;
  stageId: string;
  /** "Round 7" — the tournament's own numbering. */
  label: string;
  /** The day it is played, ISO, or "" when nobody has dated it. */
  playedOn: string;
  status: "in" | "out";
  /** Whether that answer was stated, or is the tournament's default. */
  explicit: boolean;
  /** True once the sign-up window has closed for players. */
  locked: boolean;
  /**
   * Whether this round ASKS the member at all.
   *
   * False under `everyone` (no weekly question exists) and under `captains`
   * (the captain sends the list and the club records it). Such a round is still
   * ON the calendar — it is a day this member is expected at the club, which is
   * the whole point of a commitments calendar — but it is a FIXTURE rather than
   * a question, and offering a toggle for it would invite an answer the app
   * would then refuse at the endpoint. See `setOwnAttendance`.
   */
  asks: boolean;
}

/** A tournament, as the legend lists it. */
export interface CalendarTournament {
  eventId: string;
  name: string;
  /** Up to three letters, for the chip on a square. */
  initials: string;
  /** Index into `TOURNAMENT_TINTS`, stable for this set of tournaments. */
  tint: number;
  /** How many dated rounds it has on this calendar. */
  rounds: number;
  /** How many of them the member is in for. */
  inCount: number;
  /** Whether any of its rounds can still be answered. */
  asks: boolean;
}

export interface ClubCalendarDay extends GridDay {
  /**
   * Everything on this day, in tournament order.
   *
   * A LIST, where the league calendar has at most one. Two rounds on one date
   * is impossible within a league and entirely ordinary across a club — the
   * Thursday league and a Saturday medal can share a weekend, and a calendar
   * that showed one of them would be hiding the clash it exists to reveal.
   */
  commitments: ClubCommitment[];
}

export interface ClubCalendarMonth {
  key: string;
  label: string;
  weeks: ClubCalendarDay[][];
  /** Commitments this month holds, counting only its own days. */
  count: number;
  /** How many of them the member is in for. */
  inCount: number;
}

export interface ClubCalendar {
  months: ClubCalendarMonth[];
  /** One row per tournament that has a dated round, for the legend. */
  tournaments: CalendarTournament[];
  /**
   * Commitments with no date.
   *
   * They cannot be placed and must not be silently dropped — a round nobody has
   * dated is exactly the one a member would otherwise never see.
   */
  undated: ClubCommitment[];
}

/**
 * Tints for the tournament chips, as mixes of the club's own tokens.
 *
 * Deliberately expressions rather than colours: whatever the club has chosen,
 * and whichever ground is in force, these resolve against it. Six is enough for
 * every club seen so far and the seventh tournament shares the first tint —
 * which is honest only because the chip also carries the tournament's initials
 * and the legend names it. Do not lengthen this list with literal hues; see the
 * note at the top of the file.
 */
export const TOURNAMENT_TINTS: readonly string[] = [
  "var(--color-accent)",
  "var(--color-accent-2)",
  "var(--color-warning)",
  "color-mix(in srgb, var(--color-accent) 55%, var(--color-surface))",
  "color-mix(in srgb, var(--color-accent-2) 55%, var(--color-surface))",
  "color-mix(in srgb, var(--color-warning) 55%, var(--color-surface))",
];

/**
 * Up to three letters standing for a tournament.
 *
 * The initials of its words where it has several ("Thursday Evening League" →
 * TEL), and the first letters of the one word where it does not ("Championship"
 * → CHA). Digits count as words, so "2026 Club Championship" does not come out
 * as "CC" and lose the year that distinguishes it from last season's.
 */
export function initialsOf(name: string): string {
  const words = (name ?? "")
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w.length > 0);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.slice(0, 3).map((w) => w[0]).join("").toUpperCase();
}

/**
 * The club's season on days, from the first dated commitment to the last.
 *
 * Tournament order — and therefore tint order — is by FIRST DATED ROUND, then
 * name, then id. Never by the order the caller happened to supply, and never by
 * a position in a list that shrinks as rounds are played: a member who learns
 * that the league is the blue one must not find it green next week because
 * April has gone by. The id is the final tiebreak so the order is total, and a
 * tournament therefore keeps its tint across renders.
 */
export function buildClubCalendar(
  commitments: readonly ClubCommitment[],
  todayIso: string,
): ClubCalendar {
  const dated: ClubCommitment[] = [];
  const undated: ClubCommitment[] = [];
  for (const c of commitments) {
    if (partsOf(c.playedOn)) dated.push(c);
    else undated.push(c);
  }

  // Ordered before the tints are handed out, so the ordering rule above is the
  // only thing that decides them.
  const firstDay = new Map<string, string>();
  for (const c of dated) {
    const day = c.playedOn.trim();
    const seen = firstDay.get(c.eventId);
    if (!seen || day < seen) firstDay.set(c.eventId, day);
  }
  const eventIds = [...new Set(dated.map((c) => c.eventId))].sort((a, b) => {
    const da = firstDay.get(a) ?? "";
    const db = firstDay.get(b) ?? "";
    if (da !== db) return da < db ? -1 : 1;
    const na = dated.find((c) => c.eventId === a)?.eventName ?? "";
    const nb = dated.find((c) => c.eventId === b)?.eventName ?? "";
    if (na !== nb) return na < nb ? -1 : 1;
    return a < b ? -1 : 1;
  });
  const tintOf = new Map(eventIds.map((id, i) => [id, i % TOURNAMENT_TINTS.length]));
  const rank = new Map(eventIds.map((id, i) => [id, i]));

  const tournaments: CalendarTournament[] = eventIds.map((eventId) => {
    const own = dated.filter((c) => c.eventId === eventId);
    return {
      eventId,
      name: own[0]?.eventName ?? "",
      initials: initialsOf(own[0]?.eventName ?? ""),
      tint: tintOf.get(eventId) ?? 0,
      rounds: own.length,
      inCount: own.filter((c) => c.status === "in").length,
      asks: own.some((c) => c.asks && !c.locked),
    };
  });

  const byIso = new Map<string, ClubCommitment[]>();
  for (const c of dated) {
    const day = c.playedOn.trim();
    const list = byIso.get(day) ?? [];
    list.push(c);
    byIso.set(day, list);
  }
  // Within a day, the same tournament order as the legend, so two squares in
  // one week put the same tournament in the same place.
  for (const list of byIso.values()) {
    list.sort((a, b) => (rank.get(a.eventId) ?? 0) - (rank.get(b.eventId) ?? 0));
  }

  const months: ClubCalendarMonth[] = monthGrids(
    dated.map((c) => c.playedOn),
    todayIso,
  ).map((m) => {
    let count = 0;
    let inCount = 0;
    const weeks = m.weeks.map((week) =>
      week.map((day) => {
        const commitments = byIso.get(day.iso) ?? [];
        if (day.inMonth) {
          count += commitments.length;
          inCount += commitments.filter((c) => c.status === "in").length;
        }
        return { ...day, commitments };
      }),
    );
    return { key: m.key, label: m.label, weeks, count, inCount };
  });

  return { months, tournaments, undated };
}

/** How one commitment reads, in the league calendar's own vocabulary. */
export function commitmentTone(c: ClubCommitment): DayTone {
  return toneFor(c);
}

/**
 * What a day's worth of commitments comes to, for the square's own label.
 *
 * A square carrying two tournaments has no single tone, so it gets a sentence
 * instead: the screen reader hears every commitment on the day rather than a
 * summary that would have to pick one of them to be about.
 */
export function dayLabel(day: ClubCalendarDay, toneLabel: Record<DayTone, string>): string {
  if (day.commitments.length === 0) return `${day.iso}, nothing on`;
  const parts = day.commitments.map(
    (c) => `${c.eventName}, ${c.label}: ${toneLabel[commitmentTone(c)]}`,
  );
  return `${day.iso}. ${parts.join(". ")}`;
}
