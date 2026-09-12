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
 * THE CLUB STEPS ARE A CHECKLIST AMONG THEMSELVES, AND A GATE ON THE
 * TOURNAMENT.
 *
 * This file used to say "a checklist, not a gate", and the reasoning was
 * sound as far as it went: organizers do not work in order, a secretary
 * creates the tournament the day the date is confirmed and loads the roster
 * over the following fortnight, and the workaround for a hard gate —
 * inventing a placeholder member to unlock the next step — is worse data than
 * the empty state it was protecting.
 *
 * What that reasoning missed is that the club and the tournament are not peers
 * on one list. A club is set up ONCE and its tournaments are MANY, so the
 * club's answers — its name, who its members are, how its money works — are
 * the ground every tournament stands on, not a parallel task. Presenting
 * "Create your first tournament" as an equal fifth row, live and unblocked
 * beside three unanswered club questions, invited exactly the order that
 * produces a tournament called "Ajay's golf" with an empty roster. Raised on
 * 2026-09-11, having been observed on the screen.
 *
 * So the club steps keep the old freedom — any of them, in any order, none
 * blocking another — and the tournament step waits for the ones that are
 * genuinely required. `required` says which, per step, rather than a list of
 * keys held somewhere else: "Add your course" is a real convenience and not a
 * prerequisite, and saying so on the step is what keeps the gate honest.
 *
 * The gate is only ever a FIRST-TOURNAMENT gate. Once one exists nothing is
 * blocked ever again — see `blockedByClubSetup` — because a club with a season
 * behind it has proved everything this list was asking about, and a gate that
 * interrupted it to collect a field it had skipped would be the app stopping
 * real golf to tidy its own records.
 *
 * Where an empty step genuinely cannot work LATER, the refusal still belongs
 * at the point of consequence and still says why: pairings cannot be drawn
 * from an empty field, so the draw button explains that and links to the
 * roster. That is the idiom here — see `resolveThirdPlace` and
 * `resolveSingleMatch`, both of which refuse with an explanation rather than
 * disappearing — and this gate is written the same way: it names what is
 * outstanding and where to answer it, never just greys out.
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
 * `/roster` are inside the `(app)` shell, which `requireEventSession` gated on
 * an ACTIVE EVENT — so an organizer with no tournament yet could reach neither,
 * and was bounced to `/choose`. The app was event-first: the club settings hung
 * off a tournament rather than the other way round.
 *
 * BOTH ARE FREE NOW, via `requireOrgScreen` — see `EVENTLESS_HREFS`. `/event`
 * is not and never will be, because it IS a tournament's own screen, which is
 * why the course step is the one that still reports as blocked.
 */
/**
 * THE CLUB IS SET UP ONCE; THE TOURNAMENTS ARE MANY.
 *
 * That is the relationship, and the app had it upside down: every club screen
 * resolved its organization through whichever tournament happened to be open,
 * so the one-time decisions — the club's name, its colours, its handicap
 * policy, how its money works — could not be made until a tournament existed
 * to stand inside. A secretary's first act became their second.
 *
 * This is the list of steps that no longer need one. It is a list rather than
 * "everything except the tournament step" because the two halves have to be
 * able to disagree — and they still do: `/event` is a tournament's own screen
 * and is not on it, so the course step honestly reports as blocked rather than
 * promising a screen that would bounce.
 *
 * `org-setup.test.ts` holds this to account in both directions — every href
 * marked blocked must really require an event, and `/choose` must not. Add a
 * screen here only after it actually works without one.
 */
const EVENTLESS_HREFS: readonly string[] = [
  // `/choose` is where an eventless session is SENT, so it cannot demand one.
  "/choose",
  // Club settings: name, branding, theme, handicap policy, and the club's
  // money default. Two of the four setup steps point here.
  "/organization",
  /**
   * The member list, freed on 2026-09-11. It was the one step this file had to
   * report as blocked, and the blockage was the relationship upside down: a
   * list that explicitly OUTLIVES any one tournament could not be opened until
   * one existed. `/roster` answers from `requireOrgScreen` now and shows the
   * club's members with the tournament half of the screen simply absent.
   *
   * This is what makes the club steps a genuine prerequisite rather than a
   * wish — until it was true, requiring members before the first tournament
   * would have been a deadlock dressed as a checklist.
   */
  "/roster",
];

