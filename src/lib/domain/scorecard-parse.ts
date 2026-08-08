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

  const strippedTotals: number[] = [];

  if (holes === 18) {
    // 21 = 9 + OUT + 9 + IN + TOT. 20 = one of the two nine-totals plus a
    // grand total. 19 = a grand total only.
    if (nums.length === 21) {
      strippedTotals.push(nums[9], nums[19], nums[20]);
      return { values: [...nums.slice(0, 9), ...nums.slice(10, 19)], strippedTotals };
    }
    if (nums.length === 20) {
      strippedTotals.push(nums[9], nums[19]);
      return { values: [...nums.slice(0, 9), ...nums.slice(10, 19)], strippedTotals };
    }
    if (nums.length === 19) {
      strippedTotals.push(nums[18]);
      return { values: nums.slice(0, 18), strippedTotals };
    }
  }

  if (holes === 9 && nums.length === 10) {
    strippedTotals.push(nums[9]);
    return { values: nums.slice(0, 9), strippedTotals };
  }

  // Anything else is handed back whole — the validator will say what's wrong
  // far more usefully than a guess here would.
  return { values: nums, strippedTotals };
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

  const lengthProblem = (row: CardProblem["row"], values: number[]) => {
    if (values.length !== holes) {
      problems.push({
        row,
        message: `Expected ${holes} numbers, found ${values.length}.`,
        holes: [],
      });
      return true;
    }
    return false;
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
