import { orgProfile, type OrgProfile } from "./org-profile";

/**
 * What an organization still has to do before it can run a tournament.
 *
 * DERIVED, never stored. A stored "setup complete" flag becomes a second
 * source of truth about the same data, and this codebase has already been
 * bitten three times by exactly that: pot membership read three different ways
 * (the same contest worth $165 on one screen and $5 on another), matches
 * fetched with no ordering, and forfeit tiebreakers disagreeing with the
 * ranking comparator. One rule, read in one place.
 *
 * This is a CHECKLIST, not a gate. Every step stays reachable whether or not
 * the ones above it are done, because organizers do not work in order: a club
 * secretary creates the tournament the day the date is confirmed and loads the
 * roster over the following fortnight. Blocking that turns a normal sequence
 * into a blocked one, and the workaround — inventing a placeholder member to
 * unlock the next step — is worse data than the empty state it was protecting.
 *
 * Where an empty step genuinely CANNOT work, the refusal belongs at the point
 * of consequence and says why: pairings cannot be drawn from an empty field,
 * so the draw button explains that and links to the roster. That is already
 * the idiom here — see `resolveThirdPlace` and `resolveSingleMatch`, both of
 * which refuse with an explanation rather than disappearing.
 */

export type SetupStepKey = "profile" | "course" | "roster" | "tournament" | "money";

export interface SetupStep {
  key: SetupStepKey;
  title: string;
  /** What this step is for, in an organizer's words. */
  blurb: string;
  /** True once the underlying data says so. */
  done: boolean;
  /**
   * What stops working while this is undone, or "" when nothing does.
   *
   * The honest half of not gating: if skipping a step has a consequence, the
   * checklist says what it is rather than silently disabling something later.
   */
  consequence: string;
  /** Where to go and do it. */
  href: string;
}

/** The facts this derives from. Counts rather than rows — nothing here needs
 *  to know what a member IS, only whether there are any. */
export interface OrgSetupFacts {
  kind: string | null | undefined;
  /** The organization has been named. */
  named: boolean;
  /** A home course with a scorecard, for an organization that has one. */
  hasCourse: boolean;
  memberCount: number;
  eventCount: number;
  /** Whether the organizer has answered the money question either way. */
  moneyAnswered: boolean;
}

export interface OrgSetupState {
  profile: OrgProfile;
  steps: SetupStep[];
  /** Steps that still matter for this kind of organization. */
  remaining: SetupStep[];
  /** Everything that applies is done. */
  ready: boolean;
  /** The one to do next, or null when there is nothing left. */
  next: SetupStep | null;
}

/**
 * The checklist for this organization, in the order it makes sense to work.
 *
 * Which steps EXIST depends on the org kind, because a step that cannot apply
 * is worse than a step that is merely undone — a personal organizer told to
 * build a shared roster reasonably concludes the app has misunderstood them.
 * The kind is asked first for this reason: it is the cheapest question and it
 * removes the most noise.
 */
export function orgSetupState(facts: OrgSetupFacts): OrgSetupState {
  const profile = orgProfile(facts.kind);
  const steps: SetupStep[] = [];

  steps.push({
    key: "profile",
    title: `Name your ${profile.label.toLowerCase()}`,
    blurb: "What it is and what to call it. Decides which of the rest of these apply.",
    done: facts.named,
    consequence: "",
    href: "/settings/organization",
  });

  if (profile.ownsCourse) {
    steps.push({
      key: "course",
      title: "Add your course",
      blurb: "Par and stroke index for each hole, so handicaps and skins compute.",
      done: facts.hasCourse,
      consequence: "Without a card, net scoring and skins have no stroke index to work from.",
      href: "/courses",
    });
  }

  if (profile.sharedRoster) {
    steps.push({
      key: "roster",
      title: "Add your members",
      blurb: "The list that outlives any one tournament. Import a CSV or add them by hand.",
      done: facts.memberCount > 0,
      consequence: "Pairings cannot be drawn from an empty field.",
      href: "/members",
    });
  }

  /**
   * The money question is asked of EVERY kind, and pre-answered for the kinds
   * whose default needs no action.
   *
   * It used to exist only `if (profile.ledger)`, so a club was never shown it.
   * That made the default a restriction rather than a default: a club CAN set
   * split on one tournament — `resolveMoneyMode` is event → club → kind — but
   * with nothing on screen ever mentioning it, nobody would find out. A club's
   * annual away day is an outing: minibus, green fees, dinner, somebody
   * fronted it. The kind of the tenant does not tell you the character of the
   * event, which is the whole reason the mode is per tournament.
   *
   * `done` for a club because the decision IS made — the shop handles it, and
   * nothing is broken or waiting. It is listed so it can be changed, not so it
   * can be nagged about: the checklist renders finished steps as live links and
   * disappears entirely once everything that applies is done, so a permanently
   * open step nobody needs to act on would keep it on screen forever.
   */
  steps.push({
    key: "money",
    title: "Decide how money works",
    blurb: profile.ledger
      ? "Entry fees and shared costs, or nothing at all. Changeable per tournament later."
      : "Skins and pots are always worked out. Entry fees and shared costs sit outside the app unless you say otherwise — a society day can differ.",
    done: facts.moneyAnswered || !profile.ledger,
    consequence: "",
    href: "/settings/organization",
  });

  steps.push({
    key: "tournament",
    title: "Create your first tournament",
    blurb: "Rounds, formats and a field. The part everyone came for.",
    done: facts.eventCount > 0,
    consequence: "",
    href: "/tournaments/new",
  });

  const remaining = steps.filter((s) => !s.done);
  return {
    profile,
    steps,
    remaining,
    ready: remaining.length === 0,
    next: remaining[0] ?? null,
  };
}
