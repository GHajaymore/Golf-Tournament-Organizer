/**
 * What a pasted scorecard actually produced, in words.
 *
 * Two silences this replaces, both on the fastest path into the app — pasting a
 * card off the club's website is how a course gets set up at all.
 *
 * **A successful paste said nothing.** The copy promises "the boxes below fill
 * in as you paste", and those boxes live inside a `<details>` that is folded
 * shut unless the paste went WRONG. So the one case where everything worked was
 * the one case with no evidence: same text in the textarea, a collapsed summary
 * reading "Or type the card in by hand", and no way to tell whether eighteen
 * holes had been read or none.
 *
 * **A one-row paste did nothing at all.** `applyPaste` returns early below two
 * rows — no state written, no problem reported. Somebody who pastes just the par
 * row watches the screen not react and has nothing to read. That is the
 * vanishing-control shape in a different costume: the app declined and kept the
 * reason to itself.
 *
 * Pure, because the component's paste text is local state a static render cannot
 * type into — the same reason `rosterSelection` and `messageAudience` are here.
 */

export interface PasteCounts {
  /** Non-empty lines in what was pasted. */
  rowCount: number;
  pars: number;
  strokeIndex: number;
  yards: number;
  /** Problems the parser already reports on their own lines. */
  problems: number;
}

const HOLES = 18;

/**
 * A sentence, or "" when there is nothing useful to add.
 *
 * Empty in two cases and both are deliberate: nothing pasted yet (there is no
 * news), and a paste that produced problems (those are listed individually
 * right below, and a summary on top of them is noise saying less).
 */
export function pasteSummary(input: PasteCounts): string {
  if (input.rowCount === 0) return "";
  if (input.rowCount < 2) {
    return "That is one row — paste at least two, with the pars on the first line and the stroke index on the second.";
  }
  if (input.problems > 0) return "";

  const parts: string[] = [];
  if (input.pars > 0) parts.push(`${input.pars} pars`);
  if (input.strokeIndex > 0) parts.push(`${input.strokeIndex} stroke indexes`);
  if (input.yards > 0) parts.push(`${input.yards} yardages`);
  // Two rows that parsed to nothing at all. Not a "problem" the parser named,
  // but plainly not a success either, and saying "Read" followed by nothing
  // would be the app congratulating itself.
  if (parts.length === 0) {
    return "Nothing recognisable in that — the rows should be numbers separated by spaces.";
  }

  const read = `Read ${parts.join(", ")}.`;
  // A short card is worth flagging even when the parser is happy with it: a
  // nine-hole paste into an eighteen-hole course leaves half the boxes empty,
  // and the save then refuses hole by hole with no hint of why.
  const short = [input.pars, input.strokeIndex].some((n) => n > 0 && n < HOLES);
  return short ? `${read} That is fewer than ${HOLES} holes — check the card below.` : read;
}
