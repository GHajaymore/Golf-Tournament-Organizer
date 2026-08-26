/**
 * How old the board on screen is, said plainly.
 *
 * The public leaderboard is read on a phone, outdoors, on a course where the
 * signal comes and goes between holes. So the interesting state is not "is it
 * live" — it is "how long since this last actually reached me", and that is a
 * question the page must answer honestly, because there is nobody standing
 * next to the spectator to correct it.
 *
 * The age is measured from a timestamp the SERVER stamped on the render. That
 * matters: a client-side "last tried" clock keeps ticking cheerfully while the
 * phone is in a dead spot, so it would report the board as fresh precisely
 * when it is not. A server stamp cannot advance unless a request actually came
 * back, so an aging label IS the failure showing through.
 */

/** Past this, say so: three polls have gone by without anything arriving. */
export const STALE_AFTER_MS = 120_000;

/** How often the board asks for new scores, when the tab is visible. */
export const POLL_MS = 30_000;

export interface Freshness {
  /** "just now", "2 min ago" — what to put next to the dot. */
  label: string;
  /**
   * Whether to warn. A leaderboard nobody has heard from in two minutes is
   * still worth showing — the last scores are the best information available —
   * but showing it as though it were current is a lie the reader cannot check.
   */
  stale: boolean;
}

export function freshness(ageMs: number): Freshness {
  // A negative age means the device clock is behind the server's. Treat it as
  // fresh rather than printing "in 3 minutes", which reads as a bug and makes
  // the whole board look untrustworthy.
  const age = Number.isFinite(ageMs) && ageMs > 0 ? ageMs : 0;
  const stale = age >= STALE_AFTER_MS;

  if (age < 45_000) return { label: "just now", stale };

  const mins = Math.round(age / 60_000);
  if (mins < 60) return { label: `${mins} min ago`, stale };

  const hours = Math.round(mins / 60);
  return { label: hours === 1 ? "1 hour ago" : `${hours} hours ago`, stale };
}
