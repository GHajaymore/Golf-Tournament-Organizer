import { holeNumber } from "./hole-number";

/**
 * WHAT A COMMITTEE CORRECTION CHANGED, in the words the record keeps
 * (2026-10-08).
 *
 * Walked as grid cell T11: a closed round, $10 skins, and the committee found
 * Bea's 2nd was a 4 and not the 5 on her card. They reopened the card,
 * corrected it and approved it again; the board and the skins moved — a skin
 * and $15 changed hands — and Reports' "Recent changes" said "Nothing recorded
 * yet". The match-play counterparts (confirm, reopen) had always written a
 * line; a stroke card's approval, reopening and correction wrote none.
 *
 * "hole 2: 5 → 4" rather than "card changed", because the question after a
 * correction is always WHICH score moved. A hole with no score reads "–".
 */
export function holesChanged(
  before: readonly (number | null | undefined)[],
  after: readonly (number | null | undefined)[],
  firstHole = 1,
): string {
  const shown = (v: number | null | undefined) => (typeof v === "number" && v > 0 ? String(v) : "–");
  const out: string[] = [];
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    const a = shown(before[i]);
    const b = shown(after[i]);
    if (a !== b) out.push(`hole ${holeNumber(i, firstHole)}: ${a} → ${b}`);
  }
  return out.join(", ");
}
