import type { GolfRegister } from "@/lib/domain/golf-terms";
import { playKindWord } from "@/lib/domain/play-kind";

/**
 * THE WORDS OF AN EVENT — the one place a screen gets them (Ajay, 2026-11-09:
 * "Tournament" is ONE KIND of event a club runs, beside an outing, a charity
 * day and a league; the general word is "Event").
 *
 * Both arguments are REQUIRED, so a caller that forgets the kind or the club's
 * golf does not compile:
 *   - `kind` is the event's stored kind (`Event.playKind`); anything this app
 *     does not know reads as a tournament, never echoed into a sentence.
 *   - `register` is the club's golf (`golfRegister(country, override)`), which
 *     decides the kind's word: "Outing" for a US club, "Society day" for a
 *     British one, "Golf day" for an Australian one (`golf-terms.ts`).
 *
 * Nothing here changes how the golf is scored; these are words only.
 */
export interface EventWords {
  /** The event's own kind, capitalised and lower case: "Charity outing" / "charity outing". */
  kind: string;
  kindLower: string;
  /** The heading over the day's results: "Outing result". */
  resultHeading: string;
}

export function eventWords(kind: string, register: GolfRegister): EventWords {
  const word = playKindWord(kind, register);
  return {
    kind: word,
    kindLower: word.toLowerCase(),
    resultHeading: `${word} result`,
  };
}
