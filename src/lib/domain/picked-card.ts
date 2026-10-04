import { cardTrustNote, needsStrokeIndex, parseIndex } from "./card-trust";
import { cardRefusal } from "./scorecard-parse";

/**
 * WHAT TO SAY ABOUT A COURSE'S SCORECARD AT THE MOMENT SOMEBODY PICKS IT.
 *
 * Ajay, 2026-10-03: "when organizer/player select a course, warn them if the
 * scorecard is not complete or verified". The rules already existed —
 * `cardTrustNote` for whether anybody has checked the card and whether that
 * was over a year ago, `cardRefusal` for a card that does not add up — but
 * they were said on the round's screen and the player's card, AFTER the
 * course was chosen. A casual round set up on the first tee picks a course and
 * walks off to play it; that is the moment to hear the card is missing its
 * stroke index, not the 9th green.
 *
 * Read off the STORED strings rather than the decoded arrays the services
 * hand the screens, because `clubCourses` substitutes eighteen 4s for a
 * missing card so the row stays editable — and a placeholder par 72 is
 * exactly the card this must not call complete.
 *
 * Never a refusal, for the reason `card-trust.ts` gives: an unchecked card is
 * usable and the decision belongs to the people playing.
 */

export interface StoredCard {
  /** `Course.pars` as stored — a JSON array, or "" when there is none. */
  pars: string;
  strokeIndex: string;
  /** "manual" | "imported" | "preset". */
  source: string;
  verifiedAt: Date | string | null;
  verifiedBy: string;
}

export interface PickedCardNote {
  /** Whether this should read as a warning rather than a footnote. */
  warn: boolean;
  /** One sentence, in full. */
  text: string;
}

export const NO_CARD_YET =
  "This course has no scorecard yet. Its pars and stroke index need entering — copied off the club's own card — before a net round, a four-ball or a money game can be scored.";

/**
 * A card that has just come in from the course directory. The same sentence
 * `cardTrustNote` gives an imported, unchecked card, so a course reads the
 * same whether it was picked from the club's list or added a moment ago.
 */
export const IMPORTED_UNCHECKED =
  cardTrustNote({ source: "imported", verifiedAt: null, verifiedBy: "" })?.text ?? "";

/** Just the two fields a screen prints — this crosses to the browser. */
const said = (n: { warn: boolean; text: string } | null): PickedCardNote | null =>
  n ? { warn: n.warn, text: n.text } : null;

export function pickedCardNote(card: StoredCard | null | undefined, today: Date = new Date()): PickedCardNote | null {
  if (!card) return null;
  const pars = parseIndex(card.pars);
  if (pars.length === 0 || pars.every((p) => !p)) return { warn: true, text: NO_CARD_YET };

  const si = parseIndex(card.strokeIndex);
  /**
   * Missing stroke index first: it is the one that makes a number WRONG
   * rather than doubtful, and `cardTrustNote` already words it.
   */
  if (needsStrokeIndex(si)) return said(cardTrustNote(card, today, undefined, si));

  /**
   * INCOMPLETE OR INCONSISTENT. Pars and stroke index only — yardage is
   * optional and nothing scores off it, so an empty yards array is passed
   * exactly as `revalidateStored` does (CLAUDE.md, "Course cards").
   */
  const problem =
    pars.length !== 9 && pars.length !== 18
      ? `It has ${pars.length} holes on it, not 9 or 18.`
      : cardRefusal(pars, [], si, pars.length);
  if (problem) {
    // The refusal already says what to check, in its own words — one
    // instruction, not two stacked ("Check they are listed… Check it against…").
    return { warn: true, text: `This course's scorecard doesn't look right. ${problem}` };
  }

  // The date in `cardTrustNote`'s own form, the same one the round screen and
  // the player's card print — a club's locale is not known on every screen
  // that picks a course, and a hardcoded one is what `no-hardcoded-locale`
  // exists to refuse.
  return said(cardTrustNote(card, today, undefined, si));
}
