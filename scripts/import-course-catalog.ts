/**
 * Fill the shared course catalogue from the public directory.
 *
 *   npx tsx --require ./scripts/server-shim.cjs scripts/import-course-catalog.ts --state OH
 *   npx tsx --require ./scripts/server-shim.cjs scripts/import-course-catalog.ts --all
 *
 * Walks each US state's listing, fetches every course in batches, and upserts
 * it into `CourseCatalog` keyed by the directory's own id — so re-running
 * refreshes rather than duplicating.
 *
 * It writes what the importer JUDGED, not what the source said. A course whose
 * card `cardFrom` refuses is catalogued with empty hole arrays and the reason,
 * because the alternative is putting a fabricated par 72 in front of every club
 * in the country. Green Crest Golf Course is the worked example: pars sorted
 * longest-to-shortest, a par total that matches, a clean 1-18 stroke index, and
 * wrong on every hole.
 *
 * Nothing here touches a club's own courses. Adding a catalogue entry to a club
 * COPIES it into a Course, so a club's corrections stay theirs and a later
 * refresh cannot overwrite them.
 *
 * Safe to interrupt and safe to re-run. It is polite to the directory: one
 * request at a time, with a pause between them.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PrismaClient } from "@prisma/client";
import { courseFrom, hitsFrom } from "../src/lib/domain/course-directory";

const prisma = new PrismaClient();

/** Written out rather than escaped inline — a literal newline in a shell-
 *  authored edit is how this file got a broken string twice. */
const EOL = String.fromCharCode(10);

const BASE = "https://api.opengolfapi.org";
/**
 * Pace, and what to do when the directory says no.
 *
 * The first run of Ohio reported 374 of 527 courses "unreadable", which was not
 * the data: every one of them answered 200 when asked again on its own. It was
 * this script going too fast. So it goes slower and retries, and a course is
 * only recorded as unreadable once it has refused three times — otherwise the
 * catalogue silently reflects our own impatience rather than the source.
 */
/**
 * Gentle on purpose, and gentler than it used to be.
 *
 * Six in flight every 350ms is about seventeen requests a second, which the
 * directory answers with burst refusals — and those read as "the allowance is
 * used up" and ended runs with hundreds of requests still unspent. Since a
 * run now takes a bounded daily slice rather than trying to import a country
 * in one sitting, speed buys nothing: 400 courses at this pace is a couple of
 * minutes, and it is a couple of minutes that actually finishes.
 */
const PAUSE_MS = 600;
const RETRIES = 3;
/**
 * How many courses are in flight at once.
 *
 * Serial with a long pause was the first fix and it was the wrong shape: it
 * bought accuracy with an hour of wall clock. A small pool with the same pause
 * per worker is the same load per second spread over fewer seconds — six is
 * gentle against a directory serving the whole country, and it turns a state
 * from forty minutes into about seven.
 *
 * Not tuned upward without evidence. The failure this is guarding against was
 * invisible: the fast version did not error, it recorded 374 real courses as
 * unreadable and moved on.
 */
const CONCURRENCY = 1;
const PAGE = 100;

/** Every US state and territory the directory indexes by code. */
const STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
  "DC", "PR", "VI", "GU",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Thrown when the directory says we have had our allowance for today.
 *
 * A quota is not a fact about a golf course. Left to the ordinary path, an
 * exhausted allowance would mark every remaining course "unreadable" and write
 * that to the catalogue — our billing status recorded as the state of the
 * world, and invisible afterwards. So it stops the run instead.
 */
class QuotaExhausted extends Error {}

/**
 * A free key raises the allowance well above the anonymous one.
 *
 * Read from the environment or from `.env`, which is gitignored — it is a
 * credential and this repository is public. `.env` is the easier of the two:
 * put the key there once and every later run picks it up, rather than
 * remembering to prefix the command.
 *
 *   .env:  OPENGOLF_API_KEY=ogapi_…
 *   or:    OPENGOLF_API_KEY=ogapi_… npx tsx … --all
 *
 * Read by hand rather than with dotenv. Prisma loads `.env` for its own
 * connection, which is why the database works here, but it does not put the
 * file's other keys on `process.env` — so a key sitting in `.env` was being
 * silently ignored and the run went out anonymous.
 */
