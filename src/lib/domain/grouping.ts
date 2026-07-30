// Group formation. Reproduces the handoff's snake-draft rules exactly.

import type { FormationRule, Group, Player } from "./types";

/** Group count: max(2, round(playerCount / 4)). */
export function groupCountFor(playerCount: number): number {
  return Math.max(2, Math.round(playerCount / 4));
}

const groupName = (i: number): string => {
  // A, B, C … Z, then AA, AB … for large fields.
  let n = i;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
};

/**
 * Form groups from players by the chosen rule.
 *  - balanced / handicap: sort by handicap asc, then snake-draft.
 *  - seeding: sort by seed asc, then snake-draft.
 *  - manual: groups follow roster order, chunked sequentially.
 *
 * Snake draft distributes the sorted list across groups in a
 * 0,1,…,n-1,n-1,…,1,0 serpentine so each group gets a comparable spread.
 */
export function formGroups(
  players: Player[],
  rule: FormationRule,
  makeId: (index: number) => string = (i) => `group-${i}`,
): Group[] {
  const count = groupCountFor(players.length);
  const buckets: string[][] = Array.from({ length: count }, () => []);

  if (rule === "manual") {
    // Preserve roster order; fill group A, then B, … sequentially.
    const perGroup = Math.ceil(players.length / count);
    players.forEach((p, i) => {
      const g = Math.min(Math.floor(i / perGroup), count - 1);
      buckets[g].push(p.id);
    });
  } else {
    const sorted = [...players].sort((a, b) =>
      rule === "seeding" ? a.seed - b.seed : a.handicap - b.handicap,
    );
    let idx = 0;
    let dir = 1;
    for (const p of sorted) {
      buckets[idx].push(p.id);
      idx += dir;
      if (idx >= count) {
        idx = count - 1;
        dir = -1;
      } else if (idx < 0) {
        idx = 0;
        dir = 1;
      }
    }
  }

  return buckets.map((playerIds, i) => ({
    id: makeId(i),
    name: groupName(i),
    playerIds,
  }));
}

/** Average handicap of a group, rounded to one decimal (for display). */
export function groupAvgHandicap(group: Group, byId: Map<string, Player>): number {
  if (group.playerIds.length === 0) return 0;
  const sum = group.playerIds.reduce((acc, id) => acc + (byId.get(id)?.handicap ?? 0), 0);
  return Math.round((sum / group.playerIds.length) * 10) / 10;
}
