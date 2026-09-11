import { canAccessScreen, type Role } from "./roles";
import { orgProfile, type OrgKind } from "@/lib/domain/org-profile";
import { canSeeLeaderboard, canEnterScores, type TournamentSettings } from "./tournament-settings";

/**
 * WHERE a screen is used, which is not the same question as WHO uses it.
 *
 * Tiering by audience is the obvious split and the wrong one. It puts every
 * "player" screen on one side and every "organizer" screen on the other, and
 * then Score entry and the Tee sheet — which are worked standing on a tee box,
 * in sun, by an assistant holding a phone — land on the desk side because a
 * member of staff is holding them. The person is not the constraint. The
 * pointing device and the daylight are.
 *
 * - `on-course`  read or tapped outdoors, one-handed, on a phone. Touch
 *                minimums are enforced here, and enforced by sweep rather than
 *                by anyone remembering.
 * - `at-desk`    worked sitting down, usually on a wide screen, often for an
 *                hour. Density is the feature; raising every control to 44px
 *                would be a real cost to the person who lives in it.
 *
 * THIS CHANGES WHAT IS ASSERTED, NEVER WHETHER A SCREEN IS SWEPT. `layout.spec`
 * derives its routes from the filesystem precisely because a hand-written list
 * covered 14 of 22, and a tier is a hand-written list wearing a type. Every
 * screen is still measured at every viewport; the tier only decides whether
 * the 44px minimum is among the things measured.
 */
export type NavTier = "on-course" | "at-desk";

/**
 * The screens a casual round does not get.
 *
 * TWO CATEGORIES, and the set was named after only the first of them.
 *
 * The FIELD apparatus — dividing a field into flights, drawing it a tee sheet,
 * announcing things to it, hiring staff to help. Four people on the first tee
 * have none of that, and every one of those links is a door to a screen about
 * somebody else's problem.
 *
 * And the ORGANIZATION apparatus, which was still wide open. Walked on
 * 2026-09-08, a Sunday fourball's sidebar offered Club settings, Members and
 * Season standings: the club's branding and colours, its whole roster, and a
 * league table for an event that is one round long and can never be in a
 * season — `capabilitiesOf("match").chainsRounds` has said so since the shape
 * was added. Those are not doors to somebody else's problem, they are doors to
 * somebody else's CLUB, offered to whoever set up a game.
 *
 * `prizes` is here for a third reason, and is the one that had to bring
 * something with it. It is the club's money — a prize table, contests, the
 * float, the organizer's ledger, the season's skins — none of which a casual
 * round has. What it also held was the skins pot, which IS what four friends
 * playing for a fiver want, so removing the screen without moving that would
 * have taken the money game away. It lives on Group games now, which is where
 * players' own money already lived.
 *
 * WHAT DELIBERATELY STAYS. Registration & field, because it is where a
 * mistyped name or a wrong handicap gets fixed and there is nowhere else.
 * Rounds & formats, because changing 18 to 9 or gross to net is exactly the
 * second thought people have on the first tee. Tournament details, because it
 * is where the COURSE is set, and a round with no card cannot be scored net.
 * Group games, because a round played for a fiver is the oldest bet in golf.
 *
 * EXPORTED because the sidebar was not the only thing offering them. The setup
 * checklist on `/event` went on listing "Flights" and "Access & staff" for a
 * match, which is the same doors reopened one card lower down: the nav had
 * shut them and the checklist had never been told. One set, two readers.
 */
export const TOURNAMENT_ONLY_SCREENS: ReadonlySet<string> = new Set([
  // The field's apparatus.
  "grouping",
  "foursomes",
  "announcements",
  "access",
  // The organization's.
  "organization",
  "roster",
  "series",
  /**
   * Messaging a field you do not have.
   *
   * `/messages` is threads, staff broadcasts and an SMS fan-out priced per
   * segment against the club's rate — apparatus for reaching forty people who
   * are not in the room. A casual round is two to eight players who are
   * standing on the same tee, and the round is gone tomorrow.
   *
   * It is also the club's: the thread scopes are the club's flights, rounds
   * and teams, and a quick round now belongs to the person rather than to any
   * club at all, so what it would offer is a conversation about somebody
   * else's tournament.
   */
  "messages",
  /**
   * THE TOURNAMENT'S OWN FILING CABINET, and the reason a casual round has a
   * panel of its own instead.
   *
   * `/event` is the club's settings, its course library and its plan.
   * `/registration` is a registration desk: approvals, a waitlist, a capacity,
   * an invite message. `/stages` is rounds and formats with cut lines, carry
   * forward and tiebreakers. Every one of them is apparatus for running a
   * field, and a casual round is two to eight people who are standing on the
   * same tee.
   *
   * These used to stay, on the argument that each was the only door to
   * something a round genuinely has — a mistyped handicap, eighteen changed to
   * nine. That argument was right about the NEED and wrong about the door:
   * what it produced was a fourball being walked through a tournament's setup
   * screens to change one number. `CasualRoundPanel` is those three things,
   * on the round's own screen, and it is what makes removing these safe rather
   * than stranding.
   */
  "event",
  "registration",
  "stages",
  // The club's money. Its skins pot moved to `group-games` rather than going.
  "prizes",
]);

