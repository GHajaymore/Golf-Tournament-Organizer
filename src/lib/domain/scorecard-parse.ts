/**
 * Reading a course card, and — more importantly — checking it.
 *
 * The numbers can arrive three ways: typed, pasted from a club website, or
 * extracted from a photograph. This module does not care which. It parses
 * loosely and validates strictly, because the validation is the part that
 * makes any of those sources safe to trust.
 *
 * The check that matters most is the stroke index. A wrong par shows up the
 * first time someone plays the hole; a wrong stroke index is invisible and
 * quietly allocates handicap shots to the wrong holes for the life of the
 * course. But it has one property that makes it *machine-checkable*: on a real
 * 18-hole card the stroke indexes are exactly 1 to 18, each used once. An OCR
 * misread almost always breaks that — two 6s and no 8 — so the error is caught
 * before anyone plays off it.
 *
 * Pars and yards have no such invariant, so they get range checks and a total
 * an organizer can eyeball against the card in their hand.
 */

export interface ParsedCardRow {
  /** The values found, in hole order. */
  values: number[];
  /** Totals that were present and stripped (OUT / IN / TOT). */
  strippedTotals: number[];
}

/**
 * Pull the hole values out of one row of a card.
 *
 * Club websites and OCR both hand back rows with the out/in/total columns
 * mixed in — "4 5 3 4 4 4 3 4 5 36 4 4 3 4 5 4 3 4 4 35 71". Those totals sit
 * at predictable positions once you know the hole count, so they are removed
 * by position rather than by guessing at magnitude: a par-36 nine and a
 * 36-yard hole are both plausible numbers in isolation.
 */
export function parseCardRow(text: string, holes = 18): ParsedCardRow {
  const nums = (text.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => Number.isFinite(n));

  // Exactly the hole count: nothing to strip.
  if (nums.length === holes) return { values: nums, strippedTotals: [] };

  /**
   * Strip the totals by ARITHMETIC rather than by position.
   *
   * This used to assume a layout from the count alone — 20 numbers meant
   * "nine, OUT, nine, TOTAL", so it dropped whatever sat at index 9 and 19.
   * That is right for a tidy card and silently wrong for a real one. A card
   * pasted with one par missing from the front nine still has 20 numbers, so
   * the OUT total was kept AS A PAR and a real hole was thrown away: the
   * screen showed par 36 on the 9th, and the only complaint was a flat "every
   * hole needs a par between 3 and 6" with nothing said about where or why.
   *
   * A total is a number that equals the sum of the run in front of it, and
   * that is checkable rather than guessable. Only after a full nine, or as a
   * grand total once the whole card is in — so an ordinary par 4 that happens
   * to equal something cannot be mistaken for one.
   */
  const values: number[] = [];
  const strippedTotals: number[] = [];
  const nine = holes === 9 ? 9 : 9;
  let run = 0;
  let runCount = 0;
  let all = 0;

  for (const n of nums) {
    const endsANine = runCount === nine && n === run;
    const isGrandTotal = values.length === holes && n === all;
    if (endsANine || isGrandTotal) {
      strippedTotals.push(n);
      run = 0;
      runCount = 0;
      continue;
    }
    values.push(n);
    all += n;
    run += n;
    runCount += 1;
  }

  if (values.length === holes) return { values, strippedTotals };

  /**
   * The arithmetic did not resolve it — the card does not add up, which is
   * usually a hole missing from the paste. Fall back to the old positional
   * reading only where it is unambiguous, and otherwise hand the numbers back
   * whole so the validator can say what is wrong. A wrong card entered
   * silently is worse than one that refuses to load.
   */
  if (holes === 18 && nums.length === 21) {
    return { values: [...nums.slice(0, 9), ...nums.slice(10, 19)], strippedTotals: [nums[9], nums[19], nums[20]] };
  }
  if (holes === 18 && nums.length === 19) {
    return { values: nums.slice(0, 18), strippedTotals: [nums[18]] };
  }
  if (holes === 9 && nums.length === 10) {
    return { values: nums.slice(0, 9), strippedTotals: [nums[9]] };
  }

  return { values: nums, strippedTotals: [] };
}

export interface CardProblem {
  row: "pars" | "yards" | "strokeIndex";
  message: string;
  /** Hole numbers (1-based) worth looking at. */
  holes: number[];
}

