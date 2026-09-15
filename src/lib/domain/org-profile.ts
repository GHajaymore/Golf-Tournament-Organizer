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

import { countryCode } from "./country";

export type OrgKind = "club" | "community" | "personal";

export const ORG_KINDS: OrgKind[] = ["club", "community", "personal"];

export interface OrgProfile {
  kind: OrgKind;
  /** What to call it on screen, as a heading or a chip. Title case. */
  label: string;
  /**
   * What to call it inside a sentence — "Setting up your club", "Name your
   * outing".
   *
   * Separate from `label` because `label` does not survive being dropped into
   * running text. `OrgSetupChecklist` said "Setting up your personal" and the
   * first step was titled "Name your personal", both from lowercasing the
   * label. Neither is English. Nobody saw them because the component has never
   * been mounted.
   */
  noun: string;
  /** One line an organizer would recognise their own outfit in. */
  blurb: string;
  /**
   * What the organization-wide settings screen is called — its own heading and
   * its sidebar entry.
   *
   * Hard-coded as "Club settings" in both places, which is how a solo
   * organizer came to be shown a screen about a club they do not have while
   * the same page correctly rendered their type as "Personal". The page knew;
   * every string on it did not.
   *
   * Declared here rather than composed from `noun` at each call site so that
   * the two readers cannot drift — a sidebar saying one thing and a heading
   * saying another is this codebase's most-repeated defect.
   */
  settingsLabel: string;
  /**
   * The sidebar section that groups everything belonging to the organization
   * rather than to the tournament currently open — members, season standings,
   * the settings screen.
   *
   * Sat directly above "Club settings" and said "Club", so changing only one
   * of them would have left the pair disagreeing in the same eyeful.
   */
  groupLabel: string;
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

/**
 * What a community is called when nothing has said otherwise.
 *
 * Declared HERE, above `PROFILES`, rather than inline in the `community` entry
 * — because it is also the `society` row of `COMMUNITY_VOICES` below, and two
 * copies of the same five strings is precisely the defect this whole file
 * exists to prevent. The next person to reword one of them would have found a
 * second copy to disagree with.
 */
const COMMUNITY_DEFAULT_WORDS = {
  label: "Society or league",
  noun: "society",
  settingsLabel: "Society settings",
  groupLabel: "Society",
  blurb: "A society, league or group that plays together and shares the costs.",
} as const;

const PROFILES: Record<OrgKind, Omit<OrgProfile, "kind">> = {
  club: {
    label: "Golf club",
    noun: "club",
    settingsLabel: "Club settings",
    groupLabel: "Club",
    blurb: "A club, course or resort running competitions for its members and guests.",
    sharedRoster: true,
    ledger: false,
    seasonPlay: true,
    ownsCourse: true,
  },
  community: {
    ...COMMUNITY_DEFAULT_WORDS,
    sharedRoster: true,
    ledger: true,
    // One person fronted the minibus and is owed by nine others, no shop to ask.
    seasonPlay: true,
    ownsCourse: false,
  },
  personal: {
    label: "Personal",
    noun: "outing",
    settingsLabel: "Outing settings",
    groupLabel: "Outing",
    blurb: "One organizer running an outing, with their own list of players.",
    sharedRoster: false,
    ledger: true,
    seasonPlay: false,
    ownsCourse: false,
  },
};

/**
 * WHAT A COMMUNITY IS CALLED WHERE IT PLAYS.
 *
 * The three kinds describe how the golf is ORGANISED and they travel fine. The
 * one thing that does not travel is the NOUN for `community`: the same outfit
 * is a *society* in Britain and Ireland and a *golf league* or *association* in
 * the United States. `club` and `outing` are understood everywhere, which is
 * why this is one noun set on one kind rather than a rewrite.
 *
 * NOT OFF THE SIGNED-IN PERSON'S COUNTRY, which is the obvious implementation
 * and is wrong. That is a fact about a PERSON and this word describes an
 * OUTFIT: an Irish secretary living in Boston still runs a society, and a US
 * league secretary on holiday in Dublin does not become one.
 * `Organization.country` is the club's own answer about itself, which is the
 * right source.
 *
 * ONLY WHAT WAS ASKED FOR IS MAPPED, and everything else falls through to the
 * wording the app already used. Two reasons that matters here. `country` is
 * free text defaulting to `""`, so "no answer" is the common case and must not
 * become a wrong answer. And the register's third example — that an Australian
 * outfit is "often just a club" — is deliberately NOT implemented: calling a
 * `community` a "club" collides head-on with the `club` kind, so an AU society
 * and an AU golf club would read identically on every screen. That wants a
 * decision from somebody, not a guess from here.
 *
 * The country changes WORDS ONLY. Every behavioural flag below is a fact about
 * how the outfit runs its golf, and a society in Boston still fronts the
 * minibus. There is a test pinning that, because "translate the nouns" is
 * exactly the change that quietly takes a flag with it.
 */
type Words = Pick<OrgProfile, "label" | "noun" | "settingsLabel" | "groupLabel" | "blurb">;

/**
 * The words themselves, keyed by what the outfit calls itself.
 *
 * ALL FIVE STRINGS ARE AUTHORED TOGETHER rather than four of them derived
 * from `noun`. That is the whole reason `orgProfile` exists: `OrgSetupChecklist`
 * once said "Setting up your personal" and titled a step "Name your personal",
 * both from lowercasing a `label`, and neither is English. A generated
 * `settingsLabel` would reintroduce it one word at a time.
 *
 * `society` is the default and matches what the app said before any of this
 * existed, so an outfit that has answered nothing is unchanged.
 */
export const COMMUNITY_VOICES = {
  society: COMMUNITY_DEFAULT_WORDS,
  league: {
    label: "League or association",
    noun: "league",
    settingsLabel: "League settings",
    groupLabel: "League",
    blurb: "A league, association or group that plays together and shares the costs.",
  },
  association: {
    label: "Golf association",
    noun: "association",
    settingsLabel: "Association settings",
    groupLabel: "Association",
    blurb: "An association or group that plays together and shares the costs.",
  },
} as const satisfies Record<string, Words>;

export type CommunityVoice = keyof typeof COMMUNITY_VOICES;

export const COMMUNITY_VOICE_KEYS = Object.keys(COMMUNITY_VOICES) as CommunityVoice[];

export function isCommunityVoice(v: string): v is CommunityVoice {
  return (COMMUNITY_VOICE_KEYS as string[]).includes(v);
}

/**
 * Which voice a country gets when the outfit has not said.
 *
 * ONLY WHAT WAS ASKED FOR IS MAPPED. `country` is free text defaulting to `""`,
 * so "no answer" is the common case and must not become a wrong answer — and
 * the register's third example, that an Australian outfit is "often just a
 * club", is deliberately absent: calling a `community` a "club" collides with
 * the `club` KIND, so an AU society and an AU golf club would read identically
 * on every screen. That wants a decision, not a guess — and now that an
 * organizer can override, an Australian outfit that wants a different word has
 * a way to say so without the app assuming on its behalf.
 */
const VOICE_BY_COUNTRY: Record<string, CommunityVoice> = {
  US: "league",
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
export function orgProfile(
  kind: string | null | undefined,
  country?: string | null,
  /**
   * What the outfit calls ITSELF, overriding whatever its country implies.
   *
   * THE COUNTRY IS THE DEFAULT; THE ORGANIZER IS THE AUTHORITY. A country can
   * only ever be a good guess — a US club that has always called itself a
   * society is not wrong about its own name, and the app should not keep
   * correcting it. Empty, absent, or a value this file does not recognise all
   * fall through to the country, which falls through to `society`.
   *
   * Unrecognised resolves rather than throws on purpose. This arrives from a
   * free-text database column, and a stored value from a later version of the
   * app — or a typo — must not be able to break every screen that names the
   * outfit. Same direction of failure as an unknown `kind` resolving to
   * `personal`.
   */
  voice?: string | null,
): OrgProfile {
  const k = isOrgKind(kind ?? "") ? (kind as OrgKind) : "personal";
  const base = { kind: k, ...PROFILES[k] };
  if (k !== "community") return base;

  const chosen = (voice ?? "").trim();
  if (isCommunityVoice(chosen)) return { ...base, ...COMMUNITY_VOICES[chosen] };

  /**
   * Normalised through the app's one country vocabulary rather than compared
   * as text, so "United States", "USA" and "us" are the same country. Doing it
   * by hand is how the catalogue ended up with 187 rows of "GB" beside 10 of
   * "United Kingdom" — and `countryCode` returns "" for blank or "Unknown",
   * which lands on the default below exactly as it should.
   *
   * Both extra arguments are OPTIONAL, so every caller written before they
   * existed is unchanged and correct: nothing said means today's wording.
   */
  const byCountry = VOICE_BY_COUNTRY[countryCode(country ?? "")];
  return byCountry ? { ...base, ...COMMUNITY_VOICES[byCountry] } : base;
}
