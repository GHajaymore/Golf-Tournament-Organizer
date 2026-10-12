/**
 * WHAT A PLAYER'S INDEX SAYS ON A SCREEN.
 *
 * One function because five screens print this number, and until 2026-09-18
 * every one of them printed it raw — so a member nobody has an index for read
 * as **0**, which is a scratch golfer. `handicap-policy.ts` calls that outcome
 * catastrophic and exists to make it impossible:
 *
 *   "A 24-handicapper playing off scratch does not look like an outage; it
 *    looks like a competition, and it is settled and paid out before anybody
 *    works out why the results are absurd."
 *
 * `handicapSource: "none"` is how the rest of the app already says nobody has
 * claimed a figure. `upsertMember` writes it deliberately — a club playing off
 * association indexes gets "an unfinished roster row rather than a player at
 * zero" — and the entry path copies it onto the Player, so every screen that
 * shows a field can tell the two apart. They just have to ask.
 *
 * ONE READER RATHER THAN FIVE, for the reason this codebase gives every time:
 * the sixth screen is written by somebody who never read this paragraph, and a
 * rule that lives in five components is five chances to print a zero.
 */
export interface IndexLike {
  handicap: number;
  /** "18" or "9" — which index the figure represents. */
  handicapType?: string | null;
  /** ghin | manual | none. "none" means nobody has claimed a figure. */
  handicapSource?: string | null;
}

/** The words for a missing index. One string, so five screens cannot differ. */
export const NO_INDEX = "no index";

/**
 * THE FIGURE, AS A GOLFER WRITES IT: a plus handicap is "+2.4", never "-2.4".
 *
 * A handicap better than scratch is stored below zero, because that is what
 * the arithmetic needs: such a player GIVES strokes. It is written with a plus
 * sign, by every golfer and by the World Handicap System, and this app reads
 * it that way on the way in (`parseHandicapInput`: "+2.4" is 2.4 better than
 * scratch). On the way out it printed the stored number — so the best players
 * in a club stood on the Members list, the flights, the tee sheet and the
 * entry screens as "-2.4" (found 2026-10-13 by importing a member as "+2.4"
 * and reading the list back). Four screens already wrote it properly, each
 * with its own ternary; this is the one place the rule is said.
 */
export function indexFigure(handicap: number): string {
  return handicap < 0 ? `+${Math.abs(handicap)}` : `${handicap}`;
}

/** What a round's own handicap may be: WHS's ceiling, and plus ten at the other end. */
export const STROKES_MIN = -10;
export const STROKES_MAX = 54;

export type StrokesParse = { ok: true; value: number } | { ok: false; error: string };

/**
 * A ROUND'S HANDICAP, AS SOMEBODY TYPES IT: whole strokes, and "+2" gives two.
 *
 * The round's handicap box read what was typed with `Number()`, which is
 * arithmetic, and to arithmetic "+2" is two. So the screen said "plays off +2",
 * the organizer pressed Set, typed what the screen had just shown them, and a
 * player who GIVES two strokes was saved as one who RECEIVES two — four strokes
 * out, in that round only, on every net figure it produced. The box also opened
 * on "-2", the stored number, beside the "+2" of the sentence it sat in (found
 * 2026-10-13, reading the editor after the Members form had the same fault).
 *
 * Three more things `Number()` let through quietly, each of which is now said:
 * an empty box was scratch (it is zero to arithmetic); "12.4" was rounded on
 * the server without a word, when this figure is whole strokes; and 77 was cut
 * down to 54. "scratch" is read as 0, because it is the word this screen prints.
 */
export function parseStrokesInput(raw: string | null | undefined): StrokesParse {
  const value = (raw ?? "").trim();
  const HOW = "Enter the strokes as a whole number, like 12 — or +2 for a plus handicap.";
  if (value === "") return { ok: false, error: HOW };
  if (value.toLowerCase() === "scratch") return { ok: true, value: 0 };
  const parsed = Number(value.startsWith("+") ? `-${value.slice(1)}` : value);
  if (!Number.isFinite(parsed)) return { ok: false, error: HOW };
  if (!Number.isInteger(parsed)) {
    return { ok: false, error: "A round's handicap is whole strokes — 12, not 12.4. The index stays on the roster." };
  }
  if (parsed < STROKES_MIN || parsed > STROKES_MAX) {
    return { ok: false, error: "A handicap runs from +10 to 54." };
  }
  // "+0" comes to minus zero, which a test comparing with `toBe(0)` calls a different number.
  return { ok: true, value: parsed === 0 ? 0 : parsed };
}

export function indexLabel(p: IndexLike): string {
  if ((p.handicapSource ?? "manual") === "none") return NO_INDEX;
  // The nine-hole marker rides along, because "12.4" and "12.4 over nine" are
  // different figures and a screen that drops the distinction is wrong in the
  // direction that allocates the wrong shots.
  return p.handicapType === "9" ? `${indexFigure(p.handicap)} (9)` : indexFigure(p.handicap);
}

/**
 * Whether this figure is safe to play off.
 *
 * Separate from the label because a screen asking "may I sort by this" is
 * asking something different from "what do I print". A missing index is not a
 * small number: it is the absence of one, and code that sorts, balances
 * flights or pairs on it is making a decision from nothing.
 */
export function hasIndex(p: IndexLike): boolean {
  return (p.handicapSource ?? "manual") !== "none";
}
