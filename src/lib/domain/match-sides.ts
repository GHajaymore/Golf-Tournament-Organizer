import { distinctLabels } from "@/lib/format";

/**
 * WHAT A MATCH CARD CALLS ITS TWO SIDES — one rule, for every card that keeps a
 * match hole by hole (`MatchKeeper`, `MatchStrokeKeeper`), on the round-code page,
 * in the player app and at the desk.
 *
 * THE CARD NEVER TURNS ROUND (2026-11-04). At a real team cup on 18 Oct two
 * scorers tapped a name from the OPPOSING pair on `/play`. The card made the
 * tapped name's side "side A" and turned the match round to face it, so the
 * scorer's own pair sat where the other pair had been, and they pressed the
 * button in the place they took to be their own: every hole they won went on
 * the board as a win for the other side. So:
 *
 *   - side A is the match's A side in DRAW ORDER (`match.teamAId` / `playerAId`),
 *     whoever is holding the phone; nothing on the card asks who that is;
 *   - the answers carry NAMES, never "me", "us" or "them": a team cup's two
 *     teams ("CVC won · Halved · CDG won"), otherwise the players — a pair as
 *     "Rakesh & Snehal", a single as one first name — widened only where two
 *     clash (`distinctLabels`).
 */
export interface MatchSides {
  /** Full names: the heading and what a screen reader says. */
  aName: string;
  bName: string;
  /** Each side's players, full names, in the side's own order. Absent: the side's name stands for them. */
  aPlayers?: string[];
  bPlayers?: string[];
  /** In a team cup, the cup team each side plays for. Empty elsewhere. */
  aTeam?: string;
  bTeam?: string;
  /** A match between two sides (a four-ball or foursomes pair), whose name may be "Ann & Bea". */
  side?: boolean;
}

/** The two sides as the card's answers name them, A first. */
export function matchSideLabels(m: MatchSides): [string, string] {
  const aTeam = (m.aTeam ?? "").trim();
  const bTeam = (m.bTeam ?? "").trim();
  // A cup is won by teams: the scorer is on one, and the team is the word they use.
  if (aTeam && bTeam && aTeam !== bTeam) return [aTeam, bTeam];
  const playersOf = (players: string[] | undefined, name: string) =>
    players && players.length > 0 ? players : m.side ? name.split(" & ") : [name];
  const a = playersOf(m.aPlayers, m.aName);
  const b = playersOf(m.bPlayers, m.bName);
  const short = distinctLabels([...a, ...b]);
  return [short.slice(0, a.length).join(" & "), short.slice(a.length).join(" & ")];
}

/** The answer that gives a hole, or the match, to one side: "CVC won", "Rakesh & Snehal won". */
export function wonBy(label: string): string {
  return `${label} won`;
}

/**
 * The letter or two marking each side's holes on the card's strip of hole
 * numbers, so the strip reads in sunlight without knowing which tint is whose.
 * It said W and L — won and lost from the holder's side — which is a card that
 * turns round. Now the winner's initials: "CVC" v "CDG" is CV / CD, a pair
 * "Rakesh & Snehal" is RS; never the same mark for both sides.
 */
export function sideMarks(a: string, b: string): [string, string] {
  const words = (s: string) => s.split(/\s+/).filter((w) => w !== "" && w !== "&");
  const initials = (s: string) => words(s).map((w) => w[0].toUpperCase()).join("").slice(0, 3);
  let [x, y] = [initials(a), initials(b)];
  for (let n = 2; x === y && n <= 3; n++) {
    const lead = (s: string) => (words(s)[0] ?? "").slice(0, n).toUpperCase();
    [x, y] = [lead(a), lead(b)];
  }
  return x && y && x !== y ? [x, y] : ["1", "2"];
}
