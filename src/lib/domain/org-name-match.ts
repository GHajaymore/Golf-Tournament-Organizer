/**
 * IS THIS THE CLUB THAT IS ALREADY HERE?
 *
 * Two people from one club both sign up, both type their club's name on their
 * first tournament, and the app cheerfully builds them two tenants with the
 * same name. Nothing warned, because `Organization.name` has no uniqueness and
 * nothing ever looked. What that costs is not a tidy list — it is the CLUB'S
 * ROSTER SPLIT DOWN THE MIDDLE, two calendars, two subscriptions, and members
 * invited into whichever half their secretary happened to be in.
 *
 * Ajay's decision, 2026-09-17: warn them first.
 *
 * A WARNING, NOT A REFUSAL, and the distinction decides this whole file.
 * Two real clubs do share a name — there is more than one Royal Golf Club, and
 * a society named after a pub is named after a chain of them. Refusing a
 * duplicate refuses a real customer, which is the course-card lesson written
 * down in CLAUDE.md: a guard that throws away something real is worse than no
 * guard. So this reports a LIKENESS and the person decides.
 *
 * Which is also why it matches LOOSELY. The two errors are not symmetrical:
 *
 *   over-match  →  somebody is asked a question they answer "no" to, once.
 *   under-match →  the roster splits, and nobody finds out for a season.
 *
 * So "Mill Ridge G.C." matches "Mill Ridge Golf Club", and "Château" matches
 * "Chateau". It is deliberately not clever beyond that: no edit distance, no
 * token overlap score, nothing that can match two clubs which merely sound
 * alike. Everything here is a rule somebody can read off the screen and
 * predict.
 */

/**
 * The words a golf club's name ends with that mean the same thing written
 * three ways. Whole-word sequences only, applied after punctuation is gone.
 *
 * Longest first: "golf and country club" has to be tried before "country club"
 * or it would fold to "golf and cc" and stop matching "GCC".
 */
const SAME_THING: [string, string][] = [
  ["golf and country club", "gcc"],
  ["golf country club", "gcc"],
  ["golf club", "gc"],
  ["country club", "cc"],
  ["golf society", "gs"],
  ["golf links", "gl"],
  ["golf course", "gc"],
];

/**
 * A name reduced to what two people typing the same club would agree on.
 *
 * Case, accents, punctuation and the ampersand all go — a club with "Men's &
 * Ladies'" in its name is written four ways by four secretaries and it is the
 * same club every time.
 */
