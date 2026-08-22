import "server-only";
import { prisma } from "@/lib/db";
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
export async function searchDirectory(query: string): Promise<DirectoryHit[]> {
  const q = query.trim();
  // Two characters matches half the country and returns nothing useful.
  if (q.length < 3) return [];

  // Name OR city. "Cincinnati" found nothing while every course in it was
  // sitting in the catalogue, and typing where you play is at least as natural
  // as typing what it is called — especially for a society deciding where to
  // hold an outing.
  const local = await prisma.courseCatalog.findMany({
    where: {
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
      ],
    },
    // Courses with a card first: a club searching wants one it can score on,
    // and the ones we could not read should not crowd out the ones we could.
    orderBy: [{ cardProblem: "asc" }, { name: "asc" }],
    take: 20,
    select: { id: true, name: true, city: true, state: true, par: true, website: true },
  });
  if (local.length > 0) return local;

  const payload = await getJson(`/v1/courses/search?q=${encodeURIComponent(q.slice(0, 80))}`);
  return hitsFrom(payload).slice(0, 20);
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
