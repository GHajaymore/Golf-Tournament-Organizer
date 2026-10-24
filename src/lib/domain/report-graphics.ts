/**
 * THE REPORT'S PICTURES (2026-10-23; Ajay: "make all the reports rich and add
 * some graphics … we need state of the art reports"; the panel's decision is
 * in `docs/final-report-every-format.md`, "The rich report").
 *
 * ONE hero graphic per format, chosen where the Rules make it mean something,
 * and at most the hole-difficulty strip beside it:
 *
 *   stroke play, 2+ rounds        the place after each round, top eight ("ladder")
 *   one round, 8+ cards           each hole's average GROSS against its par ("holes")
 *   Stableford                    the points, a bar each ("points")
 *   four-ball / better ball       the winning side's holes, whose ball counted ("side")
 *   foursomes / scramble          the winning side's own holes ("side")
 *   knockout                      the champion's path, round by round ("path")
 *   league                        the table with a dot a week ("weeks")
 *   casual round                  the settle-up card (drawn by the report itself)
 *
 * A GRAPHIC IS NEVER ITS OWN READER. Every builder here takes the rows the
 * report's table beside it is drawn from and returns them, ordered once, with
 * the figures already worded; the component draws the picture AND the table
 * from that one list (`report-graphics.spec.ts` reads both off the page and
 * requires the same names, order and figures). Nothing here ranks a field: a
 * place, a figure and an order arrive from the board.
 *
 * Pure, so it is tested by hand.
 */
import { placeIn, type MovementRound } from "./report-movement";
import type { HighlightRound } from "./report-highlights";
import { placeOrdinal } from "../format";
import { listWords } from "./final-report";

/* ------------------------------------------------------------------------ */
/*  The ladder: the place after each round                                   */
/* ------------------------------------------------------------------------ */

export interface LadderRow {
  name: string;
  /** "1", "T3", or "" where they had no place after that round — one per column. */
  places: string[];
}

export interface LadderGraphic {
  kind: "ladder";
  caption: string;
  /** "R1", "R2", … and the last column, "Final" or "Now". */
  columns: string[];
  rows: LadderRow[];
  /** The column a cut was made after ("R2"), or "" for none. */
  cutAfter: string;
}

/** The number in a place, for drawing: "T3" → 3, "" → 0. */
export function placeNumber(place: string): number {
  return Number(place.replace(/^T/, "")) || 0;
}

/**
 * The place after each round for the top eight of the board, in the board's
 * order. `final` is the board's own rows (its places, its order); `rounds` the
 * table after every round but the last, as the cut reads it. Null with fewer
 * than two rounds — a ladder of one column is a list.
 */
export function ladderGraphic(input: {
  rounds: ReadonlyArray<MovementRound>;
  final: ReadonlyArray<{ id: string; name: string; place: string }>;
  shortLabel: (label: string) => string;
  completed: boolean;
  cutAfterRound: string;
}): LadderGraphic | null {
  const earlier = input.rounds.slice(0, -1);
  const top = input.final.filter((r) => r.place).slice(0, 8);
  if (earlier.length === 0 || top.length < 2) return null;
  const columns = [...earlier.map((r) => input.shortLabel(r.label)), input.completed ? "Final" : "Now"];
  const rows = top.map((r) => ({
    name: r.name,
    places: [...earlier.map((round) => placeIn(round.rows, r.id)), r.place],
  }));
  const lead = rows[0];
  const led = lead.places.every((p) => placeNumber(p) === 1);
  const firstTop = lead.places.findIndex((p) => placeNumber(p) === 1);
  const from = lead.places[0];
  const caption = !input.completed
    ? led
      ? `${lead.name} has led after every round.`
      : `${lead.name} leads, ${from ? `from ${placeWords(from)} after ${columns[0]}` : "after a late start"}.`
    : led
      ? `${lead.name} led after every round.`
      : firstTop > 0 && firstTop < columns.length - 1
        ? `${lead.name} went top after ${columns[firstTop]} and stayed there.`
        : from
          ? `${lead.name} came from ${placeWords(from)} after ${columns[0]} to win.`
          : `${lead.name} won it in the last round.`;
  const cutAfter = input.cutAfterRound ? input.shortLabel(input.cutAfterRound) : "";
  return {
    kind: "ladder",
    caption,
    columns,
    rows,
    cutAfter: columns.includes(cutAfter) ? cutAfter : "",
  };
}

