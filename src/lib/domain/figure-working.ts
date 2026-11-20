/**
 * EVERY FIGURE EXPLAINS ITSELF (2026-10-24) — the panel's first item before
 * launch, ranked first by all five of them: a player or a secretary taps a
 * figure and is told, in one sentence, how it was worked out and which Rule it
 * follows.
 *
 * ONE RULE, ONE PLACE is the whole design. Every function here either computes
 * the figure itself and hands back the sentence beside it — `strokesOnHole`
 * calls `holeStrokesReceived`, `cardFigures` is the card's own totals,
 * `pointsOnHole` calls the very per-hole tables `cardPoints` adds up — or it
 * words a result another function already decided and returns (a countback's
 * `CountbackDecision`, a round's handicap parts from
 * `playingHandicapPartsInRound`). Nothing here works a figure out a second way,
 * so the sentence cannot disagree with the number beside it: they are one call.
 *
 * `figure-working.test.ts` reads every sentence back as a golfer would — takes
 * the numbers out of the words and does the arithmetic by the Rule — and holds
 * it to the figure on the screen.
 *
 * The citation is said in words beside the sentence, never linked: a figure is
 * read on a tee, and the Rules are a long way from there.
 */
import { holeStrokesReceived, stablefordPointsForHole, modifiedStablefordForHole, toParText } from "./stroke";
import { holesPlayed, wholeStrokes } from "./handicap";
import type { CountbackDecision } from "./stroke-countback";
import type { HandicapSource } from "./round-handicap";
import { cardPoints, type PointsTable } from "./card-points";
import { holeNumber } from "./hole-number";
import { DEFAULT_LOCALE } from "./locale";

/** One sentence of working, and the Rule it follows. */
export interface Working {
  says: string;
  cite: string;
}

/** The Rules the figures follow, in the words a sentence ends with. */
export const CITE = {
  allocation: "Rules of Handicapping, Appendix E",
  playing: "Rules of Handicapping, Rule 6.2a and Appendix C",
  playingWithPars: "Rules of Handicapping, Rules 6.2a and 6.2b, Appendix C",
  stableford: "Rules of Golf, Rule 21.1b",
  modified: "the tournament's Modified Stableford table",
  countback: "Committee Procedures, Section 5A",
  disqualified: "Rules of Golf, Rule 1.3c",
  noReturn: "Rules of Golf, Rule 3.3b",
  stoppedShort: "Rules of Golf, Rule 3.2b",
  terms: "the terms of the competition",
} as const;

/** A handicap as golf writes one: a plus handicap is "+2", never "-2". */
export function handicapText(n: number): string {
  return n < 0 ? `+${-n}` : `${n}`;
}

/**
 * A figure that is not a whole number, to two places, in the club's own way of
 * writing a decimal — and CUT, never rounded, toward minus infinity.
 *
 * Cut so that the reader's own rounding of the printed figure lands where the
 * app's rounding of the exact one did: a figure of 13.4999… printed "13.50"
 * would be read as 14 by anybody checking, where the Rule (and the app) said 13.
 * Every half-way point is a whole number of hundredths, so a figure cut to two
 * places is on the same side of it as the figure itself. The sliver is
 * `wholeStrokes`'s: a figure that is exactly a half in arithmetic and arrives a
 * hair under it is a half.
 */
export function twoPlaces(n: number, locale: string = DEFAULT_LOCALE): string {
  const whole = Math.round(n);
  if (Math.abs(n - whole) < 1e-9) return handicapText(whole);
  const cut = Math.floor((n + 1e-9) * 100) / 100;
  // One place where the second is a nought ("24.6", not "24.60"): the same
  // figure, so the reader's rounding of it is unchanged.
  const text = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 2,
    useGrouping: false,
  }).format(Math.abs(cut));
  return cut < 0 ? `+${text}` : text;
}

const strokesWord = (n: number) => (n === 1 ? "a stroke" : `${n} strokes`);
const times = (n: number) => (n === 1 ? "one" : n === 2 ? "two" : n === 3 ? "three" : `${n}`);

