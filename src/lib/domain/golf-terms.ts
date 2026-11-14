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
 *
 * THREE REGISTERS, AND WHY THE THIRD (2026-10-24, `docs/country-words.md`).
 * Ajay: "we are using societies a lot. in US its Leagues. We need to represent
 * all geographies." The table there is the golf pro's and the marketing
 * manager's, with sources. Two registers were enough for Britain and the US
 * and wrong for the southern hemisphere: an Australian, a New Zealander and a
 * South African ride in a CART (in Australia a "buggy" is as often the trolley
 * you pull, and a New Zealander pulls a "trundler"), book a FOURBALL, and go to
 * a GOLF DAY, not a society day. That is three words, so `au` is three words
 * away from `uk` and otherwise the same.
 */
export type GolfRegister = "us" | "uk" | "au";

export const GOLF_REGISTERS: readonly GolfRegister[] = ["us", "uk", "au"];

/**
 * The countries that speak UK golf: Britain and Ireland, and the eurozone —
 * whose clubs learnt the game's English from the R&A rather than the USGA.
 * Canada is deliberately NOT here: it plays in carts and foursomes, in leagues.
 */
const UK_COUNTRIES = new Set([
  "GB", "IE",
  // Eurozone.
  "AT", "BE", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IT", "LV", "LT", "LU",
  "MT", "NL", "PT", "SK", "SI", "ES",
]);

/** The countries of the third register: R&A golf, played from a cart. */
const AU_COUNTRIES = new Set(["AU", "NZ", "ZA"]);

export function isGolfRegister(v: string): v is GolfRegister {
  return (GOLF_REGISTERS as readonly string[]).includes(v);
}

/** Which register a country speaks, before the club has said anything. */
export function countryRegister(country?: string | null): GolfRegister {
  const code = countryCode(country ?? "");
  if (AU_COUNTRIES.has(code)) return "au";
  return UK_COUNTRIES.has(code) ? "uk" : "us";
}

/**
 * Which golf the club speaks. Its own choice if it made one; otherwise its
 * country's; otherwise US. An unrecognised stored value falls through rather
 * than throwing, so a row from a later version cannot break a screen.
 */
export function golfRegister(country?: string | null, override?: string | null): GolfRegister {
  const chosen = (override ?? "").trim().toLowerCase();
  if (isGolfRegister(chosen)) return chosen;
  return countryRegister(country);
}

/**
 * The words. Each is the SAME concept in every register, written the way that
 * register's golfers write it. Lower case; a screen capitalises as it needs —
 * or writes the token with a capital (`{Outing}`), see `inClubWords`.
 *
 * AUDIENCE AND EVENT WORDS ONLY. Never a Rules of Golf FORMAT (Foursomes and
 * Four-Ball keep their Rules names in every country), and never a NAME a club
 * gives its own day ("Captain's Day", "Member-Guest") — those are the club's.
 */
export const GOLF_TERMS = {
  /** A motorised golf car. */
  cart: { us: "cart", uk: "buggy", au: "cart" },
  carts: { us: "carts", uk: "buggies", au: "carts" },
  /** The group of up to four who play together — NOT a format. */
  group: { us: "foursome", uk: "fourball", au: "fourball" },
  groups: { us: "foursomes", uk: "fourballs", au: "fourballs" },
  /** A group of three and of two — how a tee sheet names the odd sizes. */
  groupOfThree: { us: "threesome", uk: "three-ball", au: "three-ball" },
  groupOfTwo: { us: "twosome", uk: "two-ball", au: "two-ball" },
  /** The person running the event. */
  organizer: { us: "organizer", uk: "organiser", au: "organiser" },
  organizers: { us: "organizers", uk: "organisers", au: "organisers" },
  /** A stroke-play competition, as a member would name the day. */
  strokeCompetition: { us: "stroke play", uk: "medal", au: "stroke" },
  /** One round of it, after "a": "a stroke-play round", "a medal". */
  strokeRound: { us: "stroke-play round", uk: "medal", au: "stroke round" },
  /**
   * WHAT A COMMUNITY CALLS ITSELF when it has not said: the outfit that runs
   * regular golf without owning a course. Its value is also the key of
   * `COMMUNITY_VOICES` in `org-profile.ts`, which reads it from here.
   */
  community: { us: "league", uk: "society", au: "golfGroup" },
  /**
   * The same outfit in running text, beside "league": "a league or golf group".
   * Not "society" down under (the panel, 2026-10-26): Australia and New Zealand
   * say "social club" and South Africa "golf group", and the one word all three
   * read the same is "golf group". An outfit that calls itself a social club
   * says so on Club settings (`COMMUNITY_VOICES.socialClub`).
   */
  golfGroup: { us: "golf group", uk: "society", au: "golf group" },
  golfGroups: { us: "golf groups", uk: "societies", au: "golf groups" },
  /** The organized day out a group plays at somebody else's course. */
  outing: { us: "outing", uk: "society day", au: "golf day" },
  outings: { us: "outings", uk: "society days", au: "golf days" },
  /** A day played to raise money for a cause. */
  charityDay: { us: "charity outing", uk: "charity day", au: "charity golf day" },
  /**
   * The board of a club's past champions — the same board, spelled as the
   * country spells it. Canada spells "honours" and reads the US register: the
   * one word that split costs it (`docs/country-words.md`).
   */
  honoursBoard: { us: "honors board", uk: "honours board", au: "honours board" },
} as const satisfies Record<string, Record<GolfRegister, string>>;

