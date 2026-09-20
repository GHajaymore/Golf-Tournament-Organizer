/**
 * WHETHER ANYBODY HAS CHECKED THIS COURSE CARD, SAID OUT LOUD.
 *
 * Ajay, 2026-09-19: "always give a warning to check the card", and then the
 * two things the warning is about — "accuracy or recent".
 *
 * The schema has carried `source`, `verifiedAt` and `verifiedBy` since the
 * course library was built, and its own comment says why: "a wrong par is
 * obvious the first time someone plays the hole; a wrong stroke index is
 * invisible, and it silently allocates handicap shots to the wrong holes for
 * the life of the course." The library marked unverified cards. Every screen
 * that SCORES against one said nothing at all.
 *
 * TWO RISKS, NOT ONE. A card can be wrong (imported from a directory and never
 * read by anybody at the club) or it can be stale (checked, correctly, before
 * the course rebuilt the 7th and moved two stroke indexes). The first is about
 * provenance and the second is about age, so a card that has been checked is
 * not thereby trustworthy for ever.
 *
 * NOT A REFUSAL. An unchecked card is usable — the alternative is refusing to
 * score a round because nobody has initialled the pars, which is the shape
 * CLAUDE.md warns about at length: "a guard that refuses a real golf course is
 * worse than no guard". This states what is known and leaves the decision with
 * the club.
 */

/** How old a checked card may be before it is worth checking again. */
export const RECHECK_AFTER_DAYS = 365;

/**
 * A CARD WITH PARS AND NO STROKE INDEX, WHICH IS NOW A STATE THAT EXISTS.
 *
 * Until 2026-09-19 the directory importer refused such a card outright and
 * stored nothing — throwing away every hole's par because one other column
 * was empty. It keeps them now, which is right, and creates a card that can
 * score GROSS and cannot allocate a single handicap stroke.
 *
 * That has to be said out loud wherever the card is used, because the failure
 * is the invisible one: `holeStrokesReceived` takes a stroke index per hole,
 * and a missing one reads as 18 — so every shot lands on the hole the app
 * thinks is hardest, silently, and a net leaderboard is wrong all day.
 */
/**
 * A stored card column as numbers — `"[7,3,11,…]"`, or "" where there is none.
 *
 * Kept beside the rule that reads it, because every caller of that rule has a
 * stored string and a hand-rolled parse in each one is a hand-rolled bug in
 * each one: `JSON.parse` throws on "" and on anything a directory ever sent
 * that was not an array.
 */
export function parseIndex(stored: string | null | undefined): number[] {
  if (!stored) return [];
  try {
    const v: unknown = JSON.parse(stored);
    return Array.isArray(v) ? v.map((n) => (typeof n === "number" && Number.isFinite(n) ? n : 0)) : [];
  } catch {
    return [];
  }
}

export function needsStrokeIndex(strokeIndex: readonly number[] | null | undefined): boolean {
  if (!strokeIndex || strokeIndex.length === 0) return true;
  return strokeIndex.every((v) => !v);
}

export interface CardTrust {
  /** "manual" (typed by the club) or "imported". */
  source: string;
  /** When somebody at the club confirmed the card, or null. */
  verifiedAt: Date | string | null;
  verifiedBy: string;
}

export interface TrustNote {
  /** "unchecked" | "stale" | "checked" — what the screen should say. */
  level: "unchecked" | "stale" | "checked";
  /** One sentence, in full, for a screen to print. */
  text: string;
  /** Whether this should read as a warning rather than as a footnote. */
  warn: boolean;
}

function asDate(v: Date | string | null): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

/**
 * What to say about this card, if anything.
 *
 * `today` is passed rather than read, so the sentence is a function of its
 * inputs and a test does not have to wait a year to see the stale one.
 */
export function cardTrustNote(
  card: CardTrust | null | undefined,
  today: Date = new Date(),
  formatDate: (d: Date) => string = (d) => d.toISOString().slice(0, 10),
  /** The card's stroke index, where the caller has it. See `needsStrokeIndex`. */
  strokeIndex?: readonly number[] | null,
): TrustNote | null {
  // No card at all is a different problem, and the screens that have one say
  // so themselves ("no card on file"). Nothing to add here.
  if (!card) return null;

  /**
   * FIRST, because it is the one that makes a number wrong rather than
   * doubtful. An unchecked card MIGHT be incorrect; a card with no stroke
   * index WILL allocate every shot to the same hole, on every net round, until
   * somebody types the index in.
   */
  if (strokeIndex !== undefined && needsStrokeIndex(strokeIndex)) {
    return {
      level: "unchecked",
      warn: true,
      text: `This course card has no stroke index, so handicap strokes cannot be allocated — net scores will be wrong until somebody enters it off the club's own scorecard. Gross scoring is unaffected.`,
    };
  }

  const verified = asDate(card.verifiedAt);
  if (!verified) {
    const where = card.source === "manual" ? "typed in" : "imported";
    return {
      level: "unchecked",
      warn: true,
      text: `This course card was ${where} and nobody at the club has checked it. Compare the pars and stroke index with the club's own scorecard — a wrong stroke index puts handicap shots on the wrong holes.`,
    };
  }

  const age = daysBetween(verified, today);
  if (age > RECHECK_AFTER_DAYS) {
    const by = card.verifiedBy.trim();
    return {
      level: "stale",
      warn: true,
      text: `This card was last checked on ${formatDate(verified)}${by ? ` by ${by}` : ""} — over a year ago. Courses change their stroke index when they change a hole, so it is worth checking against the club's scorecard.`,
    };
  }

  const by = card.verifiedBy.trim();
  return {
    level: "checked",
    warn: false,
    text: `Card checked on ${formatDate(verified)}${by ? ` by ${by}` : ""}.`,
  };
}