function envKey(): string {
  const fromEnv = process.env.OPENGOLF_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    const text = readFileSync(resolve(process.cwd(), ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?OPENGOLF_API_KEY\s*=\s*(.*)$/.exec(line);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    // No .env, or unreadable. Anonymous is a valid way to run this.
  }
  return "";
}

const API_KEY = envKey();

/**
 * The rate-limit headers cannot tell a burst from the end of the day.
 *
 * Measured: ten requests fired at once all came back 429 with
 * `X-RateLimit-Remaining: 0` and `X-RateLimit-Reset` at midnight UTC — and a
 * single unhurried request a second later reported 493 of 500 still
 * available. The refusal reports the same numbers whether you have spent the
 * day or merely asked too fast in one second, so reading them decides
 * nothing. An earlier version of this file trusted them and stopped runs with
 * hundreds of requests unspent.
 *
 * What does distinguish the two is ASKING AGAIN SLOWLY. A burst penalty
 * clears in seconds; a spent day does not. So a refusal is retried at
 * widening intervals, and only a refusal that survives all of them ends the
 * run — by which point the distinction has stopped mattering, because either
 * way there is nothing useful left to do today.
 */
const BACKOFF_MS = [5000, 15000, 45000];
/**
 * A 429 is not the same thing as being out of allowance.
 *
 * Two different refusals arrive as the same status code: asking too fast in a
 * burst, which wants a pause, and having spent the day's requests, which
 * wants tomorrow. Treating the first as the second stopped a run with 244 of
 * 500 still unspent and announced "the daily request allowance is used up" —
 * the same shape of mistake as the 374 courses once recorded as unreadable,
 * which were really this script going too fast.
 *
 * `X-RateLimit-Remaining` tells them apart, so it is read rather than guessed.
 * Only a zero there, or the `limit_hit` body some endpoints answer with, ends
 * the run.
 */
function outOfAllowance(res: Response): boolean {
  const left = Number(res.headers.get("x-ratelimit-remaining"));
  return Number.isFinite(left) && left <= 0;
}

async function getJson(path: string): Promise<unknown | null> {
  for (let attempt = 0; attempt < RETRIES; attempt += 1) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: {
          Accept: "application/json",
          ...(API_KEY ? { "X-API-Key": API_KEY } : {}),
        },
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) {
        const body = (await res.json()) as { limit_hit?: boolean; error?: string };
        // Some endpoints answer 200 with a limit_hit body rather than a 429,
        // so the status alone would sail straight past this. Same treatment as
        // a 429: back off and ask again.
        if (body?.limit_hit) {
          await sleep(BACKOFF_MS[attempt] ?? 45000);
          continue;
        }
        return body as unknown;
      }
      // 429 and 5xx mean "ask again". A 404 is an answer, and retrying it is
      // three times the load for the same nothing.
      if (res.status !== 429 && res.status < 500) return null;
    } catch (e) {
      if (e instanceof QuotaExhausted) throw e;
      // Timeout or connection reset — the same treatment.
    }
    await sleep(BACKOFF_MS[attempt] ?? 45000);
  }
  // Refused at 5s, then 15s, then 45s. Whatever the headers claim, something
  // that will not answer after a minute of backing off has nothing more to
  // give today, and carrying on would just be asking a wall.
  throw new QuotaExhausted("it is still refusing requests after backing off for a minute.");
}

/** Every course id the directory lists for one state. */
/**
 * Courses refused under a rule that no longer refuses them.
 *
 * The catalogue stores WHY a card was turned away, which means a rule change
 * can be undone precisely rather than by re-fetching everything. Accepting
 * nine-hole courses recovered 119 of them; a blanket --refresh over Ohio to
 * find those would have spent 471 requests, against an allowance of 500 a
 * day, to change 119 rows.
 *
 * It reads the stored reason rather than a list of ids, so the next time a
 * rule loosens the fix is a pattern here rather than a migration. A row is
 * only re-fetched when the CURRENT rules would plainly do better; anything
 * ambiguous is left alone, because re-asking is what costs.
 */
