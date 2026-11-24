/**
 * THE TIME ZONE A THROWAWAY E2E CLUB IS BORN IN (B120).
 *
 * A club with no zone makes the console layout draw `ClubClockAdopter`, which on mount posts the
 * `adoptClubTimeZone` server action, which calls `revalidatePath("/", "layout")`: the first page load of
 * every such club gets a fresh render a few hundred ms later, and that render races any spec that writes
 * to the database and expects a stale screen, or reloads early (completed-offers on WebKit, #1240).
 *
 * The adopter writes the BROWSER's zone, so the club is born in the zone it would have adopted: `E2E_TZ`
 * when a run sets it (it is the browser's `timezoneId` and the seeded club's zone, `playwright.config.ts`,
 * `scripts/seed-club.mjs`), else this machine's own zone, which is the browser's and the server's.
 * The day is then the one the club had before, and nothing is re-rendered.
 *
 * `timeZone: null` is the opt-out: a club with NO zone ("" in the column), for a spec that tests the
 * adoption itself or the server's day. Nothing imports anything, so a unit test can read this.
 */
export function defaultClubZone(
  env: { E2E_TZ?: string } = process.env,
  machineZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  return (env.E2E_TZ || machineZone || "").trim();
}

/** The zone column for `makeClub`'s `timeZone` option: undefined takes the default, null opts out. */
export function clubZoneFor(timeZone: string | null | undefined): string {
  if (timeZone === null) return "";
  return timeZone ?? defaultClubZone();
}
