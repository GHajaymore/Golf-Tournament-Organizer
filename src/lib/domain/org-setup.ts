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

/**
 * Where each step actually lives.
 *
 * Gathered here because the first version of this file invented them — it
 * linked to `/settings/organization`, `/members`, `/courses` and
 * `/tournaments/new`, and NOT ONE of those routes exists. Every row of the
 * checklist was a dead link, which nobody noticed because the component was
 * never mounted. A path is not a design decision, it is a fact about the app,
 * and inventing one is the same mistake as storing a rule twice: it reads as
 * true and is checked by nothing.
 *
 * Kept as a table rather than inline strings so the next person can see all
 * five in one place and check them against `find src/app -name page.tsx`.
 *
 * Note what these say about the shape of the app. `/organization` and
 * `/roster` are inside the `(app)` shell, which `requireEventSession` gates on
 * an ACTIVE EVENT — so an organizer with no tournament yet cannot reach either
 * of them, and is bounced to `/choose`. This app is event-first: the club
 * settings hang off a tournament rather than the other way round. Until that
 * changes, the only step a brand-new organization can actually do is create
 * its first tournament, and the checklist must not pretend otherwise.
 */
export const SETUP_HREF: Record<SetupStepKey, string> = {
  // The club settings screen: name, branding, theme, staff access.
  profile: "/organization",
  // Courses are set up per tournament, on the event screen.
  course: "/event",
  // The club roster — members who outlive any one tournament.
  roster: "/roster",
  // `?stay=1` keeps the picker up instead of bouncing a single-tournament
  // organizer straight back into the one they already have.
  tournament: "/choose?stay=1",
  // The money question sits on the same settings screen as the profile.
  money: "/organization",
};

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

  /**
   * `noun`, not `label.toLowerCase()`. This read "Name your personal" for a
   * personal organizer, and the checklist heading above it read "Setting up
   * your personal" — the label is a chip, and a chip does not survive being
   * dropped into a sentence.
   *
   * Done for a personal organizer whichever name it has. Their organization is
   * their own list of players and nobody else ever sees its name, so the
   * derived one is a complete answer. A club or a society is a shared tenant
   * whose name lands on every scorecard, the console header and the public
   * board — for those, the name the app made up is the first thing still to do.
   */
  steps.push({
    key: "profile",
    title: `Name your ${profile.noun}`,
    blurb: profile.sharedRoster
      ? "It goes on every scorecard, the console header and the public leaderboard."
      : "A name, a logo and colours for your scorecards and leaderboard.",
    done: facts.named || !profile.sharedRoster,
    consequence: "",
    href: SETUP_HREF.profile,
  });

  if (profile.ownsCourse) {
    steps.push({
      key: "course",
      title: "Add your course",
      blurb: "Par and stroke index once, reused by every tournament you run there.",
      done: facts.hasCourse,
      /**
       * Not "net scoring and skins have no stroke index to work from", which
       * this said and which is not true: a tournament carries its own pars and
       * stroke index, and the demo club has run a whole event on them without
       * a Course row. Overstating a consequence is the same failure as a
       * disabled control with no reason — it asks somebody to act on a
       * penalty that will not arrive, and they learn to discount the next one.
       */
      consequence: "Without one, par and stroke index have to be re-entered on every tournament.",
      href: SETUP_HREF.course,
    });
  }

  if (profile.sharedRoster) {
    steps.push({
      key: "roster",
      title: "Add your members",
      blurb: "The list that outlives any one tournament. Import a CSV or add them by hand.",
      done: facts.memberCount > 0,
      consequence: "Pairings cannot be drawn from an empty field.",
      href: SETUP_HREF.roster,
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
    href: SETUP_HREF.money,
  });

  steps.push({
    key: "tournament",
    title: "Create your first tournament",
    blurb: "Rounds, formats and a field. The part everyone came for.",
    done: facts.eventCount > 0,
    consequence: "",
    href: SETUP_HREF.tournament,
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
