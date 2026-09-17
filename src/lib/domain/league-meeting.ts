import { resolveMatch } from "./match";
import type { HoleResult } from "./types";

/**
 * A WEEK OF AN INTERCLUB LEAGUE: twelve club teams, six four-balls each.
 *
 * The shape this exists for, described by a club running it on 2026-09-17:
 * twelve teams with a roster of ten or more, each nominating SIX PAIRS a week
 * — different pairs week to week — every pair playing a four-ball against an
 * opposing pair, shotgun across eighteen holes, round robin so every team
 * plays every other once, then a play-off.
 *
 * NONE OF THE GOLF HERE IS NEW. A pairing is an ordinary four-ball match:
 * `aggregateTeamCard` already takes each side's better ball per hole,
 * `teamMatchHoles` already decides who won each hole from those, and
 * `resolveMatch` already turns that into "2 up" and knows a closeout ends a
 * match. What was missing is only the layer ABOVE: six of those results
 * belonging to one meeting between two club teams, and a rule turning them
 * into league points.
 *
 * THE MEETING IS DERIVED, NOT STORED. `Team.parentTeamId` says which club a
 * pair plays for, so the matches in one round whose two sides share a pair of
 * parents ARE the meeting. That is why a six-match tie needs no model of its
 * own, and why nothing about the existing formats changes.
 *
 * Pure: it takes resolved matches and returns numbers. No Prisma, no clock —
 * every combination below can be swept without a database, which is what
 * `matrix.test.ts` asks of anything that scores.
 */

/**
 * How a league turns four-ball results into points.
 *
 * These are the systems club software offers, not an invention. A league picks
 * one; the engine does not care which, and the same six results score
 * differently under each — which is the whole reason it is a setting rather
 * than a constant.
 */
export const LEAGUE_POINTS_SYSTEMS = [
  "match",
  "holes-and-match",
  "holes",
  "nassau",
] as const;

export type LeaguePointsSystem = (typeof LEAGUE_POINTS_SYSTEMS)[number];

/**
 * Whether a stored value names a system this app knows.
 *
 * `Event.leaguePoints` is free text and defaults to empty, so a reader has to
 * ask rather than cast — the same shape `isBracketMode` and `isAttendanceMode`
 * use, and for the same reason: a column holds whatever was written to it.
 */
export function isLeaguePointsSystem(v: unknown): v is LeaguePointsSystem {
  return (LEAGUE_POINTS_SYSTEMS as readonly string[]).includes(v as string);
}

export const LEAGUE_POINTS_LABEL: Record<LeaguePointsSystem, string> = {
  match: "Match play — 1 point a win, ½ a half",
  "holes-and-match": "Holes won, plus a bonus for the match",
  holes: "Holes won only",
  nassau: "Nassau — front nine, back nine, overall",
};

export const LEAGUE_POINTS_HELP: Record<LeaguePointsSystem, string> = {
  match:
    "The simplest. Each four-ball is worth one point, shared when it is halved, so a six-pair meeting puts six points up.",
  "holes-and-match":
    "The common Thursday-league system. A point for every hole a side wins, and a further bonus to whoever wins the match — so a thrashing is worth more than a one-hole win.",
  holes:
    "Holes won and nothing else. Every hole counts equally and closing a match out early costs a side the holes it never played.",
  nassau:
    "Three points a pairing: the front nine, the back nine, and the match overall. Halves split each segment.",
};

/** What the bonus is worth when the system has one. A club may change it. */
export const DEFAULT_MATCH_BONUS = 2;

export interface PairingResult {
  /** The club team each side plays for. */
  parentA: string;
  parentB: string;
  /** Per-hole winner, as `teamMatchHoles` returns it. */
  holes: HoleResult[];
}

export interface MeetingPoints {
  /** Club team id. */
  teamId: string;
  points: number;
}

/**
 * Halves are worth half to each side, which is why league tables are full of
 * numbers like 187.50 rather than whole points.
 */
function split(aWon: number, bWon: number, halved: number, stake: number): [number, number] {
  return [aWon * stake + (halved * stake) / 2, bWon * stake + (halved * stake) / 2];
}

/** Holes won by each side, ignoring the ones nobody has played. */
function holesWon(holes: HoleResult[]): { a: number; b: number; halved: number } {
  let a = 0;
  let b = 0;
  let halved = 0;
  for (const h of holes) {
    if (h === "A") a += 1;
    else if (h === "B") b += 1;
    else if (h === "H") halved += 1;
  }
  return { a, b, halved };
}