/** Whether a screen is worth offering on an event of this shape. */
export function screenAppliesToMatch(key: string): boolean {
  return !TOURNAMENT_ONLY_SCREENS.has(key);
}

/**
 * What a casual round calls the screens it keeps.
 *
 * Not a second set of screens — the same ones, named for what they are when
 * the event is four friends rather than a field. "Registration & field" is a
 * registration desk with a waitlist and approvals; on a Sunday fourball it is
 * the list of who is playing and what they are off.
 *
 * Only the entries that would read wrongly. Score entry, Live leaderboard,
 * Rules reference and Group games mean exactly the same thing to a fourball
 * as to a championship and are deliberately absent from this map.
 */
const MATCH_ITEM_LABEL: Readonly<Record<string, string>> = {
  reports: "Export this round",
  // "Dashboard" is a word for a desk. This screen already titles itself "The
  // match" on a casual round; the sidebar was the half still calling it
  // something else.
  dashboard: "This round",
};

/**
 * And the headings above them.
 *
 * The sections are the tournament lifecycle — "Overview → Club → Set up →
 * Manage → Results" — which is a real description of running a competition and
 * a strange thing to show somebody who has just pressed "Start the round". A
 * casual round has no set-up phase to lock, nothing to manage but the card,
 * and no results to publish to anyone who was not standing there.
 */
const MATCH_SECTION_LABEL: Readonly<Record<string, string>> = {
  Manage: "Playing",
  Results: "Afterwards",
};

/**
 * WHAT ONE ITEM IS CALLED, given who is looking at it.
 *
 * Two things move a label off its constant, and both used to be applied by the
 * sidebar alone: a casual round renames two entries, and an organization that
 * is not a club renames its own settings — "Society settings", "Outing
 * settings". `screenName` knew about neither, which was invisible while the
 * sidebar was the only reader.
 *
 * It stopped being invisible the moment browser tabs started naming themselves
 * from `screenName`: a society's sidebar read "Society settings" and its tab
 * read "Club settings", which is precisely the two-names-for-one-screen fault
 * that function's own comment is about. So both readers resolve a label here
 * and cannot disagree.
 *
 * A casual round beats the organization's wording, which is the order the
 * sidebar already applied (`forMatch(relabel(...))`) and the right one: a
 * casual round now belongs to a person rather than to any club, so there is no
 * society whose settings those would be.
 */
export function itemLabel(
  item: { key: string; label: string },
  isMatch: boolean,
  orgKind?: OrgKind,
): string {
  if (isMatch && MATCH_ITEM_LABEL[item.key]) return MATCH_ITEM_LABEL[item.key];
  if (orgKind && item.key === "organization") return orgProfile(orgKind).settingsLabel;
  return item.label;
}

