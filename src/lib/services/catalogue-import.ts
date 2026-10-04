import "server-only";
import { prisma } from "@/lib/db";
import { courseFrom, hitsFrom } from "@/lib/domain/course-directory";

/**
 * THE APP FILLS ITS OWN COURSE CATALOGUE, A SLICE A DAY (2026-10-04).
 *
 * The catalogue — every course the app knows about, with its scorecard where
 * the directory's card can be trusted — used to be built by a script run on a
 * developer's machine, into that machine's database. Production never had it,
 * and on 2026-09-27 the local copy (~2,469 courses, ~892 cards, three weeks of
 * daily slices) was wiped with no backup. Ajay: "we lost so many days effort
 * importing the courses".
 *
 * So the walk now runs where the courses are used: a daily Vercel cron calls
 * this, it takes a bounded slice of the public directory (OpenGolfAPI —
 * keyless reads, 500 a day per endpoint), and it stores each course exactly
 * as `scripts/import-course-catalog.ts` does — the card the importer JUDGED,
 * or the reason it was refused, never a plausible placeholder. The database it
 * writes to is the production one, which its host backs up; nothing about it
 * depends on any one computer.
 *
 * Its position is a `PlatformSetting` row rather than a file, because a
 * serverless function has no file that survives to tomorrow.
 *
 * What it will NOT do:
 * - spend the whole allowance. The same detail endpoint serves "add this
 *   course" from the picker, so a slice leaves headroom for the people using
 *   the app that day;
 * - outlive its function. It stops on a wall-clock deadline well inside the
 *   platform's limit, saves its place, and carries on tomorrow;
 * - fetch a course it already holds. A catalogued course costs nothing, so
 *   the allowance only goes on courses nobody has judged yet;
 * - read a refusal as a fact about a golf course. A directory that will not
 *   answer after backing off ends the run; the course is simply not reached.
 */

export const DIRECTORY = "https://api.opengolfapi.org";
export const WALK_KEY = "course-walk";
const PAGE = 100;

/**
 * THE US FIRST, STATE BY STATE, THEN THE WORLD.
 *
 * The world listing is alphabetical across every country, and measured on
 * 2026-08-23 the directory has a usable card for none of its non-US rows — so
 * a walk that started there spent its first weeks buying names with no
 * scorecard. A real slice taken on 2026-10-04 confirmed it: three courses,
 * Thai, French and German, no card between them. The US listing is per state
 * and is where the cards are.
 */
export const US_STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC", "PR", "VI", "GU",
];

/** Where the walk is: a state's listing (index into the list), or the world's. */
export interface WalkPosition {
  /** 0..states.length-1 is a state; states.length is the world listing. */
  phase: number;
  offset: number;
}
/** Gentle: one request at a time with a pause, as the script learned to. */
const PAUSE_MS = 600;
/** Short, because a function is waiting on it; the script waits 5/15/45s. */
const BACKOFF_MS = [3000, 10000];

/** A refusal that survived backing off — today has nothing more to give. */
class DirectoryRefusing extends Error {}

export type FetchJson = (path: string) => Promise<{ status: number; body: unknown } | null>;

