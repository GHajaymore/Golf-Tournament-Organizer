import { isPlayingRound } from "@/lib/stage-types";
import { cleanIsoDate, shortDate } from "./round-dates";

/**
 * WHEN A TOURNAMENT IS PLAYED, READ OFF ITS ROUNDS — for one with no dates of
 * its own (Ajay, 2026-09-26).
 *
 * The member's calendar has always read the rounds (`clubCommitmentsFor`), and
 * Events read only the tournament's own `startOn` — so a knockout dated round
 * by round on Rounds & formats sat under "No dates yet" on Events while the
 * same member's calendar put it on 5 September. These let Events fall back to
 * the rounds wherever the tournament itself is silent.
 *
 * Only PLAYING rounds, and only real dates: a cut is not a day anybody plays,
 * and a value that is not a date is ignored rather than guessed at — the same
 * reading the calendar gives both.
 */
export function roundDaysOf(stages: readonly { playedOn: string; type: string }[]): string[] {
  return stages
    .filter((s) => isPlayingRound(s.type))
    .map((s) => cleanIsoDate(s.playedOn))
    .filter((d): d is string => d !== "")
    .sort();
}

/**
 * "Sat 5 Sep – Sat 19 Sep", or one day, or "" when no round is dated. The
 * calendar's own short form (`shortDate`), so the two screens name a day the
 * same way.
 */
export function roundSpanOf(stages: readonly { playedOn: string; type: string }[], locale?: string): string {
  const days = roundDaysOf(stages);
  if (days.length === 0) return "";
  const first = shortDate(days[0], locale);
  const last = shortDate(days[days.length - 1], locale);
  return first === last ? first : `${first} – ${last}`;
}
