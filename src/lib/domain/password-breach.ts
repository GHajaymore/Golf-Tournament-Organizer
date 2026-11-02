/**
 * HAS THIS PASSWORD BEEN LEAKED SOMEWHERE ELSE? (2026-10-21) — the pure half.
 *
 * `password.ts` refuses the passwords people guess first, from a short list
 * kept in the file. A real list of leaked passwords holds about a billion, and
 * the standard way to ask it is Have I Been Pwned's range API, which never
 * learns the password: the SHA-1 of it is split, only the first five
 * characters are sent, and the answer is every leaked hash that starts with
 * them (hundreds of lines). Whether ours is among them is decided here, on our
 * side. With `Add-Padding: true` the answer also carries made-up lines with a
 * count of 0, so even its length says nothing; a count of 0 is not a leak.
 *
 * This file holds the arithmetic and the words. The request is made in
 * `services/password-breach.ts`.
 */

/** What is sent (the first five hex characters) and what is looked for (the rest). */
export function breachRangeParts(sha1Hex: string): { prefix: string; suffix: string } {
  const upper = sha1Hex.toUpperCase();
  return { prefix: upper.slice(0, 5), suffix: upper.slice(5) };
}

/**
 * Is `suffix` in the range's answer with a count above nought? The answer is
 * lines of `SUFFIX:COUNT`, upper-case hex, CRLF or LF.
 */
export function seenInRange(body: string, suffix: string): boolean {
  const wanted = suffix.toUpperCase();
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    if (line.slice(0, colon).toUpperCase() !== wanted) continue;
    const count = Number(line.slice(colon + 1));
    return Number.isFinite(count) && count > 0;
  }
  return false;
}

/** Said under the password box, where every other password refusal is said. */
export const PASSWORD_SEEN_IN_BREACH =
  "That password has turned up in a data leak from another website, so it is one of the first that gets tried. Choose a different one.";