function worksWithoutATournament(href: string): boolean {
  const path = href.split("?")[0];
  return EVENTLESS_HREFS.includes(path);
}

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
  /**
   * Whether the first tournament waits for this one.
   *
   * Declared on the step rather than as a list of keys elsewhere, so the
   * answer sits beside the step it describes and a step added later has to
   * state its own. The two must not be able to drift.
   *
   * "Add your course" is the one that is false, and deliberately: a tournament
   * carries its own pars and stroke index, the demo club has run a whole event
   * without a Course row, and its consequence says what it really costs —
   * re-entering the card each time. Gating on a convenience is how a gate
   * stops being believed.
   *
   * Meaningless on the tournament step itself, which is what waits.
   */
  required: boolean;
  /**
   * Why this step cannot be reached YET, or "" when it can.
   *
   * Not a gate this file invented — a gate that already existed and was not
   * being reported. `/organization`, `/roster` and `/event` all resolve their
   * organization FROM the selected event, and `requireEventSession` redirects
   * to /choose when a session has none. So on a brand-new account, three of
   * the four rows on this checklist were links that bounced silently back to
   * the page they were clicked from, under a sentence promising that "nothing
   * here is locked".
   *
   * Walked on 2026-09-10: signed up as a society, pressed "Name your society",
   * and arrived back on /choose with no explanation. Same for "Add your
   * members" and "Decide how money works". The one row that worked was the one
   * already saying it happens on this page.
   *
   * Derived from the href rather than from a list of keys, so a step added
   * later is covered the day it is added.
   */
  blocked: string;
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
  /**
   * Required club steps still unanswered, before the first tournament exists.
   *
   * Empty once one does, for good — see `orgSetupState`. Exposed as the steps
   * themselves rather than a count so a caller can link straight to them.
   */
  outstanding: SetupStep[];
  /**
   * Why the first tournament cannot be created yet, or "".
   *
   * The sentence rather than a boolean, so the rule and its wording stay
   * together and every screen that enforces this says the same thing. `/choose`
   * shows it under the disabled button; `createEvent` is where it is actually
   * enforced, because a disabled button stops nobody.
   */
  blockedByClubSetup: string;
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
  // Built without `blocked`, which is decided once at the end against the
  // whole list rather than repeated on every push.
  const steps: Omit<SetupStep, "blocked">[] = [];

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
    required: true,
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
      required: false,
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
      required: true,
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
    /**
     * NOT a prerequisite, and its own blurb says why: "Changeable per
     * tournament later." `resolveMoneyMode` is event → club → kind, so every
     * tournament can answer this for itself and the club default is a
     * convenience. Gating the first tournament on a setting it can override is
     * the same overreach as gating it on the course card.
     *
     * It is also what keeps the STANDALONE ORGANIZER free without a special
     * case. A personal organizer has no shared roster, so no members step
     * exists for them, and their name step is already done — so with money out,
     * nothing is required and nobody running a one-off outing with friends is
     * ever asked to set up a club they said they did not have. Derived, rather
     * than a `kind === "personal"` escape hatch written somewhere else.
     */
    required: false,
  });

  steps.push({
    key: "tournament",
    title: "Create your first tournament",
    blurb: "Rounds, formats and a field. The part everyone came for.",
    done: facts.eventCount > 0,
    consequence: "",
    href: SETUP_HREF.tournament,
    required: false,
  });

  /**
   * Everything but the tournament itself lives INSIDE a tournament.
   *
   * `/organization` and `/roster` read their organization off the selected
   * event, and `/event` is a tournament's own screen — so until there is one,
   * `requireEventSession` sends every one of them back to /choose. That is
   * correct behaviour for those screens and it is what the checklist has to
   * report rather than walk an organizer into.
   *
   * Keyed on the href, not on the step key: `/choose` is the one screen that
   * works without an event, so a step added later pointing anywhere else is
   * marked without this line being touched. And once one tournament exists,
   * nothing is blocked and the checklist is exactly what it was.
   */
  const noEventYet = facts.eventCount === 0;

  /**
   * The club answers the first tournament is still waiting on.
   *
   * ONLY BEFORE THE FIRST ONE. `noEventYet` is the whole condition, so a club
   * with a season behind it is never gated whatever its list looks like — it
   * has proved every question here by running golf, and stopping it to collect
   * a field it had skipped would be the app interrupting real golf to tidy its
   * own records. It also means this can never fire twice for anybody.
   *
   * `required`, read off the steps, so the two cannot drift and a step added
   * later has to say for itself whether the tournament waits for it.
   */
  const outstanding = noEventYet ? steps.filter((s) => s.required && !s.done) : [];

  /**
   * Why the first tournament cannot be created yet, in the organizer's own
   * words, or "".
   *
   * NAMES WHAT IS MISSING rather than saying "finish setup first". A disabled
   * control that does not say which answer it is waiting for is the thing this
   * file's own draw-button precedent exists to avoid, and with three possible
   * steps outstanding "complete your setup" leaves somebody hunting.
   */
  const blockedByClubSetup = outstanding.length
    ? `Finish setting up your ${profile.noun} first — ${listSteps(outstanding)}. ` +
      `It is answered once, and every tournament you run is built on it.`
    : "";

  /**
   * `blocked` MEANS ONE THING: the screen behind this row cannot be opened
   * yet. Nothing else belongs in it.
   *
   * The club-setup gate was briefly written into this field on the tournament
   * row, and it was the wrong home: `/choose` is perfectly reachable — it is
   * the page the row is rendered on — so a reader taking `blocked` at its word
   * would have been told a screen was shut while looking at it. Worse, the
   * test that checks this marking is TRUE reads the page source for a
   * `requireEventSession`, and `/choose` has none, so the lie would have been
   * caught as a bug in the route rather than in the meaning.
   *
   * The gate is a fact about the ACTION, not the screen, and lives in
   * `blockedByClubSetup` on the state.
   */
  const blockedSteps = steps.map((s) => ({
    ...s,
    blocked:
      noEventYet && !worksWithoutATournament(s.href)
        ? // `profile.noun`, not "club". Read off the screen on 2026-09-10 while
          // signed up as a SOCIETY: "your club's own screens live inside one".
          // The same slip this file already records against "Name your
          // personal" — the app's word for the tenant is not always club.
          `Opens once you have a tournament — your ${profile.noun}'s own screens live inside one.`
        : "",
  }));

  const remaining = blockedSteps.filter((s) => !s.done);
  /**
   * The "Next" chip points at something that can actually be done.
   *
   * It was `remaining[0]`, which on a new account is "Name your society" — the
   * first of the three rows that bounce. Marking the one step that works is
   * the whole job of that chip; marking a dead one is worse than marking none.
   *
   * Falls back to the plain first remaining step, so an organizer with nothing
   * reachable still sees where the list starts rather than nothing at all.
   */
  const next = remaining.find((s) => !s.blocked) ?? remaining[0] ?? null;
  return {
    profile,
    steps: blockedSteps,
    remaining,
    ready: remaining.length === 0,
    next,
    // Re-read off the finished list so callers get steps carrying `blocked`,
    // rather than the half-built ones the sentence above was composed from.
    outstanding: blockedSteps.filter((s) => outstanding.some((o) => o.key === s.key)),
    blockedByClubSetup,
  };
}

/**
 * "name your society and add your members", from the steps themselves.
 *
 * Lower-cased from the step titles rather than written out a second time: a
 * hand-written list is a second set of words for the same five steps, and this
 * file already carries a scar from exactly that — `label.toLowerCase()`
 * produced "Name your personal" because a chip does not survive being dropped
 * into a sentence. A title does, because a title is already a phrase.
 */
function listSteps(steps: { title: string }[]): string {
  const words = steps.map((s) => s.title.charAt(0).toLowerCase() + s.title.slice(1));
  if (words.length <= 1) return words[0] ?? "";
  return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`;
}
