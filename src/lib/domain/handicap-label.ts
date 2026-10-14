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
import { decimalPoint, plainFigure, readDecimal } from "./decimal-text";

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
/**
 * THE RANGE OF A HANDICAP INDEX, ONCE. A WHS index runs from +10 (a plus
 * handicap, better than scratch, held as a negative number) to 54.0. Anything
 * outside it is a typo or a joke: 124 for 12.4 is six strokes a hole.
 *
 * It was written three times — here, in `registration-intake.ts` and in
 * `quick-match.ts` — and checked in the forms and NOT on the server, where four
 * actions stored whatever finite number they were handed (`indexRefusal`).
 */
export const INDEX_MIN = -10;
export const INDEX_MAX = 54;
export const STROKES_MIN = INDEX_MIN;
export const STROKES_MAX = INDEX_MAX;

/** What was typed in a box for a handicap index. */
export type TypedIndex =
  /** Nothing. NOT nought: a scratch handicap is a claim and an empty box is the absence of one. */
  | { kind: "blank" }
  | { kind: "index"; value: number }
  /** Not a figure at all: a letter in it, two points, "1e1". */
  | { kind: "unreadable" }
  /** A figure no golfer has. */
  | { kind: "out-of-range"; value: number };

/**
 * A HANDICAP INDEX AS A GOLFER WRITES ONE, read one way for every box.
 *
 * "12.4"; "12,4" as half of Europe writes it; "+2.4" for a plus handicap,
 * which is 2.4 strokes BETTER than scratch and is held as −2.4 — the leading
 * plus is golf's notation, not arithmetic, which is why `parseFloat` gets the
 * sign backwards; and the same figures in a Japanese keyboard's full-width
 * digits (`plainFigure`).
 *
 * There were three readers. The entry form and the roster refused a figure
 * outside the range; a quick match clamped it; a casual round's box did
 * neither, read an EMPTIED box as nought — making the player a scratch golfer —
 * and sent 124 to a server that stored it. This says what was typed and
 * nothing else. What a box does with a blank, a typo or an impossible figure
 * is still that box's decision, and each of the three now makes it out loud.
 */
export function readHandicapIndex(raw: string | null | undefined): TypedIndex {
  const typed = decimalPoint(raw);
  if (typed === "") return { kind: "blank" };
  const plus = typed.startsWith("+");
  const rest = plus ? typed.slice(1) : typed;
  // "+-2" and "++2" are not figures: the one sign allowed after a plus is none.
  if (plus && /^[+-]/.test(rest)) return { kind: "unreadable" };
  const read = readDecimal(rest);
  if (read.kind !== "number") return { kind: "unreadable" };
  const signed = plus ? -Math.abs(read.value) : read.value;
  const value = signed === 0 ? 0 : signed;
  if (value < INDEX_MIN || value > INDEX_MAX) return { kind: "out-of-range", value };
  return { kind: "index", value };
}

/**
 * WHY THE SERVER WILL NOT STORE THIS FIGURE AS AN INDEX, or null when it will.
 *
 * For the actions, which are handed a NUMBER by whatever called them — a form
 * that checked, a form that did not, or no form at all. Not finite is refused
 * as well: `NaN` is how a form says "left blank", and an action that means to
 * allow a blank asks before calling this.
 */
export function indexRefusal(index: unknown): string | null {
  if (typeof index !== "number" || !Number.isFinite(index)) return "Enter the handicap as a number, like 12.4 — or +2.4 for a plus handicap.";
  if (index < INDEX_MIN || index > INDEX_MAX) return "A handicap index runs from +10 to 54.";
  return null;
}

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
  const value = plainFigure(raw);
  const HOW = "Enter the strokes as a whole number, like 12 — or +2 for a plus handicap.";
  if (value === "") return { ok: false, error: HOW };
  if (value.toLowerCase() === "scratch") return { ok: true, value: 0 };
  // The one reading of a typed figure (`readDecimal`): "1e1" and "0x10" are not strokes.
  const plus = value.startsWith("+");
  const read = readDecimal(plus ? value.slice(1) : value);
  if (read.kind !== "number" || (plus && /^[+-]/.test(value.slice(1)))) return { ok: false, error: HOW };
  const parsed = plus ? -Math.abs(read.value) : read.value;
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