export function normalizeOrgName(name: string): string {
  let s = name
    .normalize("NFD")
    // Strip combining marks: this is what makes "Château" and "Chateau" the
    // same club. The range is the combining-diacritics block.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    /**
     * APOSTROPHES VANISH, they do not become spaces — straight, curly and
     * backtick alike. The general rule below turns punctuation into a space
     * because "mill-ridge" is two words; run it on "men's" and you get "men s",
     * which then matches nothing a second secretary types. Caught by the test
     * pairing "Men’s & Ladies’ Society" with "Mens and Ladies Society", which
     * is one society written the two ordinary ways.
     */
    .replace(/['’`]/g, "")
    // Anything else that is not a letter, a digit or a space becomes a space
    // rather than nothing: "mill-ridge" is two words, not "millridge".
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  /**
   * AN INITIALISM IS ONE WORD, however it was punctuated. "G.C." arrives here
   * as "g c" and has to become "gc" or it stops matching "GC" — and the same
   * for "R.C.G.C.". Runs of two or more single letters only: a lone trailing
   * letter is part of a name, not an abbreviation.
   */
  s = s.replace(/\b(?:[a-z] ){1,}[a-z]\b/g, (run) => run.replace(/ /g, ""));

  if (s.startsWith("the ")) s = s.slice(4);

  for (const [long, short] of SAME_THING) {
    if (s.endsWith(` ${long}`)) {
      s = `${s.slice(0, -long.length - 1)} ${short}`;
      break;
    }
  }
  return s.trim();
}

/**
 * Whether these two names are worth asking about.
 *
 * Empty matches nothing: an organization that has never been named carries the
 * person's own name, and two organizers called Ajay Mehta are not a club.
 */
export function orgNamesLookLikeOne(a: string, b: string): boolean {
  const x = normalizeOrgName(a);
  const y = normalizeOrgName(b);
  return x.length > 0 && x === y;
}

/** Where an outfit says it is. Free text, because that is what the app stores. */
export interface Whereabouts {
  city: string;
  region: string;
  country: string;
}

/**
 * CLOSE ENOUGH TO BE THE SAME OUTFIT.
 *
 * Ajay asked for fifty miles. THE APP CANNOT MEASURE FIFTY MILES: an
 * organization's location is `city`, `region` and `country` as free text —
 * `schema.prisma` says so in as many words, and says why — and there is not a
 * coordinate anywhere in the database. A real radius needs a geocoder, an API
 * budget and a migration, and writing `withinFiftyMiles` over three free-text
 * fields would be a function whose name is a lie.
 *
 * So this is the honest approximation, and the name says what it does:
 *
 *   - same COUNTY OR STATE counts as near. A county is about fifty miles
 *     across; a state is more, which errs toward asking, and asking is the
 *     cheap mistake.
 *   - same TOWN counts as near even when the regions are written differently,
 *     because "Cincinnati / OH" and "Cincinnati / Ohio" are one place.
 *   - different COUNTRIES are not near, which is the one case worth being
 *     certain about: a Thursday League in Ohio and one in Cheshire are two
 *     leagues, always.
 *
 * FAILS OPEN, and that is the important half. Somebody who signed up an hour
 * ago has no town on their outfit at all — that is exactly the person about to
 * duplicate a league — so an unknown location is treated as near rather than
 * as far away. A filter that silences the warning for every brand new tenant
 * would silence it for everybody it was written for.
 *
 * When there is a geocoder, this is the one function to change.
 */
export function inTheSameArea(a: Whereabouts, b: Whereabouts): boolean {
  const norm = (s: string) => normalizeOrgName(s ?? "");
  const [ac, bc] = [norm(a.country), norm(b.country)];
  const [ar, br] = [norm(a.region), norm(b.region)];
  const [at, bt] = [norm(a.city), norm(b.city)];

  // Nothing known about one of them: ask, do not assume distance.
  if (!ac && !ar && !at) return true;
  if (!bc && !br && !bt) return true;

  if (at && bt && at === bt) return true;
  if (ac && bc && ac !== bc) return false;
  if (ar && br) return ar === br;

  // One of them named a country and nothing finer. Same country is as close as
  // this can get, and it is still a question worth asking.
  return true;
}

/**
 * What the screen and the endpoint both say. One string, because a question
 * asked in two different words is two questions.
 *
 * NAMED, AND PLACED WHERE THERE IS A PLACE. Ajay's read on who this actually
 * bites, 2026-09-17: a big club has one secretary and will never see this, and
 * a local league, society or outing has three people who all think they are
 * the one setting it up. Their names are also the generic ones — "Thursday
 * League", "Saturday Swindle" — so "that name is taken" is unanswerable on its
 * own. The town is usually the whole answer, so it goes in when the outfit has
 * filled one in.
 *
 * `label` comes from `orgProfile`, so a society is asked about as a society.
 */
export function clubExistsQuestion(existing: {
  name: string;
  /** "Club", "Society", … — `orgProfile(kind).label`. */
  label: string;
  /** Town or region, when the outfit has one. */
  where?: string;
  /**
   * WHO RUNS IT, so "ask them to add you" names somebody.
   *
   * A NAME AND NEVER AN EMAIL ADDRESS, which is the line this draws. Ajay
   * asked for a name so the person knows who to contact, and in a local league
   * that is the whole answer — they know Dave, they will text Dave. Printing
   * Dave's email would be handing a stranger a contact address out of somebody
   * else's account, which is a different thing entirely and not ours to give.
   *
   * Two things already keep this narrow: the name is only shown to somebody
   * who typed this outfit's name themselves, and only when they are in the
   * same area (`inTheSameArea`). It is never shown for a `personal` tenant.
   */
  runBy?: string;
}): string {
  const kind = existing.label.toLowerCase();
  const place = existing.where?.trim() ? ` in ${existing.where.trim()}` : "";
  const who = existing.runBy?.trim() ? ` It is run by ${existing.runBy.trim()}.` : "";
  return (
    `A ${kind} called “${existing.name}”${place} is already on TourneyHQ.${who} If that is yours, ` +
    `ask them to add you instead — a second one has its own roster, calendar and subscription, ` +
    `and members added to one never see the other. If yours is a different ${kind} with the same ` +
    `name, carry on.`
  );
}
