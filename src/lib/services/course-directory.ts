import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { parseAreaQuery } from "@/lib/domain/course-area";
import { rankCourseHits } from "@/lib/domain/course-ranking";
import { parseHoleArray } from "@/lib/courses";
import {
  hitsFrom,
  courseFrom,
  type DirectoryHit,
  type DirectoryCourse,
  type DirectoryTee,
} from "@/lib/domain/course-directory";

/**
 * Finding a course, from the catalogue we hold or the directory that has it.
 *
 * Two layers, deliberately in this order.
 *
 * `CourseCatalog` is the shared catalogue this app imports ahead of time. It
 * answers instantly, works when the directory is down, and is what a club
 * searching mid-setup actually hits. It is a catalogue, not a club's course —
 * adding one COPIES it into that club's own Course, so their corrections stay
 * theirs.
 *
 * The live directory is the fallback: a course catalogued after our last import
 * run, or one outside whatever we have loaded. OpenGolfAPI, free, no key, ODbL
 * 1.0, 16,822 US courses.
 *
 * Two things this will not do:
 *
 * It will not throw. A directory being slow, renamed or offline must not take a
 * screen down — importing is an accelerator, and the paste box and manual entry
 * stay first-class beside it.
 *
 * It will not become a dependency. Nothing in scoring, handicapping or the board
 * reads any of this. A course is imported once and stored, so the directory
 * going away later costs a club nothing they already have.
 */

const BASE = "https://api.opengolfapi.org";
const TIMEOUT_MS = 8000;

/** The directory is a nicety on a setup screen; nobody should wait on it. */
async function getJson(path: string): Promise<unknown | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // A course card changes about never, and the same club will search the
      // same name twice in a minute while deciding.
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    // Timeout, DNS, TLS, malformed JSON — all the same to a caller who just
    // wants to be told the directory could not help.
    return null;
  }
}

/** One catalogued row, in the shape the rest of the import path already takes. */
function fromCatalog(row: {
  id: string;
  name: string;
  city: string;
  state: string;
  country: string;
  website: string;
  address: string;
  pars: string;
  yards: string;
  strokeIndex: string;
  tees: string;
  cardProblem: string;
}): DirectoryCourse {
  const pars = parseHoleArray(row.pars);
  const strokeIndex = parseHoleArray(row.strokeIndex);
  const yards = parseHoleArray(row.yards) ?? new Array(18).fill(0);

  let tees: DirectoryTee[] = [];
  try {
    const parsed = JSON.parse(row.tees) as unknown;
    if (Array.isArray(parsed)) tees = parsed as DirectoryTee[];
  } catch {
    // A corrupt tees blob costs the ratings, not the course.
    tees = [];
  }

  return {
    id: row.id,
    name: row.name,
    city: row.city,
    state: row.state,
    country: row.country,
    website: row.website,
    address: row.address,
    // The catalogue stores what the importer JUDGED — empty arrays where the
    // source's card was refused, and the reason beside them. So the refusal
    // survives being stored, rather than being re-decided here from numbers
    // that are no longer there to judge.
    card:
      pars && strokeIndex
        ? { usable: true, pars, strokeIndex, yards }
        : { usable: false, reason: row.cardProblem || "The directory has no usable card for this course." },
    tees,
  };
}

/**
 * Courses matching what somebody typed.
 *
 * The catalogue first, the live directory only when it has nothing — so a club
 * whose course we already hold never waits on a network call, and a course
 * catalogued since our last import is still findable.
 *
 * Coverage is US-only either way, so an empty list is an ordinary answer for a
 * UK or Irish club rather than an error, and the screen says as much.
 */
/**
 * @param localOnly Search the catalogue and stop there.
 *
 * The screen searches as you type, and the live directory is metered — 500
 * requests a day, shared with the importer and the "check source" button. The
 * catalogue holds a fraction of the directory today, so most keystroke
 * searches would miss it and go straight out to the network: a club typing
 * "Ballybunion" would spend eight requests reaching the answer. So typing
 * reads what we already hold, and asking for the full directory is a
 * deliberate press.
 */
