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
 * @param newestFirst every reachable event id, newest created first.
 */
export function landingEvent<T extends Reachable>(reachable: readonly T[], newestFirst: readonly string[]): T | undefined {
  const byId = new Map(reachable.map((r) => [r.eventId, r]));
  const ordered = newestFirst.map((id) => byId.get(id)).filter((r): r is T => !!r);
  return ordered.find((r) => !watchOnly(r)) ?? ordered[0] ?? reachable[0];
}
