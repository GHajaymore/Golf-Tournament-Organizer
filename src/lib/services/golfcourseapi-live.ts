import "server-only";
import { prisma } from "@/lib/db";
import { cardRefusal } from "@/lib/domain/scorecard-parse";
import { countryCode } from "@/lib/domain/country";
import { holesPlayed } from "@/lib/domain/handicap";
import type { DirectoryCourse, DirectoryHit, DirectoryTee } from "@/lib/domain/course-directory";

/**
 * GolfCourseAPI, ON DEMAND ONLY (Ajay, 7 Nov 2026: "Switch it off").
 *
 * The provider's terms forbid compiling its dataset, and until this change a
 * cron walked it twice a day and stored what it found. That walk is gone, and
 * so is everything only it used. What is left is the shape the terms allow: an
 * organizer searches for a course, nothing we hold matches, and we ask the
 * provider about THAT search; they pick one, and we fetch and store THAT one.
 * One person's question per request, never a sweep.
 *
 * Courses the walk already stored stay (`gca:` rows in `CourseCatalog`).
 *
 * The key is configuration (`GOLFCOURSE_API_KEY`). It is read here, sent as a
 * header and never logged or echoed. With no key this is silent: no hits, and
 * no "unavailable" notice either, because nothing is broken.
 *
 * THIS MUST NEVER BLOCK TYPING A COURSE IN. Every failure comes back as
 * `unavailable` with nothing thrown; the screen words it and the paste box and
 * manual entry stay where they are.
 */

const BASE = "https://api.golfcourseapi.com";
/** A person is waiting at a setup screen: short, and it ends in plain words. */
export const GCA_TIMEOUT_MS = 6000;

/** `gca:` keeps provenance visible beside OpenGolfAPI's ids. */
export const GCA_PREFIX = "gca:";
export const gcaId = (id: string) => `${GCA_PREFIX}${id}`;
export const isGcaId = (id: string) => id.startsWith(GCA_PREFIX);

export const GCA_UNAVAILABLE_NOTICE =
  "The international course lookup isn't answering right now. You can still add the course by typing it in or pasting its card below.";

export type GcaFetch = (path: string) => Promise<{ status: number; body: unknown } | null>;

/** The one HTTP call. Tests replace it; nothing else here touches the network. */
export function gcaFetch(key: string): GcaFetch {
  return async (path) => {
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(GCA_TIMEOUT_MS),
        cache: "no-store",
      });
      return { status: res.status, body: res.ok ? ((await res.json()) as unknown) : null };
    } catch {
      // Timeout, DNS, TLS, malformed JSON: all the same to a caller.
      return null;
    }
  };
}

function defaultFetch(): GcaFetch | null {
  const key = (process.env.GOLFCOURSE_API_KEY ?? "").trim();
  return key ? gcaFetch(key) : null;
}

interface GcaSummary {
  id: string | number;
  club_name?: string;
  course_name?: string;
  location?: { city?: string; state?: string; country?: string; address?: string };
}
interface GcaHole {
  par?: number | null;
  yardage?: number | null;
  handicap?: number | null;
}
interface GcaTee {
  tee_name?: string;
  course_rating?: number | null;
  slope_rating?: number | null;
  par_total?: number | null;
  total_yards?: number | null;
  holes?: GcaHole[];
}

function nameOf(s: { club_name?: string; course_name?: string }): string {
  const club = (s.club_name ?? "").trim();
  const course = (s.course_name ?? "").trim();
  if (!club) return course;
  if (!course || course.toLowerCase() === club.toLowerCase()) return club;
  return `${club} — ${course}`;
}

/**
 * The first tee box that yields a complete card, or the first reason none did.
 * Tees share a par and an index; only the yardage differs. Yardage is passed
 * EMPTY when incomplete, never as zeros, which would refuse a good card over a
 * field nothing scores off. The judge is `cardRefusal`, the strict rule a card
 * must pass before handicap shots are allocated on it.
 */
