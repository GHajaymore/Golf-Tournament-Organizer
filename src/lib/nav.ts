import { canAccessScreen, type Role } from "./roles";
import { canSeeLeaderboard, canEnterScores, type TournamentSettings } from "./tournament-settings";

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: string;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

// Navigation follows the real event lifecycle an organizer works through:
// Overview (monitor) → Club (the standing roster and identity, which outlive
// any one event) → Set up (define the event, locks once live) → Manage (run
// the live competition) → Results (publish & export).
export const NAV: NavSection[] = [
  {
    label: "Overview",
    items: [
      { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: "ph ph-squares-four" },
      { key: "leaderboard", label: "Live leaderboard", href: "/leaderboard", icon: "ph ph-ranking" },
      { key: "week", label: "This week", href: "/week", icon: "ph ph-calendar-check" },
    ],
  },
  {
    // Club-level, shared by every tournament this organization runs — as
    // opposed to "Set up", which only describes the event currently open.
    label: "Club",
    items: [
      { key: "roster", label: "Members", href: "/roster", icon: "ph ph-address-book" },
      { key: "series", label: "Season standings", href: "/series", icon: "ph ph-trophy" },
      { key: "organization", label: "Club settings", href: "/organization", icon: "ph ph-buildings" },
    ],
  },
  {
    // Everything that defines the tournament. Locks when the event goes live.
    label: "Set up",
    items: [
      { key: "event", label: "Tournament details", href: "/event", icon: "ph ph-gear-six" },
      { key: "registration", label: "Registration & field", href: "/registration", icon: "ph ph-user-plus" },
      { key: "stages", label: "Rounds & formats", href: "/stages", icon: "ph ph-stack" },
      { key: "grouping", label: "Flights", href: "/grouping", icon: "ph ph-squares-four" },
      { key: "teams", label: "Teams & pairs", href: "/teams", icon: "ph ph-users-three" },
      { key: "access", label: "Access & staff", href: "/access", icon: "ph ph-shield-check" },
    ],
  },
  {
    // Running the live competition — always available once play begins.
    label: "Manage",
    items: [
      { key: "foursomes", label: "Tee sheet", href: "/foursomes", icon: "ph ph-users-four" },
      { key: "entry", label: "Score entry", href: "/entry", icon: "ph ph-pencil-simple" },
      { key: "qualification", label: "Qualification", href: "/qualification", icon: "ph ph-flag-checkered" },
      { key: "bracket", label: "Bracket", href: "/bracket", icon: "ph ph-tree-structure" },
      { key: "announcements", label: "Announcements", href: "/announcements", icon: "ph ph-megaphone" },
    ],
  },
  {
    label: "Results",
    items: [
      { key: "prizes", label: "Prizes & payouts", href: "/prizes", icon: "ph ph-trophy" },
      { key: "reports", label: "Reports & export", href: "/reports", icon: "ph ph-export" },
    ],
  },
];

/**
 * The sidebar for a role, derived from the same access map the server-side
 * guards use — so what's shown and what's reachable can't disagree.
 *
 * `settings` narrows it further for screens the tournament itself governs: a
 * player in a blind event has no leaderboard link, and one in an
 * organizer-scored event has no score entry link. Without this the sidebar
 * would offer doors that bounce you straight back to the dashboard.
 */
export function navForRole(
  viewRole: Role,
  settings?: TournamentSettings,
  opts: { hasTeamRound?: boolean; hasKnockout?: boolean; isLeague?: boolean } = {},
): NavSection[] {
  const allowed = (key: string): boolean => {
    if (!canAccessScreen(viewRole, key)) return false;
    // Teams only matter to a tournament that has a team round in it. Most
    // don't, and a permanent link to an empty screen is just clutter — the
    // link appears the moment a round is set to a team format.
    if (key === "teams" && !opts.hasTeamRound) return false;
    // Qualification answers one question — who goes through to the knockout —
    // so it only earns a slot when there is a knockout to go through to. Its
    // configuration moved into the round builder, and a tournament that ends
    // at the last round already has the cut line and the leaderboard saying
    // the same thing in the place the decision is made.
    if (key === "qualification" && !opts.hasKnockout) return false;
    // Same rule, same reason: a bracket is a knockout draw, so a league or a
    // medal that ends at the last round has nothing to show. The dashboard
    // tile has been gated on this since it existed (bracket-visibility.ts);
    // the sidebar link never was, so every tournament carried a permanent
    // door to an empty screen.
    if (key === "bracket" && !opts.hasKnockout) return false;
    // "This week" only means something where there are weeks. A one-day medal
    // has a single round, and a link reading "This week" next to it would be
    // a second name for the leaderboard — the kind of duplicate door that
    // makes an app feel bigger and worse.
    if (key === "week" && !opts.isLeague) return false;
    if (!settings) return true;
    // The bracket is seeded from live standings, so showing it in a blind
    // event would give away the order the leaderboard is hiding.
    if (key === "leaderboard" || key === "bracket") return canSeeLeaderboard(settings, viewRole);
    if (key === "entry") return canEnterScores(settings, viewRole);
    return true;
  };

  return NAV.map((s) => ({ ...s, items: s.items.filter((i) => allowed(i.key)) })).filter(
    (s) => s.items.length > 0,
  );
}