/** Where a playing handicap's strokes go, in a clause. */
function spreadOf(playing: number, n: 9 | 18): string {
  if (playing === 0) return "a playing handicap of 0 receives no strokes";
  const nine = n === 9 ? " of these nine holes" : "";
  if (playing > 0) {
    const laps = Math.floor(playing / n);
    const rest = playing % n;
    const span = rest === 1 ? "stroke index 1" : `stroke index 1 to ${rest}`;
    if (laps === 0) return `its ${playing} ${playing === 1 ? "stroke goes" : "strokes go one a hole"} on ${span}${nine}`;
    if (rest === 0) return `its ${playing} strokes are ${times(laps)} on every hole${nine}`;
    return `its ${playing} strokes are ${times(laps)} on every hole${nine} and one more on ${span}`;
  }
  const given = -playing;
  const laps = Math.floor(given / n);
  const rest = given % n;
  const span = rest === 1 ? `stroke index ${n}` : `stroke index ${n - rest + 1} to ${n}`;
  const back = `a plus handicap gives ${given === 1 ? "its stroke" : `its ${given} strokes`} back from the easiest hole`;
  if (laps === 0) return `${back}, on ${span}${nine}`;
  if (rest === 0) return `${back}, ${times(laps)} on every hole${nine}`;
  return `${back}, ${times(laps)} on every hole${nine} and one more on ${span}`;
}

/**
 * THE STROKES A PLAYER RECEIVES ON ONE HOLE — the dot in the score box — and
 * why.
 *
 * `holes` is the round's length: nine-hole rounds spread a nine-hole playing
 * handicap over nine stroke indexes, 1 to 9 (`allocationHoles`). The card's
 * dots are drawn from `shots` here, and the server allocates them through this
 * function, so a dot and its sentence are one call.
 */
export function strokesOnHole(playing: number, strokeIndex: number, holes: number): { shots: number } & Working {
  const n = holesPlayed(holes);
  const p = Math.round(playing);
  const shots = holeStrokesReceived(p, strokeIndex, n);
  const lead =
    shots > 0
      ? `You get ${strokesWord(shots)} here`
      : shots < 0
        ? `You give ${strokesWord(-shots)} back here`
        : "No stroke here";
  return {
    shots,
    says: `${lead}: your playing handicap is ${handicapText(p)} and this hole is stroke index ${strokeIndex}${
      n === 9 ? " of nine" : ""
    }, and ${spreadOf(p, n)}.`,
    cite: CITE.allocation,
  };
}

/** What a round's playing handicap was priced from — `playingHandicapPartsInRound`. */
export interface HandicapParts {
  /** The figure before the allowance was taken (`resolved.exact`). */
  courseExact: number;
  /** Where that figure came from. */
  source: HandicapSource;
  /** The allowance in force, as a percentage. */
  allowance: number;
  /** Strokes for playing tees of a higher par (Rule 6.2b), or nought. */
  parStrokes: number;
  /** The playing handicap those make. */
  playing: number;
}

/**
 * HOW A ROUND'S PLAYING HANDICAP WAS WORKED OUT, from the parts the round was
 * priced with. The arithmetic is the Rule's — the allowance of the unrounded
 * figure, rounded once, then the strokes for the pars — and every number in the
 * sentence is one of the parts, so the sentence's own arithmetic gives `playing`.
 */
export function playingHandicapWorking(parts: HandicapParts, locale: string = DEFAULT_LOCALE): Working {
  const base =
    parts.source === "override"
      ? `the committee's figure of ${handicapText(Math.round(parts.courseExact))} for this round`
      : parts.source === "frozen"
        ? `your course handicap of ${twoPlaces(parts.courseExact, locale)}, as it stood when this round's first card came in`
        : `your course handicap of ${twoPlaces(parts.courseExact, locale)}`;
  const share = (parts.courseExact * parts.allowance) / 100;
  const whole = wholeStrokes(share);
  const pars =
    parts.parStrokes !== 0
      ? `, and ${parts.parStrokes} more for playing tees of a higher par than the lowest in the field`
      : "";
  const priced =
    parts.allowance === 100
      ? Number.isInteger(parts.courseExact)
        ? `${base}`
        : `${base}, rounded once to ${handicapText(whole)}`
      : `${parts.allowance}% of ${base}: ${twoPlaces(share, locale)}, rounded once to ${handicapText(whole)}`;
  return {
    says: `Your playing handicap of ${handicapText(parts.playing)} is ${priced}${pars}.`,
    cite: parts.parStrokes !== 0 ? CITE.playingWithPars : CITE.playing,
  };
}

