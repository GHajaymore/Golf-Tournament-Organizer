// Match-play resolution: everything about a match derives from its `holes[]` array.
// Reproduces the "Standings Logic" section of the handoff README exactly.

import type { HoleResult, Match } from "./types";
import { holeStrokesReceived , allocationHoles } from "./stroke";

export interface MatchResolution {
  /** Holes with a non-null value. */
  played: number;
  /** totalHoles - played. */
  remaining: number;
  /** holesWonByA - holesWonByB (positive = A leads). */
  lead: number;
  holesWonA: number;
  holesWonB: number;
  /** True once the match can no longer change hands (dormie/closed out or all holes played). */
  complete: boolean;
  /** 'A' | 'B' winner, 'H' halved; null while still in progress. */
  winner: "A" | "B" | "H" | null;
  /** Standard match-play result string: "3&2", "2 UP", "AS", or "" while in progress. */
  resultText: string;
}

/**
 * Find the hole at which the match was decided, if it was.
 *
 * Rule 3.2a(3): a match ends when one side leads by more holes than remain.
 * That is a moment DURING the round, not a property of the final card — and
 * reading only the final state is how a match that ended 3&2 came to be
 * reported as "1 UP" because the players carried on and lost 17 and 18.
 *
 * The scan runs over the contiguous run of decided holes from the first. It
 * stops at the first undecided hole on purpose: nothing past a hole with no
 * result is known, so a match cannot be proven closed out beyond it.
 */
function closeoutOf(holes: HoleResult[]): { atIndex: number; remaining: number } | null {
  const total = holes.length;
  let a = 0;
  let b = 0;
  for (let i = 0; i < total; i += 1) {
    const h = holes[i];
    if (h === null) return null;
    if (h === "A") a += 1;
    else if (h === "B") b += 1;
    const remaining = total - (i + 1);
    if (Math.abs(a - b) > remaining) return { atIndex: i, remaining };
  }
  return null;
}

/**
 * The holes that COUNT: everything up to and including the closeout.
 *
 * Holes played after the match was already won are not part of the result, and
 * must not be part of the record either — a player beaten 3&2 was being
 * credited the 17th and 18th, which fed `holes-won-ratio` and
 * `fewest-holes-lost` in the standings.
 *
 * Exported because that fix was applied inside `resolveMatch` and one reader
 * was missed: `holesDiffOn`, which powers the toughest-N tiebreakers, walked
 * the raw card. So the same two extra holes were excluded from the record and
 * counted on the six hardest holes of the course — and a tiebreaker reading a
 * card differently from the result it is breaking a tie about is a tie decided
 * on a match that did not happen that way.
 *
 * A whole-card match (nobody closed out) returns the card unchanged.
 */
export function countedHoles(holes: HoleResult[]): HoleResult[] {
  const closeout = closeoutOf(holes);
  return closeout ? holes.slice(0, closeout.atIndex + 1) : holes;
}

/**
 * Whether a match is OVER — decided, not merely started.
 *
 * The distinction this exists for: `matchSettled` in services/tournament.ts
 * answers a different question with a very similar name. It is satisfied by a
 * match with ONE hole on it, which is exactly right for "which round is the
 * tournament on" — a round somebody has begun scoring is the round being
 * played — and exactly wrong for anything that pays out. A match one hole old
 * is not a result.
 *
 * That gap was load-bearing. `roundMoneyFor` fed `matchSettled` into
 * `roundMoneyIsFinal`, so a match round flipped to "final" the moment every
 * pairing had a single hole entered, and the player's EXPOSURE line — which is
 * computed only while a round is unfinished — vanished from their screen
 * mid-round. No money leaked, because every pot family refuses a provisional
 * result for its own reasons, so the screen simply went silent: no stake, no
 * standing, nothing. An empty screen reads as "nothing to report" rather than
 * as a fault, which is why it went unnoticed.
 *
 * A closeout counts, so 5&4 is over with four holes unplayed — that is what
 * `resolveMatch` already means by `complete`, and a rule that demanded
 * eighteen returned holes would refuse most real match play.
 *
 * The empty card is the trap and is guarded explicitly. `resolveMatch([])` is
 * COMPLETE: nothing is left to play, so `remaining` is zero. A scheduled match
 * nobody has touched is stored as `"[]"`, so without this line a round of
 * matches that had never been started would read as finished.
 */
export function matchIsOver(holes: HoleResult[]): boolean {
  if (!holes.some((h) => h !== null)) return false;
  return resolveMatch(holes).complete;
}

