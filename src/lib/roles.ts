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
  // The weekly league sheet — results, the table and the skins for one night.
  // Players see it because it is the thing a league member actually wants,
  // and it is read-only for everybody: the money is managed on Prizes, which
  // stays staff-only. A captain reading the week is not a captain editing it.
  week: ["admin", "assistant", "player"],
  // The rules reference is for anyone in the tournament. A player querying how
  // a tie broke has as much reason to look it up as the organizer who set it.
  rules: ["admin", "assistant", "player"],
  // The player shell — a player's whole app: where they stand, who they are out
  // with, their own card, and the rules in force. Open to staff as well, so an
  // organizer who is also in the field can use it to play rather than signing
  // out of their own tournament.
  me: ["admin", "assistant", "player"],

  // Set up — defining the event. Assistants run it but don't reshape it.
  event: ["admin"],
  access: ["admin"],
  // Organization settings sit above any one event; a finer check inside the
  // screen limits editing to organization owners/admins.
  organization: ["admin"],
  // The club roster spans every event, but assistants fill fields from it, so
  // it follows registration's access rather than organization's.
  roster: ["admin", "assistant"],
  // A season spans every tournament the club runs, so it sits with the roster
  // rather than inside any one event.
  series: ["admin", "assistant"],
  registration: ["admin", "assistant"],
  stages: ["admin", "assistant"],
  grouping: ["admin", "assistant"],
  // Drawing sides for a team format is the same kind of work as building
  // flights, so it follows grouping's access rather than the event's.
  teams: ["admin", "assistant"],

  // Manage — running the live competition.
  foursomes: ["admin", "assistant"],
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
    // Players land in the play shell, not the console. The console is built
    // for a desk — a sidebar of fifteen screens, dense tables, 34px controls —
    // and a player has four things to do, on a phone, outdoors. Sending them
    // to /dashboard was what made the mobile app feel like a shrunken console:
    // it was one.
    case "player":
      return "/me";
    case "admin":
    case "assistant":
    default:
      return "/dashboard";
  }
}

/**
 * Where a role's app starts.
 *
 * One answer, so every entry point agrees. Both the /choose redirect and
 * enterTournament used to send everybody to /dashboard, which meant a player
 * who signed in got the organizer's console with most of it removed by the
 * guards above — while the four-tab player app sat one hand-typed URL away.
 *
 * Here rather than beside those redirects because a "use server" module may
 * only export async functions, and this is a pure lookup that the player shell
 * and the console both need to agree on.
 */
export function homeFor(role: string): string {
  return role === "admin" || role === "assistant" ? "/dashboard" : "/me";
}
