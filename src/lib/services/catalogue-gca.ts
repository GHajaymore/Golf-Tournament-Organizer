import "server-only";
import { prisma } from "@/lib/db";
import { cardRefusal } from "@/lib/domain/scorecard-parse";
import { countryCode } from "@/lib/domain/country";
import { holesPlayed } from "@/lib/domain/handicap";

/**
 * THE INTERNATIONAL HALF OF THE PRODUCTION CATALOGUE (2026-10-04).
 *
 * Ajay: "get whatever the limit is everyday without my involvement. domestic
 * or international." OpenGolfAPI — the walk in `catalogue-import.ts` — has a
 * usable card for almost none of its courses outside the US. GolfCourseAPI
 * carries a per-hole `handicap`, which IS the stroke index, including outside
 * the US, so it is the only source of a COMPLETE card there. This is
 * `scripts/import-golfcourseapi.ts` brought into the app, so production fills
 * its own catalogue rather than waiting on a script on somebody's machine.
 *
 * It runs only when GOLFCOURSE_API_KEY is set in the deployment — the free
 * tier's key, 50 requests a day, which this spends a slice of per run.
 *
 * COMPLETE, NOT MERELY USABLE. A card here is stored as usable only with a
 * full stroke index and pars, judged by `cardRefusal` — the strict rule a card
 * must pass before handicap shots are allocated on it. Anything less is stored
 * with its reason, so the allowance is never spent on the same course twice.
 *
 * Its place in the walk (which search term, and the courses found but not yet
 * fetched) is a `PlatformSetting` row, as the other walk's is.
 */

const BASE = "https://api.golfcourseapi.com";
export const GCA_WALK_KEY = "gca-walk";
/** One request every 1.5s: a burst reads exactly like a spent day here. */
const PACE_MS = 1500;
const BACKOFF_MS = [3000, 10000];
/** Searches per run when nothing is queued — discovery costs the same as a card. */
const DISCOVERY_CAP = 5;
/** Courses banked from searches but not yet fetched. Bounded: it is one row. */
const QUEUE_MAX = 150;

/**
 * The search has no paging: at most 25 rows a term. So the directory is
 * sampled term by term — the curated words first, then every two-letter pair,
 * which measured as wide with almost no overlap. Same list as the script.
 */
const CURATED = [
  "Golf Club", "Golf Course", "Country Club", "Links", "Golf Links",
  "Royal", "National", "Municipal", "Park", "Valley", "Hills", "Ridge",
  "Creek", "Lake", "River", "Pines", "Oaks", "Meadows", "Springs", "Bay",
  "Highlands", "Woods", "Downs", "Heath", "Common", "Manor", "Castle",
  "Abbey", "Priory", "Grange", "Hall", "Lodge", "Resort", "Bahia", "Real",
  "Golf Resort", "Golf & Country", "Old Course", "New Course", "West Course",
];
const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
export const GCA_TERMS = [...CURATED, ...LETTERS.flatMap((a) => LETTERS.map((b) => a + b))];

export interface GcaSummary {
  id: string;
  club_name?: string;
  course_name?: string;
  location?: { city?: string; state?: string; country?: string; address?: string };
  tees?: Record<string, number>;
}

interface GcaHole {
  par?: number | null;
  yardage?: number | null;
  handicap?: number | null;
}
interface GcaTee {
  holes?: GcaHole[];
}

export type GcaFetch = (path: string) => Promise<{ status: number; body: unknown } | null>;

export function gcaFetch(key: string): GcaFetch {
  return async (path) => {
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15000),
        cache: "no-store",
      });
      return { status: res.status, body: res.ok ? ((await res.json()) as unknown) : null };
    } catch {
      return null;
    }
  };
}

/** `gca:` keeps provenance visible beside OpenGolfAPI's ids. */
export const gcaId = (id: string) => `gca:${id}`;

