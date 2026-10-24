/**
 * THE RULES WORKED IN WHOLE NUMBERS, for the property tests (2026-10-23).
 *
 * Every function here is a second route to an answer the app already gives,
 * written so that it shares neither the app's formula nor its floating point:
 * a handicap index has one decimal place and a slope is a whole number over
 * 113, so every figure in the Rules of Handicapping is an exact fraction, and
 * BigInt keeps it exact. Where the app distributes strokes by a formula, this
 * hands them out one at a time; where the app resolves a match from a card,
 * this plays it hole by hole. A property that compares the two can only pass
 * if both routes reach the same place.
 *
 * Not a test file: imported by the `properties-*.test.ts` files beside it.
 */

/** Floor division of whole numbers, exact for any size. */
export function floorDiv(a: bigint, b: bigint): bigint {
  if (b <= 0n) throw new Error("floorDiv needs a positive divisor");
  return a >= 0n ? a / b : -((-a + b - 1n) / b);
}

/** num/den rounded to the nearest whole number, a half UPWARDS (Rules of Handicapping, 6.1 and 6.2). */
export function roundHalfUp(num: bigint, den: bigint): number {
  return Number(floorDiv(2n * num + den, 2n * den));
}

/**
 * A Course Handicap as an exact fraction over 1130 (Rule 6.1a):
 * Index × Slope / 113 + (Course Rating − Par), with the index and the rating in
 * TENTHS — so 12.3 off 71.4/131, par 72, is (123 × 131 + (714 − 720) × 113) / 1130.
 */
export function courseHandicapOver1130(indexTenths: number, slope: number, ratingTenths: number, par: number): bigint {
  return BigInt(indexTenths) * BigInt(slope) + (BigInt(ratingTenths) - BigInt(par) * 10n) * 113n;
}

/** The Course Handicap a golfer is told: the exact figure rounded once. */
export function courseHandicapRef(indexTenths: number, slope: number, ratingTenths: number, par: number): number {
  return roundHalfUp(courseHandicapOver1130(indexTenths, slope, ratingTenths, par), 1130n);
}

/** Playing Handicap (Rule 6.2a, Appendix C): the allowance of the UNROUNDED Course Handicap, rounded once. */
export function playingHandicapRef(indexTenths: number, slope: number, ratingTenths: number, par: number, pct: number): number {
  return roundHalfUp(courseHandicapOver1130(indexTenths, slope, ratingTenths, par) * BigInt(pct), 113000n);
}

/**
 * Strokes received hole by hole (Rule 6.2, Appendix E), handed out ONE AT A
 * TIME: the first stroke to stroke index 1, the next to 2, … wrapping after the
 * last hole. A plus handicap gives strokes BACK, the easiest hole first: the
 * first to the highest stroke index, then the next highest.
 */
export function strokesByHandingOut(playing: number, strokeIndex: readonly number[]): number[] {
  const n = strokeIndex.length;
  const out = strokeIndex.map(() => 0);
  const holeOf = new Map(strokeIndex.map((si, i) => [si, i]));
  for (let k = 0; k < Math.abs(playing); k += 1) {
    const si = playing >= 0 ? (k % n) + 1 : n - (k % n);
    const at = holeOf.get(si)!;
    out[at] += playing >= 0 ? 1 : -1;
  }
  return out;
}

/** Stableford points for a hole, read off the table a scorer learns, not off a formula. */
export function stablefordByName(net: number, par: number): number {
  const toPar = net - par;
  const TABLE: Record<number, number> = { [-4]: 6, [-3]: 5, [-2]: 4, [-1]: 3, 0: 2, 1: 1 };
  if (toPar >= 2) return 0; // net double bogey or worse
  if (toPar <= -5) return 2 - toPar; // beyond a condor the scale goes on
  return TABLE[toPar];
}

export type Hole = "A" | "B" | "H" | null;

/**
 * A match played hole by hole (Rule 3.2a(3)): won when one side is up by more
 * holes than remain; halved when every hole is played level. Reads a card the
 * way a referee walks it — from the 1st, stopping at the first hole not yet
 * played — and reports the result in the standard notation.
 */
export function playMatch(holes: readonly Hole[]): { over: boolean; winner: "A" | "B" | "H" | null; text: string; lead: number } {
  const total = holes.length;
  let lead = 0;
  for (let i = 0; i < total; i += 1) {
    const h = holes[i];
    if (h === null) return { over: false, winner: null, text: "", lead };
    if (h === "A") lead += 1;
    if (h === "B") lead -= 1;
    const left = total - (i + 1);
    if (Math.abs(lead) > left) {
      const winner = lead > 0 ? "A" : "B";
      return { over: true, winner, text: left === 0 ? `${Math.abs(lead)} UP` : `${Math.abs(lead)}&${left}`, lead };
    }
  }
  if (total === 0) return { over: false, winner: null, text: "", lead };
  return { over: true, winner: lead === 0 ? "H" : lead > 0 ? "A" : "B", text: lead === 0 ? "AS" : `${Math.abs(lead)} UP`, lead };
}

/** A repeatable source of order for a property that needs a random sequence inside one case. */
export function chooser(seed: number) {
  let state = seed >>> 0;
  return (n: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % n;
  };
}
