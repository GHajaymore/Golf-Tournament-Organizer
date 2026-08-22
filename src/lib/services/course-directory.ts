import "server-only";
import { hitsFrom, courseFrom, type DirectoryHit, type DirectoryCourse } from "@/lib/domain/course-directory";

/**
 * Talking to the public course directory.
 *
 * OpenGolfAPI: free, no key, ODbL 1.0, about 16,800 US courses. This module is
 * only the fetch — every judgement about whether a card can be trusted lives
 * in `domain/course-directory.ts`, where it can be tested against real
 * payloads without a live host.
 *
 * Two things it will not do:
 *
 * It will not throw. A directory being slow, renamed or offline must not take
 * a screen down — importing is an accelerator, and the paste box and manual
 * entry stay first-class beside it. Everything failed returns an empty result
 * and lets the caller say so.
 *
 * It will not become a dependency. Nothing in scoring, handicapping or the
 * board reads this. A course is imported once and stored, so the directory
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

/**
 * Courses matching what somebody typed.
 *
 * Coverage is US-only, so an empty list is an ordinary answer for a UK or
 * Irish club rather than an error, and the screen says as much.
 */
export async function searchDirectory(query: string): Promise<DirectoryHit[]> {
  const q = query.trim();
  // Two characters matches half the country and returns nothing useful.
  if (q.length < 3) return [];
  const payload = await getJson(`/v1/courses/search?q=${encodeURIComponent(q.slice(0, 80))}`);
  return hitsFrom(payload).slice(0, 20);
}

/** One course in full — its card, if it has a usable one, and its rated tees. */
export async function fetchDirectoryCourse(id: string): Promise<DirectoryCourse | null> {
  const clean = id.trim();
  if (!clean) return null;
  const payload = await getJson(`/api/v1/courses/${encodeURIComponent(clean)}`);
  return payload ? courseFrom(payload) : null;
}
