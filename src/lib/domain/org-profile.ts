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
  /**
   * Whether the APP is the thing that tracks who has paid.
   *
   * At a club or a course, it is not: the shop takes the entry fee, the 2s
   * pot comes out of it, and the professional pays the winner. The app's job
   * there is to say who won — a results sheet, not a cash book. Recording
   * "Halloran still owes £5" would be inventing a debt the club is not
   * chasing and cannot see, and every screen that showed it would be wrong.
   *
   * A society or a roll-up is the opposite case: one person fronted the money
   * and is owed by nine others, with nobody in a shop to arbitrate. That is
   * the whole reason the ledger and the settle-up exist.
   *
   * This is the flag that decides whether "take their money" and "you owe"
   * appear at all — not a cosmetic difference, a different product on the
   * same engine.
   */
  tracksCash: boolean;
}

const PROFILES: Record<OrgKind, Omit<OrgProfile, "kind">> = {
  club: {
    label: "Golf club",
    blurb: "A members' club running competitions for its own membership.",
    sharedRoster: true,
    ledger: false,
    seasonPlay: true,
    ownsCourse: true,
    // The shop takes the entry fee and pays the winner. The app says who won.
    tracksCash: false,
  },
  course: {
    label: "Golf course",
    blurb: "A course or resort running events for whoever books them.",
    sharedRoster: true,
    ledger: false,
    seasonPlay: true,
    ownsCourse: true,
    tracksCash: false,
  },
  community: {
    label: "Society or league",
    blurb: "A society, league or group that plays together and shares the costs.",
    sharedRoster: true,
    ledger: true,
    seasonPlay: true,
    ownsCourse: false,
    // One person fronted it and is owed by nine others, with no shop to ask.
    tracksCash: true,
  },
  personal: {
    label: "Personal",
    blurb: "One organizer running an outing, with their own list of players.",
    sharedRoster: false,
    ledger: true,
    seasonPlay: false,
    ownsCourse: false,
    tracksCash: true,
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
