/**
 * Single source of truth for what each role may do.
 *
 * Access used to be expressed twice — as `player` / `adminOnly` flags on nav
 * items, and again as screen-key sets used by the server-side guards. Two
 * lists describing the same rule drift apart; a screen could appear in the
 * sidebar while the guard rejected it, or worse, be reachable while hidden.
 *
 * Now both the sidebar and the guards read this map. Adding a role means
 * listing it against the screens it may open; adding a screen means one entry
 * here. Nothing else needs to change.
 */

export const ROLES = ["admin", "assistant", "player"] as const;
export type Role = (typeof ROLES)[number];

/** Indexed by plain string because roles are stored as free text on Account;
 *  unknown values fall through to the raw value rather than crashing. */
export const ROLE_LABEL: Record<string, string> = {
  admin: "Organizer",
  assistant: "Assistant",
  player: "Player",
};

/**
 * Which roles may open each screen, keyed by the screen key used in both
 * `NAV` and `requireScreen(...)`.
 *
 * Roles are per-tournament, so the same person can be `admin` on one event
 * and `player` on another — this map is always evaluated against the role
 * they hold in the tournament they're currently in.
 */
export const SCREEN_ACCESS: Record<string, readonly Role[]> = {
  // Overview — everyone in the tournament.
  dashboard: ["admin", "assistant", "player"],
  leaderboard: ["admin", "assistant", "player"],

  // Set up — defining the event. Assistants run it but don't reshape it.
  event: ["admin"],
  access: ["admin"],
  registration: ["admin", "assistant"],
  stages: ["admin", "assistant"],
  grouping: ["admin", "assistant"],

  // Manage — running the live competition.
  foursomes: ["admin", "assistant"],
  scorecard: ["admin", "assistant"],
  entry: ["admin", "assistant", "player"],
  qualification: ["admin", "assistant"],
  bracket: ["admin", "assistant", "player"],
  announcements: ["admin", "assistant"],

  // Results.
  prizes: ["admin", "assistant"],
  reports: ["admin", "assistant"],
};

export function canAccessScreen(role: Role, screenKey: string): boolean {
  return SCREEN_ACCESS[screenKey]?.includes(role) ?? false;
}

/**
 * Where a role lands after entering a tournament. Every role starts on the
 * dashboard today — players get standings and a one-tap route to score entry
 * there — but keeping this as a function means a future role (a scorer sent
 * straight to their assigned matches, say) is a one-line change.
 */
export function landingScreenFor(role: Role): string {
  switch (role) {
    case "admin":
    case "assistant":
    case "player":
    default:
      return "/dashboard";
  }
}
