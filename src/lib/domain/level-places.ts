/**
 * WHERE PLAYERS (OR CLUBS) LEVEL ON POINTS FINISH — THE ONE ANSWER for every
 * table ranked by a tie-break chain with head-to-head in it (2026-11-07).
 *
 * The rule, as a league committee applies it (Committee Procedures 5A(6): how
 * a tie is decided is the Committee's to set, and the table's chain is that
 * decision; the head-to-head step is the usual league practice of a
 * MINI-LEAGUE among only the tied):
 *
 *   1. Take everybody level on points as ONE group.
 *   2. Ask the chain's first step of the whole group. For head-to-head that is
 *      the results among ONLY the players in the group — their mini-league.
 *   3. If the step separates the group, it is split by it. A part that is
 *      still level after head-to-head is asked head-to-head AGAIN, over only
 *      the players in that part (their results with the others no longer
 *      count); any other part goes on to the next step.
 *   4. If the step separates nobody — a pure cycle, Bea beat Cat, Cat beat
 *      Dot, Dot beat Bea — the whole group goes on to the next step together.
 *   5. Whoever is still level when the chain runs out SHARES the place.
 *
 * What it replaced, in `rankPlayers`: the ORDER was already the group's
 * mini-league, but whether two neighbours SHARED a place was asked of the
 * pair's own meeting. In a cycle of three level players the neighbours each
 * had a winner, so the table numbered them 2, 3, 4 in ENTRY order, and a
 * round robin's cut on countback sent the earliest entry through where the
 * committee owed a draw. And the other way about: a group the mini-league DID
 * separate (Ann +1, Bea 0, Cat -1) shared a place wherever the two neighbours
 * had halved their own meeting. The league of clubs (`orderClubs`) sorted on
 * the pairwise meeting outright — an intransitive comparator, whose order in
 * a cycle is whatever `Array.sort` reaches.
 *
 * Generic over what is ranked, so the player table and the club table cannot
 * answer a cycle two ways. `a-head-to-head-cycle-shares-the-place.test.ts`
 * works the rule by hand; the sweep there refuses a ranking that applies
 * head-to-head without coming here.
 */

/** One step of a chain, asked of a GROUP of the level. Higher is better. */
export interface LevelStep<T> {
  /**
   * A figure for each member of `group`. Head-to-head's depends on the group
   * (the mini-league among its members); every other step's is the member's
   * own record and ignores it.
   */
  score: (member: T, group: readonly T[]) => number;
  /**
   * Head-to-head: a part this step leaves level is asked this step again,
   * over only that part. False for every other step, whose figure would not
   * change.
   */
  regroup: boolean;
}

/**
 * The level group in finishing order, as PLACES: each inner list is one place,
 * shared by everyone in it. `within` orders the members of a shared place (a
 * list still needs an order — seed, a handicap on an untouched chain, a name)
 * without separating them.
 */
export function placesOfLevelGroup<T>(
  group: readonly T[],
  steps: readonly LevelStep<T>[],
  within: (a: T, b: T) => number,
): T[][] {
  const resolve = (members: readonly T[], at: number): T[][] => {
    if (members.length <= 1) return members.length === 1 ? [[members[0]]] : [];
    if (at >= steps.length) return [[...members].sort(within)];
    const step = steps[at];
    const figure = new Map(members.map((m) => [m, step.score(m, members)]));
    const values = [...new Set(figure.values())].sort((a, b) => b - a);
    if (values.length === 1) return resolve(members, at + 1);
    const out: T[][] = [];
    for (const v of values) {
      // Members kept in the order they came, so `within` is the only thing
      // that orders a shared place.
      const part = members.filter((m) => figure.get(m) === v);
      out.push(...resolve(part, step.regroup && part.length > 1 ? at : at + 1));
    }
    return out;
  };
  return resolve(group, 0);
}

/**
 * A whole table: grouped by `points` (higher first), each level group placed
 * by `placesOfLevelGroup`. Returns the rows in order with their place —
 * 1, 2, 2, 4: a shared place, and the next row takes the place its position
 * deserves.
 */
export function placeByPointsThenSteps<T>(
  rows: readonly T[],
  points: (row: T) => number,
  steps: readonly LevelStep<T>[],
  within: (a: T, b: T) => number,
): Array<{ row: T; place: number }> {
  const byPoints = new Map<number, T[]>();
  for (const r of rows) {
    const p = points(r);
    const list = byPoints.get(p);
    if (list) list.push(r);
    else byPoints.set(p, [r]);
  }
  const out: Array<{ row: T; place: number }> = [];
  for (const p of [...byPoints.keys()].sort((a, b) => b - a)) {
    for (const place of placesOfLevelGroup(byPoints.get(p)!, steps, within)) {
      const at = out.length + 1;
      for (const row of place) out.push({ row, place: at });
    }
  }
  return out;
}
