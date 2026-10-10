import { compareTeamRows, valueOnBasis, type WeekBasis } from "./week-basis";

/**
 * A PAIRS EVENT OVER MORE THAN ONE ROUND IS WON ON THE TOTAL (2026-10-10).
 *
 * A 36-hole better-ball championship — the club foursomes over two days, a
 * society's four-ball weekend — is decided on the pair's aggregate, exactly as
 * a 36-hole medal is decided on the player's. The team board showed one round
 * at a time and nothing added them, so the champion pair could be read off no
 * screen at all.
 *
 * A side is the same side when it has the same PLAYERS, not the same row id:
 * each round draws its own sides (`autoDrawTeams` fills every same-format
 * round), so a pair is matched across rounds by its member ids. Totals are
 * only offered when every round holds the same pairs — if the partners were
 * changed between rounds there is no pair to total, and inventing one would be
 * a result nobody played for. Rounds must share a basis for the same reason:
 * net strokes and Stableford points do not add.
 *
 * Ranked as the round boards are (`compareTeamRows`): relative to par while
 * anybody is still out, points for Stableford.
 */

export interface PairRoundRow {
  teamId: string;
  name: string;
  members: string[];
  memberIds: string[];
  playingHandicap: number;
  gross: number;
  net: number;
  points: number;
  played: number;
  toPar: number;
}

export interface PairTotal {
  key: string;
  name: string;
  members: string[];
  memberIds: string[];
  /** The round's ranked figure, one per round in order; null where the pair has no card. */
  rounds: (number | null)[];
  gross: number;
  net: number;
  points: number;
  /** Holes with a counting score, across every round. */
  played: number;
  toPar: number;
}

const keyOf = (memberIds: readonly string[]) => [...memberIds].sort().join("|");

export function pairTotals(rounds: readonly (readonly PairRoundRow[])[], basis: WeekBasis): PairTotal[] {
  if (rounds.length < 2) return [];
  const keyed = rounds.map((rows) => rows.filter((r) => r.memberIds.length > 0));
  const keys = keyed.map((rows) => new Set(rows.map((r) => keyOf(r.memberIds))));
  const first = keys[0];
  if (first.size === 0) return [];
  // The same pairs in every round, or there is nothing to total.
  if (!keys.every((k) => k.size === first.size && [...k].every((x) => first.has(x)))) return [];

  const last = keyed[keyed.length - 1];
  const totals = last.map((side): PairTotal => {
    const key = keyOf(side.memberIds);
    const own = keyed.map((rows) => rows.find((r) => keyOf(r.memberIds) === key)!);
    return {
      key,
      name: side.name,
      members: side.members,
      memberIds: side.memberIds,
      rounds: own.map((r) => (r.played > 0 ? valueOnBasis(basis, r) : null)),
      gross: own.reduce((s, r) => s + r.gross, 0),
      net: own.reduce((s, r) => s + r.net, 0),
      points: own.reduce((s, r) => s + r.points, 0),
      played: own.reduce((s, r) => s + r.played, 0),
      toPar: own.reduce((s, r) => s + (r.played > 0 ? r.toPar : 0), 0),
    };
  });
  return totals.sort((a, b) => {
    if (a.played === 0 !== (b.played === 0)) return a.played === 0 ? 1 : -1;
    return compareTeamRows(basis, a, b) || a.name.localeCompare(b.name);
  });
}
