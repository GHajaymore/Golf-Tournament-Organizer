/**
 * WHICH TOURNAMENT A SESSION OPENS ON WHEN NOTHING HAS CHOSEN ONE.
 *
 * `getSession` used the newest tournament the person could reach. That was
 * right while "reach" meant "was added to". Since a plain club member can
 * WATCH every tournament their club runs (`a-member-can-watch-not-play`), the
 * newest reachable one is often a tournament they are not in — so a member
 * whose cookie had lapsed opened the app on somebody else's tournament, with
 * no card, when their own round was one tap away. Found by looking: the
 * fixture player landed on a second club tournament the moment it existed.
 *
 * So the newest tournament that is the person's OWN wins — one they were
 * added to, or one they run. A watch-only tournament is chosen only when
 * there is nothing else, which is still better than no tournament at all.
 */
export interface Reachable {
  eventId: string;
  role: string;
  /** "event" — added to it; "organization" — reached through the club. */
  source: string;
}

/** Reached through the club as a plain member: can look, is not in it. */
export function watchOnly(r: Reachable): boolean {
  return r.source === "organization" && r.role === "player";
}

/**
 * AND OF THEIR OWN, THE ONE BEING PLAYED NOW (2026-09-19).
 *
 * The club asked that a player entered in several tournaments can pick which
 * one they are playing and scoring. Picking is the switcher's job; this is
 * the default a player gets before they pick, and "newest created" was the
 * wrong one: a league set up last night for next month would take the phone
 * away from the medal being played today.
 *
 * So, among the player's own: a LIVE tournament first, then one not yet
 * finished, then a finished one — newest first within each. Watch-only
 * tournaments come after all of those, as before.
 *
 * `status` is the organizer's lifecycle word (draft | live | completed …).
 * Clubs run rounds in draft too (CLAUDE.md), which is why draft sits beside
 * the other unfinished states rather than below them.
 */
function tier(r: Reachable, status: string | undefined): number {
  const finished = status === "completed";
  const live = status === "live";
  const base = live ? 0 : finished ? 2 : 1;
  return watchOnly(r) ? 3 + base : base;
}

/**
 * @param newestFirst every reachable event, newest created first, with its status.
 */
export function landingEvent<T extends Reachable>(
  reachable: readonly T[],
  newestFirst: readonly { id: string; status?: string }[],
): T | undefined {
  const byId = new Map(reachable.map((r) => [r.eventId, r]));
  const ordered = newestFirst
    .map((e, i) => ({ r: byId.get(e.id), t: 0, i, status: e.status }))
    .filter((x): x is { r: T; t: number; i: number; status: string | undefined } => !!x.r)
    .map((x) => ({ ...x, t: tier(x.r, x.status) }))
    .sort((a, b) => a.t - b.t || a.i - b.i);
  return ordered[0]?.r ?? reachable[0];
}
