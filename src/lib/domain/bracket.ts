// Bracket seeding and advancement. Two single-elimination brackets (Winners,
// Consolation) seeded from qualifiers; winners are chosen manually (README).

import type { BracketKind, Player } from "./types";
import type { RankedPlayer } from "./standings";

/** Standard 8-seed pairing order from the handoff: seed 1 plays 8, etc. */
export const SEED_ORDER_8 = [1, 8, 4, 5, 3, 6, 2, 7];

export interface BracketSlot {
  playerId: string | null;
  /** Seed within this bracket (1-based) when known from round 1. */
  seed: number | null;
  name: string;
}

export interface BracketMatch {
  /** Stable key: `${bracket}-${roundIndex}-${matchIndex}`. */
  key: string;
  roundIndex: number;
  matchIndex: number;
  a: BracketSlot;
  b: BracketSlot;
  winnerId: string | null;
}

export interface BracketRound {
  label: string;
  roundIndex: number;
  matches: BracketMatch[];
}

export interface BracketView {
  kind: BracketKind;
  rounds: BracketRound[];
  champion: BracketSlot | null;
}

const ROUND_LABELS = ["Round of 8", "Semifinals", "Final"];

/**
 * Select qualifiers: top `qualifyPerGroup` from each group's ranking, then
 * ordered by their overall rank across the whole field.
 */
export function pickQualifiers(
  groupsRanked: RankedPlayer[][],
  qualifyPerGroup: number,
  overallRanked: RankedPlayer[],
): Player[] {
  const ids = new Set<string>();
  for (const g of groupsRanked) {
    for (const rp of g.slice(0, qualifyPerGroup)) ids.add(rp.player.id);
  }
  return overallRanked.filter((rp) => ids.has(rp.player.id)).map((rp) => rp.player);
}

/** Split qualifiers (already in overall-rank order): top half -> Winners, bottom -> Consolation. */
export function splitBrackets(qualifiers: Player[]): {
  winners: Player[];
  consolation: Player[];
} {
  const half = Math.ceil(qualifiers.length / 2);
  return { winners: qualifiers.slice(0, half), consolation: qualifiers.slice(half) };
}

/**
 * Build a full bracket view for up to 8 seeded players (index 0 = seed 1).
 * `winners` maps match key -> winning playerId (organizer picks). Rounds after
 * the first are populated by advancing chosen winners; byes auto-advance.
 */
export function buildBracket(
  kind: BracketKind,
  seededPlayers: Player[],
  winners: Record<string, string>,
): BracketView {
  const byId = new Map(seededPlayers.map((p) => [p.id, p]));
  const seedById = new Map(seededPlayers.map((p, i) => [p.id, i + 1]));

  const slotFor = (playerId: string | null): BracketSlot => {
    if (!playerId) return { playerId: null, seed: null, name: "TBD" };
    const p = byId.get(playerId);
    return {
      playerId,
      seed: seedById.get(playerId) ?? null,
      name: p ? p.name : "—",
    };
  };

  // Round of 8, seeded per SEED_ORDER_8. Missing seeds become byes (null).
  const seedSlot = (seedNum: number): string | null => seededPlayers[seedNum - 1]?.id ?? null;

  const rounds: BracketRound[] = [];

  // Round 0: 4 matches from the seed order.
  const r0: BracketMatch[] = [];
  for (let i = 0; i < 4; i += 1) {
    const aId = seedSlot(SEED_ORDER_8[i * 2]);
    const bId = seedSlot(SEED_ORDER_8[i * 2 + 1]);
    const key = `${kind}-0-${i}`;
    // Byes: if exactly one side is present, it auto-advances.
    let winnerId = winners[key] ?? null;
    if (!winnerId) {
      if (aId && !bId) winnerId = aId;
      else if (bId && !aId) winnerId = bId;
    }
    r0.push({
      key,
      roundIndex: 0,
      matchIndex: i,
      a: slotFor(aId),
      b: slotFor(bId),
      winnerId,
    });
  }
  rounds.push({ label: ROUND_LABELS[0], roundIndex: 0, matches: r0 });

  // Rounds 1..2: fed by previous round winners.
  for (let round = 1; round <= 2; round += 1) {
    const prev = rounds[round - 1].matches;
    const count = prev.length / 2;
    const matches: BracketMatch[] = [];
    for (let i = 0; i < count; i += 1) {
      const aId = prev[i * 2].winnerId;
      const bId = prev[i * 2 + 1].winnerId;
      const key = `${kind}-${round}-${i}`;
      let winnerId = winners[key] ?? null;
      // Only auto-advance a bye once both feeders are actually resolved.
      if (!winnerId) {
        if (aId && !bId && prev[i * 2 + 1].winnerId === null && isByeFeeder(prev[i * 2 + 1])) {
          winnerId = aId;
        }
      }
      matches.push({
        key,
        roundIndex: round,
        matchIndex: i,
        a: slotFor(aId),
        b: slotFor(bId),
        winnerId,
      });
    }
    rounds.push({ label: ROUND_LABELS[round], roundIndex: round, matches });
  }

  const finalMatch = rounds[2].matches[0];
  const champion = finalMatch?.winnerId ? slotFor(finalMatch.winnerId) : null;

  return { kind, rounds, champion };
}

/** A feeder match that can never produce a player (both slots empty) is a bye. */
function isByeFeeder(m: BracketMatch): boolean {
  return m.a.playerId === null && m.b.playerId === null;
}
