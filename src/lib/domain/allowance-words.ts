/**
 * WHAT A ROUND'S CARD SAYS AFTER "Handicap allowance 95%".
 *
 * One sentence, said in two places: the panel a team round has always had, and
 * the line an individual net round gained on 2026-10-13. They are the same claim
 * about the same number, so it is written once — two copies of a sentence drift
 * the way two copies of a rule do, and this one is read by a committee deciding
 * whether the figure in front of it is the Rules' or its own.
 */
export interface AllowanceSaid {
  /** The allowance in force, per cent. */
  allowance: number;
  /** What the Rules (or, for a shamble, custom) give this format in this kind of round. */
  recommended: number;
  /** The committee has set a figure of its own. */
  overridden: boolean;
  /** True where the recommendation is club convention, not a published rule. */
  isConvention: boolean;
  /** The format is scored by per-player shares, and a flat figure has been put in their place. */
  replacesSplit?: boolean;
}

export function allowanceSaid(a: AllowanceSaid): string {
  if (a.overridden) {
    if (a.replacesSplit) return " — set by your committee, in place of the split below.";
    // A committee that types the usual figure has still said something;
    // "in place of the usual 85%" over an 85% would read as a mistake.
    if (a.allowance === a.recommended) return " — set by your committee; it is also the usual figure for this format.";
    return ` — set by your committee, in place of the usual ${a.recommended}%.`;
  }
  return a.isConvention
    ? " — the common club convention for this format, not a published standard."
    : " — the recommended allowance for this format.";
}