export function resolveMatch(holes: HoleResult[]): MatchResolution {
  const total = holes.length;

  // `remaining` and `complete` below need the closeout itself, not only the
  // holes it selects — see the two reads further down.
  const closeout = closeoutOf(holes);
  const counted = countedHoles(holes);

  let holesWonA = 0;
  let holesWonB = 0;
  let played = 0;

  for (const h of counted) {
    if (h === null) continue;
    played += 1;
    if (h === "A") holesWonA += 1;
    else if (h === "B") holesWonB += 1;
    // 'H' (halved) counts as played but awards no hole to either side.
  }

  const remaining = closeout ? closeout.remaining : total - played;
  const lead = holesWonA - holesWonB;
  const absLead = Math.abs(lead);

  // Complete when closed out early, or when every hole has been played.
  const complete = closeout !== null || remaining === 0;

  let winner: MatchResolution["winner"] = null;
  let resultText = "";

  if (complete) {
    if (lead > 0) winner = "A";
    else if (lead < 0) winner = "B";
    else winner = "H";

    if (remaining === 0) {
      resultText = lead === 0 ? "AS" : `${absLead} UP`;
    } else {
      // Closed out early, e.g. 3 up with 2 to play -> "3&2".
      resultText = `${absLead}&${remaining}`;
    }
  }

  return { played, remaining, lead, holesWonA, holesWonB, complete, winner, resultText };
}

/**
 * Convert a "match result" entry (winner + margin string) into an equivalent
 * `holes[]` array so it feeds the same standings math as hole-by-hole entry.
 *
 * Accepts "N&M" (won by N with M to play), "N UP" (through the round, won by N),
 * and "AS" (all square). This is lossy — it records the net result only, not the
 * specific holes won/lost along the way (see handoff README, "Match Result Entry").
 */
export function marginToHoles(
  winner: "A" | "B" | "H",
  margin: string,
  totalHoles: number,
): HoleResult[] {
  const holes: HoleResult[] = new Array(totalHoles).fill(null);
  const raw = margin.trim().toUpperCase();

  if (winner === "H" || raw === "AS" || raw === "") {
    // All square: every hole played and halved.
    return holes.map(() => "H");
  }

  const winSym: HoleResult = winner === "A" ? "A" : "B";
  const loseSym: HoleResult = winner === "A" ? "B" : "A";

  const amp = raw.match(/^(\d+)\s*&\s*(\d+)$/);
  const up = raw.match(/^(\d+)\s*UP$/);

  let lead: number;
  let remaining: number;

  if (amp) {
    lead = parseInt(amp[1], 10);
    remaining = parseInt(amp[2], 10);
  } else if (up) {
    lead = parseInt(up[1], 10);
    remaining = 0;
  } else {
    // Unparseable margin: assume a minimal 1-up win through the round.
    lead = 1;
    remaining = 0;
  }

  const played = totalHoles - remaining;
  /**
   * The winner's holes go at the END of the played stretch, halved before.
   *
   * They used to go at the start, which reconstructed a card that contradicts
   * the result it was built from. "2 UP" over 18 became: win 1 and 2, halve
   * the rest — but that card is 2 up with one to play at the 17th, which is a
   * match that ENDED 2&1. The margin said one thing and the holes said
   * another, and resolveMatch now reads the holes.
   *
   * Building the lead as late as legally possible is the only reconstruction
   * consistent with the stated margin: the lead reaches `lead` exactly at the
   * final played hole, which is where a match that finished on that margin
   * actually reached it.
   */
  const firstWin = Math.max(0, played - lead);
  for (let i = 0; i < totalHoles; i += 1) {
    if (i >= played) holes[i] = null; // unplayed
    else if (i >= firstWin) holes[i] = winSym;
    else holes[i] = "H";
  }
  // `loseSym` is intentionally unused for played holes — the net margin is what
  // matters; halved filler preserves the correct lead without inventing losses.
  void loseSym;
  return holes;
}

/** Parse a free-text/voice transcript into a winner + margin (see README voice spec). */
export function parseResultTranscript(
  transcript: string,
  aFirstName: string,
  bFirstName: string,
): { winner: "A" | "B" | "H" | null; margin: string } {
  const t = transcript.toLowerCase().trim();
  let winner: "A" | "B" | "H" | null = null;
  let margin = "";

  // Halve / draw keywords take precedence.
  if (/\bhalved?\b/.test(t) || /\ball square\b/.test(t) || /^as$/.test(t)) {
    return { winner: "H", margin: "AS" };
  }

  // Whole-word match, longer name tried first. Substring matching credited
  // the wrong player whenever one first name prefixed the other: "Samantha
  // wins 3 and 2" contains "sam", and with A checked first, Sam got
  // Samantha's match. Between two named people that is not a parsing quirk,
  // it is the wrong result on the board.
  const a = aFirstName.toLowerCase();
  const b = bFirstName.toLowerCase();
  const said = (name: string) => name !== "" && new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(t);
  const ordered: Array<["A" | "B", string]> = a.length >= b.length ? [["A", a], ["B", b]] : [["B", b], ["A", a]];
  for (const [side, name] of ordered) {
    if (said(name)) { winner = side; break; }
  }

  const amp = t.match(/(\d+)\s*(?:&|and)\s*(\d+)/);
  const up = t.match(/(\d+)\s*up/);
  if (amp) margin = `${amp[1]}&${amp[2]}`;
  else if (up) margin = `${up[1]} UP`;

  return { winner, margin };
}

