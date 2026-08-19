/**
 * The name a newly created organization takes on a person's first tournament.
 *
 * Pulled out of the server-only organization service so the decision — which is
 * the whole of what 2a changes — is a pure function that can be tested without
 * a database.
 *
 * Order of preference:
 *   1. an explicit club/society/company name the organizer typed, if any
 *   2. their own display name (the behaviour before the field existed)
 *   3. their email, as a last resort when a name is somehow blank
 *
 * This only ever names an organization at the moment it is created. It is never
 * used to rename an existing one — someone who already owns a club must not
 * have it renamed because they typed something different on a later event.
 */
export function newOrganizationName(
  orgName: string | undefined | null,
  displayName: string,
  email: string,
): string {
  return orgName?.trim() || displayName.trim() || email;
}

/**
 * Whether the organizer has actually NAMED their organization, as against the
 * app having derived one for them.
 *
 * `named` cannot mean "the name column is non-empty". Since sign-up creates the
 * organization, every one of them has a name from the moment it exists — the
 * person's own, because that is what `newOrganizationName` falls back to. A
 * checklist reading the column would tick "Name your club" for a club called
 * "Ajay Mehta", which is the one thing on that screen that is definitely still
 * to do: the name goes on every scorecard, the console header and the public
 * board.
 *
 * So it is compared against the fallback instead. A club whose name is still
 * exactly what the app would have generated has not been named. Somebody
 * genuinely called "Bushwood" whose society is also "Bushwood" is told to name
 * it once, sets it to the same thing, and the step stays undone — accepted,
 * because the alternative is a stored "they confirmed it" flag, which is a
 * second source of truth about the same data and the defect class this
 * codebase keeps paying for.
 */
export function organizationWasNamed(
  storedName: string,
  displayName: string,
  email: string,
): boolean {
  const stored = storedName.trim();
  if (!stored) return false;
  return stored !== newOrganizationName(null, displayName, email);
}