export interface NavItem {
  key: string;
  label: string;
  href: string;
  icon: string;
  /**
   * Required, with no default, deliberately. A default is a decision nobody
   * makes — a screen added later would inherit whichever tier happened to be
   * the fallback and be graded by it silently. Declaring it is one word, and
   * the type makes forgetting a compile error rather than a wrong assertion.
   */
  tier: NavTier;
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
      { key: "dashboard", label: "Dashboard", href: "/dashboard", icon: "ph ph-squares-four", tier: "at-desk" },
      { key: "leaderboard", label: "Live leaderboard", href: "/leaderboard", icon: "ph ph-ranking", tier: "on-course" },
      { key: "week", label: "This week", href: "/week", icon: "ph ph-calendar-check", tier: "on-course" },
      { key: "rules", label: "Rules reference", href: "/rules", icon: "ph ph-book-open", tier: "on-course" },
      // The way into the play shell, for staff who are also in the field.
      // Conditional on actually being entered — an organizer who does not play
      // would only reach a screen telling them so.
      { key: "me", label: "My round", href: "/me", icon: "ph ph-golf", tier: "on-course" },
    ],
  },
  {
    // Club-level, shared by every tournament this organization runs — as
    // opposed to "Set up", which only describes the event currently open.
    label: "Club",
    items: [
      { key: "roster", label: "Members", href: "/roster", icon: "ph ph-address-book", tier: "at-desk" },
      { key: "series", label: "Season standings", href: "/series", icon: "ph ph-trophy", tier: "at-desk" },
      { key: "organization", label: "Club settings", href: "/organization", icon: "ph ph-buildings", tier: "at-desk" },
    ],
  },
  {
    // Everything that defines the tournament. Locks when the event goes live.
    label: "Set up",
    items: [
      { key: "event", label: "Tournament details", href: "/event", icon: "ph ph-gear-six", tier: "at-desk" },
      { key: "registration", label: "Registration & field", href: "/registration", icon: "ph ph-user-plus", tier: "at-desk" },
      { key: "stages", label: "Rounds & formats", href: "/stages", icon: "ph ph-stack", tier: "at-desk" },
      // Bands across the field, which is what a flight is — and NOT
      // ph-squares-four, which is the Dashboard's icon. Two entries wearing the
      // same glyph is the sidebar losing the only thing an icon is for.
      { key: "grouping", label: "Flights", href: "/grouping", icon: "ph ph-rows", tier: "at-desk" },
      { key: "teams", label: "Teams & pairs", href: "/teams", icon: "ph ph-users-three", tier: "at-desk" },
      { key: "access", label: "Access & staff", href: "/access", icon: "ph ph-shield-check", tier: "at-desk" },
    ],
  },
  {
    // Running the live competition — always available once play begins.
    label: "Manage",
    items: [
      { key: "foursomes", label: "Tee sheet", href: "/foursomes", icon: "ph ph-users-four", tier: "on-course" },
      { key: "entry", label: "Score entry", href: "/entry", icon: "ph ph-pencil-simple", tier: "on-course" },
      { key: "bracket", label: "Bracket", href: "/bracket", icon: "ph ph-tree-structure", tier: "on-course" },
      { key: "announcements", label: "Announcements", href: "/announcements", icon: "ph ph-megaphone", tier: "on-course" },
      { key: "messages", label: "Messages", href: "/messages", icon: "ph ph-chat-circle-dots", tier: "on-course" },
    ],
  },
  /**
   * MONEY, on its own.
   *
   * It sat under Results, beside the export — which is where a tournament's
   * money went when it was one screen of prize payouts. It is not that any
   * more: there is the club's pot, each fourball's own game, side bets, the
   * shared costs of a trip, the float and the settle-up. That is an
   * accounting section, and a treasurer coming to do the books should not
   * have to look for it under the same heading as a CSV.
   *
   * Deliberately AFTER Results rather than before: the golf comes first, and
   * the money is what follows a round rather than what a club opens the app
   * for. The order is the claim — the golf is the product, the accounting is
   * the part that stops being a chore.
   */
  {
    label: "Results",
    items: [
      { key: "reports", label: "Reports & export", href: "/reports", icon: "ph ph-export", tier: "at-desk" },
    ],
  },
  {
    label: "Money",
    items: [
      // Coins rather than a trophy: the trophy belongs to Season standings, and
      // this section is the money. What is being opened here is a payout.
      { key: "prizes", label: "Prizes & payouts", href: "/prizes", icon: "ph ph-coins", tier: "at-desk" },
      // Its own entry, not a section of Prizes, because it is different money
      // with different owners: the field's pot is the club's, a group's pot is
      // four players' own. Two lists of identical-looking cards on one screen
      // is how somebody pays into the wrong one.
      // Money among a group, which is exactly what this screen is — and not
      // ph-users-three, which is "Teams & pairs" in Set up. The two screens are
      // already easy to confuse by name; wearing one glyph made it worse.
      { key: "group-games", label: "Group games", href: "/group-games", icon: "ph ph-hand-coins", tier: "on-course" },
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
  opts: {
    hasTeamRound?: boolean;
    hasKnockout?: boolean;
    isLeague?: boolean;
    /** The organizer said at setup that people play in pairs or teams. */
    wantsTeams?: boolean;
    /**
     * This staff member is also in the field.
     *
     * Club golf is mostly run by people who are playing in the thing they are
     * running. Without this they had to sign out of their own tournament to
     * fill in their own card, which is absurd — and the play shell's only door
     * pointed outwards.
     */
    isPlayerToo?: boolean;
    /**
     * This is a match between two people, not a tournament.
     *
     * The other flags here hide a screen because the tournament has not grown
     * into it yet — no team round, so no Teams; no knockout, so no Bracket.
     * This one hides screens the event will never grow into, because a match
     * is finished when the two of them shake hands on the 18th.
     *
     * What it removes is the apparatus of running a FIELD: dividing one into
     * flights, drawing it a tee sheet, announcing things to it, and hiring
     * staff to help. Two people on the first tee have no field, and every one
     * of those links was a door to a screen about somebody else's problem.
     *
     * What it deliberately keeps is anything a match genuinely has. The field
     * screen stays, because it is where a mistyped name or a wrong handicap
     * gets fixed and there is nowhere else. Prizes and Group games stay,
     * because a match played for a fiver is the oldest bet in golf. Rounds &
     * formats stays, because changing 18 to 9 or gross to net is exactly the
     * kind of second thought two people have on the first tee.
     */
    isMatch?: boolean;
    /**
     * What this organization is — club, society or one person.
     *
     * Only the "Club" section and its settings entry read it. Everything else
     * in the sidebar is about the tournament, which does not change shape
     * because of who is running it.
     */
    orgKind?: OrgKind;
  } = {},
): NavSection[] {
  const TOURNAMENT_ONLY = TOURNAMENT_ONLY_SCREENS;

  const allowed = (key: string): boolean => {
    if (!canAccessScreen(viewRole, key)) return false;
    if (opts.isMatch && TOURNAMENT_ONLY.has(key)) return false;
    // Teams only matter to a tournament that has a team round in it. Most
    // don't, and a permanent link to an empty screen is just clutter — the
    // link appears the moment a round is set to a team format.
    // ...or once the organizer has said at setup that people play as a side.
    //
    // Gating on hasTeamRound alone created a dead end: the Teams screen's own
    // empty state is what explains how to set a round to a team format, and it
    // was unreachable until you had already done the thing it explains.
    if (key === "teams" && !opts.hasTeamRound && !opts.wantsTeams) return false;
    // Qualification has no entry of its own any more: it is the audit of a
    // draw, and it now sits under that draw on /bracket. The two were gated on
    // the same condition and showed the same players, one as "who goes
    // through" and the other as "who they play". See QualificationPanel.
    // "My round" is the play shell. It belongs to whoever is entered, not to a
    // role — an organizer who plays needs it, and one who does not would find
    // nothing there.
    if (key === "me" && !opts.isPlayerToo) return false;
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

  /**
   * The one section whose wording depends on what the outfit IS.
   *
   * `NAV` is a constant, and rightly — a sidebar assembled per request is a
   * sidebar that can differ between two screens of the same app. This is the
   * single exception, and it is applied to the SECTION and its settings ITEM
   * together, because they sit one line apart: a "Club" heading over "Outing
   * settings" would be the same disagreement moved rather than fixed.
   *
   * Falls back to the club wording when no kind is passed, which is what every
   * caller did before and what a club — the commonest case — should see.
   */
  const profile = opts.orgKind ? orgProfile(opts.orgKind) : null;
  const relabel = (s: NavSection): NavSection => {
    if (!profile || s.label !== "Club") return s;
    return {
      ...s,
      label: profile.groupLabel,
      items: s.items.map((i) =>
        i.key === "organization" ? { ...i, label: itemLabel(i, false, opts.orgKind) } : i,
      ),
    };
  };

  /**
   * A casual round's sidebar in a casual round's words.
   *
   * The screens themselves are right to be here — the comment on `isMatch`
   * above says why each one stays, and none of that changes. What was wrong is
   * what they are CALLED. Two people who opened the app to play each other on
   * Sunday were handed "Tournament details", "Registration & field", "Rounds &
   * formats", under headings reading Set up, Manage and Results: a filing
   * cabinet for an event that does not exist, describing a round that will be
   * deleted tomorrow. Read off the screen on 2026-09-10 after setting one up.
   *
   * Renaming rather than removing, deliberately. Every one of these is the
   * only door to something a round genuinely needs — a mistyped name, a wrong
   * index, eighteen changed to nine on the first tee — and a sidebar that
   * hides them strands somebody exactly as a dead link does.
   *
   * `screenName()` states the rule that a screen has one name, and grants the
   * phone's tab bar a single confined exception. This is the second, and it is
   * confined the same way: two maps, read in one place, applied only when the
   * event is a casual round.
   */
  const forMatch = (s: NavSection): NavSection =>
    !opts.isMatch
      ? s
      : {
          ...s,
          label: MATCH_SECTION_LABEL[s.label] ?? s.label,
          items: s.items.map((i) => ({ ...i, label: itemLabel(i, true, opts.orgKind) })),
        };

  return NAV.map((s) =>
    forMatch(relabel({ ...s, items: s.items.filter((i) => allowed(i.key)) })),
  ).filter((s) => s.items.length > 0);
}

/**
 * The three console screens the phone's tab bar promotes, in order.
 *
 * ONLY THE SHORT LABEL LIVES HERE. The href and the icon come from `NAV`,
 * because the tab bar used to carry its own copy of all three and a copy is a
 * second source of truth: change an icon in `NAV` and the bar keeps the old
 * one, silently, on the surface nobody checks on a desktop.
 *
 * The label is the one thing that legitimately differs — "Board" and "Scores"
 * rather than "Live leaderboard" and "Score entry" — because a tab is about
 * 80px wide. That is a deliberate exception to the rule `screenName()` states,
 * and it is confined to this list so it cannot spread.
 */
const PRIMARY_TABS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "dashboard", label: "Dashboard" },
  { key: "leaderboard", label: "Board" },
  { key: "entry", label: "Scores" },
];

