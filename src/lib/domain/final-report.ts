/**
 * THE FINAL REPORT'S ARITHMETIC (2026-10-19) — pure, so it is tested by hand.
 *
 * Ajay, after the first real cup: "close the CVC vs CDG cup and provide me the
 * final report which app generates with all the tournament details", then
 * "whatever you are doing, the actual app should do it". The report reads the
 * cup board (`cupBoard`) and works three things out of it here:
 *
 *   each player's record   a match is worth its points to EVERY player on the
 *                          side that took them — a four-ball win is a point
 *                          each to two partners — so these add up to more than
 *                          the cup score, which counts each match once
 *   the stars              players unbeaten across at least two matches: every
 *                          match played, every one won
 *   the points track       the cup's points as half-point cells, so a halved
 *                          match and a half-point outside the matches draw
 *
 * Only DECIDED matches count. A report is made when the cup is over, but the
 * rule must hold on the day too: a match two up is not a point to anybody.
 */
export type ReportSide = "A" | "B";

export interface ReportMatch {
  /** The names on each side, team A's first. */
  a: string[];
  b: string[];
  /** Points to each side once decided: 1/0, ½/½; and whether it is decided. */
  points: [number, number];
  final: boolean;
  /** "3&2", "1 UP", "A/S", "Conceded". */
  label: string;
}

export interface ReportSession {
  name: string;
  matches: ReportMatch[];
}

export interface PlayerRecord {
  name: string;
  side: ReportSide;
  played: number;
  points: number;
}

export interface Star {
  name: string;
  side: ReportSide;
  played: number;
  /** How each match was won, session by session: "Four-ball 3&2", "Singles 1 up". */
  how: string[];
}

/** Every player's decided matches and points, best first, then by name. */
export function playerRecords(sessions: ReportSession[]): PlayerRecord[] {
  const by = new Map<string, PlayerRecord>();
  const note = (name: string, side: ReportSide, pts: number) => {
    const key = `${side}:${name}`;
    const r = by.get(key) ?? { name, side, played: 0, points: 0 };
    r.played += 1;
    r.points += pts;
    by.set(key, r);
  };
  for (const s of sessions) {
    for (const m of s.matches) {
      if (!m.final) continue;
      for (const n of m.a) note(n, "A", m.points[0]);
      for (const n of m.b) note(n, "B", m.points[1]);
    }
  }
  return [...by.values()].sort((x, y) => y.points - x.points || x.name.localeCompare(y.name));
}

/** Players who played at least two decided matches and won every one. */
export function stars(sessions: ReportSession[]): Star[] {
  const records = playerRecords(sessions).filter((r) => r.played >= 2 && r.points === r.played);
  return records.map((r) => ({
    name: r.name,
    side: r.side,
    played: r.played,
    how: sessions.flatMap((s) =>
      s.matches
        .filter((m) => m.final && (r.side === "A" ? m.a : m.b).includes(r.name))
        .map((m) => `${sessionWord(s.name)} ${marginWords(m.label)}`),
    ),
  }));
}

/** A session's name as one match of it: "Four-balls" → "Four-ball"; singles stay "Singles". */
function sessionWord(name: string): string {
  if (/singles/i.test(name)) return name;
  return name.replace(/s$/i, "");
}

/** "1 UP" → "1 up"; a result as it reads in a sentence. */
export function marginWords(label: string): string {
  if (label === "A/S") return "halved";
  return label.replace(/\bUP\b/, "up");
}

/**
 * The cup's points as half-point cells: side A's, side B's in the matches, the
 * points outside the matches that have been given (in award order, so a point
 * to B reads after B's matches), and anything still undecided last.
 */
export function pointsTrack(input: {
  a: number;
  b: number;
  /** Points outside the matches already awarded, and to whom. */
  outside: Array<{ side: ReportSide | null; points: number }>;
  /** Every point in the cup, matches and outside alike. */
  inPlay: number;
}): { a: number; b: number; outside: number; open: number; cells: number } {
  const half = (n: number) => Math.round(n * 2);
  const outsideAwarded = input.outside.filter((o) => o.side !== null).reduce((t, o) => t + o.points, 0);
  const outsideToA = input.outside.filter((o) => o.side === "A").reduce((t, o) => t + o.points, 0);
  const outsideToB = input.outside.filter((o) => o.side === "B").reduce((t, o) => t + o.points, 0);
  const cells = half(input.inPlay);
  const a = half(input.a - outsideToA);
  const b = half(input.b - outsideToB);
  const outside = half(outsideAwarded);
  return { a, b, outside, open: Math.max(0, cells - a - b - outside), cells };
}
