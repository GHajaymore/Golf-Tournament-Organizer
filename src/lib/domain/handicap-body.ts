import { countryCode } from "./country";

/**
 * THE BODY THAT ISSUES A CLUB'S HANDICAP INDEXES, AND THE WORDS FOR IT.
 *
 * Ajay, 2026-10-17: "we need to add international bodies too … add only the
 * top 3-5". Every one of these calculates under the World Handicap System — WHS
 * is the method, run by the R&A and the USGA; these are the bodies that hold a
 * golfer's record and issue the index. So a club picks a BODY, never "WHS".
 *
 * Keyed by body, not by platform (panel, 2026-10-17): the Emirates and Hong
 * Kong federations run on GHIN, and a club there is not "GHIN (USGA)".
 *
 * None of these is connected — there is no public API for any of them (the
 * panel looked). Each is chosen, named and worded correctly, and reads "Not
 * connected" until a club licenses access — the state the app already handles
 * for GHIN (`integrations/ghin.ts`).
 *
 * "national" is the honest fallback for every other country: the setting and
 * the member's number are worded for "your national association" rather than
 * for an American body the club has nothing to do with.
 */

export interface HandicapBody {
  id: string;
  /** As golfers say it, on the setting: "England Golf". */
  name: string;
  /** What a member's number with this body is called. */
  number: string;
  /** The app or service golfers know it by, for the "how to connect" line. */
  service: string;
}

export const HANDICAP_BODIES: readonly HandicapBody[] = [
  { id: "ghin", name: "GHIN (USGA)", number: "GHIN number", service: "GHIN" },
  { id: "england-golf", name: "England Golf", number: "England Golf membership number (CDH)", service: "My England Golf" },
  { id: "golf-ireland", name: "Golf Ireland", number: "Golf Ireland number", service: "the Golf Ireland app" },
  { id: "golf-canada", name: "Golf Canada", number: "Golf Canada number", service: "Golf Canada Score Centre" },
  { id: "golf-australia", name: "Golf Australia", number: "Golf ID", service: "the Golf Australia app" },
  { id: "national", name: "Your national association", number: "national association number", service: "your national association" },
];

/** The body for an id, or null for one this app does not have. */
export function handicapBody(id: string | null | undefined): HandicapBody | null {
  const key = (id ?? "").trim().toLowerCase();
  return HANDICAP_BODIES.find((b) => b.id === key) ?? null;
}

/**
 * The body a club in this country most likely answers to — a default to
 * offer, never a choice made for it.
 *
 * Read from what the club TYPED as well as its ISO code, because "GB" is four
 * nations and two bodies: Northern Ireland is Golf Ireland (one body for the
 * whole island), England is England Golf, and Scotland and Wales have bodies
 * of their own that this list does not carry yet, so they get the national
 * fallback rather than England's. A blank country is the app's default, the US.
 */
export function defaultHandicapBody(country: string | null | undefined): HandicapBody {
  const raw = (country ?? "").trim().toLowerCase();
  const code = countryCode(country ?? "");
  const pick = (id: string) => handicapBody(id)!;
  if (raw === "northern ireland" || code === "IE") return pick("golf-ireland");
  if (raw === "scotland" || raw === "wales") return pick("national");
  if (code === "GB") return pick("england-golf");
  if (code === "CA") return pick("golf-canada");
  if (code === "AU") return pick("golf-australia");
  if (code === "US" || !code) return pick("ghin");
  return pick("national");
}

/**
 * THE BODY THIS CLUB IS ON — the one question every screen and action asks.
 *
 * A club that has chosen one ("Both" or "<body> only") is on the body it
 * chose. A club still on its own record has chosen nothing — and the stored
 * column defaults to "ghin" for every club ever made — so it is offered its
 * country's body, which is what its members will have numbers with.
 */
export function clubHandicapBody(org: {
  handicapPolicy?: string | null;
  handicapAuthorityId?: string | null;
  country?: string | null;
}): HandicapBody {
  const chose = (org.handicapPolicy ?? "club").trim().toLowerCase() !== "club";
  return (chose && handicapBody(org.handicapAuthorityId)) || defaultHandicapBody(org.country);
}

/** "a GHIN number", "an England Golf membership number (CDH)". */
export function aNumber(b: HandicapBody): string {
  return `${/^[aeiou]/i.test(b.number) ? "an" : "a"} ${b.number}`;
}

/** The body as a short choice label beside "Manual" and "None" — "GHIN", "England Golf", "Association". */
export function bodyShortLabel(b: HandicapBody): string {
  return b.id === "national" ? "Association" : b.id === "ghin" ? "GHIN" : b.name;
}

/** "England Golf" in a sentence — "your national association" stays lower case there. */
export function bodyInProse(b: HandicapBody): string {
  return b.id === "national" ? "your national association" : b.id === "ghin" ? "GHIN" : b.name;
}
