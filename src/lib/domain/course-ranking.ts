import type { DirectoryHit } from "./course-directory";

/**
 * Putting the course somebody meant at the top.
 *
 * The catalogue matches on "contains", which is right — a club that types
 * "Ponkapoag" should find "1 At Ponkapoag Golf Club" — but ordering those
 * matches alphabetically is not. Typing "pebble" put "1 At Pebble..." above
 * "Pebble Beach Golf Links", and searching "golf" returned courses beginning
 * with digits, because "1" sorts before "P". A picker that makes you read
 * twenty rows to find the obvious one is a picker you stop trusting.
 *
 * So matches are TIERED by how the query lines up with the name, and only
 * sorted alphabetically inside a tier. The tiers are the ways a person means a
 * search, strongest first:
 *
 *   the whole name  →  they typed it exactly
 *   the start       →  they are typing it and stopped early
 *   a word in it    →  "crest" for "Green Crest", the commonest real case
 *   the town        →  "where do we play" rather than "what is it called"
 *   anywhere        →  a substring, which is a match but rarely the one meant
 *
 * Ranked here rather than in SQL because the tiers are a product judgement
 * about what a golfer meant, not a database concern — and because a pure
 * function is a thing the test suite can hold to account.
 */

/** Lower is better. Exported for the tests, which assert the ORDER of the
 *  tiers rather than their numbers. */
export const enum Tier {
  ExactName = 0,
  NameStarts = 1,
  NameWordStarts = 2,
  CityStarts = 3,
  Contains = 4,
  NoMatch = 5,
}