function placeWords(place: string): string {
  const n = placeNumber(place);
  return place.startsWith("T") ? `a share of ${placeOrdinal(n)}` : placeOrdinal(n);
}

/**
 * Where each row sits in a column of the drawing: its order among the eight
 * by that column's place (level places keep the board's order), so the lines
 * never sit on top of each other. The PLACE itself is printed in the mark.
 */
export function ladderOrder(rows: ReadonlyArray<LadderRow>, column: number): number[] {
  const keyed = rows.map((r, i) => ({
    i,
    n: placeNumber(r.places[column] ?? "") || Number.MAX_SAFE_INTEGER,
  }));
  const sorted = [...keyed].sort((a, b) => a.n - b.n || a.i - b.i);
  const at = new Array<number>(rows.length);
  sorted.forEach((k, slot) => {
    at[k.i] = slot;
  });
  return at;
}

/* ------------------------------------------------------------------------ */
/*  The hole-difficulty strip                                                */
/* ------------------------------------------------------------------------ */

export interface HoleCell {
  hole: number;
  par: number;
  /** "+0.8", "−0.2", "0.0" — the average gross against par, or "" with no score on it. */
  figure: string;
  /** The same, as a number for the shading; null with no score on it. */
  overPar: number | null;
  /** Average strokes, worded: "4.8". */
  average: string;
  scores: number;
}

export interface HoleStripGraphic {
  kind: "holes";
  caption: string;
  cells: HoleCell[];
  cards: number;
}

/** At least this many cards before a hole's average says anything. */
export const HOLE_STRIP_CARDS = 8;

/**
 * Each hole's average GROSS against its par, over one round's cards. A hole
 * nobody scored on (everybody picked up — `pickedUp`) has no figure and is
 * never the hardest. Null with fewer than eight cards, or no par on the card.
 */
export function holeStrip(round: HighlightRound): HoleStripGraphic | null {
  const returned = round.cards.filter((c) => c.strokes.some((s, i) => written(s) && !c.pickedUp?.[i]));
  if (returned.length < HOLE_STRIP_CARDS) return null;
  if (round.pars.slice(0, round.holes).some((p) => !(p > 0))) return null;
  const cells: HoleCell[] = [];
  for (let i = 0; i < round.holes; i += 1) {
    let sum = 0;
    let n = 0;
    for (const c of returned) {
      const s = c.strokes[i];
      if (!written(s) || c.pickedUp?.[i]) continue;
      sum += s;
      n += 1;
    }
    const par = round.pars[i];
    // In whole tenths, so the figure is the average it prints, less par — never
    // two roundings that can disagree ("3.5 on average", "+0.4").
    const tenths = n > 0 ? Math.round((sum * 10) / n) : null;
    const over = tenths === null ? null : (tenths - par * 10) / 10;
    cells.push({
      hole: round.firstHole + i,
      par,
      overPar: over,
      figure: over === null ? "" : toParFigure(over),
      average: tenths === null ? "" : (tenths / 10).toFixed(1),
      scores: n,
    });
  }
  const scored = cells.filter((c) => c.overPar !== null);
  if (scored.length < 2) return null;
  const hardest = scored.reduce((a, b) => ((b.overPar ?? 0) > (a.overPar ?? 0) ? b : a));
  const easiest = scored.reduce((a, b) => ((b.overPar ?? 0) < (a.overPar ?? 0) ? b : a));
  const caption =
    hardest === easiest
      ? `The ${placeOrdinal(hardest.hole)} played ${hardest.average} on average, a par ${hardest.par}.`
      : `The ${placeOrdinal(hardest.hole)} was the hardest, ${hardest.average} on average for a par ${hardest.par}; the ${placeOrdinal(easiest.hole)} the easiest, ${easiest.average} for a par ${easiest.par}.`;
  return { kind: "holes", caption, cells, cards: returned.length };
}

function written(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 1;
}

/** "+0.8", "−0.3", "0.0" — to one place, with a true minus. */
export function toParFigure(over: number): string {
  const r = Math.round(over * 10) / 10;
  if (r === 0) return "0.0";
  return `${r > 0 ? "+" : "−"}${Math.abs(r).toFixed(1)}`;
}

/** How a cell is drawn: solid under par, blank at par, outlined over it — never hue alone. */
export function holeTone(over: number | null): "under" | "level" | "over" | "none" {
  if (over === null) return "none";
  const r = Math.round(over * 10) / 10;
  return r < 0 ? "under" : r === 0 ? "level" : "over";
}