/**
 * The tab bar's primary tabs, DERIVED from the same filtered sections the
 * sidebar renders.
 *
 * The bar used to render a static list, so the phone offered doors the desktop
 * sidebar deliberately hides. `navForRole` drops "leaderboard" in a blind
 * event and "entry" in an organizer-scored one — precisely so nobody is given
 * a link that bounces — and both screens redirect to /dashboard when opened
 * anyway (`leaderboard/page.tsx`, `entry/page.tsx`). The sidebar was fixed;
 * the bar beside it was not.
 *
 * It bites hardest on the role preview, which is the one feature whose entire
 * job is to show an organizer what a PLAYER sees: switch "Viewing as" to
 * Player on a phone and the bar kept offering Board and Scores after the
 * sidebar had correctly removed them. A preview that lies is worse than no
 * preview.
 *
 * Taking `sections` rather than a role means this cannot drift from the
 * sidebar: they are the same list, filtered once.
 */
export function primaryTabs(sections: NavSection[]): NavItem[] {
  const byKey = new Map(sections.flatMap((s) => s.items).map((i) => [i.key, i]));
  return PRIMARY_TABS.flatMap((tab) => {
    const item = byKey.get(tab.key);
    return item ? [{ ...item, label: tab.label }] : [];
  });
}

/**
 * A screen's own name, read from the sidebar rather than written out again.
 *
 * Anything that points somebody AT a screen — a checklist row, a "recommended
 * flow", a refusal saying where to go — has to call it what the sidebar calls
 * it, or the reader hunts for a screen that is not in the list. Writing the
 * name out a second time is how the app came to have a checklist row reading
 * "Rounds & format" and a flow list reading "Prizes & Reports", neither of
 * which is a screen.
 *
 * Falls back to the href, which is at least true, rather than to a guess.
 */
