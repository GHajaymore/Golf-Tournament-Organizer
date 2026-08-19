/**
 * What kind of organization this is, and what follows from it.
 *
 * `Organization.kind` already existed as "club" or "personal" and was compared
 * inline wherever something needed to differ — the roster screen, the event
 * picker, the settings header. That works while there are two kinds and one
 * question. It stops working the moment a third kind arrives, because every
 * one of those comparisons is a separate decision about what the new kind is,
 * made by whoever last edited that file.
 *
 * So the kinds are declared once, here, with what each one MEANS. Everything
 * else asks this rather than comparing a string. Adding a kind is then a row
 * in one table, and the compiler finds every place that has to have an answer
 * for it.
 *
 * The distinctions are drawn from how the golf is actually organised, not from
 * how big the outfit is:
 *
 *   - a CLUB (or a course, or a resort) runs competitions for a standing
 *     membership or for whoever books. Money means the pots, settled round by
 *     round, usually in cash the same evening. Nobody splits a cart fee with
 *     the club — they pay the shop.
 *   - a COMMUNITY (a society, a league, a group of friends who play weekly)
 *     runs the same competitions AND shares real costs somebody fronted: the
 *     minibus, the green fees, dinner. That is what the ledger is for.
 *   - a PERSONAL organizer is one person running one thing. Same as a
 *     community in what it needs, smaller in what it has.
 *
 * There was briefly a fourth kind, `course`, for a course or resort as distinct
 * from a members' club. It was removed on 2026-08-18 because it held the SAME
 * value as `club` on all five flags below — it was a label, not a kind, and a
 * kind that decides nothing is a question an organizer has to answer for no
 * reason and a fifth column to fill in every time a flag is added. The word
 * survives where it belongs, in the signup wording ("A golf club or course"),
 * which is where somebody recognises their own outfit. Nothing had ever been
 * written with it: no code path writes `kind` at all except the hard-coded
 * "personal" in services/organization.ts, so there were no rows to migrate.
 * If a resort ever does need a different answer to one of these, it comes back
 * as one row in PROFILES and the compiler finds every caller — which is the
 * whole point of declaring them here.
 */

export type OrgKind = "club" | "community" | "personal";

export const ORG_KINDS: OrgKind[] = ["club", "community", "personal"];

export interface OrgProfile {
  kind: OrgKind;
  /** What to call it on screen. */
  label: string;
  /** One line an organizer would recognise their own outfit in. */
  blurb: string;
  /**
   * A member list that outlives any one tournament, shared by the staff.
   * A personal organizer keeps their own list of players instead.
   */
  sharedRoster: boolean;
  /**
   * Shared costs and a settle-up: money one person FRONTED and the others owe
   * a share of. The minibus, the green fees, dinner.
   *
   * Off for a club. A ledger there is a feature from somebody else's outing and
   * worse than absent: it invites a member to think the club owes them for the
   * buggy. A society is the opposite case — one person paid for the minibus and
   * is owed by nine others, with nobody in a shop to arbitrate — and that is
   * the whole reason the settle-up exists.
   *
   * Note what this is NOT about: whether the app counts money at all. It does,
   * for everybody. A club runs skins and a 2s pot, players stake in them, and
   * the app works out who won and who is down a fiver — see `usesExpenses` and
   * `moneyScreenApplies`. A stake in a pot is a RESULT, settled at the bar the
   * same evening. A share of the minibus is a DEBT, and only some outfits have
   * them.
   *
   * There used to be a second flag here, `tracksCash`, documented as "whether
   * the APP is the thing that tracks who has paid" and false for a club. Three
   * things were wrong with it. It was read by nothing. It held the same value
   * as `ledger` on every kind, which a test asserted outright — so it was a
   * second name for this rule, and this codebase's recurring defect is one rule
   * with two readers that disagree. And by 2026-08-18 its claim was simply
   * false: a club player who stakes in the skins and wins nothing is shown a
   * negative number, and an organizer marks a pot entrant unpaid. The app does
   * track who has paid at a club. Removed rather than reworded, because the
   * honest split of it is "a constant that is true everywhere" plus this flag.
   */
  ledger: boolean;
  /**
   * Competitions that run week after week, so season standings and a
   * carried-over order of merit mean something.
   */
  seasonPlay: boolean;
  /**
   * Whether the organization is a venue in its own right — it has a course,
   * so its own card is the default rather than one picked per event.
   */
  ownsCourse: boolean;
}

const PROFILES: Record<OrgKind, Omit<OrgProfile, "kind">> = {
  club: {
    label: "Golf club",
    blurb: "A club, course or resort running competitions for its members and guests.",
    sharedRoster: true,
    ledger: false,
    seasonPlay: true,
    ownsCourse: true,
  },
  community: {
    label: "Society or league",
    blurb: "A society, league or group that plays together and shares the costs.",
    sharedRoster: true,
    ledger: true,
    // One person fronted the minibus and is owed by nine others, no shop to ask.
    seasonPlay: true,
    ownsCourse: false,
  },
  personal: {
    label: "Personal",
    blurb: "One organizer running an outing, with their own list of players.",
    sharedRoster: false,
    ledger: true,
    seasonPlay: false,
    ownsCourse: false,
  },
};

export function isOrgKind(v: string): v is OrgKind {
  return (ORG_KINDS as string[]).includes(v);
}

/**
 * The profile for a stored kind.
 *
 * Unknown values resolve to `personal`, which is the schema's own default and
 * the most permissive answer: it shows the ledger. Failing the other way would
 * hide real debts from the people who owe them, and a typo in a column should
 * never be the reason somebody is not told they owe forty pounds.
 */
export function orgProfile(kind: string | null | undefined): OrgProfile {
  const k = isOrgKind(kind ?? "") ? (kind as OrgKind) : "personal";
  return { kind: k, ...PROFILES[k] };
}
