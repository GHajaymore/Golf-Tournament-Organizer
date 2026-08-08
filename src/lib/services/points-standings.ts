import { allocationHoles } from "../domain/stroke";
import "server-only";
import { prisma } from "../db";
import { playSkins, type SkinsOutcome } from "../domain/skins";
import { playNassau, type NassauOutcome } from "../domain/nassau";
import { modifiedStablefordForHole, holeStrokesReceived } from "../domain/stroke";
import type { HoleResult } from "../domain/types";

/**
 * Standings for the formats that read an ordinary card a different way.
 *
 * Skins, Nassau and modified Stableford add no new way of *recording* a round —
 * a skins game is a stroke card, a Nassau is a match card. What they change is
 * how the result is read, so these all load what is already there rather than
 * needing their own storage.
 */

const parse = (s: string): (number | null)[] => {
  try {
    return JSON.parse(s) as (number | null)[];
  } catch {
    return [];
  }
};

export interface SkinsBoard {
  outcome: SkinsOutcome;
  nameById: Record<string, string>;
}

export async function skinsBoard(
  eventId: string,
  stageId: string,
  holeCount: number,
  net: boolean,
  strokeIndex: number[],
): Promise<SkinsBoard> {
  const [cards, players] = await Promise.all([
    prisma.scorecard.findMany({ where: { eventId, stageId } }),
    prisma.player.findMany({
      where: { eventId, status: "confirmed" },
      select: { id: true, name: true, handicap: true },
    }),
  ]);
  const byPlayer = new Map(cards.map((c) => [c.playerId, parse(c.strokes)]));
  // Only players who have returned something take part — including everyone
  // would make every hole "fewer than two scores" and score nothing at all.
  const entrants = players
    .filter((p) => (byPlayer.get(p.id) ?? []).some((s) => s != null))
    .map((p) => ({
      playerId: p.id,
      strokes: byPlayer.get(p.id) ?? [],
      courseHandicap: p.handicap,
    }));

  return {
    outcome: playSkins(entrants, holeCount, { net, strokeIndex }),
    nameById: Object.fromEntries(players.map((p) => [p.id, p.name])),
  };
}

export interface NassauMatchRow {
  matchId: string;
  aName: string;
  bName: string;
  outcome: NassauOutcome;
}

export async function nassauBoard(eventId: string, stageId: string): Promise<NassauMatchRow[]> {
  const [matches, players] = await Promise.all([
    prisma.match.findMany({ where: { eventId, stageId }, orderBy: { round: "asc" } }),
    prisma.player.findMany({ where: { eventId }, select: { id: true, name: true } }),
  ]);
  const nameById = new Map(players.map((p) => [p.id, p.name]));

  return matches.map((m) => ({
    matchId: m.id,
    aName: nameById.get(m.playerAId) ?? "—",
    bName: nameById.get(m.playerBId) ?? "—",
    outcome: playNassau(parse(m.holes) as HoleResult[]),
  }));
}

export interface ModStablefordRow {
  playerId: string;
  name: string;
  handicap: number;
  points: number;
  played: number;
  gross: number;
}

export async function modifiedStablefordBoard(
  eventId: string,
  stageId: string,
  pars: number[],
  strokeIndex: number[],
): Promise<ModStablefordRow[]> {
  const [cards, players] = await Promise.all([
    prisma.scorecard.findMany({ where: { eventId, stageId } }),
    prisma.player.findMany({
      where: { eventId, status: "confirmed" },
      select: { id: true, name: true, handicap: true },
      orderBy: { seed: "asc" },
    }),
  ]);
  const byPlayer = new Map(cards.map((c) => [c.playerId, parse(c.strokes)]));

  const rows = players.map((p) => {
    const strokes = byPlayer.get(p.id) ?? [];
    let points = 0;
    let played = 0;
    let gross = 0;
    for (let h = 0; h < pars.length; h += 1) {
      const s = strokes[h];
      if (s == null || !Number.isFinite(s)) continue;
      const shots = holeStrokesReceived(p.handicap, strokeIndex[h] ?? 18, allocationHoles(strokeIndex.length));
      points += modifiedStablefordForHole(s, pars[h] ?? 0, shots);
      gross += s;
      played += 1;
    }
    return { playerId: p.id, name: p.name, handicap: p.handicap, points, played, gross };
  });

  // Highest points wins. Unlike standard Stableford there is no floor at zero,
  // so a score can be negative — which means an unplayed card (0 points) would
  // otherwise outrank someone having a bad day. Unplayed sorts last regardless.
  return rows.sort((a, b) => {
    if (a.played === 0 !== (b.played === 0)) return a.played === 0 ? 1 : -1;
    return b.points - a.points || a.gross - b.gross || a.name.localeCompare(b.name);
  });
}