/**
 * One pairing's points to each side, under one system.
 *
 * A match that is OVER is scored on the holes that were actually played —
 * `resolveMatch` counts a closeout, so 6&4 leaves four holes nobody walked and
 * they are worth nothing to anybody. That is the difference between "holes
 * won" and "holes available", and a system that paid for unplayed holes would
 * reward conceding.
 */
export function pairingPoints(
  holes: HoleResult[],
  system: LeaguePointsSystem,
  matchBonus: number = DEFAULT_MATCH_BONUS,
): [number, number] {
  const resolved = resolveMatch(holes);
  const won = holesWon(holes);

  if (system === "holes") {
    return split(won.a, won.b, won.halved, 1);
  }

  if (system === "holes-and-match") {
    const [a, b] = split(won.a, won.b, won.halved, 1);
    if (!resolved.complete) return [a, b];
    if (resolved.winner === "A") return [a + matchBonus, b];
    if (resolved.winner === "B") return [a, b + matchBonus];
    return [a + matchBonus / 2, b + matchBonus / 2];
  }

  if (system === "nassau") {
    /**
     * Three segments, each worth a point. The nine boundaries are fixed rather
     * than derived from the card's length: a Nassau is front, back and
     * overall, and a nine-hole round has no back nine to win — which is why
     * the segments are only counted where holes exist for them.
     */
    const segments: HoleResult[][] = [holes.slice(0, 9), holes.slice(9, 18), holes];
    let a = 0;
    let b = 0;
    for (const seg of segments) {
      if (seg.length === 0 || !seg.some((h) => h !== null)) continue;
      const s = holesWon(seg);
      if (s.a > s.b) a += 1;
      else if (s.b > s.a) b += 1;
      else {
        a += 0.5;
        b += 0.5;
      }
    }
    return [a, b];
  }

  // "match": one point, and an unfinished pairing is worth nothing yet.
  if (!resolved.complete) return [0, 0];
  if (resolved.winner === "A") return [1, 0];
  if (resolved.winner === "B") return [0, 1];
  return [0.5, 0.5];
}

/**
 * A whole meeting — every pairing between two club teams — reduced to a point
 * each side.
 *
 * Takes the pairings rather than finding them, so the caller decides what a
 * meeting IS. That keeps the rule above — matches sharing a pair of parents —
 * in one place and out of the arithmetic.
 */
export function meetingPoints(
  pairings: readonly PairingResult[],
  system: LeaguePointsSystem,
  matchBonus: number = DEFAULT_MATCH_BONUS,
): MeetingPoints[] {
  const totals = new Map<string, number>();
  const add = (teamId: string, n: number) => {
    if (!teamId) return;
    totals.set(teamId, (totals.get(teamId) ?? 0) + n);
  };

  for (const p of pairings) {
    const [a, b] = pairingPoints(p.holes, system, matchBonus);
    add(p.parentA, a);
    add(p.parentB, b);
  }

  return [...totals.entries()]
    .map(([teamId, points]) => ({ teamId, points }))
    .sort((x, y) => y.points - x.points || x.teamId.localeCompare(y.teamId));
}

/**
 * Which club teams met in a round, from the pairs that played.
 *
 * The meeting is the pair of parents, so this is the whole of "who played
 * whom" — and a pairing whose sides have no parent is not league play at all
 * and is left out rather than invented into a meeting of nobody.
 */
/**
 * The key for one meeting, spelled the way this codebase spells a composite
 * key — see `roundHandicapKey`, which joins on a colon for the same reason.
 *
 * Sorted, so Schmit-versus-Carter and Carter-versus-Schmit are one meeting
 * rather than two. A colon cannot appear in a cuid, so the pair cannot be
 * ambiguous.
 *
 * It was written with a NUL byte as the separator and `no-control-bytes.test`
 * caught it, which is what that guard is for: invisible in a diff, makes grep
 * treat the file as binary, and vanishes the first time somebody sanitises the
 * file.
 */
function meetingKey(a: string, b: string): string {
  return [a, b].sort().join(":");
}

export function meetingsIn(pairings: readonly PairingResult[]): [string, string][] {
  const seen = new Map<string, [string, string]>();
  for (const p of pairings) {
    if (!p.parentA || !p.parentB || p.parentA === p.parentB) continue;
    const key = meetingKey(p.parentA, p.parentB);
    if (!seen.has(key)) seen.set(key, [p.parentA, p.parentB]);
  }
  return [...seen.values()];
}