/* ------------------------------------------------------------------------ */
/*  The points ladder                                                        */
/* ------------------------------------------------------------------------ */

export interface PointsBar {
  place: string;
  name: string;
  points: number;
}

export interface PointsGraphic {
  kind: "points";
  caption: string;
  rows: PointsBar[];
  /** The longest bar's figure: every bar is drawn against it. */
  most: number;
}

/**
 * The top of a points board as bars, the figure at the end of each. The rows
 * are the board's own, in its order — the leaderboard's first rows.
 */
export function pointsGraphic(rows: ReadonlyArray<PointsBar>, completed: boolean): PointsGraphic | null {
  const top = rows.filter((r) => r.place).slice(0, 10);
  if (top.length < 2) return null;
  const most = Math.max(...top.map((r) => r.points));
  if (!(most > 0)) return null;
  const leaders = top.filter((r) => r.place === top[0].place);
  const next = top.find((r) => r.place !== top[0].place);
  const by = next ? top[0].points - next.points : 0;
  const who = listWords(leaders.map((l) => l.name));
  const caption =
    leaders.length > 1
      ? `${who} ${completed ? "finished" : "are"} level on ${top[0].points} points.`
      : by > 0
        ? `${who} ${completed ? "won" : "leads"} on ${top[0].points} points, ${by} clear.`
        : `${who} ${completed ? "won" : "leads"} on ${top[0].points} points, on countback.`;
  return { kind: "points", caption, rows: top, most };
}

/* ------------------------------------------------------------------------ */
/*  A side's holes                                                           */
/* ------------------------------------------------------------------------ */

/** A four-ball hole where both balls were the side's score. */
export const BOTH = "both";

export interface SideHole {
  hole: number;
  par: number;
  /** The side's score on the hole, as counted, or null where nobody holed out. */
  score: number | null;
  /** Whose ball counted — a name, `BOTH` where the partners were level, or "" on a shared ball. */
  by: string;
  /** The score against par, on the hole: −1 a birdie. Null with no score. */
  toPar: number | null;
}

export interface SideGraphic {
  kind: "side";
  caption: string;
  side: string;
  /** "Round 2" where there was more than one team round, else "". */
  round: string;
  /** "gross" or "net": which score the cells carry. */
  basis: string;
  holes: SideHole[];
  /** The partners, and how many holes each one's ball counted on. */
  counted: Array<{ name: string; holes: number }>;
}

/**
 * The winning side's card, hole by hole. On a four-ball each hole carries whose
 * ball counted (`playerId` off the side's card, as the board counted it); on a
 * shared ball, nobody's.
 */
