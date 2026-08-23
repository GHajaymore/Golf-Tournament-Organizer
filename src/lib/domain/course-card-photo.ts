/**
 * Reading a CLUB'S CARD — the blank one, with par, stroke index and yardage —
 * off a photograph.
 *
 * Not the same job as reading a played card, and the difference matters.
 * A played card is one player's round: it is certified by the player who
 * played it, and a misread digit is caught by the person looking straight at
 * the number. A club's card is a permanent fact about a golf course, entered
 * once and then used to score every round played there forever. Nobody
 * re-reads it. A stroke index off by one hole never looks wrong afterwards —
 * it just quietly gives shots to the wrong holes, in every match, for years.
 *
 * So this module decides ONE thing: which numbers could be read. It does not
 * decide whether they are any good. That judgement already exists in
 * `validateCard`, which names the hole, reports every problem at once, and is
 * the same check a pasted or typed card goes through. Two definitions of "a
 * valid par" is how the two paths drift apart, and this path is the one nobody
 * would notice drifting.
 *
 * A hole that could not be read comes back as 0 rather than being dropped.
 * Dropping it would shift every later hole up one — eighteen numbers becoming
 * seventeen, silently re-indexing the back nine — whereas a 0 keeps every hole
 * in its own column and makes `validateCard` say "a par should be 3, 4, 5 or
 * occasionally 6" against that exact hole number. The blank asks the question
 * in the right place.
 */

/** The rows a club's card carries, as text — the format the review screen's
 *  own boxes take, so a photographed card and a pasted one are then identical. */
export interface CourseCardReading {
  pars: string;
  strokeIndex: string;
  yards: string;
  /** Holes (1-based) that came back blank on each row, for the note. */
  unreadable: { pars: number[]; strokeIndex: number[]; yards: number[] };
  /** True when the yardage row was left out — see `YARDS_GIVE_UP_AT`. */
  yardsDropped: boolean;
  /** True when nothing usable came back at all. */
  empty: boolean;
}

/**
 * How much of the yardage row may be missing before it is dropped entirely.
 *
 * Yardage is optional — plenty of clubs never enter it and nothing scores off
 * it — so a mostly-unread yardage row is worth less than the noise it makes.
 * Eighteen "that yardage looks wrong" complaints would bury the two par
 * problems that actually stop the card being saved. Par and stroke index get
 * no such mercy: both are scoring data, and a gap in either must be seen.
 */
const YARDS_GIVE_UP_AT = 1 / 3;

/** A number as read, or 0 when it could not be. Deliberately generous: whether
 *  9 is a plausible par is `validateCard`'s question, not this one. */
function readNumber(v: unknown, max: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > max) return 0;
  return n;
}

function readRow(raw: unknown, holes: number, max: number): number[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: number[] = [];
  for (let i = 0; i < holes; i += 1) out.push(readNumber(list[i], max));
  return out;
}

const blanksIn = (values: number[]): number[] =>
  values.flatMap((v, i) => (v === 0 ? [i + 1] : []));

/**
 * What to ask for.
 *
 * Named rows rather than "read the card", because a printed club card carries
 * several yardage rows — one per tee — and a men's/ladies' par row, and the
 * OUT/IN/TOTAL columns. Which of those the reader picks is the whole accuracy
 * question, so it is stated rather than left to chance: the longest tee, the
 * men's par row where a card prints two, and no totals.
 */
export function courseCardPrompt(holes: number): string {
  return [
    "This is a photograph of a blank golf scorecard — the card a club prints, showing each hole's",
    "par, stroke index and yardage. Read the hole-by-hole rows.",
    "",
    `Return exactly ${holes} values per row, in hole order, 1 to ${holes}.`,
    "Do NOT include the OUT, IN or TOTAL columns — those are sums, not holes.",
    "",
    "If the card prints more than one yardage row (one per set of tees), use the LONGEST one.",
    "If it prints more than one par row, use the men's.",
    "The stroke index row may be labelled S.I., Index, Handicap, HCP or Stroke.",
    "",
    "Reply with ONLY this JSON:",
    `  {"pars": [4, 5, ...], "strokeIndex": [6, 10, ...], "yards": [378, 509, ...]}`,
    "",
    "Use null for any single value you cannot read with confidence, keeping every other value in",
    "its own position — do not shift the rest up to close the gap. Use an empty array for a row",
    "that is not on the card at all.",
    "",
    "Do not include any other text, explanation or formatting.",
  ].join("\n");
}

/**
 * Turn whatever came back into the three rows the review screen takes.
 *
 * Untrusted throughout, and judgement-free by design: everything that decides
 * whether this card is fit to save happens afterwards, in `validateCard`,
 * where a typed card and a pasted one are judged by the same rules.
 */
export function parseCourseCardReading(raw: unknown, holeCount: number): CourseCardReading {
  const holes = Math.max(0, Math.floor(holeCount));
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const pars = readRow(obj.pars ?? obj.par, holes, 99);
  const strokeIndex = readRow(obj.strokeIndex ?? obj.stroke_index ?? obj.si, holes, 99);
  const yards = readRow(obj.yards ?? obj.yardage ?? obj.yds, holes, 999);

  const parBlanks = blanksIn(pars);
  const siBlanks = blanksIn(strokeIndex);
  const yardBlanks = blanksIn(yards);

  // Nothing at all on both scoring rows: there is no card here to review, and
  // filling the boxes with thirty-six zeroes would be a worse answer than
  // saying so.
  const empty = parBlanks.length === holes && siBlanks.length === holes;

  const yardsDropped =
    holes > 0 && (yardBlanks.length === holes || yardBlanks.length / holes > YARDS_GIVE_UP_AT);

  const row = (values: number[]) => values.join(" ");
  return {
    pars: empty ? "" : row(pars),
    strokeIndex: empty ? "" : row(strokeIndex),
    yards: empty || yardsDropped ? "" : row(yards),
    unreadable: {
      pars: parBlanks,
      strokeIndex: siBlanks,
      yards: yardsDropped ? [] : yardBlanks,
    },
    yardsDropped,
    empty,
  };
}
