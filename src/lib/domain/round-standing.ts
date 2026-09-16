/**
 * WHERE A ROUND SITS RELATIVE TO THE ONE BEING PLAYED.
 *
 * The Rounds & formats screen chips each round Played, Active or Upcoming, and
 * worked it out from the round's INDEX against a single pointer:
 *
 *     activeStageId === s.id ? "active" : i < activeIndex ? "played" : "upcoming"
 *
 * `activeStage` is one stage. Everything after it is therefore "Upcoming",
 * whatever the field has actually done — and a tournament does not play its
 * rounds strictly one at a time. A round robin stays active while its results
 * are confirmed, and the medal round after it is being scored meanwhile.
 *
 * MEASURED on the seeded Demo Cup, 2026-09-16:
 *
 *     Round 1 · Round Robin        Active      36 match results to confirm
 *     Round 2 · Stroke Play Round  Upcoming    7 of 33 scorecards in
 *
 * Seven people had played Round 2 and returned a card. The dashboard called it
 * "Current round", the leaderboard was ranking it, and this screen — the one an
 * organizer opens to change a round's format, holes, handicaps or cut — called
 * it upcoming. That is the screen where believing it does damage: the settings
 * on a round already scored are not the settings on one nobody has started.
 *
 * The previous version of this rule had the same shape and was fixed once
 * before, from `isFirst ? "Active" : "Upcoming"` — "only true on day one". This
 * is the same fault one layer out: a position standing in for a fact.
 *
 * So ask the ROUND, not its index. A round with a result in it is not upcoming,
 * wherever it sits.
 */

export type RoundStanding = "played" | "active" | "upcoming";

export function roundStanding(facts: {
  /** This round is the one score entry and the boards default to. */
  isActive: boolean;
  /** Its position among the rounds, and the active round's. -1 when none. */
  index: number;
  activeIndex: number;
  /**
   * Whether anybody has returned anything for this round — one hole is enough,
   * the same line `playRefusal` draws. See `roundsWithResults`.
   */
  hasResult: boolean;
}): RoundStanding {
  const { isActive, index, activeIndex, hasResult } = facts;
  if (isActive) return "active";
  // Behind the active round: played, which it was whether or not anybody
  // returned a card — a round the field skipped is still behind us.
  if (activeIndex >= 0 && index < activeIndex) return "played";
  /**
   * AHEAD OF IT AND ALREADY STARTED.
   *
   * "Active" rather than a fourth word. Two rounds can honestly be in play at
   * once — this is exactly that tournament — and inventing "Under way" to sit
   * beside "Active" would make an organizer work out which of two similar
   * words meant their round was live. What the chip is for is "can I still
   * change this safely", and the answer for both is no.
   */
  if (hasResult) return "active";
  return "upcoming";
}
