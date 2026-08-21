import {
  resolveMatch,
  marginToHoles,
  deriveNetHoles,
  matchStrokesGiven,
  type MatchResolution,
} from "./match";
import { breakMatchTie, type MatchTiebreakKey } from "./match-tiebreak";
import { inputChoices } from "../formats";
import type { HoleResult } from "./types";

/**
 * One way in for every way of writing a match down.
 *
 * A match arrives from the course in one of three shapes, and which one
 * depends on who is holding the phone rather than on the format:
 *
 *   - **Gross cards.** Both players' strokes per hole. The most work to enter
 *     and the only shape that can be re-scored later — change the round from
 *     gross to net and the result recomputes, because the strokes are still
 *     there.
 *   - **Hole results.** Who won each hole. What a player actually tracks while
 *     playing match play; nobody writes down a 6 when they've lost the hole.
 *   - **The match result.** "3&2". What gets phoned in from the 16th green.
 *
 * The app previously wired these up separately and let each one reach the
 * standings by its own route, so whether handicaps applied depended on which
 * screen the score was typed into. This resolves all three the same way, once,
 * against the round's own settings — which is the difference between a card
 * that records a score and a card that computes a result.
 *
 * Lossiness is one-directional and worth stating: gross cards can produce hole
 * results, and hole results can produce a match result. Neither goes back.
 */

export type MatchEntryMode = "gross-cards" | "hole-results" | "match-result";

export const MATCH_ENTRY_MODES: Array<{
  key: MatchEntryMode;
  label: string;
  blurb: string;
  /** Whether this shape can be re-scored if the round's basis changes. */
  rescorable: boolean;
}> = [
  {
    key: "gross-cards",
    label: "Hole-by-hole scores",
    blurb:
      "Both players' strokes on every hole. The most to type, and the only one that survives a change from gross to net.",
    rescorable: true,
  },
  {
    key: "hole-results",
    label: "Hole-by-hole result",
    blurb: "Who won each hole. What a player actually tracks while playing match play.",
    rescorable: false,
  },
  {
    key: "match-result",
    label: "Final result only",
    blurb: 'Just the margin — "3&2". What gets phoned in from the green.',
    rescorable: false,
  },
];

export interface MatchEntry {
  mode: MatchEntryMode;
  /** gross-cards: per-hole strokes, null where not yet played. */
  strokesA?: (number | null)[];
  strokesB?: (number | null)[];
  /** hole-results: who won each hole. */
  holes?: HoleResult[];
  /** match-result. */
  winner?: "A" | "B" | "H";
  margin?: string;
  /**
   * The organizer's decision, which beats everything above it.
   *
   * Every scoring rule in this file is a default for the usual case, and the
   * committee is the authority in the unusual one — a disqualification, a
   * concession, a play-off settled on the 19th, a card nobody can reconstruct.
   * Software that cannot be overruled gets worked around, and being worked
   * around is how results end up in a spreadsheet again.
   *
   * It is also what makes sudden death recordable: the play-off happens on the
   * course and its result arrives here.
   */
  override?: { winner: "A" | "B" | "H"; note?: string } | null;
}

export interface MatchScoringContext {
  /** The round's scoring basis, from its setup. */
  basis: string;
  /** Course handicaps — already converted, not indexes. */
  handicapA: number;
  handicapB: number;
  /** 1 = hardest. Empty means the card is unknown. */
  strokeIndex: number[];
  holes: number;
  /** The round's configured all-square rule, in order. */
  tiebreak: MatchTiebreakKey[];
}

export interface ResolvedMatchEntry {
  /** Canonical per-hole result, whatever shape it was entered in. */
  holes: HoleResult[];
  resolution: MatchResolution;
  /** Strokes given per hole, so the card can show the dots. */
  strokesGiven: { toA: number[]; toB: number[] };
  /** Whether handicaps were applied. */
  net: boolean;
  /** Set when an all-square match was decided by the round's rule. */
  decidedBy: MatchTiebreakKey | null;
  /** The final winner, after any tiebreak. */
  winner: "A" | "B" | "H" | null;
  /** One line for the card: "3&2", or "All square — last hole: 1–0." */
  detail: string;
  /** Set when the entry cannot be scored as configured, and why. */
  problem: string | null;
  /** Whether the organizer overruled the card. */
  overridden: boolean;
}

