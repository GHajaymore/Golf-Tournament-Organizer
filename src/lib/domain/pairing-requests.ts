/**
 * PAIRING REQUESTS — "can I play with Bea?", which every club day, society
 * outing and charity scramble fields on the entry sheet.
 *
 * A request is between two players, and requests CHAIN: Ann asks for Bea and
 * Bea asks for Cal, so the three of them want one group. So the unit here is
 * the CLUSTER — every player joined to another by any request — and the draw
 * either keeps a cluster whole or says it could not.
 *
 * THE DRAW STILL DECIDES EVERYTHING ELSE. Requests are honoured AFTER the
 * chosen draw — random, balanced, seeded — by swapping players between groups,
 * so every group keeps its size and the draw's character survives for everyone
 * who asked for nothing. They are not honoured on a draw BY POSITION: a second
 * round paired off the leaderboard is a competitive draw, and a request that
 * put the leader beside their friend would be unfair to the field. That is the
 * convention at every club, and the screen says so.
 *
 * A cluster larger than a group cannot be kept together and is reported rather
 * than forced — a group of six is not a tee time.
 */

export interface DrawGroup {
  id: string;
  name: string;
  playerIds: string[];
}

/** Every requested pairing as a pair of ids, from each player's own list. */
export function requestPairs(players: readonly { id: string; playWith: readonly string[] }[]): [string, string][] {
  const out: [string, string][] = [];
  for (const p of players) for (const w of p.playWith) if (w !== p.id) out.push([p.id, w]);
  return out;
}

/**
 * The clusters of players who asked to be together, restricted to `field` —
 * a request for somebody not playing this round is simply not in play today.
 * Largest first, members in field order, so the result does not depend on
 * which side of a request was stored.
 */
export function requestClusters(pairs: readonly [string, string][], field: readonly string[]): string[][] {
  const inField = new Set(field);
  const parent = new Map<string, string>();
  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  for (const [a, b] of pairs) {
    if (!inField.has(a) || !inField.has(b) || a === b) continue;
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  }
  const byRoot = new Map<string, string[]>();
  for (const id of field) {
    if (!parent.has(id)) continue;
    const r = find(id);
    byRoot.set(r, [...(byRoot.get(r) ?? []), id]);
  }
  return [...byRoot.values()].sort((a, b) => b.length - a.length);
}

/**
 * The draw with every cluster that CAN be kept together kept together.
 *
 * For each cluster, largest first: the group already holding most of it is the
 * target, and each missing member swaps places with somebody in the target who
 * is not in a cluster already placed. Group sizes never change. A cluster that
 * is bigger than its target group, or cannot find enough free places there, is
 * returned in `split` and its members are left where the draw put them.
 */
export function honourRequests(
  groups: readonly DrawGroup[],
  clusters: readonly string[][],
): { groups: DrawGroup[]; kept: string[][]; split: string[][] } {
  const out = groups.map((g) => ({ ...g, playerIds: [...g.playerIds] }));
  const groupOf = new Map<string, number>();
  out.forEach((g, gi) => g.playerIds.forEach((id) => groupOf.set(id, gi)));
  const locked = new Set<string>();
  const kept: string[][] = [];
  const split: string[][] = [];

  for (const cluster of clusters) {
    const members = cluster.filter((id) => groupOf.has(id));
    if (members.length < 2) continue;
    // Try the group holding the most of them first (the fewest moves), then
    // every other group in order — a group already full of a kept cluster is
    // not the only place this one could go.
    const counts = new Map<number, number>();
    for (const id of members) counts.set(groupOf.get(id)!, (counts.get(groupOf.get(id)!) ?? 0) + 1);
    const candidates = out
      .map((_, gi) => gi)
      .sort((x, y) => (counts.get(y) ?? 0) - (counts.get(x) ?? 0) || x - y);
    let target = -1;
    let free: string[] = [];
    for (const gi of candidates) {
      const room = out[gi].playerIds.filter((id) => !members.includes(id) && !locked.has(id));
      const need = members.filter((id) => groupOf.get(id) !== gi).length;
      if (members.length <= out[gi].playerIds.length && room.length >= need) {
        target = gi;
        free = room;
        break;
      }
    }
    if (target < 0) {
      split.push(cluster);
      continue;
    }
    const missing = members.filter((id) => groupOf.get(id) !== target);
    for (const m of missing) {
      const from = groupOf.get(m)!;
      const x = free.shift()!;
      out[from].playerIds[out[from].playerIds.indexOf(m)] = x;
      out[target].playerIds[out[target].playerIds.indexOf(x)] = m;
      groupOf.set(x, from);
      groupOf.set(m, target);
    }
    members.forEach((id) => locked.add(id));
    kept.push(cluster);
  }
  return { groups: out, kept, split };
}

/**
 * Which clusters a SAVED sheet splits — for the warning on a sheet drawn before
 * a request came in. Only players on the sheet are considered; a cluster whose
 * members are all in one group, or who are not all drawn, is not "split".
 */
export function splitRequests(groups: readonly { playerIds: readonly string[] }[], clusters: readonly string[][]): string[][] {
  const groupOf = new Map<string, number>();
  groups.forEach((g, gi) => g.playerIds.forEach((id) => groupOf.set(id, gi)));
  return clusters.filter((c) => {
    const drawn = c.filter((id) => groupOf.has(id));
    return drawn.length > 1 && new Set(drawn.map((id) => groupOf.get(id))).size > 1;
  });
}

/** The most partners one player may ask for — a four-ball is them and three others. */
export const MAX_REQUESTS = 3;