/** The real directory. `no-store`: an import must not read yesterday's cached page. */
export const directoryFetch: FetchJson = async (path) => {
  try {
    const res = await fetch(`${DIRECTORY}${path}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(15000),
      cache: "no-store",
    });
    return { status: res.status, body: res.ok ? ((await res.json()) as unknown) : null };
  } catch {
    // Timeout or connection reset: the same as a refusal, ask again.
    return null;
  }
};

export interface SliceOptions {
  /** How many courses this run may fetch (one request each). */
  budget: number;
  /** Stop starting new requests at this time (ms since epoch). */
  deadline: number;
  fetchJson?: FetchJson;
  sleep?: (ms: number) => Promise<void>;
  /** Where the position is kept — a test passes its own, marked key. */
  cursorKey?: string;
  /** The state listings walked before the world's. A test passes its own. */
  states?: readonly string[];
}

export interface SliceResult {
  fetched: number;
  withCard: number;
  withoutCard: number;
  skipped: number;
  /** Where tomorrow starts. Back to the first state after the world's end. */
  position: WalkPosition;
  stopped: "budget" | "deadline" | "end" | "refused";
}

const whole = (v: unknown) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : 0;
};

async function readCursor(key: string, phases: number): Promise<WalkPosition> {
  const row = await prisma.platformSetting.findUnique({ where: { key } });
  try {
    const raw = JSON.parse(row?.value ?? "{}") as { phase?: unknown; offset?: unknown };
    const phase = whole(raw.phase);
    return phase <= phases ? { phase, offset: whole(raw.offset) } : { phase: 0, offset: 0 };
  } catch {
    return { phase: 0, offset: 0 };
  }
}

async function writeCursor(key: string, at: WalkPosition): Promise<void> {
  const value = JSON.stringify(at);
  await prisma.platformSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

/**
 * Store one course as the importer judged it. Same rules as the script's
 * `store`: the country comes from the LISTING (the detail payload has none),
 * a usable card is written whole, and a refused one is stored with its reason
 * and empty hole arrays — never a placeholder par.
 */
async function store(id: string, payload: unknown, country: string): Promise<"card" | "no-card" | "skip"> {
  const c = courseFrom(payload);
  if (!c) return "skip";
  const usable = c.card.usable;
  const base = {
    name: c.name,
    city: c.city,
    state: c.state,
    ...(country ? { country } : {}),
    website: c.website,
    address: c.address,
    par: c.card.usable ? c.card.pars.reduce((s, p) => s + p, 0) : 0,
    tees: JSON.stringify(c.tees),
    cardProblem: c.card.usable ? "" : c.card.reason,
  };
  const card = c.card.usable
    ? {
        pars: JSON.stringify(c.card.pars),
        yards: JSON.stringify(c.card.yards),
        strokeIndex: JSON.stringify(c.card.strokeIndex),
      }
    : {};
  // Create, not upsert: the walk only ever fetches a course it does not hold
  // (see `known` below), so there is no stored card here to protect.
  try {
    await prisma.courseCatalog.create({ data: { id, ...base, ...card } });
  } catch (e) {
    /**
     * SOMETHING ELSE STORED IT FIRST (2026-10-04). `known` is read a moment
     * before this write, and anything else filling the catalogue — a bulk
     * import, a second run — can land the same id in between. Then the row
     * exists, which is all this wanted; failing the whole night's run over it
     * would throw away every course after it. Counted as a skip, and whatever
     * is stored is left exactly as it is.
     */
    if ((e as { code?: string })?.code === "P2002") return "skip";
    throw e;
  }
  return usable ? "card" : "no-card";
}

/**
 * Take today's slice of the directory.
 *
 * Interleaved — list a page, fetch the courses on it not yet catalogued, move
 * on — so a page of courses already held costs one request, not a hundred.
 * The cursor only moves past a page that was FULLY consumed, and is saved in
 * a `finally`, because stopping early is the ordinary way a day ends.
 */
export async function importCatalogueSlice(opts: SliceOptions): Promise<SliceResult> {
  const fetchJson = opts.fetchJson ?? directoryFetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const key = opts.cursorKey ?? WALK_KEY;
  const states = opts.states ?? US_STATES;
  const result: SliceResult = {
    fetched: 0, withCard: 0, withoutCard: 0, skipped: 0, position: { phase: 0, offset: 0 }, stopped: "budget",
  };
  /** A state's listing, or the world's once every state is done. */
  const listing = (at: WalkPosition) =>
    at.phase < states.length
      ? `/api/v1/courses/state/${states[at.phase]}?limit=${PAGE}&offset=${at.offset}`
      : `/api/v1/courses/search?limit=${PAGE}&offset=${at.offset}`;

  const ask = async (path: string): Promise<unknown | null> => {
    for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt += 1) {
      const res = await fetchJson(path);
      if (res && res.status >= 200 && res.status < 300) {
        const limited = (res.body as { limit_hit?: boolean } | null)?.limit_hit;
        if (!limited) return res.body;
      } else if (res && res.status !== 429 && res.status < 500) {
        // A 404 is an answer. Asking again is three times the load for nothing.
        return null;
      }
      if (attempt < BACKOFF_MS.length) await sleep(BACKOFF_MS[attempt]);
    }
    throw new DirectoryRefusing();
  };

  let at = await readCursor(key, states.length);
  /**
   * The end of one listing. A state's end moves on to the next state (or the
   * world) in the same run; the WORLD's end is the end of the directory, and
   * the walk starts again at the first state tomorrow, which is how a course
   * added later is ever picked up — every course already held costs nothing.
   */
  const listingDone = (): boolean => {
    if (at.phase < states.length) {
      at = { phase: at.phase + 1, offset: 0 };
      return false;
    }
    at = { phase: 0, offset: 0 };
    result.stopped = "end";
    return true;
  };
  try {
    for (;;) {
      if (result.fetched >= opts.budget) {
        result.stopped = "budget";
        break;
      }
      if (Date.now() >= opts.deadline) {
        result.stopped = "deadline";
        break;
      }
      const inState = at.phase < states.length;
      const hits = hitsFrom(await ask(listing(at))).map((h) =>
        // A state listing is the US by definition, whether or not the row says.
        inState && !h.country ? { ...h, country: "US" } : h,
      );
      if (hits.length === 0) {
        if (listingDone()) break;
        continue;
      }
      const known = new Set(
        (await prisma.courseCatalog.findMany({ where: { id: { in: hits.map((h) => h.id) } }, select: { id: true } })).map(
          (r) => r.id,
        ),
      );
      const fresh = hits.filter((h) => !known.has(h.id));

      let consumed = 0;
      for (const h of fresh) {
        if (result.fetched >= opts.budget || Date.now() >= opts.deadline) break;
        const payload = await ask(`/api/v1/courses/${encodeURIComponent(h.id)}`);
        result.fetched += 1;
        consumed += 1;
        const stored = payload ? await store(h.id, payload, h.country) : "skip";
        if (stored === "card") result.withCard += 1;
        else if (stored === "no-card") result.withoutCard += 1;
        else result.skipped += 1;
        await sleep(PAUSE_MS);
      }
      // Stopped part-way through this page: stay on it. Tomorrow re-reads it
      // for one request and skips the ones now catalogued.
      if (consumed < fresh.length) {
        result.stopped = result.fetched >= opts.budget ? "budget" : "deadline";
        break;
      }
      if (hits.length < PAGE) {
        if (listingDone()) break;
      } else {
        at = { phase: at.phase, offset: at.offset + PAGE };
      }
      await sleep(PAUSE_MS);
    }
  } catch (e) {
    if (!(e instanceof DirectoryRefusing)) throw e;
    result.stopped = "refused";
  } finally {
    await writeCursor(key, at);
    result.position = at;
  }
  return result;
}
