import { MAX_STROKES_PER_HOLE } from "./score-payload";
import { transcriptTokens, readScoreToken } from "./stroke";

/**
 * The two quick ways a player gets numbers onto a card without tapping every
 * hole: TYPING the whole card in one line, and SAYING one hole's scores for
 * the group. Pure, so every reading is tested without a phone or a microphone.
 *
 * Neither saves anything. Each returns the numbers it read and the caller
 * puts them on the card the same way a tap would — through the card's own
 * offline queue — so there is exactly one path by which a score is written.
 *
 * `parseTypedCard` WAS HERE AND IS DELETED, because nothing reached it any
 * more and `domain-is-reachable` said so in its own words: "written and
 * reachable from nothing — finish it, call it, or delete it."
 *
 * It read a whole card out of one line — "4 5 3 4 …" — for a text box on the
 * player's full card. That box existed because `ScorecardTable`'s score cells
 * did not advance, so typing a round meant tapping eighteen of them. They
 * advance now, which makes the card itself the place to type and left this
 * parsing a notation nobody was offered.
 *
 * Its one durable idea is kept where the live rule is, in `expandDigitRuns`:
 * a run of figures is split per hole, and an AMBIGUOUS run is refused rather
 * than repaired, because "a card is not the place to guess" and a wrong guess
 * shifts every score after it.
 */

export interface SpokenPlayer {
  id: string;
  /** The name as the card shows it. The first word is what people say. */
  name: string;
  /** True for the person holding the phone — answers to "me" and "I". */
  isMe?: boolean;
}

/**
 * One hole's scores for the group, said out loud.
 *
 * Two ways people actually say it, and both work:
 *
 *   - IN ORDER: "four five three four" — one score per player, in the order
 *     the card lists them;
 *   - BY NAME: "Marcus five, me four, Síle par" — a first name (or "me")
 *     followed by that player's score. Names may come in any order and any
 *     subset.
 *
 * Mixed is fine: a named score goes to that player, an unnamed one to the
 * next player in card order who has not had one yet.
 *
 * NAMES RESOLVE AGAINST THE PLAYERS PASSED IN AND NOTHING WIDER — the rule
 * `domain/attest.ts` states for exactly this path: dictation is free text
 * straight into a score, and a name matched against the whole field would let
 * anyone write anyone's card. A word that is nobody here is ignored.
 *
 * Returns only what was heard. A player nobody mentioned is absent, not null,
 * so a partial dictation never blanks a score already on the card.
 */
export function parseHoleTranscript(
  transcript: string,
  players: readonly SpokenPlayer[],
  par: number,
): Record<string, number> {
  const tokens = transcriptTokens(transcript);
  const out: Record<string, number> = {};

  const byFirstName = new Map<string, string>();
  for (const p of players) {
    const first = firstWord(p.name);
    // Two players with the same first name cannot be told apart by it; saying
    // it then names nobody rather than guessing between them.
    if (first) byFirstName.set(first, byFirstName.has(first) ? "" : p.id);
  }
  const me = players.find((p) => p.isMe)?.id;

  let target: string | null = null;
  let j = 0;
  while (j < tokens.length) {
    const t = tokens[j];
    if ((t === "me" || t === "i" || t === "myself") && me) {
      target = me;
      j += 1;
      continue;
    }
    const named = byFirstName.get(t);
    if (named !== undefined) {
      target = named || null;
      j += 1;
      continue;
    }
    const read = readScoreToken(tokens, j, par);
    if (read) {
      const who = target ?? players.find((p) => out[p.id] === undefined)?.id ?? null;
      if (who && read.value >= 1 && read.value <= MAX_STROKES_PER_HOLE) out[who] = read.value;
      target = null;
      j = read.next;
      continue;
    }
    j += 1;
  }
  return out;
}

/** Lower-cased first word of a name, accents kept — "Síle" is said "Síle". */
function firstWord(name: string): string {
  return name.trim().split(/\s+/)[0]?.toLowerCase().replace(/[.,]/g, "") ?? "";
}
