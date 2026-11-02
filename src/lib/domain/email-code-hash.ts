import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { EMAIL_CODE_LENGTH } from "./email-code";

/**
 * The crypto half of proving an address — see `email-code.ts`. Server only:
 * the panel imports the words, never this.
 */

/** A fresh code: six digits, every one from the platform's CSPRNG. */
export function newEmailCode(): string {
  return String(randomInt(0, 10 ** EMAIL_CODE_LENGTH)).padStart(EMAIL_CODE_LENGTH, "0");
}

/**
 * What is stored in place of the code: sha256 of the user's id and the code.
 *
 * The raw code lives only in the email, as a reset token lives only in its
 * link. The user id is in it so that two people sent the same six digits do
 * not hold the same row value, and a hash read off one row says nothing about
 * another. (`e2e/verify-by-code.ts` writes this same shape to set a known code.)
 */
export function hashEmailCode(userId: string, code: string): string {
  return createHash("sha256").update(`${userId}:${code}`).digest("hex");
}

/** Compared in constant time, so a wrong guess learns nothing from the clock. */
export function sameCodeHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** The browser's own random value, kept in an HttpOnly cookie. */
export function newBrowserValue(): string {
  return randomBytes(32).toString("base64url");
}

/** What a code row stores of that value. */
export function hashBrowserValue(value: string): string {
  return createHash("sha256").update(`browser:${value}`).digest("hex");
}
