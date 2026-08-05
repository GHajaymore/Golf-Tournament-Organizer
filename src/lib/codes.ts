import "server-only";
import { randomInt } from "node:crypto";
import { CODE_ALPHABET, CODE_LENGTH } from "./code-format";

/**
 * Generating Round Codes and share tokens.
 *
 * Server-only: this pulls in `node:crypto`, and importing it from a client
 * component breaks the build. Formatting and validation live in
 * `code-format.ts`, which both sides can use.
 *
 * Two different jobs with two different shapes:
 *
 *   - A **share token** is only ever tapped from a link, so it is long and
 *     opaque — no one reads it aloud.
 *   - A **Round Code** is read off a printed tee sheet and typed on a phone at
 *     a golf course, sometimes in sunlight by someone who left their glasses
 *     in the cart. That constraint drives the alphabet and the length.
 */

/**
 * `randomInt` is rejection-sampled by Node, so this is unbiased — unlike
 * `randomBytes[i] % alphabet.length`, which would favour the first few
 * symbols and quietly shrink the keyspace.
 */
function randomFrom(alphabet: string, length: number): string {
  let out = "";
  for (let i = 0; i < length; i += 1) out += alphabet[randomInt(alphabet.length)];
  return out;
}

/**
 * A Round Code.
 *
 * 27^8 ≈ 2.8e11 combinations. Guessing is not the threat model a short code
 * defends against on its own — redemption is rate limited, which is what makes
 * the space large enough in practice.
 */
export function generateAccessCode(): string {
  return randomFrom(CODE_ALPHABET, CODE_LENGTH);
}

/** Opaque id for a public leaderboard link. */
export function generateShareToken(): string {
  return randomFrom(CODE_ALPHABET, 24);
}
