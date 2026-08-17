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
 *   - a CLUB and a COURSE run competitions for a standing membership. Money
 *     means the pots, settled round by round, usually in cash the same
 *     evening. Nobody splits a cart fee with the club — they pay the shop.
 *   - a COMMUNITY (a society, a league, a group of friends who play weekly)
 *     runs the same competitions AND shares real costs somebody fronted: the
 *     minibus, the green fees, dinner. That is what the ledger is for.
 *   - a PERSONAL organizer is one person running one thing. Same as a
 *     community in what it needs, smaller in what it has.
 */

export type OrgKind = "club" | "course" | "community" | "personal";

export const ORG_KINDS: OrgKind[] = ["club", "course", "community", "personal"];

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
   * Shared costs and a settle-up.
   *
   * Off for a club and a course. A ledger there is a feature from somebody
   * else's outing and worse than absent: it invites a member to think the club
   * owes them for the buggy.
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
    blurb: "A members' club running competitions for its own membership.",
    sharedRoster: true,
    ledger: false,
    seasonPlay: true,
    ownsCourse: true,
  },
  course: {
    label: "Golf course",
    blurb: "A course or resort running events for whoever books them.",
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
