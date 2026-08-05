import { canAccessScreen, type Role } from "./roles";

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
// Overview (monitor) → Set up (define the event, locked once live) →
// Manage (run the live competition) → Results (publish & export).
export const NAV: NavSection[] = [
  {
    label: "Overview",
    items: [
      { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: "ph ph-squares-four" },
      { key: "leaderboard", label: "Live leaderboard", href: "/leaderboard", icon: "ph ph-ranking" },
    ],
  },
  {
    // Everything that defines the tournament. Locks when the event goes live.
    label: "Set up",
    items: [
      { key: "event", label: "Event setup", href: "/event", icon: "ph ph-gear-six" },
      { key: "registration", label: "Registration & field", href: "/registration", icon: "ph ph-user-plus" },
      { key: "stages", label: "Rounds & format", href: "/stages", icon: "ph ph-stack" },
      { key: "grouping", label: "Flights & divisions", href: "/grouping", icon: "ph ph-squares-four" },
      { key: "access", label: "Access & staff", href: "/access", icon: "ph ph-shield-check" },
    ],
  },
  {
    // Running the live competition — always available once play begins.
    label: "Manage",
    items: [
      { key: "foursomes", label: "Tee sheet & pairings", href: "/foursomes", icon: "ph ph-users-four" },
      { key: "scorecard", label: "Scorecards", href: "/scorecard", icon: "ph ph-cards" },
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
 */
export function navForRole(viewRole: Role): NavSection[] {
  return NAV.map((s) => ({ ...s, items: s.items.filter((i) => canAccessScreen(viewRole, i.key)) })).filter(
    (s) => s.items.length > 0,
  );
}
