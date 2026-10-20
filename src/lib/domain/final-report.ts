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
 * The cup's points as half-point cells, drawn from both ends: side A's from
 * the left, side B's from the right, each team's points outside the matches
 * at its own outer end, and anything still undecided in the middle.
 *
 *     [A outside][A matches][  open  ][B matches][B outside]
 *
 * `a` and `b` are the TALLY — matches and outside points together, as
 * `cupTally` counts them — so the outside points are taken back out of them.
 */
export function pointsTrack(input: {
  a: number;
  b: number;
  /** Points outside the matches, and who has them (null: not yet decided). */
  outside: Array<{ side: ReportSide | null; points: number }>;
  /** Every point in the cup, matches and outside alike. */
  inPlay: number;
}): { a: number; b: number; outsideA: number; outsideB: number; open: number; cells: number } {
  const half = (n: number) => Math.round(n * 2);
  const to = (side: ReportSide) => input.outside.filter((o) => o.side === side).reduce((t, o) => t + o.points, 0);
  const cells = half(input.inPlay);
  const outsideA = half(to("A"));
  const outsideB = half(to("B"));
  const a = half(input.a) - outsideA;
  const b = half(input.b) - outsideB;
  return { a, b, outsideA, outsideB, open: Math.max(0, cells - a - b - outsideA - outsideB), cells };
}

/* ------------------------------------------------------------------------ */
/*  The words                                                               */
/* ------------------------------------------------------------------------ */

const SMALL = [
  "no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen",
  "nineteen", "twenty",
];