export interface ParsedCard {
  pars: number[];
  yards: number[];
  strokeIndex: number[];
  problems: CardProblem[];
  /** Whether this is safe to save without someone re-reading the card. */
  ok: boolean;
  /** Totals, for eyeballing against the physical card. */
  totals: { par: number; yards: number; outPar: number; inPar: number };
}

/**
 * Check a card, whatever produced it.
 *
 * Reports every problem rather than the first, because someone re-typing from
 * a photograph wants the whole list, not one at a time.
 */
export function validateCard(
  pars: number[],
  yards: number[],
  strokeIndex: number[],
  holes = 18,
): ParsedCard {
  const problems: CardProblem[] = [];

  /**
   * Say what is actually wrong, not just that the count is off.
   *
   * "Expected 18 numbers, found 20" is true and useless: the reader cannot
   * tell whether they pasted too much or too little, and the commonest cause
   * — one hole missing from a row that still carries its totals — reads as
   * having pasted too MANY. Totals are stripped by arithmetic upstream, so
   * anything left over is a card that does not reconcile, and saying so is
   * the only hint worth giving.
   */
  const lengthProblem = (row: CardProblem["row"], values: number[]) => {
    if (values.length === holes) return false;
    const label = row === "pars" ? "par" : row === "yards" ? "yardage" : "stroke index";
    const short = holes - values.length;
    const message =
      values.length > holes
        ? `Found ${values.length} numbers for ${holes} holes on the ${label} row. The totals could not be ` +
          `told apart from the holes, which usually means one hole is missing — check each nine adds up to ` +
          `the OUT and IN figures on the card.`
        : `Found only ${values.length} numbers for ${holes} holes on the ${label} row. ` +
          `${short} hole${short === 1 ? " is" : "s are"} missing.`;
    problems.push({ row, message, holes: [] });
    return true;
  };

  // ── Pars ──────────────────────────────────────────────────────────────
  if (!lengthProblem("pars", pars)) {
    const odd = pars
      .map((p, i) => (p >= 3 && p <= 6 ? -1 : i + 1))
      .filter((h) => h > 0);
    if (odd.length) {
      problems.push({
        row: "pars",
        message: "A par should be 3, 4, 5 or occasionally 6.",
        holes: odd,
      });
    }
    // The two checks every hole passing individually cannot catch. Shared, so
    // a card typed, pasted, imported or photographed is held to one standard —
    // they used to live only in the directory importer, and Green Crest's
    // scrambled card sailed straight through the paste box.
    const shape = implausibleCard(pars, holes);
    if (shape) problems.push({ row: "pars", message: shape, holes: [] });
  }

  // ── Yards ─────────────────────────────────────────────────────────────
  // Optional: plenty of clubs never enter them, and nothing scores off them.
  if (yards.length > 0 && !lengthProblem("yards", yards)) {
    const odd = yards.map((y, i) => (y >= 50 && y <= 700 ? -1 : i + 1)).filter((h) => h > 0);
    if (odd.length) {
      problems.push({
        row: "yards",
        message: "That yardage looks wrong for a golf hole.",
        holes: odd,
      });
    }
  }

  // ── Stroke index — the one that can be checked properly ───────────────
  if (!lengthProblem("strokeIndex", strokeIndex)) {
    const seen = new Map<number, number[]>();
    strokeIndex.forEach((si, i) => {
      const list = seen.get(si);
      if (list) list.push(i + 1);
      else seen.set(si, [i + 1]);
    });

    const duplicates = [...seen.entries()].filter(([, hs]) => hs.length > 1);
    if (duplicates.length) {
      problems.push({
        row: "strokeIndex",
        message: `Stroke index ${duplicates.map(([si]) => si).join(", ")} used more than once — every hole gets its own.`,
        holes: duplicates.flatMap(([, hs]) => hs),
      });
    }

    const missing: number[] = [];
    for (let n = 1; n <= holes; n += 1) if (!seen.has(n)) missing.push(n);
    if (missing.length) {
      problems.push({
        row: "strokeIndex",
        message: `Stroke index ${missing.join(", ")} missing — a card uses 1 to ${holes}, once each.`,
        holes: [],
      });
    }

    const outOfRange = strokeIndex
      .map((si, i) => (si >= 1 && si <= holes ? -1 : i + 1))
      .filter((h) => h > 0);
    if (outOfRange.length) {
      problems.push({
        row: "strokeIndex",
        message: `Stroke index must be between 1 and ${holes}.`,
        holes: outOfRange,
      });
    }
  }

  const sum = (a: number[]) => a.reduce((s, n) => s + n, 0);
  return {
    pars,
    yards,
    strokeIndex,
    problems,
    ok: problems.length === 0,
    totals: {
      par: sum(pars),
      yards: sum(yards),
      outPar: sum(pars.slice(0, 9)),
      inPar: sum(pars.slice(9)),
    },
  };
}

