// Match-play resolution: everything about a match derives from its `holes[]` array.
// Reproduces the "Standings Logic" section of the handoff README exactly.

import type { HoleResult, Match } from "./types";
import { holeStrokesReceived } from "./stroke";

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

export function resolveMatch(holes: HoleResult[]): MatchResolution {
  const total = holes.length;
  let holesWonA = 0;
  let holesWonB = 0;
  let played = 0;

  for (const h of holes) {
    if (h === null) continue;
    played += 1;
    if (h === "A") holesWonA += 1;
    else if (h === "B") holesWonB += 1;
    // 'H' (halved) counts as played but awards no hole to either side.
  }

  const remaining = total - played;
  const lead = holesWonA - holesWonB;
  const absLead = Math.abs(lead);

  // Complete when closed out early (|lead| > remaining) or all holes are played.
  const complete = remaining === 0 || absLead > remaining;

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
  // Assign `lead` holes to the winner, the remaining played holes are halved,
  // and unplayed holes stay null.
  let assignedWin = 0;
  for (let i = 0; i < totalHoles; i += 1) {
    if (i >= played) {
      holes[i] = null; // unplayed
    } else if (assignedWin < lead) {
      holes[i] = winSym;
      assignedWin += 1;
    } else {
      holes[i] = "H";
    }
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

  const a = aFirstName.toLowerCase();
  const b = bFirstName.toLowerCase();
  if (a && t.includes(a)) winner = "A";
  else if (b && t.includes(b)) winner = "B";

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
  const toA = strokeIndex.map((si) => (diff > 0 ? holeStrokesReceived(diff, si) : 0));
  const toB = strokeIndex.map((si) => (diff < 0 ? holeStrokesReceived(-diff, si) : 0));
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
): HoleResult[] {
  const { toA, toB } = matchStrokesGiven(handicapA, handicapB, strokeIndex);
  const total = Math.max(strokesA.length, strokesB.length, strokeIndex.length);
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