/**
 * Whether the round is played off handicap.
 *
 * "both" means the leaderboard shows gross and net side by side, but a *match*
 * has to be one or the other — you cannot be 2 up gross and 1 down net and
 * have won. Net is the answer, because that is what the players played.
 */
export function isNetBasis(basis: string): boolean {
  return basis === "net" || basis === "both";
}

export function resolveMatchEntry(
  entry: MatchEntry,
  ctx: MatchScoringContext,
): ResolvedMatchEntry {
  const net = isNetBasis(ctx.basis);
  const strokesGiven = net
    ? matchStrokesGiven(ctx.handicapA, ctx.handicapB, ctx.strokeIndex)
    : { toA: new Array(ctx.holes).fill(0), toB: new Array(ctx.holes).fill(0) };

  let holes: HoleResult[];
  let problem: string | null = null;

  if (entry.mode === "gross-cards") {
    const a = entry.strokesA ?? [];
    const b = entry.strokesB ?? [];
    if (net && ctx.strokeIndex.length === 0) {
      // Without a stroke index there is nowhere to allocate the shots, so a
      // net result would be gross wearing a different label.
      problem =
        "This round is played off handicap, but the course has no stroke index — set the card up before entering scores.";
    }
    holes = net
      ? deriveNetHoles(a, b, ctx.handicapA, ctx.handicapB, ctx.strokeIndex)
      : grossHoles(a, b, ctx.holes);
  } else if (entry.mode === "hole-results") {
    holes = (entry.holes ?? []).slice(0, ctx.holes);
    while (holes.length < ctx.holes) holes.push(null);
    if (net) {
      // The player already applied their shots on the course when they decided
      // who won the hole. Applying them again here would double-count.
      strokesGiven.toA = new Array(ctx.holes).fill(0);
      strokesGiven.toB = new Array(ctx.holes).fill(0);
    }
  } else {
    holes = marginToHoles(entry.winner ?? "H", entry.margin ?? "", ctx.holes);
  }

  const resolution = resolveMatch(holes);

  // The all-square rule only runs on a finished match. Applying it to one
  // still on the course would declare a winner at the turn.
  let decidedBy: MatchTiebreakKey | null = null;
  let winner = resolution.winner;
  let detail = resolution.resultText;

  if (resolution.complete && resolution.winner === "H" && ctx.tiebreak.length > 0) {
    const broken = breakMatchTie(holes, ctx.strokeIndex, ctx.tiebreak);
    if (broken.winner) {
      winner = broken.winner;
      decidedBy = broken.decidedBy;
      detail = `All square — ${broken.detail}`;
    } else {
      detail = broken.needsManualResult ? broken.detail : "All square.";
    }
  }

  // The organizer has the last word, over the card and over the tiebreak.
  // Reported rather than hidden: a result that does not match the card should
  // say so, or the next person to read it assumes the card is wrong.
  if (entry.override) {
    const note = entry.override.note?.trim();
    return {
      holes,
      resolution,
      strokesGiven,
      net,
      decidedBy: null,
      winner: entry.override.winner,
      detail: note ? `Set by the organizer — ${note}` : "Set by the organizer.",
      problem,
      overridden: true,
    };
  }

  return { holes, resolution, strokesGiven, net, decidedBy, winner, detail, problem, overridden: false };
}

/** Gross comparison, hole by hole. Undecided until both cards have a score. */
function grossHoles(
  strokesA: (number | null)[],
  strokesB: (number | null)[],
  total: number,
): HoleResult[] {
  const out: HoleResult[] = new Array(total).fill(null);
  for (let i = 0; i < total; i += 1) {
    const a = strokesA[i];
    const b = strokesB[i];
    if (a == null || b == null) continue;
    out[i] = a < b ? "A" : b < a ? "B" : "H";
  }
  return out;
}

/**
 * Which entry modes make sense for a format.
 *
 * Stroke-based formats have no concept of winning a hole, so offering "hole
 * result" there would be offering a shape the scoring cannot read.
 *
 * This used to test `format === "Match Play"` here, which made the catalog and
 * the entry screen two places that both knew which formats produce no card —
 * and they had already drifted: Nassau resolves from HOLE RESULTS and was
 * offered only a gross card. The list now comes from the format's own
 * declaration, so adding a format declares its input once. See
 * `GolfFormat.inputs`.
 */
export function entryModesFor(format: string): MatchEntryMode[] {
  return inputChoices(format);
}