async function refusedUnderOldRules(): Promise<Array<{ id: string; country: string }>> {
  const rows = await prisma.courseCatalog.findMany({
    where: { NOT: { cardProblem: "" } },
    select: { id: true, country: true, cardProblem: true },
  });
  return rows
    .filter((r) => {
      // "The directory has 9 holes for this course, not 18." Nine holes is
      // now a golf course rather than a broken eighteen.
      const m = /has (\d+) holes for this course, not 18/.exec(r.cardProblem);
      return !!m && m[1] === "9";
    })
    .map((r) => ({ id: r.id, country: r.country }));
}

/**
 * Drop the ids already catalogued.
 *
 * Without this a daily run spends its whole allowance re-fetching courses it
 * already has, and never reaches the ones it does not — which would look
 * like the import being stuck rather than being wasteful.
 *
 * A course whose card was REFUSED is still "already catalogued". The refusal
 * is a judgement about the source data, and the source changes about never;
 * re-asking daily would spend the allowance re-confirming the same no. Use
 * --refresh to go back over them deliberately.
 */
async function unseen<T extends { id: string }>(rows: T[]): Promise<T[]> {
  const known = new Set(
    (await prisma.courseCatalog.findMany({ select: { id: true } })).map((r) => r.id),
  );
  return rows.filter((r) => !known.has(r.id));
}

async function idsInState(code: string): Promise<Array<{ id: string; country: string }>> {
  const ids: Array<{ id: string; country: string }> = [];
  for (let offset = 0; ; offset += PAGE) {
    const payload = await getJson(`/api/v1/courses/state/${code}?limit=${PAGE}&offset=${offset}`);
    const hits = hitsFrom(payload);
    if (hits.length === 0) break;
    ids.push(...hits.map((h) => ({ id: h.id, country: h.country })));
    if (hits.length < PAGE) break;
    await sleep(PAUSE_MS);
  }
  return ids;
}

/**
 * Store one course, exactly as the importer judged it.
 *
 * `updatedAt` moves on every run, which is how a later "what changed" pass
 * would find its work. The card is only overwritten with a card — a course that
 * imported cleanly last month and comes back unusable today keeps the good one,
 * because the directory losing data is not the club's problem.
 */
/**
 * The country comes from the LISTING, not the course.
 *
 * The detail payload has no country field at all — `country_iso` exists only
 * on a search row. Reading it off the course would have quietly stored every
 * course in the world with a blank country, which is exactly what the first
 * version of this did: 583 rows, every one of them blank.
 */
async function store(
  id: string,
  payload: unknown,
  country: string,
): Promise<"card" | "no-card" | "skip"> {
  const c = courseFrom(payload);
  if (!c) return "skip";

  const usable = c.card.usable;
  const base = {
    name: c.name,
    city: c.city,
    state: c.state,
    // Never blanked by a listing that did not say: a country we already
    // hold is better than an empty one.
    ...(country ? { country } : {}),
    website: c.website,
    address: c.address,
    par: usable ? c.card.pars.reduce((s, p) => s + p, 0) : 0,
    tees: JSON.stringify(c.tees),
    cardProblem: usable ? "" : c.card.reason,
  };
  const card = usable
    ? {
        pars: JSON.stringify(c.card.pars),
        yards: JSON.stringify(c.card.yards),
        strokeIndex: JSON.stringify(c.card.strokeIndex),
      }
    : {};

  await prisma.courseCatalog.upsert({
    where: { id },
    // Never blank a card we already hold: the directory losing data between
    // runs must not take a usable card away from every club in the country.
    update: { ...base, ...card },
    create: { id, ...base, ...card },
  });
  return usable ? "card" : "no-card";
}

/** Running totals for a whole run, however it was scoped. */
interface Tally {
  withCard: number;
  withoutCard: number;
  skipped: number;
}

/**
 * Fetch and store a batch of courses, one request each.
 *
 * A shared queue rather than fixed slices: courses that need retries take far
 * longer than the rest, and slicing would leave five workers idle while the
 * sixth ground through them.
 */
