import type { ChecklistItem } from "@/components/SetupChecklist";
import { screenName } from "@/lib/nav";

/**
 * Whether a club has put its own stamp on the app yet.
 *
 * "Colours" means a real choice, and the only honest evidence of a choice is
 * that somebody made one — `themeSetAt`, written by `saveOrganizationTheme`.
 *
 * IT USED TO BE INFERRED, as `themeKey !== DEFAULT_THEME`, and that is a guard
 * with an expiry date on it. When the default moved from "sunset" to
 * "verdigris" every club created before the move still stored "sunset", so
 * every one of them began reading as HAVING chosen and the branding nudge
 * stopped appearing for the entire existing customer base — silently, because
 * a nudge that fails to appear looks exactly like a nudge that was satisfied.
 * The inverse broke at the same moment: a club that deliberately picks the
 * current default reads as having chosen nothing and is nudged forever.
 *
 * Neither failure is visible from inside this function, which is the point. A
 * timestamp records the ACT instead of inferring it from the result, so it
 * cannot be invalidated by a decision taken somewhere else. `DEFAULT_THEME` is
 * deliberately no longer read here; the two historical defaults are named once
 * in the backfill in migration 64 and never again.
 */
export function clubBrandingState(
  org: { logoUrl?: string | null; themeSetAt?: Date | null } | null | undefined,
): { hasLogo: boolean; hasColours: boolean } {
  return {
    hasLogo: !!org?.logoUrl,
    hasColours: !!org?.themeSetAt,
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
  // Labels read from the sidebar, not written out again. This row said
  // "Rounds & format"; the screen is called "Rounds & formats" — the same
  // half-remembered name found the same day in the "Recommended flow" card on
  // Tournament details. A name typed twice drifts once.
  const items: ChecklistItem[] = [
    {
      label: screenName("/registration"),
      detail:
        state.confirmed.length > 0
          ? `${state.confirmed.length} confirmed${state.waitlist.length ? ` · ${state.waitlist.length} waitlisted` : ""}`
          : "No players yet — open registration and add the field.",
      done: state.confirmed.length > 0,
      href: "/registration",
    },
    {
      label: screenName("/stages"),
      detail:
        state.stages.length > 0
          ? `${state.stages.length} round${state.stages.length === 1 ? "" : "s"} configured`
          : "No rounds yet — sequence the tournament.",
      done: state.stages.length > 0,
      href: "/stages",
    },
    {
      label: screenName("/grouping"),
      detail:
        state.groups.length > 0
          ? `${state.groups.length} flights · ${hasSchedule ? "schedule generated" : "schedule not generated yet"}`
          : "No flights yet — generate them from the confirmed field.",
      done: state.groups.length > 0 && hasSchedule,
      href: "/grouping",
    },
    {
      label: screenName("/access"),
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
