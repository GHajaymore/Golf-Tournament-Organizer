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
 */

export type TypedCard =
  | { ok: true; strokes: (number | null)[]; filled: number }
  | { ok: false; problem: string };

/** Characters a player uses to mean "I have no score for this hole". */
const BLANKS = new Set(["-", "x", ".", "_", "?"]);

/**
 * A whole card typed in one go — "4 5 3 4 4 5 3 4 4", "4,5,3,…", or, for a
 * card where every hole is a single digit, "453445344".
 *
 * `-`, `x` or `.` leaves a hole blank, so a player who missed the 7th can
 * still type the rest in order. Fewer numbers than holes fills from the 1st
 * and leaves the rest untouched (null); MORE is refused, because the only way
 * that happens is a typo, and silently dropping the extra shifts nothing but
 * guessing which one is extra shifts everything after it.
 *
 * A run of digits is split one per hole ONLY when it is exactly the right
 * length. "4510" could be 4,5,10 or 4,5,1,0; a card is not the place to
 * guess, so anything else is refused with a sentence saying why.
 */
export function parseTypedCard(text: string, holes: number): TypedCard {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, problem: "Type a score for each hole, separated by spaces." };

  let parts = trimmed.split(/[\s,;/|]+/).filter(Boolean);
  if (parts.length === 1 && /^\d+$/.test(parts[0])) {
    if (parts[0].length !== holes) {
      return {
        ok: false,
        problem: `That is ${parts[0].length} digits for ${holes} holes. Put a space between the scores.`,
      };
    }
    parts = parts[0].split("");
  }

  if (parts.length > holes) {
    return { ok: false, problem: `That is ${parts.length} scores for ${holes} holes. Check for an extra one.` };
  }

  const strokes: (number | null)[] = Array.from({ length: holes }, () => null);
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i].toLowerCase();
    if (BLANKS.has(p)) continue;
    if (!/^\d+$/.test(p)) return { ok: false, problem: `“${parts[i]}” on hole ${i + 1} is not a score.` };
    const n = parseInt(p, 10);
    if (n < 1 || n > MAX_STROKES_PER_HOLE) {
      return { ok: false, problem: `${n} on hole ${i + 1} is not a possible score.` };
    }
    strokes[i] = n;
  }
  return { ok: true, strokes, filled: strokes.filter((s) => s != null).length };
}

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
