import type { ChecklistItem } from "@/components/SetupChecklist";
import { DEFAULT_THEME } from "@/lib/themes";

/**
 * Whether a club has put its own stamp on the app yet.
 *
 * "Colours" means a real choice, not the stock default: a fresh organization
 * carries themeKey = DEFAULT_THEME and an empty themeHex, and that must read as
 * "not set" so the branding nudge still appears. A custom hex or any non-default
 * preset counts as set.
 */
export function clubBrandingState(
  org: { logoUrl?: string | null; themeKey?: string | null; themeHex?: string | null } | null | undefined,
): { hasLogo: boolean; hasColours: boolean } {
  return {
    hasLogo: !!org?.logoUrl,
    hasColours: !!org?.themeHex || (!!org?.themeKey && org.themeKey !== DEFAULT_THEME),
  };
}

/**
 * What still has to happen before a tournament can be played.
 *
 * One definition, read by both the screen that sets a tournament up and the
 * dashboard someone lands on straight after creating one. It lived inline on
 * the setup screen, which meant the dashboard — the first thing a new
 * organizer sees — had no idea what was missing and could only report zeroes.
 *
 * The order is the order the work actually happens in: you cannot flight a
 * field you have not entered, and staff are the one genuinely optional step.
 */
export interface ChecklistState {
  confirmed: unknown[];
  waitlist: unknown[];
  stages: unknown[];
  groups: unknown[];
  matches: unknown[];
  accounts: unknown[];
  /** The owning organization's branding, when the caller has loaded it. Drives
   *  the optional "add your logo & colours" nudge. Absent means "don't ask" —
   *  so existing callers that pass none simply never show the item. */
  branding?: { hasLogo: boolean; hasColours: boolean };
}

export function setupChecklist(state: ChecklistState): ChecklistItem[] {
  const hasSchedule = state.matches.length > 0;
  const items: ChecklistItem[] = [
    {
      label: "Registration & field",
      detail:
        state.confirmed.length > 0
          ? `${state.confirmed.length} confirmed${state.waitlist.length ? ` · ${state.waitlist.length} waitlisted` : ""}`
          : "No players yet — open registration and add the field.",
      done: state.confirmed.length > 0,
      href: "/registration",
    },
    {
      label: "Rounds & format",
      detail:
        state.stages.length > 0
          ? `${state.stages.length} round${state.stages.length === 1 ? "" : "s"} configured`
          : "No rounds yet — sequence the tournament.",
      done: state.stages.length > 0,
      href: "/stages",
    },
    {
      label: "Flights",
      detail:
        state.groups.length > 0
          ? `${state.groups.length} flights · ${hasSchedule ? "schedule generated" : "schedule not generated yet"}`
          : "No flights yet — generate them from the confirmed field.",
      done: state.groups.length > 0 && hasSchedule,
      href: "/grouping",
    },
    {
      label: "Access & staff",
      detail:
        state.accounts.length > 1
          ? `${state.accounts.length - 1} additional staff account${state.accounts.length - 1 === 1 ? "" : "s"}`
          : "Just you so far — invite assistants if you need help running it.",
      done: state.accounts.length > 1,
      href: "/access",
      optional: true,
    },
  ];

  // A nudge, never a gate: only offered while the club has set neither a logo
  // nor colours, and marked optional like "Access & staff" so it never blocks
  // a tournament from being played. Deep-links to Club settings, where both
  // live. Once either is set it drops off — this is a first-run prompt, not a
  // permanent line item.
  if (state.branding && !state.branding.hasLogo && !state.branding.hasColours) {
    items.push({
      label: "Add your club's logo & colours",
      detail: "Put your club's badge and colours on the leaderboard and player screens.",
      done: false,
      href: "/organization",
      optional: true,
    });
  }

  return items;
}

/**
 * Whether this tournament is still being built rather than played.
 *
 * A tournament with nobody in it has no standings, no cards in and no matches
 * to complete — every number a dashboard could show is zero, and a wall of
 * zeroes tells a new organizer nothing about what to do next. The field is the
 * test because it is the first real step: everything downstream needs it.
 */
export function isUnstarted(state: ChecklistState): boolean {
  return state.confirmed.length === 0;
}
