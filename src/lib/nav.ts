export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: string;
  /** true = visible to players; otherwise staff-only. */
  player?: boolean;
  /** true = only the primary Organizer (admin), hidden from assistants. */
  adminOnly?: boolean;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

// Navigation follows the real event lifecycle an organizer works through:
// Overview (monitor) → Set up (define the event, locked once live) →
// Manage (run the live competition) → Results (publish & export).
export const NAV: NavSection[] = [
  {
    label: "Overview",
    items: [
      { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: "ph ph-squares-four", player: true },
      { key: "leaderboard", label: "Live leaderboard", href: "/leaderboard", icon: "ph ph-ranking", player: true },
    ],
  },
  {
    // Everything that defines the tournament. Locks when the event goes live.
    label: "Set up",
    items: [
      { key: "event", label: "Event setup", href: "/event", icon: "ph ph-gear-six", adminOnly: true },
      { key: "registration", label: "Registration", href: "/registration", icon: "ph ph-user-plus" },
      { key: "roster", label: "Player roster", href: "/roster", icon: "ph ph-users-three" },
      { key: "grouping", label: "Flights & divisions", href: "/grouping", icon: "ph ph-squares-four" },
      { key: "stages", label: "Rounds & format", href: "/stages", icon: "ph ph-stack" },
      { key: "access", label: "Access & staff", href: "/access", icon: "ph ph-shield-check", adminOnly: true },
    ],
  },
  {
    // Running the live competition — always available once play begins.
    label: "Manage",
    items: [
      { key: "foursomes", label: "Tee sheet & pairings", href: "/foursomes", icon: "ph ph-users-four" },
      { key: "scorecard", label: "Scorecards", href: "/scorecard", icon: "ph ph-cards" },
      { key: "entry", label: "Score entry", href: "/entry", icon: "ph ph-pencil-simple", player: true },
      { key: "qualification", label: "Qualification", href: "/qualification", icon: "ph ph-flag-checkered" },
      { key: "bracket", label: "Bracket", href: "/bracket", icon: "ph ph-tree-structure", player: true },
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

export function navForRole(viewRole: "admin" | "assistant" | "player"): NavSection[] {
  if (viewRole === "admin") return NAV;
  if (viewRole === "assistant") {
    // Assistant Organizer: everything operational, minus critical/admin-only screens.
    return NAV.map((s) => ({ ...s, items: s.items.filter((i) => !i.adminOnly) })).filter(
      (s) => s.items.length > 0,
    );
  }
  return NAV.map((s) => ({ ...s, items: s.items.filter((i) => i.player) })).filter(
    (s) => s.items.length > 0,
  );
}
