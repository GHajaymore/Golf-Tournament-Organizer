import { resolveMatch } from "./match";
import type { HoleResult } from "./types";

/**
 * THE TEAM CUP — the Ryder Cup shape for a golf trip or a club v club day
 * (Ajay, 2026-09-28: "go ahead with your recommendations").
 *
 * Two teams. Sessions of matches — four-balls, foursomes, singles — every match
 * worth one point, a halve half a point each. The cup goes to the first team to
 * reach the points to win; on a tie a named holder keeps it.
 *
 * Pure. The service hands in each match already mapped to the TEAMS it is
 * between (a pair belongs to its flight, a singles player to theirs).
 */

export type CupSide = "A" | "B";

export interface CupMatchInput {
  holes: HoleResult[];
  /** The losing side when a match was conceded, or null. */
  conceded: CupSide | null;
}

export interface CupMatchState {
  /** Points to each team: 1/0, ½/½, or 0/0 while it is not decided. */
  points: [number, number];
  status: "not-started" | "in-play" | "final";
  /**
   * What a golfer calls it: "3&2", "1 UP", "A/S" (halved) when final;
   * "2 UP thru 14" / "A/S thru 9" in play; "" before a shot.
   */
  label: string;
  /** Which team the label favours; null when level or not started. */
  leader: CupSide | null;
}

/** One match, read the way the cup board prints it. */
export function cupMatchState(m: CupMatchInput): CupMatchState {
  if (m.conceded) {
    const winner: CupSide = m.conceded === "A" ? "B" : "A";
    return { points: winner === "A" ? [1, 0] : [0, 1], status: "final", label: "Conceded", leader: winner };
  }
  const played = m.holes.filter((h) => h !== null).length;
  if (played === 0) return { points: [0, 0], status: "not-started", label: "", leader: null };
  const r = resolveMatch(m.holes);
  if (r.complete) {
    if (r.winner === "A") return { points: [1, 0], status: "final", label: r.resultText, leader: "A" };
    if (r.winner === "B") return { points: [0, 1], status: "final", label: r.resultText, leader: "B" };
    return { points: [0.5, 0.5], status: "final", label: "A/S", leader: null };
  }
  const lead = Math.abs(r.lead);
  return {
    points: [0, 0],
    status: "in-play",
    label: `${lead === 0 ? "A/S" : `${lead} UP`} thru ${r.played}`,
    leader: r.lead > 0 ? "A" : r.lead < 0 ? "B" : null,
  };
}

export interface CupTally {
  /** Points won so far — decided matches only, never a projection. */
  a: number;
  b: number;
  /** Matches in the cup, decided or not. */
  total: number;
  decided: number;
  inPlay: number;
  notStarted: number;
}

export function cupTally(matches: CupMatchInput[]): CupTally {
  const t: CupTally = { a: 0, b: 0, total: matches.length, decided: 0, inPlay: 0, notStarted: 0 };
  for (const m of matches) {
    const s = cupMatchState(m);
    t.a += s.points[0];
    t.b += s.points[1];
    if (s.status === "final") t.decided += 1;
    else if (s.status === "in-play") t.inPlay += 1;
    else t.notStarted += 1;
  }
  return t;
}

/**
 * The points a team needs to win the cup outright.
 *
 * An explicit target (14½ of 28) wins; 0 means "more than half of what is on
 * offer" — with 28 matches that is 14½, with 12 it is 6½. With no matches yet
 * there is no target to name.
 */
export function pointsToWin(target: number, totalMatches: number): number {
  if (target > 0) return target;
  if (totalMatches <= 0) return 0;
  // Half the points plus a half-point: 28 → 14½, 12 → 6½, 5 → 3. Not
  // floor(n/2) + ½, which makes 5 → 2½ — a score the other team can equal.
  return totalMatches / 2 + 0.5;
}

export type CupVerdict =
  | { kind: "won"; by: CupSide }
  | { kind: "retained"; by: CupSide }
  | { kind: "tied" }
  | { kind: "open"; needA: number; needB: number };

/**
 * Who has the cup, or what each team still needs.
 *
 * Won the moment a team reaches the target — the rest of the singles are still
 * played, but the cup is decided (a golfer says "the cup is won"). Once every
 * match is decided and neither reached it, the teams are level: the holder
 * RETAINS if there is one, otherwise it is shared.
 */
export function cupVerdict(t: CupTally, target: number, holder: CupSide | null): CupVerdict {
  const win = pointsToWin(target, t.total);
  if (win > 0 && t.a >= win) return { kind: "won", by: "A" };
  if (win > 0 && t.b >= win) return { kind: "won", by: "B" };
  if (t.total > 0 && t.decided === t.total) {
    return holder ? { kind: "retained", by: holder } : { kind: "tied" };
  }
  return { kind: "open", needA: Math.max(0, win - t.a), needB: Math.max(0, win - t.b) };
}

/** "8½", "14", "½" — how a cup score is written. */
export function cupPoints(n: number): string {
  const whole = Math.floor(n);
  const half = n - whole >= 0.5;
  if (!half) return String(whole);
  return whole === 0 ? "½" : `${whole}½`;
}
