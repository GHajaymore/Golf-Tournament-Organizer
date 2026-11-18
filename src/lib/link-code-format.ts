/**
 * A PLAYER LINK CODE'S SHAPE, SAFE FOR THE BROWSER (one code box PR B, the
 * Principal Engineer's N1 on #1176).
 *
 * The alphabet, the length and the one reader of what somebody typed live here,
 * apart from `domain/player-link.ts` (which also holds the pass's lifetime rules
 * and the words of the whole feature), the same split `code-format.ts` made from
 * `codes.ts`. `/play` and `/p` ship their code boxes to a phone, and a box that
 * only needs to know the shape of a code should not carry the rest. Pure: no
 * clock, no database, no secret. `domain/player-link.ts` re-exports all of it, so
 * every other importer is unchanged.
 */

/** Crockford base32: 0-9 and A-Z without I, L, O and U. Thirty-two symbols, five bits each. */
export const LINK_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** Twelve symbols: 60 bits (`player-link.test.ts` holds it). */
export const LINK_CODE_LENGTH = 12;

/**
 * The longest thing a code box reads, WHOLE (a typed code, a pasted address, a
 * posted field): anything longer is not a code, whatever it holds. ONE figure
 * for both readers (`normaliseLinkCode` here, `codeShapeOf` in `code-shape.ts`),
 * so they cannot disagree about whether a long input is read at all: at 128 for
 * the one and 64 for the other, `k7qm2xra.t123` with fifty-odd spaces inside it
 * was a personal code to the first reader and a round code to the second.
 */
export const MAX_CODE_INPUT = 64;

/**
 * A code as somebody typed, pasted or read it, or null when it is not one.
 *
 * FORGIVING (design §2.1): case is ignored; spaces, dashes, dots and the middle
 * dot a code is read out with are dropped; O reads as 0, I and L as 1 (the
 * letters Crockford leaves out because they are mistaken for those digits). A
 * whole pasted link is read from its fragment. Anything else outside the
 * alphabet, or the wrong length, is not a code.
 */
export function normaliseLinkCode(input: unknown): string | null {
  if (typeof input !== "string" || input.length > MAX_CODE_INPUT) return null;
  let text = input;
  const hash = text.lastIndexOf("#");
  if (hash >= 0) text = text.slice(hash + 1);
  const folded = text
    .toUpperCase()
    .replace(/[\s\-.·•_]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  if (folded.length !== LINK_CODE_LENGTH) return null;
  for (const ch of folded) if (!LINK_ALPHABET.includes(ch)) return null;
  return folded;
}
