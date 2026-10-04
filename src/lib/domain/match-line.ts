import { resolveMatch } from "./match";
import type { HoleResult } from "./types";

/**
 * WHERE A ONE-OFF MATCH STANDS, IN THE WORDS TWO GOLFERS USE (2026-10-04).
 *
 * The casual match's summary screen drew the tournament standings table for
 * it: REC 1-0-0, HOLES ± +7, PTS 6.5. Every figure correct and none of them
 * what two people who have just played a match say to each other. A league's
 * points table exists to compare a field; a match between two people has one
 * answer, and golf already has the sentence for it — "Sam won 7&6", "Sam 2 up
 * through 9", "all square through 4".
 *
 * Built on `resolveMatch`, so the margin is the one every board prints — the
 * same "7&6" score entry shows above the card.
 */
export interface MatchLineInput {
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  /** The stored card, one entry per hole: "A", "B", "H" or null. */
  holes: HoleResult[];
  /**
   * `Match.forfeitedBy`: the PLAYER ID of whoever conceded or withdrew, or ""
   * — the id, as `forfeitMatch` writes it and `single-match.ts` reads it, not
   * a side letter.
   */
  forfeitedBy?: string;
}

export function matchLine({ aId, bId, aName, bName, holes, forfeitedBy = "" }: MatchLineInput): string {
  if (forfeitedBy && (forfeitedBy === aId || forfeitedBy === bId)) {
    const aConceded = forfeitedBy === aId;
    return `${aConceded ? bName : aName} won — ${aConceded ? aName : bName} conceded`;
  }
  const r = resolveMatch(holes);
  if (r.played === 0) return "Not started — no holes on the card yet";
  if (r.complete) {
    if (r.winner === "H") return `Halved — all square after ${r.played}`;
    return `${r.winner === "A" ? aName : bName} won ${r.resultText}`;
  }
  if (r.lead === 0) return `All square through ${r.played}`;
  return `${r.lead > 0 ? aName : bName} ${Math.abs(r.lead)} up through ${r.played}`;
}
