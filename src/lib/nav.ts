export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: string;
  /** true = visible to players; otherwise organizer-only. */
  player?: boolean;
}

export interface NavSection {
  label: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    label: "Overview",
    items: [
      { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: "ph ph-squares-four", player: true },
      { key: "leaderboard", label: "Live leaderboard", href: "/leaderboard", icon: "ph ph-ranking", player: true },
    ],
  },
  {
    label: "Setup",
    items: [
      { key: "event", label: "Event setup", href: "/event", icon: "ph ph-gear-six" },
      { key: "registration", label: "Registration", href: "/registration", icon: "ph ph-user-plus" },
      { key: "roster", label: "Player roster", href: "/roster", icon: "ph ph-users-three" },
      { key: "grouping", label: "Grouping rules", href: "/grouping", icon: "ph ph-squares-four" },
      { key: "access", label: "Access control", href: "/access", icon: "ph ph-shield-check" },
    ],
  },
  {
    label: "Competition",
    items: [
      { key: "stages", label: "Stage builder", href: "/stages", icon: "ph ph-stack" },
      { key: "round-robin", label: "Round robin", href: "/round-robin", icon: "ph ph-arrows-clockwise" },
      { key: "scoring", label: "Scoring rules", href: "/scoring", icon: "ph ph-sliders" },
      { key: "qualification", label: "Qualification", href: "/qualification", icon: "ph ph-flag-checkered" },
      { key: "bracket", label: "Bracket manager", href: "/bracket", icon: "ph ph-tree-structure" },
    ],
  },
  {
    label: "Scoring",
    items: [
      { key: "scorecard", label: "Scorecard generator", href: "/scorecard", icon: "ph ph-cards" },
      { key: "entry", label: "Score entry", href: "/entry", icon: "ph ph-pencil-simple", player: true },
    ],
  },
  {
    label: "Reports",
    items: [{ key: "reports", label: "Reports / Export", href: "/reports", icon: "ph ph-export" }],
  },
];

export function navForRole(viewRole: "admin" | "player"): NavSection[] {
  if (viewRole === "admin") return NAV;
  return NAV.map((s) => ({ ...s, items: s.items.filter((i) => i.player) })).filter(
    (s) => s.items.length > 0,
  );
}
