// Relative, not "@/": the e2e specs import this file (through rate-limit.ts and
// the code helper), and they run outside the app's path aliases.
import { SUPPORT_EMAIL } from "../contact";

/**
 * PROVING AN ADDRESS (2026-10-21, Ajay: "go for email verification").
 *
 * Until this day anybody who typed an address a club had invited — a staff
 * seat, a member on the roster — could set its first password and be signed in
 * as that person, and anybody could sign up with somebody else's address and
 * inherit every tournament that address was entered in. Nothing asked whether
 * they could read the mail. Now a six-digit code is emailed and typed back, and
 * `createSession` makes no session for a user who has not done that (or
 * finished a password reset from its emailed link).
 *
 * This file is the rule's pure half and the words: no clock, no database, no
 * crypto, so the sign-in panel can import the words. The hashing is in
 * `email-code-hash.ts`; the rows and the mail in `services/email-code.ts`.
 */

export const EMAIL_CODE_LENGTH = 6;
/** A code works for fifteen minutes, as a reset link does. */
export const EMAIL_CODE_TTL_MS = 15 * 60 * 1000;
/** Five wrong tries on one code, then a new code is needed. */
export const EMAIL_CODE_MAX_TRIES = 5;
/**
 * Twenty wrong tries on one ADDRESS in a day, whichever browsers made them.
 * Five a code and three codes in fifteen minutes is fifteen guesses a quarter
 * of an hour, which over a day is 1,440 tries at a million codes: about one
 * chance in 700 of somebody guessing their way onto an invited address. Twenty
 * a day makes that one in 50,000. Somebody who mistypes twenty times is told
 * to come back tomorrow, which costs them a day and nothing else.
 */
export const EMAIL_CODE_DAILY_TRIES = 20;

/**
 * What a code proves the address FOR — which decides what takes effect when it
 * is right. A sign-up: the account's password, name and first club. A claim:
 * the first password on an address a club invited.
 */
export type EmailCodePurpose = "signup" | "claim" | "device";

export function isEmailCodePurpose(value: unknown): value is EmailCodePurpose {
  return value === "signup" || value === "claim" || value === "device";
}

/**
 * The code a person typed, as six digits, or "" when it is not one.
 *
 * Spaces and dashes are dropped because a code copied out of an email often
 * carries them ("123 456"); anything else that is not a digit makes it not a
 * code. `unknown` because a `"use server"` export is called with whatever the
 * caller likes.
 */
export function codeFromTyped(typed: unknown): string {
  if (typeof typed !== "string") return "";
  const squeezed = typed.split(" ").join("").split("-").join("").trim();
  if (squeezed.length !== EMAIL_CODE_LENGTH) return "";
  for (const ch of squeezed) if (ch < "0" || ch > "9") return "";
  return squeezed;
}

/**
 * An address as the code panel shows it: its first letter and its domain —
 * enough for somebody to recognise their own, not enough to read a stranger's
 * off a shoulder. The same shape the server logs (`maskEmail`).
 */
export function maskedAddress(address: string): string {
  const at = (address ?? "").lastIndexOf("@");
  if (at <= 0) return "your email";
  return `${address[0]}***@${address.slice(at + 1)}`;
}

/** The parts of a stored code the rule reads. */
export interface StoredEmailCode {
  expiresAt: Date;
  attempts: number;
  usedAt: Date | null;
}

export type EmailCodeRefusal = "wrong" | "expired" | "too-many" | "today";

/**
 * Whether a stored code can be tried at all, before anything is compared.
 *
 * Nothing stored — no code was ever sent to this browser for this address, or
 * it was replaced — reads as EXPIRED, not as wrong: the remedy is the same
 * (send a new one), and "isn't right" would send somebody back to re-type a
 * code that can never work. A used code is spent the same way.
 */
export function codeUnusable(stored: StoredEmailCode | null, now: Date): EmailCodeRefusal | null {
  if (!stored || stored.usedAt) return "expired";
  if (stored.attempts >= EMAIL_CODE_MAX_TRIES) return "too-many";
  if (stored.expiresAt.getTime() <= now.getTime()) return "expired";
  return null;
}

/**
 * A wrong guess, counted: the fifth wrong one is told it has run out rather
 * than to check it, since checking it again cannot help.
 */
export function afterWrongGuess(attemptsNow: number): EmailCodeRefusal {
  return attemptsNow >= EMAIL_CODE_MAX_TRIES ? "too-many" : "wrong";
}

/**
 * THE WORDS — the marketing panel's, final (2026-10-21). One copy, read by the
 * panel, the server's refusals and the email.
 */
export const EMAIL_CODE_WORDS = {
  heading: "Enter your code",
  line: (masked: string) => `We sent a 6-digit code to ${masked}. It works for 15 minutes.`,
  claimHeading: "Confirm it's you",
  claimLine: (masked: string) =>
    `${masked} has been invited to a tournament. We've emailed a 6-digit code to that address. Enter it to set your password.`,
  // A club's staff signing in on a browser not seen before (2026-10-21).
  deviceHeading: "Confirm it's you",
  deviceLine: (masked: string) =>
    `You're signing in on a new device. We sent a 6-digit code to ${masked}. It works for 15 minutes.`,
  box: "6-digit code",
  placeholder: "123456",
  confirm: "Confirm email",
  confirming: "Confirming…",
  resend: "Send a new code",
  resent: "Sent — check your inbox",
  startAgain: "Wrong address? Start again",
  refusal: {
    wrong: "That code isn't right. Check it, or send a new one.",
    expired: "That code has expired. Send a new one.",
    "too-many": "Too many tries. Send a new code to carry on.",
    today: "Too many tries for this address today. Try again tomorrow.",
  } satisfies Record<EmailCodeRefusal, string>,
  /** `wait` is worded by `retryAfterText` — "4 minutes". */
  tooManySends: (wait: string) => `We've sent three codes in the last few minutes. You can ask for another in ${wait}.`,
  couldNotSend: `We couldn't send the email just now. Try again in a minute, or write to ${SUPPORT_EMAIL}.`,
  email: {
    subject: "Your TourneyHQ code",
    claimSubject: "Confirm it's you: your TourneyHQ code",
    preheader: "Enter it within 15 minutes to confirm your email.",
    intro: "Here's the code to confirm your email address on TourneyHQ:",
    claimIntro: "A club invited this address to a tournament on TourneyHQ. Here's the code to confirm it's yours:",
    deviceSubject: "Your TourneyHQ sign-in code",
    deviceIntro: "Somebody is signing in to your TourneyHQ account on a new device. Here's the code to confirm it's you:",
    deviceIgnore: "If this wasn't you, don't share this code, and reset your password from the sign-in screen: whoever tried knows it.",
    where: "Enter it on the screen where you asked for it. It works for 15 minutes.",
    ignore: "If this wasn't you, ignore this email. Nobody can use your address without this code.",
    signoff: "The TourneyHQ team",
    why: "You're getting this because somebody entered this address on TourneyHQ.",
  },
} as const;