function nameOf(s: GcaSummary): string {
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
 * field nothing scores off.
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

async function store(s: GcaSummary, card: ReturnType<typeof gcaCard>): Promise<"card" | "no-card"> {
  const loc = s.location ?? {};
  const usable = "pars" in card;
  const country = countryCode(loc.country ?? "");
  const base = {
    name: nameOf(s),
    city: (loc.city ?? "").trim(),
    state: (loc.state ?? "").trim(),
    ...(country ? { country } : {}),
    website: "",
    address: (loc.address ?? "").trim(),
    par: usable ? card.pars.reduce((a, b) => a + b, 0) : 0,
    tees: JSON.stringify(Object.keys(s.tees ?? {})),
    cardProblem: usable ? "" : card.reason,
    fetchedAt: new Date(),
  };
  const cardCols = usable
    ? { pars: JSON.stringify(card.pars), yards: JSON.stringify(card.yards), strokeIndex: JSON.stringify(card.strokeIndex) }
    : {};
  // Upsert, and an unusable answer never blanks a card already held.
  const held = usable ? null : await prisma.courseCatalog.findUnique({ where: { id: gcaId(s.id) }, select: { pars: true } });
  await prisma.courseCatalog.upsert({
    where: { id: gcaId(s.id) },
    update: held?.pars ? { name: base.name, city: base.city, state: base.state, fetchedAt: base.fetchedAt } : { ...base, ...cardCols },
    create: { id: gcaId(s.id), ...base, ...cardCols },
  });
  return usable ? "card" : "no-card";
}

interface GcaState {
  termIndex: number;
  queue: GcaSummary[];
}

async function readState(key: string): Promise<GcaState> {
  const row = await prisma.platformSetting.findUnique({ where: { key } });
  try {
    const v = JSON.parse(row?.value ?? "{}") as Partial<GcaState>;
    const termIndex = Number.isInteger(v.termIndex) && (v.termIndex as number) >= 0 ? (v.termIndex as number) : 0;
    return { termIndex: termIndex % GCA_TERMS.length, queue: Array.isArray(v.queue) ? v.queue.slice(0, QUEUE_MAX) : [] };
  } catch {
    return { termIndex: 0, queue: [] };
  }
}

async function writeState(key: string, s: GcaState): Promise<void> {
  const value = JSON.stringify({ termIndex: s.termIndex, queue: s.queue.slice(0, QUEUE_MAX) });
  await prisma.platformSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

export interface GcaOptions {
  budget: number;
  deadline: number;
  fetchJson: GcaFetch;
  sleep?: (ms: number) => Promise<void>;
  stateKey?: string;
}

export interface GcaResult {
  requests: number;
  withCard: number;
  withoutCard: number;
  queued: number;
  stopped: "budget" | "deadline" | "refused" | "drained";
}

/**
 * Today's slice of the international directory: drain what was banked, and
 * search for more only when nothing is waiting — a search costs as much as a
 * card. Courses outside the US are fetched first, because the other directory
 * already covers the US and has no cards anywhere else.
 */
export async function importGcaSlice(opts: GcaOptions): Promise<GcaResult> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const stateKey = opts.stateKey ?? GCA_WALK_KEY;
  const state = await readState(stateKey);
  const result: GcaResult = { requests: 0, withCard: 0, withoutCard: 0, queued: 0, stopped: "drained" };

  const get = async (path: string): Promise<unknown | null | "refused"> => {
    for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt += 1) {
      if (result.requests > 0) await sleep(PACE_MS);
      result.requests += 1;
      const res = await opts.fetchJson(path);
      if (res && res.status >= 200 && res.status < 300) return res.body;
      if (res && res.status !== 429 && res.status < 500) return null;
      if (attempt < BACKOFF_MS.length) await sleep(BACKOFF_MS[attempt]);
    }
    return "refused";
  };
  const out = () => result.requests >= opts.budget || Date.now() >= opts.deadline;

  try {
    // Discover, only when nothing is banked.
    if (state.queue.length === 0) {
      const known = new Set<string>();
      let searches = 0;
      // And only until there is enough banked for what is left of today: a
      // search costs a request from the same allowance as a card does.
      while (searches < DISCOVERY_CAP && !out() && state.queue.length < opts.budget - result.requests) {
        const term = GCA_TERMS[state.termIndex];
        const body = await get(`/v1/search?search_query=${encodeURIComponent(term)}`);
        if (body === "refused") {
          result.stopped = "refused";
          return result;
        }
        state.termIndex = (state.termIndex + 1) % GCA_TERMS.length;
        searches += 1;
        const rows = ((body as { courses?: GcaSummary[] } | null)?.courses ?? []).filter((c) => c?.id);
        const ids = rows.map((c) => gcaId(String(c.id)));
        for (const r of await prisma.courseCatalog.findMany({ where: { id: { in: ids } }, select: { id: true } })) {
          known.add(r.id);
        }
        for (const c of rows) {
          if (known.has(gcaId(String(c.id)))) continue;
          known.add(gcaId(String(c.id)));
          const teeCount = Object.values(c.tees ?? {}).reduce((a, b) => a + (b || 0), 0);
          // No tee boxes on the search row: no card, judged for free.
          if (teeCount === 0) {
            await store(c, { reason: "The directory lists no tee boxes for this course, so it has no card." });
            result.withoutCard += 1;
            continue;
          }
          state.queue.push(c);
        }
      }
    }

    const isUS = (c: GcaSummary) => countryCode(c.location?.country ?? "") === "US";
    state.queue.sort((a, b) => Number(isUS(a)) - Number(isUS(b)));

    while (state.queue.length > 0) {
      if (out()) {
        result.stopped = result.requests >= opts.budget ? "budget" : "deadline";
        break;
      }
      const s = state.queue[0];
      const body = await get(`/v1/courses/${encodeURIComponent(String(s.id))}`);
      if (body === "refused") {
        result.stopped = "refused";
        break;
      }
      state.queue.shift(); // judged — even a 404 is an answer
      const course = (body as { course?: { tees?: Record<string, GcaTee[]> }; tees?: Record<string, GcaTee[]> } | null) ?? {};
      const tees = Object.values((course.course ?? course).tees ?? {}).flat() as GcaTee[];
      if ((await store(s, gcaCard(tees))) === "card") result.withCard += 1;
      else result.withoutCard += 1;
    }
  } finally {
    result.queued = state.queue.length;
    await writeState(stateKey, state);
  }
  return result;
}
