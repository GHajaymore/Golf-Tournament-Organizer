/**
 * Tournaments with no fixed course.
 *
 * A club medal is played at the club. A society outing, an inter-club league
 * or a member-guest series is not: opponents arrange their own venue, week by
 * week, and the tournament has no course until somebody says where they
 * played. Until now setup insisted on a course up front, so those tournaments
 * were either set to a venue nobody used or left blank and unable to score.
 *
 * The rule this module exists to enforce: a card is never invented. Par and
 * stroke index decide net scores and shot allocation, so a guessed card is
 * not a smaller version of the right answer — it is a wrong result that looks
 * completely normal. Everything here either finds a real card or asks for one.
 */

/** How a tournament decides where it is played. */
export type CourseMode = "fixed" | "open";

export const COURSE_MODES: Array<{ key: CourseMode; label: string; blurb: string }> = [
  {
    key: "fixed",
    label: "One course",
    blurb: "Every round is played at the same venue. Set it once and nobody is asked again.",
  },
  {
    key: "open",
    label: "No fixed course — players choose",
    blurb:
      "A league or society where each pairing arranges its own venue. Whoever enters the card names the course, and it is saved to the club's list for next time.",
  },
];

export function courseModeOf(value: string | null | undefined): CourseMode {
  return value === "open" ? "open" : "fixed";
}

/**
 * Does this match still need somebody to say where it was played?
 *
 * Only asked of an open-course tournament, and only when nothing in the
 * match → round → event chain has answered already. A fixed-course tournament
 * never asks, because it was answered at setup.
 */
export function needsVenue(
  mode: CourseMode,
  chain: {
    matchCourseId?: string | null;
    roundCourseId?: string | null;
    eventCourse?: string | null;
    /** The event carries a usable card of its own, whatever it is called.
     *  Checked as well as the name because an event can hold a saved custom
     *  card with the name left blank — asking "where did you play?" when the
     *  app already has a card is a question with no useful answer. */
    eventHasCard?: boolean;
  },
): boolean {
  if (mode !== "open") return false;
  if (chain.matchCourseId || chain.roundCourseId) return false;
  if (chain.eventHasCard) return false;
  return !(chain.eventCourse ?? "").trim();
}

/**
 * Which nine, when only nine are played.
 *
 * Front and back are different golf: different pars, different stroke index,
 * and on most courses a different total. Nine holes scored against the wrong
 * half allocates shots on holes nobody played, so this is asked rather than
 * assumed — but only when there is something to ask about.
 */
export function needsNine(holes: number, nine: string | null | undefined): boolean {
  return holes === 9 && nine !== "front" && nine !== "back";
}

/* ── Matching a typed name to the club's list ─────────────────────────────
 *
 * The duplicate problem is the whole difficulty here. "Maketewah",
 * "Maketewah CC" and "maketewah country club" are one course, and left alone
 * they become three rows with three cards, of which two will be blank. So a
 * typed name is normalised hard and matched against what the club already
 * has before anything new is created.
 */

/** Course-name noise: the suffixes every club name carries, and punctuation. */
const SUFFIXES: Array<[RegExp, string]> = [
  [/\bcountry club\b/g, "cc"],
  [/\bgolf (?:and|&) country club\b/g, "cc"],
  [/\bgolf club\b/g, "gc"],
  [/\bgolf course\b/g, "gc"],
  [/\bgolf links\b/g, "gc"],
  [/\bgolf centre\b/g, "gc"],
  [/\bgolf center\b/g, "gc"],
  [/\bg\.?c\.?\b/g, "gc"],
  [/\bc\.?c\.?\b/g, "cc"],
];

/** Words that carry no identity — dropped so "The Links at X" matches "X". */
const STOPWORDS = new Set(["the", "at", "of", "on", "a", "an", "club", "course", "links"]);