const norm = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    // Dropped, not spaced: "Andrew's" is one word and splitting it into
    // "andrew s" stops "st andrews" ever matching "St. Andrew's Links".
    .replace(/[.'`’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Does any word of `text` begin with `q`? */
const wordStarts = (text: string, q: string): boolean =>
  text.split(" ").some((w) => w.startsWith(q));

/**
 * Where the club plays, as much of it as is known.
 *
 * Every field optional, because every one of them is optional on the rows too:
 * 74% of the 2,184 catalogue rows carry a city and the rest carry nothing, and
 * a course outside the US has no `state` at all.
 */
export interface Near {
  city?: string;
  state?: string;
  country?: string;
}

/**
 * HOW CLOSE THIS ROW IS TO THE CLUB, ON THE DATA THAT ACTUALLY EXISTS.
 *
 * The catalogue is 2,184 courses and "golf" appears in most course names, so a
 * vague query genuinely matches 1,579 of them — and the picker then shows an
 * arbitrary fifty. A club almost always plays near itself, and the app already
 * knows where that is: the tournament's town, and the towns of the courses the
 * club has already saved. No browser permission, no coordinates, no API
 * allowance spent.
 *
 * DELIBERATELY NOT DISTANCE. There is no latitude or longitude on `Course` or
 * `CourseCatalog`, so real distance would mean backfilling coordinates for
 * 2,184 rows against an API capped at 500 requests a day, plus a geolocation
 * prompt on a setup screen. A declined prompt would leave the organizer with
 * the same 1,579 rows and no explanation, which is worse than not offering it.
 *
 * AND DELIBERATELY A RANKING, NEVER A FILTER. A quarter of the catalogue has
 * no town at all; filtering on this would make those courses unreachable while
 * looking like a tidier list. That is the shape `CLAUDE.md` devotes a section
 * to — four plausible course-card guards that would each have thrown away real
 * golf courses, and a re-validation pass that destroyed 33 good cards. So an
 * unknown town ranks with the same country rather than last: not ruled in, and
 * never ruled out.
 */
export const enum Locality {
  SameCity = 0,
  SameState = 1,
  /** Same country, or nothing on the row to say otherwise. */
  Unplaced = 2,
  Elsewhere = 3,
}

export function localityOf(
  row: { city?: string; state?: string; country?: string },
  near?: Near,
): Locality {
  if (!near) return Locality.Unplaced;
  const city = norm(near.city ?? "");
  const state = norm(near.state ?? "");
  const country = norm(near.country ?? "");
  const rowCity = norm(row.city ?? "");
  const rowState = norm(row.state ?? "");
  const rowCountry = norm(row.country ?? "");

  if (city && rowCity && city === rowCity) return Locality.SameCity;
  if (state && rowState && state === rowState) return Locality.SameState;
  // Nothing on the row places it, so nothing about it is wrong either.
  if (!rowCity && !rowState && !rowCountry) return Locality.Unplaced;
  if (country && rowCountry) return country === rowCountry ? Locality.Unplaced : Locality.Elsewhere;
  /**
   * The row says where it is and it is not here. Only a claim we can check
   * demotes anything: a row naming a different town in a country neither side
   * states is still evidence, and a row naming nothing is not.
   */
  if ((city && rowCity) || (state && rowState)) return Locality.Elsewhere;
  return Locality.Unplaced;
}

/**
 * How well one course answers this query.
 *
 * `NoMatch` is possible and kept rather than filtered: the catalogue decided
 * this row matched, and second-guessing that here would drop a course the
 * database found for a reason this function does not model.
 */
export function tierOf(hit: { name: string; city: string }, query: string): Tier {
  const q = norm(query);
  if (!q) return Tier.NoMatch;
  const name = norm(hit.name);
  const city = norm(hit.city);

  if (name === q) return Tier.ExactName;
  if (name.startsWith(q)) return Tier.NameStarts;
  if (wordStarts(name, q)) return Tier.NameWordStarts;
  if (city.startsWith(q) || wordStarts(city, q)) return Tier.CityStarts;
  if (name.includes(q) || city.includes(q)) return Tier.Contains;
  return Tier.NoMatch;
}

/**
 * Order the matches so the top few are worth reading.
 *
 * Within a tier: a course that arrives WITH a card outranks one that does not,
 * because a club searching wants somewhere they can score a round today and a
 * cardless course is a second job. Then the shorter name, which breaks the
 * commonest tie in the right direction — "Pebble Beach Golf Links" above
 * "Pebble Beach Golf Links Practice Area" — and finally alphabetically, so the
 * order never depends on what the database happened to return first.
 *
 * Stable and total: two runs of the same query give the same list, which
 * matters because this list moves under the reader's fingers as they type.
 */
/**
 * Order any list of courses by what the query is aiming at.
 *
 * Generic because the same order has to hold everywhere a course is chosen —
 * the club's own library, a round's venue, the public directory. Three
 * screens with three sort orders is three different answers to "which course
 * did I mean".
 *
 * `hasCard` decides the tie-break within a tier: a course you can score a
 * round on today outranks one that still needs its card typed in. Callers
 * that have no such distinction pass nothing.
 */
export function rankCourses<T extends { name: string; city?: string; state?: string; country?: string }>(
  items: readonly T[],
  query: string,
  hasCard: (item: T) => boolean = () => false,
  near?: Near,
): T[] {
  const scored = items.map((item) => ({
    item,
    tier: tierOf({ name: item.name, city: item.city ?? "" }, query),
    card: hasCard(item),
    where: localityOf(item, near),
  }));
  scored.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    /**
     * WHERE, BEFORE WHETHER IT CAN BE SCORED ON.
     *
     * Both are tiebreaks inside one relevance tier, so the question they are
     * settling is "which Hillcrest did you mean" — and the answer to that is
     * the one down the road, not the one with its card typed in. A card can be
     * added in a minute; a club playing the wrong county's course is a wrong
     * tee sheet.
     */
    if (a.where !== b.where) return a.where - b.where;
    if (a.card !== b.card) return a.card ? -1 : 1;
    const byLength = a.item.name.length - b.item.name.length;
    if (byLength !== 0) return byLength;
    return a.item.name.localeCompare(b.item.name);
  });
  return scored.map((s) => s.item);
}

/**
 * The same order, for a directory hit.
 *
 * A thin wrapper rather than a second implementation: the club picking a
 * course from its own library and the club looking one up in the directory
 * are the same act, and a list that sorted differently between the two would
 * be the app disagreeing with itself about which course you meant.
 */
export function rankCourseHits<T extends DirectoryHit>(
  hits: readonly T[],
  query: string,
  near?: Near,
): T[] {
  return rankCourses(hits, query, (h) => h.par > 0, near);
}
