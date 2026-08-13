// Flight formation. Each rule pursues a genuinely different objective, so
// Balanced / By handicap / By seeding / Random / Manual produce distinct flights.

import type { FormationRule, Group, Player } from "./types";

export interface FlightConfig {
  /** auto = ~4 players/flight; count = a fixed number of flights; perFlight = a target size. */
  mode: "auto" | "count" | "perFlight";
  value?: number;
}

/**
 * Number of flights for a field, honoring the organizer's configuration.
 *
 * Never more flights than the field can fill two-a-side. A flight of one is a
 * player with nobody to play, and a round robin drawn across such flights
 * produces NO MATCHES AT ALL — silently, with nothing on any screen to say so.
 *
 * The auto rule was `max(2, round(n / 4))`: a floor of two flights that never
 * checked there were two players. Two entrants became two flights of one and
 * zero matches; three became flights of 2 and 1, with the odd player stranded
 * for the whole tournament. Small fields are not exotic — a four-ball, a
 * play-off, a society's first outing all start here.
 *
 * `cut.ts` already refuses to leave a flight of one when it reforms the field
 * after a cut, on the stated grounds that a slightly larger flight beats one
 * nobody can play in. This is that same rule, applied where the field is first
 * drawn rather than only where it is redrawn.
 */
export function flightCountFor(playerCount: number, config: FlightConfig = { mode: "auto" }): number {
  if (playerCount <= 0) return 0;

  let requested: number;
  if (config.mode === "count" && config.value) {
    requested = Math.max(1, Math.min(playerCount, Math.round(config.value)));
  } else if (config.mode === "perFlight" && config.value) {
    const per = Math.max(2, Math.round(config.value));
    requested = Math.max(1, Math.ceil(playerCount / per));
  } else {
    requested = Math.max(2, Math.round(playerCount / 4));
  }

  // At most one flight per pair of players. A lone entrant still gets a single
  // flight — there is nowhere else to put them — but nobody else is ever left
  // in one on their own.
  const playable = Math.max(1, Math.floor(playerCount / 2));
  return Math.max(1, Math.min(requested, playable));
}

/** Legacy alias. */
export const groupCountFor = (n: number): number => flightCountFor(n);

/** Even-as-possible flight capacities (earlier flights absorb the remainder). */
function flightSizes(n: number, count: number): number[] {
  const base = Math.floor(n / count);
  const rem = n % count;
  return Array.from({ length: count }, (_, i) => base + (i < rem ? 1 : 0));
}

const flightName = (i: number): string => {
  let n = i;
  let s = "";
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return s;
};

/** Serpentine distribution of a pre-sorted list: 0,1,…,c-1,c-1,…,1,0. */
function snake(ids: string[], count: number): string[][] {
  const buckets: string[][] = Array.from({ length: count }, () => []);
  let idx = 0;
  let dir = 1;
  for (const id of ids) {
    buckets[idx].push(id);
    idx += dir;
    if (idx >= count) {
      idx = count - 1;
      dir = -1;
    } else if (idx < 0) {
      idx = 0;
      dir = 1;
    }
  }
  return buckets;
}

/** Composite ability score in [0,1] from handicap (60%) and seed/ranking (40%). */
function strengthOf(p: Player, hMin: number, hMax: number, sMin: number, sMax: number): number {
  const hs = hMax > hMin ? (hMax - p.handicap) / (hMax - hMin) : 0.5;
  const ss = sMax > sMin ? (sMax - p.seed) / (sMax - sMin) : 0.5;
  return 0.6 * hs + 0.4 * ss;
}

/**
 * Form flights from players by the chosen rule.
 *  - handicap: sort by handicap, snake-draft (comparable handicap spread per flight).
 *  - seeding:  sort by seed, snake-draft (1,8,9,16… seeding distribution).
 *  - balanced: greedy min-sum partition on a composite ability score, so each
 *              flight's *total strength* is near-equal — competitively balanced.
 *  - random:   shuffle, then deal evenly.
 *  - manual:   roster order, chunked (drag-and-drop reassignment to follow).
 */
export function formGroups(
  players: Player[],
  rule: FormationRule,
  config: FlightConfig = { mode: "auto" },
  makeId: (index: number) => string = (i) => `group-${i}`,
  rng: () => number = Math.random,
): Group[] {
  const n = players.length;
  const count = flightCountFor(n, config);
  if (count === 0) return [];

  let buckets: string[][];

  if (rule === "manual") {
    const sizes = flightSizes(n, count);
    buckets = [];
    let k = 0;
    for (const size of sizes) {
      buckets.push(players.slice(k, k + size).map((p) => p.id));
      k += size;
    }
  } else if (rule === "random") {
    const shuffled = [...players];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    buckets = Array.from({ length: count }, () => [] as string[]);
    shuffled.forEach((p, i) => buckets[i % count].push(p.id));
  } else if (rule === "balanced") {
    const hs = players.map((p) => p.handicap);
    const ss = players.map((p) => p.seed);
    const hMin = Math.min(...hs);
    const hMax = Math.max(...hs);
    const sMin = Math.min(...ss);
    const sMax = Math.max(...ss);
    const scored = players
      .map((p) => ({ p, s: strengthOf(p, hMin, hMax, sMin, sMax) }))
      .sort((a, b) => b.s - a.s);
    const flights = flightSizes(n, count).map((cap) => ({ ids: [] as string[], sum: 0, cap }));
    for (const { p, s } of scored) {
      let best = -1;
      for (let i = 0; i < flights.length; i += 1) {
        if (flights[i].ids.length >= flights[i].cap) continue;
        if (best < 0 || flights[i].sum < flights[best].sum) best = i;
      }
      flights[best].ids.push(p.id);
      flights[best].sum += s;
    }
    buckets = flights.map((f) => f.ids);
  } else {
    // handicap | seeding
    const sorted = [...players].sort((a, b) =>
      rule === "seeding" ? a.seed - b.seed : a.handicap - b.handicap,
    );
    buckets = snake(
      sorted.map((p) => p.id),
      count,
    );
  }

  return buckets.map((playerIds, i) => ({ id: makeId(i), name: flightName(i), playerIds }));
}

/** Average handicap of a flight, rounded to one decimal (for display). */
export function groupAvgHandicap(group: Group, byId: Map<string, Player>): number {
  if (group.playerIds.length === 0) return 0;
  const sum = group.playerIds.reduce((acc, id) => acc + (byId.get(id)?.handicap ?? 0), 0);
  return Math.round((sum / group.playerIds.length) * 10) / 10;
}
