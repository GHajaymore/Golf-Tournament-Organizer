import { standingsUnit } from "../format-chain";

/**
 * WHAT A ROUND IS RANKED IN, AND WHICH WAY.
 *
 * `scoringBasis` says gross or net. The FORMAT says strokes or points. The two
 * are independent, and reading one for the other is how a screen ends up
 * crowning the wrong player.
 *
 * Found on 2026-09-19 on the seeded club's Thursday league: seven rounds of
 * format "Stableford" with `scoringBasis: "net"`. The results card read the
 * basis alone, called them net strokes and picked the LOWEST score as the
 * winner of a points competition — two lines under a board that said "Ranked
 * by Stableford points". Both numbers were computed correctly; nothing
 * compared them, which is exactly the class CLAUDE.md says only eyes on real
 * rows ever find.
 *
 * `standingsUnit` is the app's one answer to "what is this ranked in", and the
 * board already asks it. This wraps it in the two things a caller actually
 * needs — the word to print, and which end of the list wins.
 */
export interface RoundUnit {
  /** Printed after the score: "net", "gross", "pts". */
  label: string;
  /** Whether the BEST score is the highest one. */
  higherWins: boolean;
}

export function roundUnit(stage: { format: string; scoringBasis?: string | null }): RoundUnit {
  const unit = standingsUnit(stage.format, stage.scoringBasis ?? "");
  if (unit === "Stableford points" || unit === "modified Stableford points") {
    return { label: "pts", higherWins: true };
  }
  return {
    label: (stage.scoringBasis ?? "net").toLowerCase() === "gross" ? "gross" : "net",
    higherWins: false,
  };
}
