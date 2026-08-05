/**
 * Round Code shape, formatting and validation.
 *
 * Split from `codes.ts` because generation needs `node:crypto`, and the
 * browser needs to display and validate codes. Importing the generator into a
 * client component drags Node crypto into the bundle and the build fails, so
 * everything safe for both sides lives here.
 */

/**
 * Unambiguous alphabet: no O/0, I/1/L, U/V, or S/5 — the pairs people
 * actually mistype off a printed card. 27 symbols.
 */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRTWXYZ2346789";

/** Codes are 8 characters, shown grouped as XXXX-XXXX. */
export const CODE_LENGTH = 8;

/** Display form: ABCD-EFGH. Stored unformatted. */
export function formatAccessCode(code: string): string {
  if (code.length !== CODE_LENGTH) return code;
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Normalize what someone typed: uppercase, and drop the spaces and dashes
 * they may have copied from the printed form.
 *
 * Deliberately does not try to "correct" characters the alphabet excludes.
 * Someone who types O might have meant Q or D, and guessing wrong fails
 * exactly the same way as not guessing — so a clear rejection they can retype
 * beats silent cleverness that mangles input which was already correct.
 */
export function normalizeAccessCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, "").slice(0, CODE_LENGTH);
}

/** Whether a string could be a code at all — checked before hitting the
 *  database, so malformed input never costs a query. */
export function looksLikeAccessCode(code: string): boolean {
  if (code.length !== CODE_LENGTH) return false;
  return [...code].every((c) => CODE_ALPHABET.includes(c));
}
