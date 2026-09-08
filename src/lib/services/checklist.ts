import type { ChecklistItem } from "@/components/SetupChecklist";
import { screenName } from "@/lib/nav";
import { bySetupOrder } from "@/lib/domain/setup-flow";

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
  /**
   * The "Tournament details" step, taken from the SETUP FLOW rather than
   * decided again here.
   *
   * This list had no such step at all, so the dashboard — the screen a new
   * organizer lands on straight after creating a tournament — never once said
   * that the thing needed a name, a date or a venue. The rail on the Set-up
   * screens said it first and loudest; the dashboard did not say it.
   *
   * Passed in as the flow's own answer, not recomputed. `setup-flow.ts` has a
   * careful test for it — a name AND either a date OR a venue, because a
   * rotating league has no venue and a club awaiting a committee has no date —
   * and a second copy of that reasoning here is how the two would come to
   * disagree about whether step one is finished.
   *
   * Absent means "don't ask", exactly like `branding`, so a caller that has
   * not loaded the flow shows the list it always showed.
   */
  details?: { done: boolean; missing: string };
}

export function setupChecklist(state: ChecklistState): ChecklistItem[] {
  const hasSchedule = state.matches.length > 0;
  // Labels read from the sidebar, not written out again. This row said
  // "Rounds & format"; the screen is called "Rounds & formats" — the same
  // half-remembered name found the same day in the "Recommended flow" card on
  // Tournament details. A name typed twice drifts once.
  const items: ChecklistItem[] = [
    ...(state.details
      ? [
          {
            label: screenName("/event"),
            detail: state.details.done
              ? "Named, and it has a date or a venue."
              : state.details.missing,
            done: state.details.done,
            href: "/event",
          },
        ]
      : []),
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

  /**
   * ONE ORDER, from `setup-flow.ts`, rather than a second opinion about it.
   *
   * This list used to run field → rounds → flights, and the note above still
   * explains why: you cannot flight a field you have not entered. That is true
   * and it is not the whole question — `setup-flow.ts` argues the other half,
   * that deciding WHO is playing before deciding WHAT is played is the way
   * round that "had somebody adding players before discovering the format was
   * not the one they wanted". Both were right about their own half and the app
   * shipped both, so an organizer on `/event` met the rail saying rounds first
   * and this list saying field first, one above the other.
   *
   * Sorting rather than rewriting the array keeps every `detail` string and
   * every `done` test exactly as it was: the only thing that changes is the
   * sequence, which is the thing that was disagreeing. The optional tail —
   * staff, and the branding nudge — is not in `SETUP_ORDER` and so stays at
   * the end, which is where an optional step belongs.
   */
  return bySetupOrder(items);
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