export async function searchDirectory(
  query: string,
  localOnly = false,
): Promise<DirectoryHit[]> {
  const q = query.trim();
  const area = parseAreaQuery(q);
  /**
   * Two characters matches half the country and returns nothing useful —
   * unless those two characters are a state. "OH" is a perfectly ordinary
   * way to ask for Ohio, and the guard was refusing it before anything got
   * the chance to read it as a place.
   */
  if (q.length < 3 && !area.state) return [];

  /**
   * Name, town, or state — because a club looking for a course is as likely
   * to be thinking about WHERE as about what it is called.
   *
   * The area is read out of the query first, so "Cincinnati, OH" searches a
   * town within a state instead of looking for a course literally called
   * that, and "Ohio" reaches the state code the catalogue actually stores.
   * Whatever is not a place stays as text and is matched against the name,
   * so this can only ever add results.
   */
  /**
   * The raw query is a name only when NO place was read out of it.
   *
   * Falling back to `q` whenever `area.text` was empty meant "Ohio" searched
   * names for the word Ohio and found the five courses called it, rather
   * than the four hundred courses IN it. A parsed place has already
   * consumed the query; there is no name left to look for.
   */
  const foundPlace = !!area.city || !!area.state;
  const text = area.text || (foundPlace ? "" : q);

  const matches: Prisma.CourseCatalogWhereInput[] = [];
  if (text) {
    matches.push({ name: { contains: text, mode: "insensitive" } });
    // A bare word is as likely to be a town as a course name.
    if (!area.city && !area.state) {
      matches.push({ city: { contains: text, mode: "insensitive" } });
    }
  }
  if (area.city) matches.push({ city: { contains: area.city, mode: "insensitive" } });

  const local = await prisma.courseCatalog.findMany({
    where: {
      // The state NARROWS rather than widens: "Cincinnati, OH" means the
      // Cincinnati in Ohio, not every Cincinnati and also all of Ohio. A
      // state on its own has no other half, so it stands as the whole query.
      AND: [
        ...(area.state ? [{ state: area.state }] : []),
        ...(matches.length ? [{ OR: matches }] : []),
      ],
    },
    // Courses with a card first: a club searching wants one it can score on,
    // and the ones we could not read should not crowd out the ones we could.
    orderBy: [{ cardProblem: "asc" }, { name: "asc" }],
    // Wider than the twenty shown, because the ranking below decides which
    // twenty those are. Taking 20 alphabetically and then ranking them only
    // reorders whatever happened to start with a digit.
    take: 100,
    // country included so a club outside the US can tell two courses of the
    // same name apart — a non-US row has no state to do that with.
    select: {
      id: true, name: true, city: true, state: true, country: true, par: true, website: true,
    },
  });
  /**
   * Ranked on the part of the query that names a course or a town.
   *
   * Ranking on the raw string would score every row against "cincinnati oh",
   * which matches no name and no city, so a whole page of correct results
   * would come back in arbitrary order. The state has already done its work
   * in the query above; it is a filter, not something to sort by.
   */
  const rankOn = area.text || area.city || q;
  if (local.length > 0 || localOnly) return rankCourseHits(local, rankOn).slice(0, 20);

  const payload = await getJson(`/v1/courses/search?q=${encodeURIComponent(q.slice(0, 80))}`);
  return rankCourseHits(hitsFrom(payload), rankOn).slice(0, 20);
}

/** One course in full — its card, if it has a usable one, and its rated tees. */
export async function fetchDirectoryCourse(id: string): Promise<DirectoryCourse | null> {
  const clean = id.trim();
  if (!clean) return null;

  const row = await prisma.courseCatalog.findUnique({ where: { id: clean } });
  if (row) return fromCatalog(row);

  const payload = await getJson(`/api/v1/courses/${encodeURIComponent(clean)}`);
  return payload ? courseFrom(payload) : null;
}

/**
 * The directory's own answer, ignoring the catalogue.
 *
 * "Check source" means ask the source, and answering it out of a catalogue we
 * imported last month would report "no change" about our own copy rather than
 * about the directory. The one caller that genuinely wants a fresh read.
 */
export async function fetchLiveDirectoryCourse(id: string): Promise<DirectoryCourse | null> {
  const clean = id.trim();
  if (!clean) return null;
  const payload = await getJson(`/api/v1/courses/${encodeURIComponent(clean)}`);
  return payload ? courseFrom(payload) : null;
}