export function isMatchStarted(m: Match): boolean {
  return m.holes.some((h) => h !== null);
}

/**
 * Parse a spoken sequence of hole-by-hole match results — the A-side or
 * B-side player's first name, or "half"/"halved"/"push"/"tie" — starting at
 * `startIndex` and advancing one hole per recognized token.
 */
export function parseHolesTranscript(
  transcript: string,
  aFirstName: string,
  bFirstName: string,
  startIndex: number,
  totalHoles: number,
): HoleResult[] {
  const a = aFirstName.toLowerCase();
  const b = bFirstName.toLowerCase();
  const tokens = transcript.toLowerCase().split(/[\s,]+/).filter(Boolean);
  const results: HoleResult[] = [];
  let hole = startIndex;
  for (let j = 0; j < tokens.length && hole < totalHoles; j += 1) {
    const t = tokens[j];
    if (a && t === a) { results.push("A"); hole += 1; }
    else if (b && t === b) { results.push("B"); hole += 1; }
    else if (/^half(ved)?$/.test(t) || t === "push" || t === "tie" || t === "tied") { results.push("H"); hole += 1; }
  }
  return results;
}

/**
 * Standard handicap match-play allowance: the higher-handicap player receives
 * strokes equal to the full difference between the two players' course
 * handicaps, allocated to the hardest holes first by stroke index.
 */
export function matchStrokesGiven(
  handicapA: number,
  handicapB: number,
  strokeIndex: number[],
): { toA: number[]; toB: number[] } {
  // diff > 0 means A has the HIGHER course handicap — the weaker player — so A
  // is the one who receives.
  //
  // This was inverted, and nothing tested it: the shots went to whoever had
  // the LOWER handicap, so a scratch golfer was given four shots against a
  // 4-handicapper. Net match play has been backwards, and the failure is
  // invisible on a card — the holes just go the wrong way.
  const diff = Math.round(handicapA) - Math.round(handicapB);
  const toA = strokeIndex.map((si) => (diff > 0 ? holeStrokesReceived(diff, si, allocationHoles(strokeIndex.length)) : 0));
  const toB = strokeIndex.map((si) => (diff < 0 ? holeStrokesReceived(-diff, si, allocationHoles(strokeIndex.length)) : 0));
  return { toA, toB };
}

/**
 * Derive per-hole match-play results net of handicap from two players' gross
 * strokes-per-hole cards. A hole stays null (not yet decided) until both
 * players have a gross score recorded for it.
 */
export function deriveNetHoles(
  strokesA: (number | null)[],
  strokesB: (number | null)[],
  handicapA: number,
  handicapB: number,
  strokeIndex: number[],
  /**
   * How many holes this match is played over. Pass it.
   *
   * Without it the length is taken from the longest of the two cards and the
   * stroke index — and a nine-hole match handed an eighteen-hole index came
   * back as an eighteen-hole match with nine holes unplayed. `remaining` never
   * fell below the lead, so `absLead > remaining` was never true and a
   * nine-hole match could NEVER be completed: no result, no standings, live
   * forever. That is what killed the nine-hole member-guest shape.
   *
   * Sizing from the cards alone would be worse: a part-entered card is short,
   * and a match would report itself complete at the turn.
   */
  holeCount?: number,
): HoleResult[] {
  const { toA, toB } = matchStrokesGiven(handicapA, handicapB, strokeIndex);
  const total =
    holeCount && holeCount > 0
      ? Math.round(holeCount)
      : Math.max(strokesA.length, strokesB.length, strokeIndex.length);
  const holes: HoleResult[] = new Array(total).fill(null);
  for (let i = 0; i < total; i += 1) {
    const a = strokesA[i];
    const b = strokesB[i];
    if (a == null || b == null) continue;
    const netA = a - (toA[i] ?? 0);
    const netB = b - (toB[i] ?? 0);
    if (netA < netB) holes[i] = "A";
    else if (netB < netA) holes[i] = "B";
    else holes[i] = "H";
  }
  return holes;
}