/** A card's figures over the holes PLAYED — the totals every card prints. */
export interface CardFigures {
  gross: number;
  played: number;
  /** Par for the holes played. */
  parThru: number;
  /** Strokes received on the holes played (negative for a plus handicap). */
  received: number;
  net: number;
}

/**
 * THE CARD'S TOTALS — gross, par, strokes received and net over the holes
 * actually played, the rule the board totals by (`aggregateStroke`): net is the
 * gross less the strokes received on the holes played, rounded once.
 *
 * This is the one place the card works it out; the scorecard's totals row and
 * the running strip above the hole both print these figures, and the net
 * sentence is worded from the same object.
 */
export function cardFigures(
  strokes: readonly (number | null)[],
  pars: readonly number[],
  shotsPerHole: readonly number[],
  holes: number,
): CardFigures {
  let gross = 0;
  let played = 0;
  let parThru = 0;
  let received = 0;
  for (let i = 0; i < holes; i += 1) {
    const s = strokes[i];
    if (typeof s !== "number" || !Number.isFinite(s) || s <= 0) continue;
    gross += s;
    played += 1;
    parThru += pars[i] ?? 0;
    received += shotsPerHole[i] ?? 0;
  }
  return { gross, played, parThru, received, net: gross - Math.round(received) };
}

/**
 * THE NET SCORE, AND HOW IT WAS REACHED: the gross less the strokes received,
 * and — where the round's parts are known — how the playing handicap those
 * strokes come from was worked out. Null with nothing played.
 */
export function netWorking(
  fig: CardFigures,
  holes: number,
  playing: number,
  parts?: HandicapParts | null,
  locale: string = DEFAULT_LOCALE,
): Working | null {
  if (fig.played === 0) return null;
  const received = Math.round(fig.received);
  const all = fig.played >= holes && received === playing;
  const sum = all
    ? playing >= 0
      ? `Gross ${fig.gross} − playing handicap ${playing} = net ${fig.net}.`
      : `Gross ${fig.gross} + ${-playing} for a playing handicap of ${handicapText(playing)} = net ${fig.net}.`
    : received >= 0
      ? `Gross ${fig.gross} − the ${received} ${received === 1 ? "stroke" : "strokes"} you receive on the ${fig.played} ${
          fig.played === 1 ? "hole" : "holes"
        } played = net ${fig.net}.`
      : `Gross ${fig.gross} + the ${-received} ${-received === 1 ? "stroke" : "strokes"} you give back on the ${fig.played} ${
          fig.played === 1 ? "hole" : "holes"
        } played = net ${fig.net}.`;
  if (!parts) return { says: sum, cite: CITE.allocation };
  const ph = playingHandicapWorking(parts, locale);
  return { says: `${sum} ${ph.says}`, cite: ph.cite };
}

/**
 * STABLEFORD POINTS ON ONE HOLE, through the same per-hole tables
 * `cardPoints` adds up, with the net they were scored off.
 */
export function pointsOnHole(
  gross: number,
  par: number,
  shots: number,
  table: PointsTable,
): { points: number; net: number } & Working {
  const net = gross - shots;
  const points =
    table === "modified" ? modifiedStablefordForHole(gross, par, shots) : stablefordPointsForHole(gross, par, shots);
  const from =
    shots === 0
      ? `Net ${net} on a par ${par}`
      : shots > 0
        ? `${gross} less ${strokesWord(shots)} received is net ${net} on a par ${par}`
        : `${gross} and ${strokesWord(-shots)} given back is net ${net} on a par ${par}`;
  const pts = `${points} ${Math.abs(points) === 1 ? "point" : "points"}`;
  if (table === "modified") {
    return {
      points,
      net,
      says: `${from}: ${pts}, on the scale of 8 for an albatross, 5 an eagle, 2 a birdie, 0 a par, −1 a bogey and −3 anything worse.`,
      cite: CITE.modified,
    };
  }
  const why =
    points === 0
      ? " — a net double bogey or worse scores nothing"
      : `: 2 for a net par, ${net < par ? "one more for each stroke under" : net > par ? "one fewer for the stroke over" : "and this is one"}`;
  return { points, net, says: `${from}: ${pts}${why}.`, cite: CITE.stableford };
}

