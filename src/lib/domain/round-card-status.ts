import { needsCourseData, type ScoringShape } from "../courses";

/**
 * WHETHER A ROUND HAS THE COURSE CARD ITS FORMAT SCORES WITH (Ajay, 2026-09-28:
 * "we need to warn or stop if golf course score card is incomplete").
 *
 * Score entry already refused a round with no card, which meant a club found
 * out on the first tee. This answers the same question at SETUP, so launch can
 * stop and Rounds & formats can say so while the committee is building.
 *
 * It blocks on exactly what the format scores with — par and stroke index —
 * and nothing else. CLAUDE.md is blunt about why: "a guard that refuses a real
 * golf course is worse than no guard". So:
 *
 *   not-needed  gross match play needs no card (`needsCourseData`)
 *   ready       the round resolves a card with par and stroke index
 *   unchecked   it does, but the card was imported and nobody at the club has
 *               confirmed it — a WARNING, never a stop: real clubs play off
 *               imported cards every week
 *   missing     it needs a card and has none — the only status that stops launch
 *
 * Distances and tee ratings never decide this: nothing scores off distance, and
 * an unrated tee plays off the Handicap Index (`unratedWarning` says so).
 */
export type RoundCardStatus = "not-needed" | "ready" | "unchecked" | "missing";

/** A course row, reduced to what this question reads. */
export interface CardSource {
  name: string;
  /** Par and stroke index both parse. */
  hasCard: boolean;
  /** Imported and never confirmed by anyone at the club. */
  unchecked: boolean;
}

export function roundCardStatus(input: {
  round: ScoringShape;
  /**
   * The venue this ROUND names, when it names one. Its own card is the answer:
   * falling back to the tournament's would score a round played at Ardmore
   * against the home course's pars — the silent wrong-course case.
   */
  roundVenue: CardSource | null;
  /** What the tournament resolves to when the round names no venue. */
  eventCard: CardSource | null;
  /**
   * Venues attached to the tournament that carry a card. A round with no venue
   * of its own in a multi-venue tournament is scored per match against one of
   * these, exactly as score entry allows — so it is not refused for them.
   */
  cardedVenues: number;
  /** "Players choose" — the venue is named per match at scoring time. */
  openCourse: boolean;
}): RoundCardStatus {
  if (!needsCourseData([input.round])) return "not-needed";
  if (input.openCourse) return "ready";

  const source = input.roundVenue ?? input.eventCard;
  if (input.roundVenue) {
    if (!input.roundVenue.hasCard) return "missing";
  } else if (!input.eventCard?.hasCard) {
    return input.cardedVenues > 0 ? "ready" : "missing";
  }
  return source?.unchecked ? "unchecked" : "ready";
}

/** The sentence launch refuses with, naming every round that stops it. */
export function missingCardsRefusal(rounds: readonly { label: string; course: string }[]): string | null {
  if (rounds.length === 0) return null;
  const named = rounds.map((r) => (r.course ? `${r.label} at ${r.course}` : r.label));
  const list = named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
  const they = rounds.length === 1 ? "its" : "their";
  return `${list} ${rounds.length === 1 ? "needs" : "need"} ${they} course card — par and stroke index — before launch, because the format scores against them. Add the card in the course library on Tournament details, then launch.`;
}
