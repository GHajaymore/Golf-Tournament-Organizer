/**
 * The boundary for the club's course library (R2a, Security Lead S5).
 *
 * Every action in `actions/courses.ts` is typed, and every type is ERASED at
 * runtime: a `"use server"` export is a public endpoint, so what arrives is
 * whatever the caller sent. Three things were found that way:
 *
 *   `played`   read as `input.played ?? "ask"` and handed on as given. Any
 *              string that was not "ask" or "keep-history" fell through
 *              `settlePlayedCards` and RE-SCORED the played rounds with no
 *              question asked.
 *   numbers    `par: NaN` slipped past `teeProblem` (both comparisons are
 *              false) and `slopeRating: NaN` beside a real course rating
 *              cleared the "rating without slope" refusal and was stored as
 *              slope 0 — the state that refusal exists to prevent.
 *   strings    `input.name.trim()` threw on a non-string, and a name, a town
 *              or a pasted row had no length.
 *
 * Same discipline as `score-payload.ts`: parse rather than trust, refuse in
 * words rather than repair, and write nothing for a bad payload.
 */

export type PlayedCardChoice = "ask" | "keep-history" | "rescore";

const PLAYED: readonly string[] = ["ask", "keep-history", "rescore"];

/** What to do about rounds already scored. Anything unrecognised is the question, never the answer. */
export function playedChoice(value: unknown): PlayedCardChoice {
  return typeof value === "string" && PLAYED.includes(value) ? (value as PlayedCardChoice) : "ask";
}

export const MAX_NAME = 120;
export const MAX_TOWN = 120;
export const MAX_ROW = 600;
export const MAX_URL = 500;

const isText = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;
const isOptionalText = (v: unknown, max: number) => v === undefined || v === null || isText(v, max);

/** A hole row typed into the editor: numbers, blanks allowed (NaN), at most eighteen. */
function isHoleRow(v: unknown): boolean {
  return Array.isArray(v) && v.length <= 18 && v.every((n) => typeof n === "number");
}

const SHAPE = "That course didn't arrive in the shape it should. Reload the page and try again.";

/** A course typed into the editor: `saveClubCourse`. Null when it is fit to read. */
export function courseInputProblem(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return SHAPE;
  const c = input as Record<string, unknown>;
  if (typeof c.name !== "string") return "Enter a course name.";
  if (c.name.length > MAX_NAME) return `A course name is at most ${MAX_NAME} letters.`;
  if (!isOptionalText(c.city, MAX_TOWN)) return `A town is at most ${MAX_TOWN} letters.`;
  if (!isHoleRow(c.pars) || !isHoleRow(c.yards) || !isHoleRow(c.strokeIndex)) return SHAPE;
  if (c.id !== undefined && typeof c.id !== "string") return SHAPE;
  if (c.distanceUnit !== undefined && typeof c.distanceUnit !== "string") return SHAPE;
  return null;
}

/** A set of tees: `saveTee`. Every number must be a real one before `teeProblem` reads it. */
export function teeInputProblem(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return SHAPE;
  const t = input as Record<string, unknown>;
  if (typeof t.name !== "string") return "Give the tees a name — Blue, White, Red.";
  if (t.name.length > 60) return "A tees name is at most 60 letters.";
  if (typeof t.gender !== "string") return SHAPE;
  for (const key of ["courseRating", "slopeRating", "par"] as const) {
    if (typeof t[key] !== "number" || !Number.isFinite(t[key])) {
      return "Course Rating, Slope Rating and Par must be numbers. Leave a rating at 0 if you don't have it yet.";
    }
  }
  return null;
}

/** A card pasted from a club's website: `importClubCourseCard`. */
export function cardImportProblem(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return SHAPE;
  const c = input as Record<string, unknown>;
  if (typeof c.name !== "string") return "Enter a course name.";
  if (c.name.length > MAX_NAME) return `A course name is at most ${MAX_NAME} letters.`;
  if (!isOptionalText(c.city, MAX_TOWN)) return `A town is at most ${MAX_TOWN} letters.`;
  if (!isText(c.pars, MAX_ROW) || !isText(c.strokeIndex, MAX_ROW) || !isOptionalText(c.yards, MAX_ROW)) {
    return "Paste the card's rows as text — the pars, the stroke index and, if you have them, the yards.";
  }
  if (c.holes !== undefined && c.holes !== null && typeof c.holes !== "number") return SHAPE;
  if (!isOptionalText(c.sourceUrl, MAX_URL * 4)) return SHAPE;
  return null;
}