async function fetchAll(rows: Array<{ id: string; country: string }>, tally: Tally): Promise<void> {
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= rows.length) return;
      const { id, country } = rows[i];
      const payload = await getJson(`/api/v1/courses/${encodeURIComponent(id)}`);
      if (!payload) {
        tally.skipped += 1;
      } else {
        const result = await store(id, payload, country);
        if (result === "card") tally.withCard += 1;
        else if (result === "no-card") tally.withoutCard += 1;
        else tally.skipped += 1;
      }
      await sleep(PAUSE_MS);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

/**
 * Where the world walk got to, so tomorrow does not start again at the top.
 *
 * A listing page costs exactly what a course costs: one request. Enumerating
 * ~30,000 courses is ~300 of them, so a daily run that re-walked the listing
 * from zero would spend most of a 500-request allowance rediscovering what it
 * already knows, and the further it got the worse it would be — which reads
 * like the import being stuck rather than being wasteful.
 *
 * A file rather than a table, because this is the script's own bookkeeping and
 * no screen has any use for it. Losing it costs one wasted day of listing
 * calls and nothing else: the walk restarts at the top, skips everything
 * already catalogued, and carries on. Degraded, not broken.
 */
const CURSOR_FILE = resolve(__dirname, "..", ".course-walk.json");

