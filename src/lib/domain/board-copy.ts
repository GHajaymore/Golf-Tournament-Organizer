/**
 * What the leaderboard says it is, when the leaderboard is two friends.
 *
 * `/leaderboard` is one of the screens a casual round deliberately KEEPS —
 * where you stand is exactly what a golfer wants afterwards, and `nav.ts` says
 * so: "Score entry, Live leaderboard, Rules reference and Group games mean
 * exactly the same thing to a fourball as to a championship". The TABLE does.
 * Everything printed around it did not.
 *
 * Walked on 2026-09-11, a two-player round, both cards in. The screen read:
 *
 *     Overall standings across all flights · stroke play (gross / net / to-par)
 *     TOURNAMENT HIGHLIGHTS
 *     🏆 LEADER — Bly Kessinger leads at +2 (net 74)
 *     [ Overall | By flight ]
 *     … Advancing rows reflect the qualification cutoff.
 *     Commentary — Drafting comes with the paid plan
 *
 * Four things that are not true of a quick round and one that is merely
 * strange. There are no flights. There is no cut — `capabilitiesOf("match")`
 * has said `chainsRounds: false` since the shape was added, so nothing
 * advances anywhere. "Tournament highlights" announced a leader over a table
 * of two rows that says the same thing one line below. And press commentary,
 * with an upsell attached, is apparatus for a field that is not in the room.
 *
 * The table, the net explanation and the live refresh stay exactly as they
 * are. This is about the sentences around them.
 */

export interface BoardCopyInput {
  /** Stroke play rather than match play. */
  isStroke: boolean;
  /** Stableford, which is scored on points and reads the other way up. */
  stableford: boolean;
  /**
   * A quick round rather than a tournament — `isMatch(event.shape)`.
   *
   * Read from the round's own shape rather than from the size of the field: a
   * two-player tournament is still a tournament, with a committee and a
   * reason to talk about flights, and a casual round with eight players is
   * still eight friends.
   */
  casual: boolean;
  /**
   * The board is ranked on NET, so its To par column is net to par
   * (`toParOnBasis`). The footnote says which: walked 2026-09-28, a casual
   * nine read "Gross 41 · To par +5 · Net 35" on the score card and
   * "41 · 35 · -1" on this board — both right, and a golfer reads +5 and -1
   * as two different rounds unless the board says its -1 is net. Read from
   * the board's own unit caption (`unitIsNet`), never re-derived here.
   */
  netToPar?: boolean;
  /**
   * The field is divided into MORE THAN ONE flight. REQUIRED, so a caller says
   * it rather than inheriting "across all flights" by omission.
   *
   * The casual answer above removed flights and the cut from a fourball's
   * board. A club competition with one flight and no cut had the same two
   * sentences, untrue in the same way: a one-round Stableford read "Overall
   * standings across all flights … Advancing rows reflect the qualification
   * cutoff" over four players, nobody advancing anywhere (organizer e2e spec,
   * 2026-10-04).
   */
  flighted: boolean;
  /** Some row on this board is lit as advancing — there is a line to explain. */
  advancing: boolean;
}

/** The line under "Live leaderboard". */
export function boardIntro({ isStroke, stableford, casual, flighted }: BoardCopyInput): string {
  const standings = flighted ? "Overall standings across all flights" : "Overall standings";
  if (!isStroke) {
    return casual
      ? "How the match stands · holes won, halved and lost."
      : `${standings} · match points breakdown.`;
  }
  if (stableford) {
    return casual
      ? "Everyone's card, as it stands · Stableford points (higher is better)."
      : `${standings} · Stableford points (higher is better).`;
  }
  return casual
    ? "Everyone's card, as it stands · gross, net and to-par."
    : `${standings} · stroke play (gross / net / to-par).`;
}

/**
 * The note under the table.
 *
 * The casual versions are the same sentences with the cut removed, on purpose
 * — the arithmetic explanation is just as useful to a fourball, and rewriting
 * it would be a second copy of a rule that is already stated once.
 */
export function boardFootnote({ isStroke, stableford, casual, netToPar = false, advancing }: BoardCopyInput): string {
  // Only where a row IS lit — a sentence explaining a highlight nobody has is
  // the board describing a cut that does not exist.
  const explainsCut = !casual && advancing;
  const cut = explainsCut ? " Advancing rows reflect the qualification cutoff." : "";
  if (!isStroke) {
    return explainsCut
      ? "Columns: P played, W won, ½ halved, L lost. Advancing rows reflect the current qualification cutoff and update live as scores are entered."
      : "Columns: P played, W won, ½ halved, L lost.";
  }
  if (stableford) {
    return `Points are Stableford: 2 for a net par, +1 per stroke better, -1 per stroke worse, floored at 0.${cut}`;
  }
  if (netToPar) {
    return `Net = gross minus handicap strokes received on the holes played; To par is the net score against par for the holes played.${cut}`;
  }
  return `Net = gross minus handicap strokes received on the holes played; To-par is versus the holes played.${cut}`;
}

/**
 * Whether the board prints the highlight cards above the table.
 *
 * Off for a quick round. "TOURNAMENT HIGHLIGHTS / 🏆 LEADER — Bly Kessinger
 * leads at +2" sat directly above a two-row table whose first row is Bly
 * Kessinger at +2: a heading, an icon and a sentence to repeat what the next
 * line already says, on the screen a phone reads outdoors.
 */
export function boardShowsHighlights(casual: boolean): boolean {
  return !casual;
}

/**
 * Whether the board offers press commentary.
 *
 * Off for a quick round. It is a staff broadcast channel with an AI drafting
 * upsell attached, for a readership of the people standing next to you.
 */
export function boardShowsCommentary(casual: boolean): boolean {
  return !casual;
}
