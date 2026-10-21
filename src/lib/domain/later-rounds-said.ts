/**
 * WHAT "USE IN LATER ROUNDS" DID, IN ONE TRUE SENTENCE (2026-10-21).
 *
 * A playing handicap set by hand for one round is copied only to later rounds where the same strokes
 * mean the same thing — the same course, tees and number of holes (Rules of Handicapping 6.1: a
 * course handicap belongs to one course, set of tees and length of round) — and only where no card
 * is in yet, since those rounds' handicaps are frozen.
 *
 * It said "…leaving 1 that has cards in or is on other tees" when the round left was a nine at the
 * same club, and "There are no later rounds to use it in" when there were later rounds and all of
 * them were left. Found by the first browser test to press the button. The two reasons are counted
 * apart now, and each case has its own sentence — worded by the UI/UX designer and the golf
 * professional.
 */
export function laterRoundsSaid(written: number, skippedCards: number, skippedOther: number): string {
  const rounds = (n: number) => `${n} later ${n === 1 ? "round" : "rounds"}`;
  const OTHER = "on another course, other tees or a different number of holes";
  const has = (n: number) => (n === 1 ? "has" : "have");
  const is = (n: number) => (n === 1 ? "is" : "are");
  const skipped = skippedCards + skippedOther;

  if (written === 0 && skipped === 0) return "There are no later rounds to use it in.";

  if (written > 0) {
    if (skipped === 0) return `Set on ${rounds(written)}.`;
    if (skippedOther === 0) {
      return `Set on ${rounds(written)}; ${skippedCards} already ${has(skippedCards)} cards in, so ${skippedCards === 1 ? "its" : "their"} handicaps are fixed.`;
    }
    if (skippedCards === 0) {
      return `Set on ${rounds(written)}; ${skippedOther} ${is(skippedOther)} ${OTHER}, where these strokes mean something else.`;
    }
    return `Set on ${rounds(written)}; ${skippedCards} already ${has(skippedCards)} cards in and ${skippedOther} ${is(skippedOther)} ${OTHER}, so both keep their own.`;
  }

  // Nothing written, though there were later rounds.
  const all = (n: number) => (n === 1 ? "the only one" : `all ${n}`);
  if (skippedOther === 0) {
    return `Not set on any later round: ${all(skippedCards)} already ${has(skippedCards)} cards in, so ${skippedCards === 1 ? "its" : "their"} handicaps are fixed.`;
  }
  if (skippedCards === 0) {
    return `Not set on any later round: ${all(skippedOther)} ${is(skippedOther)} ${OTHER}, where these strokes mean something else.`;
  }
  return `Not set on any later round: ${skippedCards} already ${has(skippedCards)} cards in and ${skippedOther} ${is(skippedOther)} ${OTHER}.`;
}
