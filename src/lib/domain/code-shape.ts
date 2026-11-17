/**
 * ONE CODE BOX: THE SHAPE OF WHAT SOMEBODY TYPED (plan row 4c, simplicity cut 1;
 * design "One code box" §2-§3, Security verdict SAFE-WITH).
 *
 * A player is handed one of two codes to get in: a ROUND CODE (8 characters of
 * the 27-symbol round alphabet, `ABCD-EFGH`) or a guest's PERSONAL PLAYER LINK
 * code (12 characters of Crockford base32, `K7QM-2XRA-9DTP`). Either may be
 * typed into either box (/play or /p) and opens the same thing. Which one it
 * is is read from the WHOLE input, here, and nowhere else:
 *
 *   - exactly 8 symbols of the round alphabet           → `eight`
 *   - exactly 12 symbols after Crockford's folding      → `twelve`
 *   - anything else (6 digits, a token, an object, …)    → `none`
 *
 * Folding never changes a length, so no input is both. Nothing may decide a
 * shape from a TRUNCATED string: `/play` once cut every input to 8 characters,
 * so about a quarter of personal codes were looked up as round codes and the
 * first 8 characters of a 60-bit secret were written to the counter table
 * under an unkeyed hash (design §2.3). That `.slice` is gone from
 * `normalizeAccessCode`, and `code-shape.test.ts` holds it gone by a property.
 *
 * Pure: no database, no clock, no secret. It runs in the browser first (so a
 * code of no shape costs no request) and again on the server, which trusts
 * nothing the browser decided. It adds no alphabet of its own: it asks the two
 * readers that already exist (`looksLikeAccessCode`/`linkFromHash` for a round
 * code, `normaliseLinkCode` for a player link).
 *
 * The sentences a box says are here too (`CODE_WORDS`), ONE for every failure
 * and ONE for every throttle, whichever kind and whichever box: a wrong code
 * must not tell a guesser which kind it nearly was, or that it was once real.
 */
import { linkFromHash, looksLikeAccessCode, normalizeAccessCode, roundCodeLink } from "../code-format";
import { MAX_CODE_INPUT, normaliseLinkCode } from "../link-code-format";

/**
 * Every sentence the code boxes say (UX Writer). `opensNothing` is the ONE
 * answer to a code of the right shape that opens nothing — unknown, reissued,
 * codes switched off, a link turned off, replaced, expired or withdrawn — and
 * `tooMany` the ONE throttle sentence for every code budget
 * (`throttleMessage`). Neither names a kind.
 */
export const CODE_WORDS = {
  notACode:
    "That doesn't look like a TourneyHQ code. A round code has 8 characters, like ABCD-EFGH. A player link code has 12, like K7QM-2XRA-9DTP. A 6-digit code from an email goes on the screen that asked for it.",
  opensNothing: "That code doesn't open anything. Check it on your card, sign or message, or ask your organizer to read it out.",
  tooMany: (wait: string) => `Too many code attempts. Wait ${wait} and try again, or ask your organizer to read the code out.`,
  /** /play's box. */
  boxLabel: "Your code",
  boxHint: "Round code or player link code. Either works here.",
} as const;

export type CodeShape =
  /** A round code (and, after J39 PR 3B, an entry code: the same shape). `group` from a pasted sign address. */
  | { shape: "eight"; code: string; group: string | null }
  /** A guest's personal player link code. */
  | { shape: "twelve"; code: string }
  | { shape: "none" };

/** Longer than `MAX_CODE_INPUT` is not a code, whatever it holds (a `"use server"` argument is whatever was posted); the same figure `normaliseLinkCode` holds. */
export { MAX_CODE_INPUT };

const NONE: CodeShape = { shape: "none" };

/**
 * THE ONE READER of anything typed, pasted or posted into a code box.
 *
 * A pasted link is read from its fragment (after the last `#`). A sign's
 * address (`ABCD-EFGH.t3`) keeps its group; otherwise spaces, dashes, dots and
 * the middle dots a code is read out with are dropped and case is ignored.
 */
export function codeShapeOf(input: unknown): CodeShape {
  if (typeof input !== "string" || input.length > MAX_CODE_INPUT) return NONE;
  const hash = input.lastIndexOf("#");
  const text = (hash >= 0 ? input.slice(hash + 1) : input).trim();
  // A twelve is decided FIRST, from the whole input: no 8-character reading may see a personal code.
  const link = normaliseLinkCode(text);
  if (link) return { shape: "twelve", code: link };
  // A sign's address, group and all: exactly a code, or a code and a group.
  const sign = linkFromHash(text);
  if (sign.code) return { shape: "eight", code: sign.code, group: sign.group };
  // The WHOLE input, squeezed — never a prefix of it.
  const squeezed = normalizeAccessCode(text.replace(/[.·•_]/g, ""));
  if (looksLikeAccessCode(squeezed)) return { shape: "eight", code: squeezed, group: null };
  return NONE;
}

/** The boxes a code can be typed into. PR 3B adds `/register`'s. */
export type CodeBox = "play" | "p" | "register";

export type BoxStep =
  /** No shape: said beside the button, with no request made. */
  | { do: "refuse"; words: string }
  /** A round code typed outside /play: opened where a scanned sign opens it, with no extra press. */
  | { do: "go"; href: string }
  /** Ask the server's one door (`openCode`). */
  | { do: "ask" };

/**
 * What a box's script does with a shape before any server call. `box` is
 * REQUIRED, so a box added later is listed by the compiler. The SERVER never
 * hears which box asked: its answer cannot depend on it.
 */
export function boxStepFor(shape: CodeShape, box: CodeBox): BoxStep {
  if (shape.shape === "none") return { do: "refuse", words: CODE_WORDS.notACode };
  if (shape.shape === "eight" && box !== "play") {
    // The sign's own address, built by its one builder (escaped there): typed text never becomes an
    // address by any other route.
    return { do: "go", href: roundCodeLink("", shape.code, shape.group ?? undefined) };
  }
  return { do: "ask" };
}
