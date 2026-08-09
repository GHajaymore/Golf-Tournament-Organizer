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
