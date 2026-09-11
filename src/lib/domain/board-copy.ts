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
}

/** The line under "Live leaderboard". */
export function boardIntro({ isStroke, stableford, casual }: BoardCopyInput): string {
  if (!isStroke) {
    return casual
      ? "How the match stands · holes won, halved and lost."
      : "Overall standings across all flights · match points breakdown.";
  }
  if (stableford) {
    return casual
      ? "Everyone's card, as it stands · Stableford points (higher is better)."
      : "Overall standings across all flights · Stableford points (higher is better).";
  }
  return casual
    ? "Everyone's card, as it stands · gross, net and to-par."
    : "Overall standings across all flights · stroke play (gross / net / to-par).";
}

/**
 * The note under the table.
 *
 * The casual versions are the same sentences with the cut removed, on purpose
 * — the arithmetic explanation is just as useful to a fourball, and rewriting
 * it would be a second copy of a rule that is already stated once.
 */
export function boardFootnote({ isStroke, stableford, casual }: BoardCopyInput): string {
  const cut = casual ? "" : " Advancing rows reflect the qualification cutoff.";
  if (!isStroke) {
    return casual
      ? "Columns: P played, W won, ½ halved, L lost."
      : "Columns: P played, W won, ½ halved, L lost. Advancing rows reflect the current qualification cutoff and update live as scores are entered.";
  }
  if (stableford) {
    return `Points are Stableford: 2 for a net par, +1 per stroke better, -1 per stroke worse, floored at 0.${cut}`;
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