/**
 * Parse three pasted rows into a checked card.
 *
 * Works for a card copied off a club's website, typed from the one in the pro
 * shop, or handed over by an image extractor — the shape is the same and so is
 * the checking.
 */
export function parseCard(
  input: { pars: string; yards?: string; strokeIndex: string },
  holes = 18,
): ParsedCard {
  const pars = parseCardRow(input.pars, holes).values;
  const yards = input.yards?.trim() ? parseCardRow(input.yards, holes).values : [];
  const strokeIndex = parseCardRow(input.strokeIndex, holes).values;
  return validateCard(pars, yards, strokeIndex, holes);
}

/* ── Which pasted row is which ─────────────────────────────────────────────── */

/** A pasted card split into the three rows a card editor needs. */
export interface AssignedCardRows {
  pars: string;
  strokeIndex: string;
  yards: string;
  /** What each row was recognised as, in the order pasted, for the note the
   *  screen shows back. Empty where a row was skipped. */
  recognised: string[];
  /** Whether the labels decided it, as opposed to falling back to position. */
  byLabel: boolean;
}

/** What a row calls itself, if anything. */
type RowKind = "par" | "si" | "yards" | "holes" | "unlabelled";

/**
 * The words clubs actually print at the head of each row.
 *
 * Matched against the leading text of the line only, so a "Yards" column
 * heading buried mid-row cannot reclassify a par row. Stroke index is the
 * longest list because nobody agrees what to call it: S.I., Index, HCP,
 * Handicap, Stroke are all in common use on real cards.
 */