export function gcaCard(tees: GcaTee[]):
  | { pars: number[]; yards: number[]; strokeIndex: number[] }
  | { reason: string } {
  let reason = "The directory has no hole-by-hole card for this course.";
  for (const tee of tees) {
    const holes = tee.holes ?? [];
    if (holes.length !== holesPlayed(holes.length)) continue;
    const pars = holes.map((h) => h.par ?? 0);
    const strokeIndex = holes.map((h) => h.handicap ?? 0);
    if (pars.some((p) => !p) || strokeIndex.some((s) => !s)) {
      reason = strokeIndex.some((s) => !s)
        ? "The directory has pars but no stroke index for this course, so handicap shots cannot be allocated."
        : "The directory's card is missing a par on at least one hole.";
      continue;
    }
    const raw = holes.map((h) => h.yardage ?? 0);
    const yards = raw.every((y) => y > 0) ? raw : [];
    const refusal = cardRefusal(pars, yards, strokeIndex, holes.length);
    if (!refusal) return { pars, yards, strokeIndex };
    reason = refusal;
  }
  return { reason };
}

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** The search answer as the picker's rows. Par is unknown until a course is picked. */
export async function searchGolfCourseApi(
  query: string,
  fetchJson: GcaFetch | null = defaultFetch(),
): Promise<{ hits: DirectoryHit[]; unavailable: boolean }> {
  if (!fetchJson) return { hits: [], unavailable: false };
  const res = await fetchJson(`/v1/search?search_query=${encodeURIComponent(query.trim().slice(0, 80))}`);
  if (!res || res.status < 200 || res.status >= 300) {
    // A 404 is an ordinary "nothing found"; anything else is the lookup being down.
    return { hits: [], unavailable: !(res && res.status === 404) };
  }
  const rows = ((res.body as { courses?: GcaSummary[] } | null)?.courses ?? []).filter(
    (c) => c && c.id !== undefined && c.id !== "",
  );
  const hits = rows
    .map((c) => ({
      id: gcaId(String(c.id)),
      name: nameOf(c),
      city: (c.location?.city ?? "").trim(),
      state: (c.location?.state ?? "").trim(),
      country: countryCode(c.location?.country ?? ""),
      par: 0,
      website: "",
    }))
    .filter((h) => h.name);
  return { hits: hits.slice(0, 20), unavailable: false };
}

function teesFrom(byGender: Record<string, GcaTee[]> | undefined): DirectoryTee[] {
  const out: DirectoryTee[] = [];
  for (const [key, list] of Object.entries(byGender ?? {})) {
    const gender = /^f/i.test(key) ? "women" : /^m/i.test(key) ? "men" : "any";
    for (const t of Array.isArray(list) ? list : []) {
      const name = (t.tee_name ?? "").trim();
      if (!name) continue;
      out.push({
        name,
        gender,
        courseRating: n(t.course_rating),
        slopeRating: Math.round(n(t.slope_rating)),
        par: Math.round(n(t.par_total)),
        yards: Math.round(n(t.total_yards)),
      });
    }
  }
  return out;
}

/**
 * ONE course, asked for by the person who picked it, judged by `cardRefusal`
 * and (unless `store: false`) kept in the catalogue so the next club that wants
 * it asks us, not the provider. `null` when the lookup is off or did not answer.
 */
export async function fetchGolfCourseApiCourse(
  id: string,
  opts: { store?: boolean; fetchJson?: GcaFetch | null } = {},
): Promise<DirectoryCourse | null> {
  const fetchJson = opts.fetchJson === undefined ? defaultFetch() : opts.fetchJson;
  const bare = id.trim().replace(/^gca:/, "");
  if (!fetchJson || !bare) return null;
  const res = await fetchJson(`/v1/courses/${encodeURIComponent(bare)}`);
  if (!res || res.status < 200 || res.status >= 300 || !res.body) return null;

  const raw = res.body as { course?: Record<string, unknown> } & Record<string, unknown>;
  const c = (raw.course ?? raw) as unknown as GcaSummary & { tees?: Record<string, GcaTee[]> };
  const byGender = (c.tees ?? {}) as Record<string, GcaTee[]>;
  const card = gcaCard(Object.values(byGender).flat());
  const name = nameOf(c);
  if (!name) return null;
  const loc = c.location ?? {};
  const course: DirectoryCourse = {
    id: gcaId(bare),
    name,
    city: (loc.city ?? "").trim(),
    state: (loc.state ?? "").trim(),
    country: countryCode(loc.country ?? ""),
    website: "",
    address: (loc.address ?? "").trim(),
    card:
      "pars" in card
        ? { usable: true, pars: card.pars, strokeIndex: card.strokeIndex, yards: card.yards }
        : { usable: false, reason: card.reason },
    tees: teesFrom(byGender),
  };

  if (opts.store !== false) await storePicked(course);
  return course;
}

/** Upsert the one picked course. An unusable answer never blanks a card already held. */
async function storePicked(course: DirectoryCourse): Promise<void> {
  const card = course.card;
  const base = {
    name: course.name,
    city: course.city,
    state: course.state,
    ...(course.country ? { country: course.country } : {}),
    website: "",
    address: course.address,
    par: card.usable ? card.pars.reduce((a, b) => a + b, 0) : 0,
    tees: JSON.stringify(course.tees),
    cardProblem: card.usable ? "" : card.reason,
    fetchedAt: new Date(),
  };
  const cardCols = card.usable
    ? { pars: JSON.stringify(card.pars), yards: JSON.stringify(card.yards), strokeIndex: JSON.stringify(card.strokeIndex) }
    : {};
  const held = card.usable ? null : await prisma.courseCatalog.findUnique({ where: { id: course.id }, select: { pars: true } });
  await prisma.courseCatalog.upsert({
    where: { id: course.id },
    update: held?.pars ? { name: base.name, city: base.city, state: base.state, fetchedAt: base.fetchedAt } : { ...base, ...cardCols },
    create: { id: course.id, ...base, ...cardCols },
  });
}
