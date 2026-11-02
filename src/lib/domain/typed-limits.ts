/**
 * WHAT A TEXT BOX MAY HOLD, ONE ANSWER FOR THE SERVER AND THE SCREEN.
 *
 * Found by the text-box crawl (`e2e/every-text-box.spec.ts`, 2026-10-21): an
 * address box on Access stored "zz-not-an-address", another stored
 * `<b>…</b>@example.invalid`, and a name box stored 2,000 characters and pushed
 * the club's settings page sideways. Each action had its own copy of the email
 * pattern (six of them, all the same and all too loose) and no limit on a name.
 *
 * So the rule is here, and both halves read it: the action refuses what is out
 * of bounds in words (a `"use server"` export is a public endpoint, whatever
 * the box allows), and the box carries the same `maxLength`, so nothing typed
 * is ever cut short without the person seeing where it stopped.
 */

/**
 * An address, plainly shaped: something, an @, a domain with a dot in it — and
 * none of the characters that make markup or a list of addresses (`<>()[]\,;:"`)
 * or a space. Deliberately loose otherwise: the job is to refuse nonsense, not
 * to adjudicate RFC 5322. An apostrophe stays allowed (o'brien@…).
 */
export const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;

/** RFC 5321's limit on a whole address. */
export const EMAIL_MAX = 254;

/** A person's name: the public entry form's limit, and a casual round's. */
export const PERSON_NAME_MAX = 80;

/** A tournament's or a club's name. */
export const TITLE_MAX = 100;

/** A club's short name — "used in tight spaces". */
export const SHORT_NAME_MAX = 30;

/** A side's or a team's name: a cup team, a pair, a flight. */
export const TEAM_NAME_MAX = 40;

/**
 * A playing side's name on Teams & pairs. Longer than a team's, because the app
 * names a pair after its two players ("Séamus O'Halloran-Whyte & Bernadette …"),
 * and a name the app wrote must still be one the box can hold.
 */
export const SIDE_NAME_MAX = PERSON_NAME_MAX * 2 + 3;

/** A town, a region, a country — and a home club. */
export const PLACE_MAX = 80;

/** A telephone number as somebody writes it, spaces and brackets included. */
export const PHONE_MAX = 40;

/** The one wording for an address that is not one. */
export const EMAIL_REFUSAL = "Enter a valid email address.";

/** Whether this (already trimmed) text is an address the app will store. */
export function isEmailAddress(clean: string): boolean {
  return clean.length <= EMAIL_MAX && EMAIL_RE.test(clean);
}

/**
 * The refusal for a name that is blank or too long, or null when it will do.
 * `blank` is the screen's own sentence for an empty box ("Enter a player name.").
 */
export function nameRefusal(clean: string, max: number, blank: string): string | null {
  if (!clean) return blank;
  if (clean.length > max) return `Keep the name to ${max} characters.`;
  return null;
}
