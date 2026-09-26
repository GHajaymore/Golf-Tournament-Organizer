/**
 * WHAT THE TABLE ON TODAY IS CALLED — "Position" or "Qualifying".
 *
 * A club knockout is often a qualifying table (a round robin, a medal) and then
 * a draw. Once the draw is being played the member's Today still carries the
 * qualifying table, because a bracket files no standings of its own — and it
 * called that table's place "Position" and its top five "LEADERS". Read off
 * the seeded Summer Knockout on 2026-09-26 as the member who topped his group:
 *
 *   Position   T1   3-0-0   Match points 19.5
 *   YOUR KNOCKOUT   Out in the semifinal · lost at the 19th
 *
 * Two panels on one screen, one saying first and one saying out. Both numbers
 * are right; only the first one's NAME was wrong. He topped the QUALIFYING and
 * lost in the draw, and the draw decides the tournament.
 *
 * The app already knew this — `lifecycle-state.ts` prints "this table is the
 * qualifying, not the bracket" under the same table before any tie is decided —
 * so this gives the two panel titles the same knowledge rather than a new rule.
 * `knockout` is the member's CURRENT round being a draw, which is true for a
 * member the draw does not hold as well: for them too, the table is the
 * qualifying they did not get through, not a finishing place.
 */
export function standingLabels(input: {
  /** The shown place, "" when there is none. */
  position: string;
  thru: number;
  /** The member's current round is a knockout draw (`MyRound.knockout`). */
  knockout: boolean | undefined;
}): { hero: string; board: string } {
  const qualifying = !!input.knockout;
  const hero = input.position
    ? qualifying
      ? "Qualifying"
      : "Position"
    : input.thru > 0
      ? "Not ranked"
      : "Not started";
  return { hero, board: qualifying ? "QUALIFYING" : "LEADERS" };
}