/** A count as a golfer writes it in a sentence: words to twenty, figures after. */
export function countWords(n: number): string {
  return Number.isInteger(n) && n >= 0 && n < SMALL.length ? SMALL[n] : String(n);
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "A, B and C". */
export function listWords(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Half points as the scoreboard writes them: 5½, ½, 10. */
export function halves(n: number): string {
  const whole = Math.floor(n);
  if (n - whole < 0.5) return String(whole);
  return whole === 0 ? "½" : `${whole}½`;
}

/**
 * A session's name inside a sentence. A plain format word is a common noun —
 * "the four-balls", "the singles" — while a name the club gave it is a
 * proper one and keeps its capitals: "Saturday Foursomes".
 */
export function sessionInSentence(name: string): string {
  return /^(four-?balls?|foursomes|singles|greensomes|scrambles?|chapmans?)$/i.test(name.trim())
    ? `the ${name.trim().toLowerCase()}`
    : name.trim();
}

/** Which holes a round is played over: "back nine", "front nine", "18 holes". */
export function nineWords(holes: number, nine: string): string {
  if (holes === 9) return nine === "back" ? "back nine" : nine === "front" ? "front nine" : "nine holes";
  return `${holes} holes`;
}

/**
 * A session as the format line of a cup programme: "Net four-ball, back
 * nine". Anything not gross is played off handicaps, so it reads as net.
 */
export function sessionDescription(s: { kind: string; basis: string; holes: number; nine: string }): string {
  return `${s.basis === "gross" ? "Gross" : "Net"} ${s.kind.toLowerCase()}, ${nineWords(s.holes, s.nine)}`;
}

/** How the matches were kept, as one fact: tapped hole by hole, or from stroke cards. */
export function scoringWords(keptBy: Array<"holes" | "cards">): string {
  const holes = keptBy.includes("holes");
  const cards = keptBy.includes("cards");
  if (holes && cards) return "Hole by hole, and from stroke cards";
  return cards ? "From stroke cards, hole by hole" : "Hole by hole";
}

export type ReportVerdict =
  | { kind: "won"; by: ReportSide }
  | { kind: "retained"; by: ReportSide }
  | { kind: "tied" }
  | { kind: "open" };

export interface ReportStoryInput {
  teams: [string, string];
  /** The cup's score, matches and outside points together. */
  score: [number, number];
  verdict: ReportVerdict;
  sessions: ReportSession[];
  outside: Array<{ label: string; points: number; side: ReportSide | null }>;
}

/** The line under the score: "CDG win the cup". Empty while it is undecided. */
export function reportRibbon(input: Pick<ReportStoryInput, "teams" | "verdict">): string {
  const v = input.verdict;
  const name = (s: ReportSide) => input.teams[s === "A" ? 0 : 1];
  if (v.kind === "won") return `${name(v.by)} win the cup`;
  if (v.kind === "retained") return `${name(v.by)} retain the cup`;
  if (v.kind === "tied") return "The cup is shared";
  return "";
}

/**
 * THE STORY, written from the results alone — the report's recap until the
 * organizer writes their own. Every sentence is a fact the board holds: who
 * won and by how much, each session's score, who won every match they played,
 * how many went to the last hole, and who took each point outside the matches.
 * Nothing a result cannot show (the weather, a delay, a great shot) is guessed
 * at; that is what the organizer's own recap is for.
 */
export function reportStory(input: ReportStoryInput): string[] {
  const name = (s: ReportSide) => input.teams[s === "A" ? 0 : 1];
  const [sa, sb] = input.score;
  const v = input.verdict;
  const first: string[] = [];
  if (v.kind === "won" || v.kind === "retained") {
    const w = v.by === "A" ? sa : sb;
    const l = v.by === "A" ? sb : sa;
    first.push(
      v.kind === "won"
        ? `${name(v.by)} won the cup ${halves(w)} – ${halves(l)}.`
        : `${name(v.by)} retained the cup, ${halves(w)} – ${halves(l)}.`,
    );
  } else if (v.kind === "tied") {
    first.push(`The cup finished level, ${halves(sa)} – ${halves(sb)}.`);
  } else {
    first.push(`${name("A")} ${halves(sa)}, ${name("B")} ${halves(sb)}, with the cup still to be decided.`);
  }

  // Each session's result, and sessions in a row taken by the same team are
  // said once: "Whites took the four-balls 1 – 0 and the foursomes 1 – 0, and
  // Blues took the singles", never "Whites took …, Whites took …".
  const groups: Array<{ winner: ReportSide | null; items: string[] }> = [];
  for (const s of input.sessions) {
    const decided = s.matches.filter((m) => m.final);
    if (decided.length === 0) continue;
    const a = decided.reduce((t, m) => t + m.points[0], 0);
    const b = decided.reduce((t, m) => t + m.points[1], 0);
    const what = sessionInSentence(s.name);
    if (a === b) {
      groups.push({ winner: null, items: [`${what} ${/^the /.test(what) ? "were" : "was"} shared ${halves(a)} – ${halves(b)}`] });
      continue;
    }
    const winner: ReportSide = a > b ? "A" : "B";
    const item = `${what} ${halves(Math.max(a, b))} – ${halves(Math.min(a, b))}`;
    const last = groups[groups.length - 1];
    if (last && last.winner === winner) last.items.push(item);
    else groups.push({ winner, items: [item] });
  }
  const said = groups.map((g) => (g.winner ? `${name(g.winner)} took ${listWords(g.items)}` : g.items[0]));
  if (said.length) {
    // With a list inside a clause, a comma keeps the clauses apart.
    const joined = groups.some((g) => g.items.length > 1)
      ? said.length === 1
        ? said[0]
        : `${said.slice(0, -1).join(", ")}, and ${said[said.length - 1]}`
      : listWords(said);
    first.push(`${capital(joined)}.`);
  }

  const second: string[] = [];
  const unbeaten = stars(input.sessions);
  if (unbeaten.length) {
    const bySide = (["A", "B"] as const)
      .map((side) => ({ side, names: unbeaten.filter((s) => s.side === side).map((s) => s.name) }))
      .filter((g) => g.names.length);
    const who = listWords(bySide.map((g) => `${listWords(g.names)} for ${name(g.side)}`));
    second.push(
      unbeaten.length === 1
        ? `${who.replace(/ for /, ", for ")}, won every match they played.`
        : `${capital(countWords(unbeaten.length))} players won every match they played: ${who}.`,
    );
  }
  const distance = input.sessions
    .flatMap((s) => s.matches)
    .filter((m) => m.final && m.label !== "Conceded" && !m.label.includes("&")).length;
  if (distance >= 2) second.push(`${capital(countWords(distance))} matches went to the last hole.`);
  for (const o of input.outside) {
    if (!o.side) continue;
    const label = /^[A-Z][a-z]/.test(o.label) ? o.label.charAt(0).toLowerCase() + o.label.slice(1) : o.label;
    const worth = o.points === 1 ? "" : `, worth ${halves(o.points)} points`;
    second.push(`The ${label} went to ${name(o.side)}${worth}.`);
  }
  return [first.join(" "), second.join(" ")].filter(Boolean);
}

/* ------------------------------------------------------------------------ */
/*  Every other tournament: a champion, not a cup score                      */
/* ------------------------------------------------------------------------ */

/** What a board ranks on, as the board itself decides it (see `rankedScore`). */
export interface RankBasis {
  isStroke: boolean;
  isStableford: boolean;
  isNet: boolean;
}

/**
 * The figure a finishing place was won on, in words: "net 66", "gross 72",
 * "38 points", "4 match points". Read off the same row and the same basis the
 * board ranks on, so the report cannot name a different figure from the board.
 */
export function placeFigure(
  row: { gross: number; net: number; points: number; pts: string },
  basis: RankBasis,
): string {
  if (!basis.isStroke) return `${row.pts || "0"} match points`;
  if (basis.isStableford) return `${row.points} points`;
  return basis.isNet ? `net ${row.net}` : `gross ${row.gross}`;
}

/**
 * A SIDE's figure in a team round, on the basis that round is decided on
 * (`WeekBasis`): "41 points", "net 62", "gross 70".
 */
export function sideFigure(row: { gross: number; net: number; points: number }, basis: "stableford" | "gross" | "net"): string {
  if (basis === "stableford") return `${row.points} points`;
  return basis === "net" ? `net ${row.net}` : `gross ${row.gross}`;
}

/** A finishing place: who holds it — one name, or several when it is shared — and on what. */
export interface Place {
  names: string[];
  figure: string;
}

/**
 * The line under the champion's name. A tie at the top is never broken here:
 * the committee settles it (a countback, a play-off, a shared title), and the
 * report says only what is true — that the place is shared. Nothing while the
 * tournament is still being played.
 */
export function eventRibbon(input: { completed: boolean; first: Place | null }): string {
  if (!input.completed || !input.first || input.first.names.length === 0) return "";
  return input.first.names.length === 1 ? "Champion" : "Shared first place";
}

/**
 * THE STORY OF A TOURNAMENT, told from the results alone, until the organizer
 * writes their own: who won and on what, who was second, and — where there was
 * more than one round — each round's result as the board words it. Nothing a
 * result cannot show is guessed at.
 */
export function eventStory(input: {
  completed: boolean;
  first: Place | null;
  second: Place | null;
  /** Each round's result, one sentence a round (`resultLinesFor`); said only where there were several. */
  rounds: Array<{ label: string; result: string }>;
}): string[] {
  const out: string[] = [];
  const { first, second } = input;
  if (first && first.names.length > 0) {
    const who = listWords(first.names);
    const several = first.names.length > 1;
    const lead: string[] = [];
    // A knockout's places are won in matches, not on a figure: " on …" only where there is one.
    const on = (p: Place) => (p.figure ? ` on ${p.figure}` : "");
    if (!input.completed) {
      lead.push(`${who} ${several ? "lead" : "leads"}${on(first)}, with the tournament still to finish.`);
    } else if (several) {
      lead.push(`${who} finished level at the top${on(first)}. A tie for first place is the committee's to settle.`);
    } else if (second && first.figure && second.figure === first.figure) {
      // Level on the figure and still placed apart: the board's countback
      // decided it. Said, so "won on gross 74 … second, on gross 74" never
      // reads as one equal score beating another.
      lead.push(`${who} won${on(first)}, ahead of ${listWords(second.names)} on countback.`);
      out.push(lead.join(" "));
      if (input.rounds.length > 1) {
        out.push(input.rounds.map((r) => `${r.label}: ${r.result.replace(/\.?$/, ".")}`).join(" "));
      }
      return out;
    } else {
      lead.push(`${who} won${on(first)}.`);
    }
    if (second && second.names.length > 0 && !(several && input.completed)) {
      const by = second.figure ? `, on ${second.figure}` : "";
      lead.push(
        second.names.length === 1
          ? `${second.names[0]} was ${input.completed ? "second" : "next"}${by}.`
          : `${listWords(second.names)} ${input.completed ? "shared second" : "are next"}${by}.`,
      );
    }
    out.push(lead.join(" "));
  }
  if (input.rounds.length > 1) {
    out.push(input.rounds.map((r) => `${r.label}: ${r.result.replace(/\.?$/, ".")}`).join(" "));
  }
  return out;
}
