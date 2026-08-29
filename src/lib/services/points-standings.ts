import { allocationHoles } from "../domain/stroke";
import "server-only";
import { prisma } from "../db";
import { playSkins, type SkinsOutcome } from "../domain/skins";
import { playNassau, type NassauOutcome } from "../domain/nassau";
import { modifiedStablefordForHole, holeStrokesReceived } from "../domain/stroke";
import type { HoleResult } from "../domain/types";
import { courseHandicapMap } from "../domain/handicap";
import { strokeHandicapResolver } from "./tournament";
import { roundHandicapRows } from "./round-handicap";
import { teeSetupFor, flightTeeByPlayer } from "./handicaps";

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

/**
 * What each player actually plays off in this round.
 *
 * These two boards handed `Player.handicap` straight to the allocator. That is
 * a Handicap INDEX — a portable number that means nothing until it is put
 * against a set of tees — and `domain/handicap.ts` opens by saying that using
 * one where the other belongs "is the single most common way an otherwise
 * correct scoring engine produces wrong results".
 *
 * Four things were missing, and they compound:
 *
 *   - the tee conversion. A 12.4 index off a slope-140 course is a Course
 *     Handicap of 16, not 12;
 *   - the round's allowance. Modified Stableford carries 95%, which this board
 *     never applied;
 *   - the nine-hole conversion;
 *   - the committee's override, and the handicap frozen when the round's first
 *     card came in — neither was read at all.
 *
 * It mattered most on skins, where the settlement screen (`skinsPotFor`) had
 * already been taught the conversion: the public board and the money the club
 * actually paid named different skin winners for the same round, because skins
 * are won outright and one differing stroke flips a hole and carries onward.
 *
 * Deliberately the SAME `strokeHandicapResolver` the stroke board, the team
 * engines and the weekly view use, rather than a fifth copy of the rule — its
 * own comment warns that this is how "one screen prices a card off an index
 * and another off a Course Handicap".
 */
async function playingHandicapFor(
  eventId: string,
  stageId: string,
): Promise<(playerId: string) => number> {
  const [players, stage, tees, roundRows] = await Promise.all([
    prisma.player.findMany({
      where: { eventId, status: "confirmed" },
      select: { id: true, handicap: true, handicapType: true, teeId: true },
    }),
    prisma.stage.findUnique({ where: { id: stageId } }),
    // This club's tees only — the same scoping `roundHandicapsFor` uses, and
    // for the same reason: an unscoped read lets a player's teeId resolve to
    // another organization's rating and silently changes what they play off.
    prisma.tee.findMany({
      where: { course: { events: { some: { eventId } } } },
      orderBy: [{ position: "asc" }],
    }),
    roundHandicapRows(eventId, stageId),
  ]);

  const teeSetup = await teeSetupFor(eventId, tees);
  const teeRatings = new Map(
    tees.map((t) => [t.id, { courseRating: t.courseRating, slopeRating: t.slopeRating, par: t.par }]),
  );
  // Under the `flight` policy this is what a player actually plays off, and
  // these boards were reading the round's default set for the whole field.
  const flightTee = await flightTeeByPlayer(eventId);
  const idx = players.map((p) => ({
    id: p.id,
    handicap: p.handicap,
    handicapType: p.handicapType,
    teeId: p.teeId,
    flightTeeId: flightTee.get(p.id) ?? null,
  }));
  const courseHcp18 = courseHandicapMap(idx, teeRatings, teeSetup.defaultTeeId, 18, teeSetup.policy);
  const courseHcp9 = courseHandicapMap(idx, teeRatings, teeSetup.defaultTeeId, 9, teeSetup.policy);

  // With no rated tees on file the maps hold the raw indexes, which is exactly
  // how this behaved before ratings existed — the fix must not make a club
  // that has never entered a slope worse off.
  const resolve = strokeHandicapResolver({
    stageById: new Map(stage ? [[stage.id, stage]] : []),
    courseHcp9,
    courseHcp18,
    fallback: courseHcp18,
    roundHandicapFor: (playerId) => roundRows.get(playerId) ?? null,
  });

  return (playerId) => resolve(playerId, stageId);
}

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
  const [cards, players, playsOff] = await Promise.all([
    prisma.scorecard.findMany({ where: { eventId, stageId } }),
    prisma.player.findMany({
      where: { eventId, status: "confirmed" },
      select: { id: true, name: true, handicap: true },
    }),
    playingHandicapFor(eventId, stageId),
  ]);
  const byPlayer = new Map(cards.map((c) => [c.playerId, parse(c.strokes)]));
  // Only players who have returned something take part — including everyone
  // would make every hole "fewer than two scores" and score nothing at all.
  const entrants = players
    .filter((p) => (byPlayer.get(p.id) ?? []).some((s) => s != null))
    .map((p) => ({
      playerId: p.id,
      // The same Playing Handicap the skins POT charges against. These two
      // used to disagree by four strokes at slope 140, and skins are won
      // outright — so one differing stroke flips a hole and carries onward,
      // and the board named a different winner from the settlement.
      strokes: byPlayer.get(p.id) ?? [],
      courseHandicap: playsOff(p.id),
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
  const [cards, players, playsOff] = await Promise.all([
    prisma.scorecard.findMany({ where: { eventId, stageId } }),
    prisma.player.findMany({
      where: { eventId, status: "confirmed" },
      select: { id: true, name: true, handicap: true },
      orderBy: { seed: "asc" },
    }),
    playingHandicapFor(eventId, stageId),
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
      // Playing Handicap, not the Index. On the modified table a stroke is
      // worth up to three points, so the three shots this used to withhold
      // from a 12.4 off slope 140 could swing a card by six and reorder the
      // board.
      const shots = holeStrokesReceived(playsOff(p.id), strokeIndex[h] ?? 18, allocationHoles(strokeIndex.length));
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