const ROW_LABELS: Array<{ kind: RowKind; re: RegExp }> = [
  { kind: "holes", re: /^(hole|holes|#|no\.?)\b/ },
  { kind: "par", re: /^par\b/ },
  { kind: "si", re: /^(s\s*\.?\s*i|stroke|index|hcp|hdcp|handicap|hdc)\b/ },
  { kind: "yards", re: /^(yard|yds?|yardage|metre|meter|mtrs?|length|distance|tee)\b/ },
];

function kindOf(line: string): RowKind {
  // Leading text only — the label, before any numbers start.
  const lead = line.replace(/^[^a-z0-9#]+/i, "").toLowerCase();
  for (const { kind, re } of ROW_LABELS) if (re.test(lead)) return kind;
  return "unlabelled";
}

/** Exactly 1..n ascending — a hole-number header, not a card row. */
function looksLikeHoleNumbers(values: number[], holes: number): boolean {
  if (values.length !== holes) return false;
  return values.every((v, i) => v === i + 1);
}

/**
 * Work out which pasted row is the par, which the stroke index, which the
 * yardage — by reading what the rows call themselves.
 *
 * This used to be positional: line one par, line two stroke index, line three
 * yardage. That assumes somebody selected exactly three rows in exactly that
 * order, and the ordinary thing to do with a table on a club's website is
 * select the whole thing. Then the "Hole 1 2 3 …" header became the pars and
 * the paste failed with "every hole needs a par between 3 and 6" — true, and
 * no help at all in working out what went wrong.
 *
 * Labels first, position as the fallback, so a bare three-row paste keeps
 * working exactly as it did. Rows that identify themselves as hole numbers are
 * dropped, and so is an unlabelled 1..18 ascending row where there are enough
 * others to fill the card — that shape is a header, and reading it as a stroke
 * index would allocate every handicap stroke to the wrong hole.
 */
export function assignCardRows(text: string, holes = 18): AssignedCardRows {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: AssignedCardRows = { pars: "", strokeIndex: "", yards: "", recognised: [], byLabel: false };

  const leftovers: string[] = [];
  for (const line of lines) {
    const kind = kindOf(line);
    if (kind === "holes") {
      out.recognised.push("hole numbers");
      continue;
    }
    // First labelled row of each kind wins. A card printed with a yardage row
    // per tee set gives several; the first is as good a choice as any, and
    // silently taking the last would depend on paste order again.
    if (kind === "par" && !out.pars) {
      out.pars = line;
      out.byLabel = true;
      out.recognised.push("par");
      continue;
    }
    if (kind === "si" && !out.strokeIndex) {
      out.strokeIndex = line;
      out.byLabel = true;
      out.recognised.push("stroke index");
      continue;
    }
    if (kind === "yards" && !out.yards) {
      out.yards = line;
      out.byLabel = true;
      out.recognised.push("yardage");
      continue;
    }
    if (kind !== "unlabelled") {
      // A second par/SI/yardage row — a card with several tee sets.
      out.recognised.push("");
      continue;
    }
    leftovers.push(line);
  }

  // Unlabelled rows fill whatever is still missing, in card order. Hole-number
  // rows are dropped first, and only while enough others remain to fill the
  // slots — so a genuine 1..18 stroke index still gets in on a card that has
  // nothing else to offer.
  const needed = [!out.pars, !out.strokeIndex, !out.yards].filter(Boolean).length;
  const usable =
    leftovers.length > needed
      ? leftovers.filter((l) => !looksLikeHoleNumbers(parseCardRow(l, holes).values, holes))
      : leftovers;

  for (const line of usable) {
    if (!out.pars) {
      out.pars = line;
      out.recognised.push("par");
    } else if (!out.strokeIndex) {
      out.strokeIndex = line;
      out.recognised.push("stroke index");
    } else if (!out.yards) {
      out.yards = line;
      out.recognised.push("yardage");
    }
  }

  return out;
}

/**
 * What is wrong with a set of pars that every hole passing on its own cannot
 * show, or null when the shape is fine.
 *
 * Two checks, both learned from real data rather than imagined.
 *
 * **Sorted rather than routed.** Green Crest Golf Course comes out of the
 * public directory as five par 5s, then six par 4s, then seven par 3s: a valid
 * stroke index, a par total matching the course's own, and every hole in range.
 * No golf course is routed in descending par, and a card like that is wrong on
 * every hole while passing every arithmetic test. All-equal pars are exempt —
 * a flat card is a placeholder, not a scrambled one.
 *
 * **A total nobody plays.** "Beaver Creek Meadows Golf Course, par 79" is in
 * the same directory. Real eighteens run 66 to 74; the band here is generous on
 * both sides and still catches it. Scaled for nine holes, where the same
 * reasoning gives roughly half.
 *
 * Lives here, beside the row parsing, because EVERY way a card enters this app
 * goes through `validateCard` — typed, pasted, imported or photographed — and a
 * check that guards only one of them guards none of them.
 */
export function implausibleCard(pars: number[], holes = 18): string | null {
  if (pars.length !== holes) return null;

  const total = pars.reduce((sum, p) => sum + p, 0);
  const low = holes === 9 ? 30 : 60;
  const high = holes === 9 ? 39 : 78;
  if (total < low || total > high) {
    return `These pars add up to ${total}, which no ${holes}-hole course plays. Check the row lines up with the holes.`;
  }

  if (new Set(pars).size > 1) {
    const up = pars.every((p, i) => i === 0 || p >= pars[i - 1]);
    const down = pars.every((p, i) => i === 0 || p <= pars[i - 1]);
    if (up || down) {
      return "These pars are in sorted order rather than hole order, so the card would be wrong on every hole. Check they are listed as the course is played.";
    }
  }

  return null;
}


/**
 * The one sentence that refuses a card, wherever a card is written.
 *
 * `validateCard` already holds every rule. What was missing was anywhere that
 * MADE the write paths use it: pasting a card ran the full check, a player
 * naming a new course at score entry got a weaker one, the library editor
 * checked only the stroke index, and the score-entry course setup checked
 * nothing at all. Four ways in, four standards, and the weakest of them was
 * the one a player reaches on the first tee.
 *
 * So this is the single refusal every write path calls. It returns null when
 * the card is fit to store, and otherwise the first problem phrased for the
 * person holding the card — naming the hole, because "invalid card" tells
 * somebody nothing about what to look at.
 *
 * Reporting the FIRST problem rather than all of them is deliberate here:
 * these callers have one error line, unlike the paste screen which lists
 * every problem beside the boxes as you type.
 */
export function cardRefusal(
  pars: number[],
  yards: number[],
  strokeIndex: number[],
  holes = 18,
): string | null {
  const card = validateCard(pars, yards, strokeIndex, holes);
  if (card.ok) return null;
  const first = card.problems[0];
  if (!first) return null;
  if (first.holes.length === 0) return first.message;
  const which = first.holes.length === 1 ? "hole" : "holes";
  return `${first.message} Check ${which} ${first.holes.join(", ")}.`;
}