function readCursor(): number {
  try {
    const raw = JSON.parse(readFileSync(CURSOR_FILE, "utf8")) as { offset?: unknown };
    const n = Number(raw?.offset);
    return Number.isInteger(n) && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

function writeCursor(offset: number): void {
  try {
    writeFileSync(CURSOR_FILE, JSON.stringify({ offset }, null, 2));
  } catch {
    // Not worth failing a good run over. The next run starts at the top and
    // skips what is already catalogued.
  }
}

/**
 * Walk the whole directory, a page at a time, until the budget is spent.
 *
 * Interleaved rather than "list everything, then fetch everything", because
 * the listing is not free. Each page is filtered against what is already
 * catalogued before a single course is fetched, so a page of courses we
 * already hold costs one request rather than a hundred.
 */
async function walkWorld(budget: number, refresh: boolean, tally: Tally): Promise<void> {
  let offset = readCursor();
  let spent = 0;
  if (offset > 0) console.log(`Resuming the world walk at offset ${offset}.`);

  /**
   * The cursor is saved even when the run is cut short — hence the finally.
   *
   * Running out of allowance THROWS, and the first version wrote the cursor
   * on the line after the loop, which that throw skipped. A run that walked to
   * offset 3,000 and then hit the wall threw away every listing request it had
   * just spent, and the next one started again at the top. Stopping early is
   * the normal way a daily run ends, so it is the path that must save its
   * place.
   *
   * And the cursor only advances past a page that was FULLY consumed. The
   * first version advanced a whole page whenever it moved at all, so a budget
   * running out 25 courses into a page of 100 left the other 75 behind
   * permanently — the catalogue would have filled with quiet holes that no
   * later run revisited. Staying put costs one listing request tomorrow to
   * re-read a page whose first 25 are now catalogued and skipped for free.
   */
  try {
    for (;;) {
      if (spent >= budget) break;
      const payload = await getJson(`/api/v1/courses/search?limit=${PAGE}&offset=${offset}`);
      const hits = hitsFrom(payload);
      if (hits.length === 0) {
        // The end. Back to the top next time, which is how a course added to
        // the directory later is ever picked up.
        console.log("Reached the end of the directory. The next run starts again at the top.");
        offset = 0;
        break;
      }

      const listed = hits.map((h) => ({ id: h.id, country: h.country }));
      const fresh = refresh ? listed : await unseen(listed);
      const take = fresh.slice(0, budget - spent);
      if (take.length > 0) {
        await fetchAll(take, tally);
        spent += take.length;
        console.log(
          `offset ${offset}: ${take.length} fetched (${tally.withCard} with cards so far), ` +
            `${spent}/${budget} of today's slice used`,
        );
      }
      // Budget ran out part-way through this page: stay on it.
      if (take.length < fresh.length) break;
      if (hits.length < PAGE) {
        console.log("Reached the end of the directory. The next run starts again at the top.");
        offset = 0;
        break;
      }
      offset += PAGE;
      await sleep(PAUSE_MS);
    }
  } finally {
    writeCursor(offset);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const world = args.includes("--world");
  const refresh = args.includes("--refresh");
  const recheck = args.includes("--recheck");
  const one = args.indexOf("--state");
  const states = all ? STATES : one >= 0 && args[one + 1] ? [args[one + 1].toUpperCase()] : [];

  /**
   * How many courses this run may fetch.
   *
   * The anonymous allowance is 500 a day and one course is one request. A run
   * that simply starts and hits the wall is safe — the script stops cleanly —
   * but it leaves nothing for anyone using the app that day, because the same
   * allowance serves the live "check source" button. So a run takes a slice
   * and stops, and tomorrow takes the next one.
   */
  const b = args.indexOf("--budget");
  const budget = b >= 0 && Number(args[b + 1]) > 0 ? Math.floor(Number(args[b + 1])) : Infinity;

  if (states.length === 0 && !world && !recheck) {
    console.log(
      [
        "Usage:",
        "  --state OH            one US state",
        "  --all                 every US state",
        "  --world               every course the directory has, anywhere",
        "  --budget 400          stop after N courses (the daily allowance is 500)",
        "  --refresh             re-fetch courses already catalogued",
        "  --recheck             re-fetch only what an old rule wrongly refused",
      ].join(EOL),
    );
    return;
  }

  const tally: Tally = { withCard: 0, withoutCard: 0, skipped: 0 };

  if (recheck) {
    const stale = await refusedUnderOldRules();
    const take = stale.slice(0, budget === Infinity ? stale.length : budget);
    console.log(
      `${stale.length} course(s) were refused by a rule that no longer refuses them` +
        (take.length < stale.length ? `; taking ${take.length} within the budget` : ""),
    );
    await fetchAll(take, tally);
    console.log(
      `Re-checked ${take.length}: ${tally.withCard} now have a card, ` +
        `${tally.withoutCard} still do not, ${tally.skipped} unreadable.`,
    );
    return;
  }

  if (world) {
    await walkWorld(budget, refresh, tally);
  } else {
    let spent = 0;
    for (const code of states) {
      if (spent >= budget) {
        console.log(`Budget of ${budget} reached — stopping. Re-run to take the next slice.`);
        break;
      }
      const listed = await idsInState(code);
      // Resume before spending: the expensive call is the per-course one.
      const fresh = refresh ? listed : await unseen(listed);
      const ids = fresh.slice(0, budget - spent);
      spent += ids.length;
      console.log(
        `${code}: ${listed.length} listed, ${fresh.length} not yet catalogued, fetching ${ids.length}`,
      );
      await fetchAll(ids, tally);
      console.log(
        `${code}: done — ${tally.withCard} with cards, ${tally.withoutCard} without, ${tally.skipped} unreadable`,
      );
    }
  }

  // Said out loud, because a silent count of "16,822 courses imported" would
  // read as 16,822 usable cards, and it is not.
  console.log(
    EOL +
      `Catalogue: ${tally.withCard} courses with a card the app will score against, ` +
      `${tally.withoutCard} catalogued without one (the directory's card could not be trusted), ` +
      `${tally.skipped} unreadable.`,
  );
}


main()
  .catch((e) => {
    if (e instanceof QuotaExhausted) {
      // Stopped, not failed. Everything already stored is good, and re-running
      // resumes — the upsert is keyed on the directory's own id.
      console.error(
        `\nStopped: the directory says ${e.message}\n` +
          "Nothing was recorded as unreadable on account of it — a quota is not a fact\n" +
          "about a golf course. What is already catalogued is unaffected.\n\n" +
          "A free key raises the allowance (opengolfapi.org/developer). Then:\n" +
          "  OPENGOLF_API_KEY=ogapi_... npx tsx --require ./scripts/server-shim.cjs scripts/import-course-catalog.ts --all\n" +
          "Or wait for the anonymous allowance to reset and re-run; it picks up where it left off.",
      );
      process.exitCode = 2;
      return;
    }
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
