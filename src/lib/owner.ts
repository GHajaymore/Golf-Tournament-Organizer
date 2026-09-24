/**
 * WHO OWNS THE PLATFORM — the gate on the owner console.
 *
 * This is a different question from every other permission in the app. `role`
 * and `viewRole` say what a person may do inside ONE tournament; this says who
 * may look ACROSS all of them, at the business — clubs, tiers, revenue. There
 * is no row for it, because it is not a grant a club can make: it is the two or
 * three people who run TourneyHQ.
 *
 * So it is an ALLOW-LIST of emails in the environment (`OWNER_EMAILS`,
 * comma-separated), checked against the signed-in person's own address. It
 * fails CLOSED in every ambiguous case: no env value, an empty address, a value
 * that is only whitespace — none of them is an owner. A console that shows the
 * whole business must never open to somebody because a variable was unset.
 *
 * The email is compared case-insensitively and trimmed, because an allow-list a
 * human maintains will have a stray space and a capital letter in it, and
 * "AJ@Example.com " must not lock the owner out of their own console.
 *
 * The pure functions live here with no server imports, so the rule is tested
 * without a request. `requireOwner` — which reads the session and 404s a
 * stranger — lives next to the page, because it needs the server.
 */

/** The allow-list, parsed from the raw env value. Lower-cased and de-blanked. */
export function parseOwnerEmails(raw: string | null | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

/**
 * Is this the address of a platform owner?
 *
 * `allowList` defaults to the environment; it is a parameter so the rule can be
 * tested against a known list rather than the machine's env. Fails closed: an
 * empty address or an empty list is never an owner.
 */
export function isOwner(
  email: string | null | undefined,
  allowList: string = process.env.OWNER_EMAILS ?? "",
): boolean {
  const who = (email ?? "").trim().toLowerCase();
  if (!who) return false;
  return parseOwnerEmails(allowList).includes(who);
}