export function screenName(href: string, isMatch = false, orgKind?: OrgKind): string {
  const path = href.split(/[?#]/)[0];
  for (const section of NAV) {
    for (const item of section.items) {
      if (item.href === path) {
        /**
         * A casual round calls three of these something else, and this reader
         * has to agree with the sidebar or it becomes the exact fault the
         * paragraph above describes.
         *
         * The flag defaults to false, so every caller that does not know
         * about casual rounds — the setup flow, the checklist, half a dozen
         * cross-references inside tournament screens — keeps the tournament
         * name, which is the only name those screens are ever shown under.
         */
        return itemLabel(item, isMatch, orgKind);
      }
    }
  }
  return path;
}

/** Every nav item, flattened — the sections are for display, not for lookup. */
export function allNavItems(): NavItem[] {
  return NAV.flatMap((section) => section.items);
}

/**
 * The routes held to touch minimums, read from the nav rather than listed
 * again.
 *
 * A hand-written list is exactly what this replaces, and the reason is on the
 * record: `layout.spec` used one, it covered 14 of 22 routes, and the eight it
 * missed had no layout assertion at all — silently, because a list that is
 * short looks identical to a list that is complete. Deriving from `NAV` means a
 * screen added to the sidebar is graded the day it is added, and a screen that
 * is NOT in the sidebar cannot quietly acquire a tier it was never given.
 *
 * What this is NOT is a filter on which screens get swept. `layout.spec` still
 * walks the filesystem and measures every route at every viewport; this only
 * says where the 44px floor additionally applies.
 */
export function routesForTier(tier: NavTier): string[] {
  return allNavItems()
    .filter((item) => item.tier === tier)
    .map((item) => item.href)
    .sort();
}
