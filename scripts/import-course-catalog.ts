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
import { PrismaClient } from "@prisma/client";
import { courseFrom, hitsFrom } from "../src/lib/domain/course-directory";

const prisma = new PrismaClient();

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
const PAUSE_MS = 350;
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
const CONCURRENCY = 6;
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

async function getJson(path: string): Promise<unknown | null> {
  for (let attempt = 0; attempt < RETRIES; attempt += 1) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) return (await res.json()) as unknown;
      // 429 and 5xx mean "ask again". A 404 is an answer, and retrying it is
      // three times the load for the same nothing.
      if (res.status !== 429 && res.status < 500) return null;
    } catch {
      // Timeout or connection reset — the same treatment.
    }
    await sleep(PAUSE_MS * (attempt + 1) * 4);
  }
  return null;
}

/** Every course id the directory lists for one state. */
async function idsInState(code: string): Promise<string[]> {
  const ids: string[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const payload = await getJson(`/api/v1/courses/state/${code}?limit=${PAGE}&offset=${offset}`);
    const hits = hitsFrom(payload);
    if (hits.length === 0) break;
    ids.push(...hits.map((h) => h.id));
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
async function store(id: string, payload: unknown): Promise<"card" | "no-card" | "skip"> {
  const c = courseFrom(payload);
  if (!c) return "skip";

  const usable = c.card.usable;
  const base = {
    name: c.name,
    city: c.city,
    state: c.state,
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

async function main() {
  const args = process.argv.slice(2);
  const all = args.includes("--all");
  const one = args.indexOf("--state");
  const states = all ? STATES : one >= 0 && args[one + 1] ? [args[one + 1].toUpperCase()] : [];

  if (states.length === 0) {
    console.log("Usage: --all, or --state OH");
    return;
  }

  let withCard = 0;
  let withoutCard = 0;
  let skipped = 0;

  for (const code of states) {
    const ids = await idsInState(code);
    console.log(`${code}: ${ids.length} courses listed`);

    // A shared queue rather than fixed slices: courses that need retries take
    // far longer than the rest, and slicing would leave five workers idle
    // while the sixth ground through them.
    let next = 0;
    const worker = async () => {
      for (;;) {
        const i = next;
        next += 1;
        if (i >= ids.length) return;
        const id = ids[i];
        const payload = await getJson(`/api/v1/courses/${encodeURIComponent(id)}`);
        if (!payload) {
          skipped += 1;
        } else {
          const result = await store(id, payload);
          if (result === "card") withCard += 1;
          else if (result === "no-card") withoutCard += 1;
          else skipped += 1;
        }
        await sleep(PAUSE_MS);
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    console.log(`${code}: done — ${withCard} with cards, ${withoutCard} without, ${skipped} unreadable`);
  }

  // Said out loud, because a silent count of "16,822 courses imported" would
  // read as 16,822 usable cards, and it is not.
  console.log(
    `\nCatalogue: ${withCard} courses with a card the app will score against, ` +
      `${withoutCard} catalogued without one (the directory's card could not be trusted), ` +
      `${skipped} unreadable.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