/** "1st", "2nd", "3rd", "4th" — a place, as a results sheet says it. */
export function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const s = teen ? "th" : n % 10 === 1 ? "st" : n % 10 === 2 ? "nd" : n % 10 === 3 ? "rd" : "th";
  return `${n}${s}`;
}

const stepWords = (n: number) => (n === 1 ? "the last hole" : `the last ${n} holes`);

function listSteps(steps: readonly number[]): string {
  const words = steps.map((n) => (n === 1 ? "the last hole" : `the last ${n}`));
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}

/** One row's tie with a neighbour on the board, as the rank pass decided it. */
export interface TieWith {
  /** Who they are level with. */
  name: string;
  /** What the countback found, from THIS row's side (`a` is this row). */
  decision: CountbackDecision;
  /** The round whose card the countback read, where the board holds more than one; "" otherwise. */
  round?: string;
}

/**
 * A PLACE THAT SHARES A SCORE, AND WHAT DECIDED IT — worded from the countback
 * the rank pass ran (`countbackBetween`), never from a second comparison.
 *
 * `score` is the figure the board prints for the row; `points` says the
 * countback's totals are points (most wins) rather than strokes.
 */
export function tieWorking(
  ties: readonly TieWith[],
  score: string,
  place: number,
  opts: { points: boolean },
): Working | null {
  if (ties.length === 0) return null;
  const unit = (n: number) => (opts.points ? `${n} ${n === 1 ? "point" : "points"}` : `${n}`);
  const parts = ties.map((t) => {
    const d = t.decision;
    const of = t.round ? ` of ${t.round}` : "";
    if (d.decidedBy) {
      const ahead = d.order < 0;
      return `Level with ${t.name} on ${score}; ${ahead ? "ahead" : "behind"} on the countback over ${stepWords(d.decidedBy.holes)}${of}: ${unit(
        d.decidedBy.a,
      )} to ${unit(d.decidedBy.b)}.`;
    }
    if (d.incomplete) {
      return `Shares ${ordinal(place)} with ${t.name} for now: level on ${score}, and a countback is read off finished cards.`;
    }
    if (d.levelOn.length === 0) {
      return `Shares ${ordinal(place)} with ${t.name}: level on ${score}, and a round this short has no countback.`;
    }
    return `Shares ${ordinal(place)} with ${t.name}: level on ${score}, and level on ${listSteps(d.levelOn)}${of} too, so nothing separates them.`;
  });
  return { says: parts.join(" "), cite: CITE.countback };
}

/** What a row with no place carries, for the sentence that says why. */
export interface UnplacedRow {
  ranked: boolean;
  thru: number;
  disqualified?: boolean;
  withdrew?: boolean;
  missedCut?: string;
  missedRound?: string;
  absent?: boolean;
}

/**
 * WHY A ROW ON THE BOARD HOLDS NO PLACE — DQ, WD, a missed cut, no return for a
 * closed round, or a card that stopped short — from what is stored on the row,
 * in the same order of questions `cardState` asks (so the word on the row and
 * the sentence behind it are about one fact). Null for a row with a place, or
 * one that has simply not started.
 */
export function unplacedWorking(r: UnplacedRow): Working | null {
  if (r.ranked || r.absent) return null;
  if (r.thru <= 0) {
    return r.missedRound
      ? {
          says: `No card was returned for ${r.missedRound}, and the committee has closed it, so there is no score for it (no return).`,
          cite: CITE.noReturn,
        }
      : null;
  }
  if (r.disqualified) {
    return {
      says: "Disqualified by the committee, so there is no score for the competition and no place. The cards returned are kept on the record.",
      cite: CITE.disqualified,
    };
  }
  if (r.withdrew) {
    return {
      says: "Withdrew after starting. What was returned stays on the sheet, beneath the field and without a place.",
      cite: CITE.terms,
    };
  }
  if (r.missedCut) {
    return {
      says: `Outside the cut made after ${r.missedCut}: only the players inside it play on, so this score stands without a place.`,
      cite: CITE.terms,
    };
  }
  if (r.missedRound) {
    return {
      says: `No card was returned for ${r.missedRound}, which the committee has closed (no return), so there is no total to place.`,
      cite: CITE.noReturn,
    };
  }
  return {
    says: `This card stops after ${r.thru} ${r.thru === 1 ? "hole" : "holes"} because the match ended there. A hole nobody played has no score, so the card is shown without a place.`,
    cite: CITE.stoppedShort,
  };
}

