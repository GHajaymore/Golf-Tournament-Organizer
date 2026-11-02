/**
 * A BROWSER IN WORDS, for the "new sign-in" email (2026-10-21): "Chrome on
 * Windows", "Safari on iPhone". Read from the User-Agent header, which the
 * browser chooses and anybody can fake, so it is a description for a person
 * to recognise and never something any decision is made on.
 *
 * Order matters: Edge, Opera and Samsung Internet all say "Chrome" too, and
 * Chrome says "Safari", so the more particular names are looked for first.
 */

const BROWSERS: Array<[needle: string, name: string]> = [
  ["Edg/", "Edge"],
  ["OPR/", "Opera"],
  ["SamsungBrowser/", "Samsung Internet"],
  ["Firefox/", "Firefox"],
  ["FxiOS/", "Firefox"],
  ["CriOS/", "Chrome"],
  ["Chrome/", "Chrome"],
  ["Safari/", "Safari"],
];

const SYSTEMS: Array<[needle: string, name: string]> = [
  ["iPhone", "iPhone"],
  ["iPad", "iPad"],
  ["Android", "Android"],
  ["Windows", "Windows"],
  ["Mac OS X", "Mac"],
  ["Macintosh", "Mac"],
  ["CrOS", "Chromebook"],
  ["Linux", "Linux"],
];

export function deviceLabel(userAgent: string | null | undefined): string {
  const ua = userAgent ?? "";
  const browser = BROWSERS.find(([needle]) => ua.includes(needle))?.[1];
  const system = SYSTEMS.find(([needle]) => ua.includes(needle))?.[1];
  if (browser && system) return `${browser} on ${system}`;
  return browser ?? system ?? "an unrecognised browser";
}

/** The "new sign-in" email's words — said once, read by the mailer and its test. */
export const NEW_SIGN_IN_WORDS = {
  subject: "New sign-in to your TourneyHQ account",
  preheader: "If this was you, there is nothing to do.",
  intro: (device: string, when: string) =>
    `Your TourneyHQ account was just signed in on <strong>${device}</strong>, ${when}.`,
  ifYou: "If this was you, there is nothing to do.",
  ifNot:
    "If it wasn't you, reset your password from the sign-in screen straight away. A reset signs out every device, this one included.",
  why: "You're getting this because your account was signed in on a browser it had not been signed in on before.",
} as const;