export type GolfTerm = keyof typeof GOLF_TERMS;

export type GolfWords = Record<GolfTerm, string>;

/** Every term, resolved for one register. */
export function golfTermsFor(register: GolfRegister): GolfWords {
  const out = {} as GolfWords;
  for (const key of Object.keys(GOLF_TERMS) as GolfTerm[]) out[key] = GOLF_TERMS[key][register];
  return out;
}

function isGolfTerm(v: string): v is GolfTerm {
  return Object.prototype.hasOwnProperty.call(GOLF_TERMS, v);
}

/** The tokens `inClubWords` fills: `{golfGroup}`, or `{GolfGroup}` capitalised. */
export const CLUB_WORD_TOKEN = /\{([A-Za-z]+)\}/g;

/**
 * TEXT WRITTEN ONCE FOR EVERY REGISTER, filled in with the club's words.
 *
 * The guide, the player's Help and the plan copy are tables of sentences, read
 * by several screens and a PDF. Writing "society" into them chose one
 * country's golf for every club. They hold a token instead — `{golfGroups}`,
 * `{Outing}` — and the screen that draws them hands over its club's words.
 *
 * A capital first letter in the token gives a capital first letter in the
 * word. A token that is not a term is left as it is, so a typo shows on the
 * screen and `country-words.test.ts` refuses it before it ships.
 */
export function inClubWords(text: string, words: GolfWords): string {
  return text.replace(CLUB_WORD_TOKEN, (whole, name: string) => {
    const key = name.charAt(0).toLowerCase() + name.slice(1);
    if (!isGolfTerm(key)) return whole;
    const word = words[key];
    return name.charAt(0) === name.charAt(0).toUpperCase() ? word.charAt(0).toUpperCase() + word.slice(1) : word;
  });
}

/** `inClubWords` over every string in a table — arrays and plain objects, as the guide is built. */
export function tableInClubWords<T>(value: T, words: GolfWords): T {
  if (typeof value === "string") return inClubWords(value, words) as T;
  if (Array.isArray(value)) return value.map((v) => tableInClubWords(v, words)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = tableInClubWords(v, words);
    return out as T;
  }
  return value;
}

/**
 * What a casual round can be, in one line: "A match, a stroke-play round or a
 * foursome" to a US golfer, "A match, a medal or a fourball" to a British one.
 * Said on `/choose` and `/match/new`, which said the British line to everybody.
 */
export function casualRoundKinds(words: GolfWords): string {
  return `A match, a ${words.strokeRound} or a ${words.group}`;
}

/** What the setting offers, in the club's own words. */
export const GOLF_TERMS_LABEL: Record<"" | GolfRegister, string> = {
  "": "Follow our country",
  us: "US golf terms — cart, foursome, league, outing",
  uk: "UK and Irish golf terms — buggy, fourball, society, society day",
  au: "Australian, New Zealand and South African golf terms — cart, fourball, golf day",
};