/**
 * A NET BOARD'S FIGURE: the net to-par a row prints, from the row's own gross,
 * net and par for the holes played. `toPar` is what the board prints; the
 * sentence's arithmetic (net − par) gives it, and `figure-working.test.ts`
 * holds it there.
 */
export function boardNetWorking(r: { gross: number; net: number; parThru: number; thru: number; toPar: number }): Working | null {
  if (r.thru <= 0 || r.parThru <= 0) return null;
  const received = r.gross - r.net;
  const holes = `${r.thru} ${r.thru === 1 ? "hole" : "holes"}`;
  const strokes =
    received >= 0
      ? `${r.gross} gross, less ${received} ${received === 1 ? "stroke" : "strokes"} received, is net ${r.net}`
      : `${r.gross} gross, and ${-received} ${-received === 1 ? "stroke" : "strokes"} given back, is net ${r.net}`;
  return {
    says: `${toParText(r.toPar)}: ${strokes}, against a par of ${r.parThru} for the ${holes} played.`,
    cite: CITE.allocation,
  };
}

/** What a card is drawn from — the scorecard's own props. */
export interface CardWorkingInput {
  holes: number;
  pars: readonly number[];
  strokeIndex: readonly number[];
  strokes: readonly (number | null)[];
  shotsPerHole: readonly number[];
  playingHandicap?: number | null;
  handicapParts?: HandicapParts | null;
  pointsTable?: PointsTable | null;
  firstHole?: number;
  locale?: string;
}

/**
 * EVERY FIGURE ON A CARD AND ITS WORKING, from the card's own props — what the
 * scorecard and the running strip above the hole print, and the sentence each
 * one opens. One function so the screen has nothing to work out for itself:
 * the totals ARE `figures`, the points total is `points`' own figure, and a
 * hole's sentence is never one whose strokes disagree with the dot drawn.
 */
export function cardWorking(c: CardWorkingInput): {
  figures: CardFigures;
  points: number;
  hole: (i: number) => string;
  net: Working | null;
  pointsWhy: Working | null;
} {
  const figures = cardFigures(c.strokes, c.pars, c.shotsPerHole, c.holes);
  const points = c.pointsTable ? cardPoints(c.strokes.slice(0, c.holes), c.pars, c.shotsPerHole, c.pointsTable) : 0;
  const hasSi = c.strokeIndex.some((n) => typeof n === "number" && n > 0);
  const hole = (i: number): string => {
    const lines: string[] = [];
    const shots = c.shotsPerHole[i] ?? 0;
    if (hasSi && c.playingHandicap != null && c.shotsPerHole.length > 0) {
      const w = strokesOnHole(c.playingHandicap, c.strokeIndex[i] ?? 18, c.holes);
      if (w.shots === shots) lines.push(`${w.says} (${w.cite})`);
    }
    const g = c.strokes[i];
    if (c.pointsTable && typeof g === "number" && g > 0 && c.pars[i]) {
      const p = pointsOnHole(g, c.pars[i], shots, c.pointsTable);
      lines.push(`${p.says} (${p.cite})`);
    }
    return lines.length ? `Hole ${holeNumber(i, c.firstHole ?? 1)}: ${lines.join(" ")}` : "";
  };
  return {
    figures,
    points,
    hole,
    net: c.playingHandicap != null ? netWorking(figures, c.holes, c.playingHandicap, c.handicapParts, c.locale) : null,
    pointsWhy: c.pointsTable && c.pars.length > 0 ? pointsTotalWorking(points, figures.played, c.pointsTable) : null,
  };
}

/**
 * A POINTS TOTAL — what the figure counts. The per-hole points are each
 * explained on the card; this says what the total is a total of.
 */
export function pointsTotalWorking(points: number, played: number, table: PointsTable): Working | null {
  if (played === 0) return null;
  const holes = `${played} ${played === 1 ? "hole" : "holes"}`;
  return table === "modified"
    ? {
        says: `${points} points over the ${holes} played, each hole scored on the Modified Stableford scale against its net score. Tap a hole on the full card to see its points.`,
        cite: CITE.modified,
      }
    : {
        says: `${points} points over the ${holes} played: 2 for a net par on each hole, one more for each stroke under, one fewer for each over, and none for a net double bogey or worse. Tap a hole on the full card to see its points.`,
        cite: CITE.stableford,
      };
}