export function normalizeCourseName(raw: string): string {
  let s = raw.toLowerCase().trim();
  // Punctuation first, so "St. Andrew's" and "St Andrews" converge.
  s = s.replace(/[.'`’]/g, "").replace(/[^a-z0-9&\s]/g, " ");
  for (const [re, to] of SUFFIXES) s = s.replace(re, to);
  const words = s.split(/\s+/).filter((w) => w && !STOPWORDS.has(w));
  return words.join(" ").trim();
}

/** The identifying part of a name, with the club-type suffix removed too. */
function coreOf(normalized: string): string {
  return normalized.replace(/\b(gc|cc)\b/g, "").replace(/\s+/g, " ").trim();
}

export interface CourseLike {
  id: string;
  name: string;
  city?: string;
}

export type VenueMatch =
  | { kind: "exact"; course: CourseLike }
  | { kind: "suggest"; candidates: CourseLike[] }
  | { kind: "new"; name: string };

/**
 * Resolve a typed course name against the club's saved courses.
 *
 * Never picks silently when it is unsure: an ambiguous name comes back as
 * suggestions for a human to choose from, because attaching a round to the
 * wrong course scores it against the wrong stroke index.
 */
export function matchCourse(typed: string, library: CourseLike[]): VenueMatch {
  const wanted = normalizeCourseName(typed);
  if (!wanted) return { kind: "new", name: typed.trim() };

  const exact = library.filter((c) => normalizeCourseName(c.name) === wanted);
  if (exact.length === 1) return { kind: "exact", course: exact[0] };
  if (exact.length > 1) return { kind: "suggest", candidates: exact };

  // "Maketewah" typed against a saved "Maketewah Country Club", or the
  // reverse — the same club, one of them abbreviated.
  const core = coreOf(wanted);
  const near = library.filter((c) => {
    const n = normalizeCourseName(c.name);
    const nCore = coreOf(n);
    if (!core || !nCore) return false;
    return nCore === core || n === core || nCore === wanted;
  });
  if (near.length === 1) return { kind: "exact", course: near[0] };
  if (near.length > 1) return { kind: "suggest", candidates: near };

  // Last resort: a shared prefix long enough not to be a coincidence. Only
  // ever a suggestion — "Oak Hill" and "Oak Ridge" must not merge.
  const prefixed = library.filter((c) => {
    const nCore = coreOf(normalizeCourseName(c.name));
    if (core.length < 5 || nCore.length < 5) return false;
    return nCore.startsWith(core) || core.startsWith(nCore);
  });
  if (prefixed.length) return { kind: "suggest", candidates: prefixed };

  return { kind: "new", name: typed.trim() };
}

/* ── Where a card can come from ───────────────────────────────────────────
 *
 * One interface, so the screen does not care which source answered. Today the
 * only source is the club's own library — a card entered once is reused by
 * every later round in the organization, which is what makes a league
 * practical after its first few weeks.
 *
 * A web or club-site lookup would be another implementation of this, and the
 * `confidence`/`sourceUrl` fields exist so it can never quietly become the
 * scoring truth: anything not `confirmed` has to be shown to a human before
 * it counts. That is deliberate. A stroke index scraped from the wrong tee
 * box gives every player the wrong shots on the wrong holes, and nothing
 * downstream would look unusual.
 */

export interface CourseCard {
  name: string;
  city: string;
  pars: number[];
  yards: number[];
  strokeIndex: number[];
  /** confirmed = a human entered or checked it. proposed = needs review. */
  confidence: "confirmed" | "proposed";
  source: string;
  sourceUrl?: string;
}

export interface CourseCardProvider {
  /** Human-readable, shown when a lookup fails so the failure is legible. */
  readonly name: string;
  find(query: { name: string; city?: string }): Promise<CourseCard[]>;
}

/** The club's own saved courses. Always tried first, and always confirmed —
 *  somebody at this club typed or checked every one of these. */
export function libraryProvider(
  library: Array<CourseLike & { pars: number[]; yards: number[]; strokeIndex: number[] }>,
): CourseCardProvider {
  return {
    name: "This club's courses",
    async find({ name }) {
      const m = matchCourse(name, library);
      const hits =
        m.kind === "exact" ? [m.course] : m.kind === "suggest" ? m.candidates : [];
      return hits
        .map((h) => library.find((c) => c.id === h.id))
        .filter((c): c is NonNullable<typeof c> => !!c)
        .map((c) => ({
          name: c.name,
          city: c.city ?? "",
          pars: c.pars,
          yards: c.yards,
          strokeIndex: c.strokeIndex,
          confidence: "confirmed" as const,
          source: "club-library",
        }));
    },
  };
}

/**
 * Ask each provider in turn and stop at the first real answer.
 *
 * Order is the point: the club's own card beats anything found elsewhere,
 * because somebody at the club stood on the tee and checked it.
 */
export async function findCard(
  providers: CourseCardProvider[],
  query: { name: string; city?: string },
): Promise<{ cards: CourseCard[]; from: string } | null> {
  for (const p of providers) {
    try {
      const cards = await p.find(query);
      if (cards.length) return { cards, from: p.name };
    } catch {
      // A provider that is down must not block entering a card by hand.
      continue;
    }
  }
  return null;
}

/* ── Tees ─────────────────────────────────────────────────────────────────
 *
 * A card is not enough on its own. Course Handicap is
 *
 *     Index × (Slope / 113) + (Course Rating − Par)
 *
 * and slope, rating and par are all properties of the *tee*, not the course.
 * Two players off the same index playing the same course from blue and white
 * tees are owed different shots, and in a net match that difference is the
 * result. So a new course is not finished until at least one tee is rated.
 */

export interface TeeLike {
  id: string;
  courseId: string;
  name: string;
  courseRating: number;
  slopeRating: number;
  par: number;
  position?: number;
}

/**
 * The tee to rate a player against when they have not chosen one.
 *
 * Scoped to the course being played and ordered deliberately, because the
 * fallback used to be "whichever tee row came back first" from an unscoped
 * query over every club in the database — so a player with no tee set could
 * be rated off another organization's championship tees, and the shots they
 * gave or received were simply wrong.
 */
export function defaultTeeFor(courseId: string | null, tees: TeeLike[]): TeeLike | null {
  if (!courseId) return null;
  const mine = tees.filter((t) => t.courseId === courseId);
  if (!mine.length) return null;
  // A rated tee beats an unrated one — an unrated tee cannot produce a course
  // handicap at all, so preferring it would silently zero everyone's strokes.
  const rated = mine.filter((t) => t.slopeRating > 0 && t.courseRating > 0);
  const pool = rated.length ? rated : mine;
  return [...pool].sort(
    (a, b) => (a.position ?? 0) - (b.position ?? 0) || a.name.localeCompare(b.name),
  )[0];
}

/** What is wrong with a tee, in the words the person entering it needs. */
export function teeProblems(tee: { name: string; courseRating: number; slopeRating: number; par: number }): string[] {
  const problems: string[] = [];
  if (!tee.name.trim()) problems.push("Give the tees the name printed on the card — Blue, White, Red.");
  // USGA slope runs 55–155, 113 being the standard course.
  if (!(tee.slopeRating >= 55 && tee.slopeRating <= 155)) {
    problems.push("Slope rating is between 55 and 155 — it's on the scorecard or the club's website.");
  }
  if (!(tee.courseRating > 25 && tee.courseRating < 90)) {
    problems.push("Course rating is the strokes a scratch golfer is expected to take, e.g. 71.5.");
  }
  if (!(tee.par >= 27 && tee.par <= 80)) problems.push("Par for these tees looks wrong.");
  return problems;
}

/**
 * Is this card usable for scoring?
 *
 * Par and stroke index are the two that matter: par decides Stableford points
 * and every "±" on a leaderboard, stroke index decides which holes a handicap
 * falls on. Yardage is presentation only. A stroke index must be a complete
 * permutation of 1..n — a duplicated or missing number means some hole gets
 * two shots and another none.
 */
export function cardProblems(card: { pars: number[]; strokeIndex: number[] }, holes: 9 | 18): string[] {
  const problems: string[] = [];
  const pars = card.pars.slice(0, holes);
  const si = card.strokeIndex.slice(0, holes);

  if (pars.length !== holes || pars.some((p) => !Number.isFinite(p) || p < 3 || p > 6)) {
    problems.push(`Par is needed for all ${holes} holes, and each must be between 3 and 6.`);
  }
  if (si.length !== holes) {
    problems.push(`Stroke index is needed for all ${holes} holes.`);
  } else {
    const sorted = [...si].sort((a, b) => a - b);
    const expected = Array.from({ length: holes }, (_, i) => i + 1);
    if (sorted.some((v, i) => v !== expected[i])) {
      problems.push(
        `Stroke index must use each number from 1 to ${holes} exactly once — otherwise handicap strokes land on the wrong holes.`,
      );
    }
  }
  return problems;
}