export function sideGraphic(input: {
  side: string;
  round: string;
  basis: "gross" | "net" | "stableford";
  shared: boolean;
  firstHole: number;
  pars: ReadonlyArray<number>;
  holes: ReadonlyArray<{
    gross: number | null;
    net: number | null;
    playerId: string;
  }>;
  names: ReadonlyMap<string, string>;
  /**
   * Holes where the partners' balls were LEVEL on the counted score — on a
   * gross four-ball, off the members' own cards. Either ball counted there,
   * and naming one would credit a hole to a partner who merely went first.
   * Omitted where the caller cannot say (a net four-ball).
   */
  level?: ReadonlyArray<boolean>;
}): SideGraphic | null {
  const net = input.basis !== "gross";
  const holes: SideHole[] = input.holes.map((h, i) => {
    const score = net ? h.net : h.gross;
    const par = input.pars[i] ?? 0;
    return {
      hole: input.firstHole + i,
      par,
      score,
      by: input.shared ? "" : input.level?.[i] && score !== null ? BOTH : (input.names.get(h.playerId) ?? ""),
      toPar: score === null || !(par > 0) ? null : score - par,
    };
  });
  if (holes.filter((h) => h.score !== null).length < 2) return null;
  const partners = [...new Set(input.holes.map((h) => h.playerId).filter(Boolean))].map((id) => input.names.get(id) ?? "");
  const counted = input.shared ? [] : partners.map((name) => ({ name, holes: holes.filter((h) => h.by === name).length }));
  const both = holes.filter((h) => h.by === BOTH).length;
  const under = holes.filter((h) => h.toPar !== null && h.toPar < 0).length;
  const caption = input.shared
    ? `${input.side}: ${under === 0 ? "no hole" : under === 1 ? "one hole" : `${under} holes`} under par${net ? " net" : ""}.`
    : `${input.side}: ${[listWords(counted.filter((c) => c.holes > 0).map((c) => `${c.name}'s ball alone counted on ${c.holes}`)), both ? `level on ${both}` : ""]
        .filter(Boolean)
        .join("; ")}.`;
  return {
    kind: "side",
    caption,
    side: input.side,
    round: input.round,
    basis: net ? "net" : "gross",
    holes,
    counted,
  };
}

/* ------------------------------------------------------------------------ */
/*  A knockout: the champion's path                                          */
/* ------------------------------------------------------------------------ */

export interface PathStep {
  round: string;
  opponent: string;
  /** " 3&2", " at the 19th" — `marginWords`'s, with its leading space; "" for none. */
  margin: string;
  /** The champion was the lower seed — said only where the draw was seeded. */
  upset: boolean;
}

export interface PathGraphic {
  kind: "path";
  caption: string;
  champion: string;
  steps: PathStep[];
}

export function pathGraphic(input: {
  champion: { id: string; name: string; seed: number | null };
  rounds: ReadonlyArray<{
    label: string;
    matches: ReadonlyArray<{
      key: string;
      winnerId: string | null;
      a: { playerId: string | null; name: string; seed: number | null };
      b: { playerId: string | null; name: string; seed: number | null };
    }>;
  }>;
  margin: (key: string) => string;
  seeded: boolean;
}): PathGraphic | null {
  const steps: PathStep[] = [];
  for (const round of input.rounds) {
    const m = round.matches.find(
      (x) =>
        x.winnerId === input.champion.id && (x.a.playerId === input.champion.id || x.b.playerId === input.champion.id),
    );
    if (!m) continue;
    const other = m.a.playerId === input.champion.id ? m.b : m.a;
    // A bye is not a tie: nobody was beaten.
    if (!other.playerId) continue;
    const mine = m.a.playerId === input.champion.id ? m.a.seed : m.b.seed;
    steps.push({
      round: round.label,
      opponent: other.name,
      margin: input.margin(m.key),
      upset: input.seeded && mine !== null && other.seed !== null && mine > other.seed,
    });
  }
  if (steps.length === 0) return null;
  const last = steps[steps.length - 1];
  const upsets = steps.filter((s) => s.upset).length;
  const caption = `${input.champion.name} won ${steps.length === 1 ? "one tie" : `${steps.length} ties`}, beating ${last.opponent} in the ${last.round.toLowerCase().replace(/s$/, "")}${last.margin}.${upsets > 0 ? ` ${upsets === 1 ? "One" : upsets} against a higher seed.` : ""}`;
  return { kind: "path", caption, champion: input.champion.name, steps };
}

/* ------------------------------------------------------------------------ */
/*  A league: the table, with a dot a week                                   */
/* ------------------------------------------------------------------------ */

export interface WeekRow {
  place: string;
  name: string;
  /** The board's figure: "112", "6½". */
  points: string;
  played: number;
  /** One per week played: did they play it. */
  weeks: boolean[];
  /** Places moved in the last week: +2 up, −1 down, 0 none or new. */
  move: number;
}

export interface WeeksGraphic {
  kind: "weeks";
  caption: string;
  /** "Wk 1", "Wk 2", … one per week somebody played. */
  columns: string[];
  rows: WeekRow[];
  /** "Points" or "Match points": the figure's name. */
  unit: string;
}

export function weeksGraphic(input: {
  rows: ReadonlyArray<WeekRow>;
  columns: string[];
  unit: string;
  completed: boolean;
}): WeeksGraphic | null {
  const rows = input.rows.filter((r) => r.place).slice(0, 12);
  if (rows.length < 2 || input.columns.length < 2) return null;
  const everyWeek = input.rows.filter((r) => r.weeks.length > 0 && r.weeks.every(Boolean)).length;
  const caption = `${rows[0].name} ${input.completed ? "topped" : "tops"} the table on ${rows[0].points}. ${
    everyWeek === 0
      ? "Nobody played every week."
      : everyWeek === 1
        ? "One player played every week."
        : `${everyWeek} players played every week.`
  }`;
  return {
    kind: "weeks",
    caption,
    columns: input.columns,
    rows,
    unit: input.unit,
  };
}

/** ▲2, ▼1 — a move in words a screen reader says. */
export function moveWords(move: number): string {
  if (move > 0) return `up ${move}`;
  if (move < 0) return `down ${-move}`;
  return "no change";
}

export type HeroGraphic = LadderGraphic | HoleStripGraphic | PointsGraphic | SideGraphic | PathGraphic | WeeksGraphic;
