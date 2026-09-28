import { countryCode } from "./country";

/**
 * GOLF'S WORDS, AS THE CLUB'S COUNTRY SAYS THEM.
 *
 * Ajay, 2026-09-27: TourneyHQ should be "local by default and overridden option
 * for USD and US terminologies … including currency and golf terminologies."
 * The app's own copy was a mix — US spelling ("organizer") with UK golf words
 * ("fourball" for a group, "buggy") — so a US league and a Scottish club both
 * read half of it in somebody else's golf.
 *
 * THE CLUB'S COUNTRY, NEVER THE READER'S. The same rule `org-profile.ts` states
 * for the community noun: this describes the OUTFIT. An Irish secretary in
 * Boston runs a society, and a US league does not start saying "buggy" because
 * a member is on holiday in Dublin. `Organization.country` is the club's own
 * answer; `Organization.golfTerms` lets the club override it.
 *
 * ONLY WORDS FOR THE SAME THING. Every entry names one concept that the two
 * registers call differently. It never swaps a Rules of Golf FORMAT: UK
 * "foursomes" is alternate shot while a US "foursome" is a group of four, so
 * "the group you are playing with" is a term here and the format names are not.
 * `golf-terms.test.ts` pins that the format names never appear in this table.
 *
 * Unknown or blank country resolves to US — Ajay's default, the same as the
 * landing page's edition for a visitor from anywhere unlisted.
 */
export type GolfRegister = "us" | "uk";

export const GOLF_REGISTERS: readonly GolfRegister[] = ["us", "uk"];

/**
 * The countries that speak UK golf.
 *
 * Britain and Ireland, the Commonwealth golf countries, and the eurozone —
 * whose clubs learnt the game's English from the R&A rather than the USGA.
 * Canada is deliberately NOT here: it plays in carts and foursomes.
 */
const UK_COUNTRIES = new Set([
  "GB", "IE", "AU", "NZ", "ZA",
  // Eurozone.
  "AT", "BE", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IT", "LV", "LT", "LU",
  "MT", "NL", "PT", "SK", "SI", "ES",
]);

export function isGolfRegister(v: string): v is GolfRegister {
  return (GOLF_REGISTERS as readonly string[]).includes(v);
}

/**
 * Which golf the club speaks. Its own choice if it made one; otherwise its
 * country's; otherwise US. An unrecognised stored value falls through rather
 * than throwing, so a row from a later version cannot break a screen.
 */
export function golfRegister(country?: string | null, override?: string | null): GolfRegister {
  const chosen = (override ?? "").trim().toLowerCase();
  if (isGolfRegister(chosen)) return chosen;
  return UK_COUNTRIES.has(countryCode(country ?? "")) ? "uk" : "us";
}

/**
 * The words. Each is the SAME concept in both registers, written the way that
 * register's golfers write it. Lower case; a screen capitalises as it needs.
 */
export const GOLF_TERMS = {
  /** A motorised golf car. */
  cart: { us: "cart", uk: "buggy" },
  carts: { us: "carts", uk: "buggies" },
  /** The group of up to four who play together — NOT a format. */
  group: { us: "foursome", uk: "fourball" },
  groups: { us: "foursomes", uk: "fourballs" },
  /** The person running the event. */
  organizer: { us: "organizer", uk: "organiser" },
  organizers: { us: "organizers", uk: "organisers" },
  /** A stroke-play competition, as a member would name the day. */
  strokeCompetition: { us: "stroke play", uk: "medal" },
} as const satisfies Record<string, Record<GolfRegister, string>>;

export type GolfTerm = keyof typeof GOLF_TERMS;

/** Every term, resolved for one register. */
export function golfTermsFor(register: GolfRegister): Record<GolfTerm, string> {
  const out = {} as Record<GolfTerm, string>;
  for (const key of Object.keys(GOLF_TERMS) as GolfTerm[]) out[key] = GOLF_TERMS[key][register];
  return out;
}

/** What the setting offers, in the club's own words. */
export const GOLF_TERMS_LABEL: Record<"" | GolfRegister, string> = {
  "": "Follow our country",
  us: "US golf terms — cart, foursome, organizer",
  uk: "UK golf terms — buggy, fourball, organiser",
};
