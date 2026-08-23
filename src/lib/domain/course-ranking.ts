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
export function rankCourses<T extends { name: string; city?: string }>(
  items: readonly T[],
  query: string,
  hasCard: (item: T) => boolean = () => false,
): T[] {
  const scored = items.map((item) => ({
    item,
    tier: tierOf({ name: item.name, city: item.city ?? "" }, query),
    card: hasCard(item),
  }));
  scored.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
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
export function rankCourseHits<T extends DirectoryHit>(hits: readonly T[], query: string): T[] {
  return rankCourses(hits, query, (h) => h.par > 0);
}
