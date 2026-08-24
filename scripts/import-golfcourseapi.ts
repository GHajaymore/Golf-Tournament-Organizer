/**
 * Import golf course cards from GolfCourseAPI, a second directory.
 *
 * WHY A SECOND PROVIDER AT ALL. OpenGolfAPI has no hole-by-hole card for 86%
 * of its non-US courses — measured, 0 usable cards across 329 non-US rows.
 * This one carries a per-hole `handicap`, which IS the stroke index, and a
 * sample on 2026-08-24 found roughly one course in three has a complete one,
 * including outside the US. That is the entire reason this file exists.
 *
 * FREE TIER, DELIBERATELY. 50 requests a day, email signup, no card. The
 * budget below leaves headroom rather than spending to the last request,
 * because a search costs one too and discovery has to come out of the same
 * allowance.
 *
 * Run:
 *   npx tsx scripts/import-golfcourseapi.ts            # a day's slice
 *   npx tsx scripts/import-golfcourseapi.ts --budget 10
 *   npx tsx scripts/import-golfcourseapi.ts --dry      # discovery only, no detail calls
 */
import { PrismaClient } from "@prisma/client";
import fs from "node:fs";
import path from "node:path";
import { cardRefusal } from "../src/lib/domain/scorecard-parse";

const prisma = new PrismaClient();

const BASE = "https://api.golfcourseapi.com";
const KEY = process.env.GOLFCOURSE_API_KEY ?? "";

/**
 * One request every 1.5s, and a burst is NOT a spent day.
 *
 * Twenty details fired back-to-back returned 429 on fourteen of them; a single
 * unhurried request a second later returned 200. The headers say the same
 * thing either way, so the only honest discriminator is asking again slowly.
 * Identical trap to OpenGolfAPI — different provider, same lesson.
 */
const PACE_MS = 1500;
const BACKOFF_MS = [5000, 15000, 45000];

/** Leaves room for the searches, which come out of the same 50. */
const DEFAULT_BUDGET = 40;

const CURSOR = path.join(process.cwd(), ".gca-walk.json");

/**
 * Discovery and fetching are separated deliberately.
 *
 * A search costs the same as a detail call, so re-searching to find work
 * already found is pure waste. Discovery banks candidates here; fetching
 * drains them. It also means a paid month could discover everything cheaply
 * first and then spend the whole allowance on details.
 */
const QUEUE = path.join(process.cwd(), ".gca-queue.json");

/**
 * Search has no offset, no page and no limit — only `search_query` and
 * `fuzzy_match`. It returns at most 25 rows for a term, and there is no way
 * to page deeper. So the database cannot be ENUMERATED; it can only be
 * sampled, one term at a time.
 *
 * Two-letter substrings are what make that sampling wide. Measured: "aa",
 * "zu", "ek" and "ov" each returned 25 rows with ZERO overlap between them —
 * 100 distinct courses from four searches. "qi" returned nothing, which is
 * the expected shape: some pairs no course name contains.
 *
 * The curated words go first because they are the highest-yield, then the 676
 * pairs. The 25-row cap means a common pair like "aa" certainly matches more
 * courses than it shows, so this reaches breadth rather than completeness.
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
const PAIRS = LETTERS.flatMap((a) => LETTERS.map((b) => a + b));
const TERMS = [...CURATED, ...PAIRS];

interface Cursor {
  termIndex: number;
}

function readCursor(): Cursor {
  try {
    return JSON.parse(fs.readFileSync(CURSOR, "utf8")) as Cursor;
  } catch {
    return { termIndex: 0 };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let spent = 0;

/**
 * One GET, paced, retrying a 429 rather than believing it.
 *
 * Returns null only after every backoff has been tried — at which point the
 * day really is spent and the caller should stop rather than burn the rest of
 * the allowance discovering the same thing.
 */
async function get(pathname: string): Promise<unknown | null> {
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    if (spent) await sleep(PACE_MS);
    spent++;
    const res = await fetch(`${BASE}${pathname}`, {
      headers: { Authorization: `Bearer ${KEY}` },
    });
    if (res.ok) return (await res.json()) as unknown;
    if (res.status !== 429) {
      console.log(`  HTTP ${res.status} on ${pathname}`);
      return null;
    }
    if (attempt < BACKOFF_MS.length) {
      const wait = BACKOFF_MS[attempt];
      console.log(`  429 — backing off ${wait / 1000}s (burst, or the day is gone)`);
      await sleep(wait);
    }
  }
  return null;
}

interface Hole {
  par?: number | null;
  yardage?: number | null;
  handicap?: number | null;
}

interface Tee {
  tee_name?: string;
  holes?: Hole[];
}

interface Card {
  pars: number[];
  yards: number[];
  strokeIndex: number[];
  reason: string;
}

/**
 * Turn a course's tee boxes into one card, or into the reason there isn't one.
 *
 * A course carries several tees and they share a par and a stroke index —
 * only the yardage really differs — so the first tee that yields a clean card
 * is as good as any. If none does, the refusal reported is the first tee's,
 * because a caller wants to know WHY rather than which tee was unluckiest.
 *
 * YARDAGE IS PASSED EMPTY WHEN INCOMPLETE, NEVER AS ZEROS. `cardRefusal`
 * accepts `[]` and refuses `[0, 0, ...]` — so filling the gaps with zeros
 * would throw away a good card over a field nothing scores off. That is
 * exactly how 33 real courses were cleared once already.
 */
function cardFrom(tees: Tee[]): Card | { reason: string } {
  let firstReason = "The directory has no hole-by-hole card for this course.";
  for (const tee of tees) {
    const holes = tee.holes ?? [];
    if (holes.length !== 9 && holes.length !== 18) continue;

    const pars = holes.map((h) => h.par ?? 0);
    const strokeIndex = holes.map((h) => h.handicap ?? 0);
    if (pars.some((p) => !p) || strokeIndex.some((s) => !s)) {
      firstReason =
        strokeIndex.some((s) => !s)
          ? "The directory has pars but no stroke index for this course, so handicap shots cannot be allocated."
          : "The directory's card is missing a par on at least one hole.";
      continue;
    }

    const rawYards = holes.map((h) => h.yardage ?? 0);
    const yards = rawYards.every((y) => y > 0) ? rawYards : [];

    const refusal = cardRefusal(pars, yards, strokeIndex, holes.length === 9 ? 9 : 18);
    if (!refusal) return { pars, yards, strokeIndex, reason: "" };
    firstReason = refusal;
  }
  return { reason: firstReason };
}

interface Summary {
  id: string;
  club_name?: string;
  course_name?: string;
  location?: { city?: string; state?: string; country?: string; address?: string };
  tees?: Record<string, number>;
}

/** `gca:` keeps provenance visible beside OpenGolfAPI's UUIDs. */
const storedId = (id: string) => `gca:${id}`;

function nameOf(s: Summary): string {
  const club = (s.club_name ?? "").trim();
  const course = (s.course_name ?? "").trim();
  if (!club) return course;
  if (!course || course.toLowerCase() === club.toLowerCase()) return club;
  return `${club} — ${course}`;
}

async function store(s: Summary, card: Card | { reason: string }): Promise<"card" | "no-card"> {
  const loc = s.location ?? {};
  const usable = "pars" in card;
  const country = (loc.country ?? "").trim();
  const base = {
    name: nameOf(s),
    city: (loc.city ?? "").trim(),
    state: (loc.state ?? "").trim(),
    // "Unknown" is a real value this directory returns. Storing it as a
    // country would make it look like a place; blank is the honest form.
    ...(country && country.toLowerCase() !== "unknown" ? { country } : {}),
    website: "",
    address: (loc.address ?? "").trim(),
    par: usable ? card.pars.reduce((a, b) => a + b, 0) : 0,
    tees: JSON.stringify(Object.keys(s.tees ?? {})),
    cardProblem: usable ? "" : card.reason,
  };
  const cardCols = usable
    ? {
        pars: JSON.stringify(card.pars),
        yards: JSON.stringify(card.yards),
        strokeIndex: JSON.stringify(card.strokeIndex),
      }
    : {};

  await prisma.courseCatalog.upsert({
    where: { id: storedId(s.id) },
    update: { ...base, ...cardCols },
    create: { id: storedId(s.id), ...base, ...cardCols },
  });
  return usable ? "card" : "no-card";
}
function readQueue(): Summary[] {
  try {
    return JSON.parse(fs.readFileSync(QUEUE, "utf8")) as Summary[];
  } catch {
    return [];
  }
}

function writeQueue(rows: Summary[]): void {
  fs.writeFileSync(QUEUE, JSON.stringify(rows, null, 2));
}

async function main() {
  if (!KEY) {
    console.error("GOLFCOURSE_API_KEY is not set. Put it in .env.");
    process.exit(1);
  }
  const argv = process.argv.slice(2);
  const dry = argv.includes("--dry");
  const discoverOnly = argv.includes("--discover");
  const bIdx = argv.indexOf("--budget");
  const budget = bIdx >= 0 ? Number(argv[bIdx + 1]) : DEFAULT_BUDGET;
  const tIdx = argv.indexOf("--term");
  const oneTerm = tIdx >= 0 ? argv[tIdx + 1] : "";

  const cursor = readCursor();
  const known = new Set(
    (await prisma.courseCatalog.findMany({ select: { id: true } })).map((r) => r.id),
  );
  const queue = readQueue().filter((c) => !known.has(storedId(c.id)));

  console.log(
    `Budget ${budget} requests. Catalogue holds ${known.size} courses, ` +
      `${queue.length} discovered and waiting.`,
  );

  let noTees = 0;
  let termIndex = oneTerm ? 0 : cursor.termIndex;
  const termList = oneTerm ? [oneTerm] : TERMS;

  /**
   * Draining comes before discovering.
   *
   * Spending a search to find work that is already banked is the one waste
   * this design exists to avoid. A targeted --term always searches, because
   * the point of it is to reach one named course now.
   */
  const shouldDiscover = discoverOnly || Boolean(oneTerm) || queue.length === 0;

  if (shouldDiscover) {
    // An ordinary run tops the queue up a little; --discover spends the lot.
    const discoveryCap = discoverOnly || oneTerm ? budget : Math.min(budget, 5);
    const seen = new Set(queue.map((c) => c.id));
    while (spent < discoveryCap && termIndex < termList.length) {
      const term = termList[termIndex];
      const payload = (await get(
        `/v1/search?search_query=${encodeURIComponent(term)}`,
      )) as { courses?: Summary[] } | null;
      termIndex++;
      if (!payload) break;

      let fresh = 0;
      for (const c of payload.courses ?? []) {
        if (known.has(storedId(c.id)) || seen.has(c.id)) continue;
        seen.add(c.id);
        const teeCount = Object.values(c.tees ?? {}).reduce((a, b) => a + (b || 0), 0);
        if (teeCount === 0) {
          // Free refusal: the search row itself proves there is no card, so
          // this is judged without ever spending a detail call on it.
          noTees++;
          if (!dry) {
            await store(c, {
              reason: "The directory lists no tee boxes for this course, so it has no card.",
            });
            known.add(storedId(c.id));
          }
          continue;
        }
        queue.push(c);
        fresh++;
      }
      console.log(`  "${term}" -> +${fresh} queued (${queue.length} waiting)`);
    }
    // A targeted run must not advance the walk it did not do.
    if (!oneTerm && !dry) fs.writeFileSync(CURSOR, JSON.stringify({ termIndex }, null, 2));
  }

  if (!dry) writeQueue(queue);

  if (dry || discoverOnly) {
    const label = discoverOnly ? "Discovery" : "Dry run";
    console.log(
      `\n${label}: ${queue.length} candidates waiting, ${noTees} free skips.` +
        `\nRequests spent: ${spent}. Term cursor ${termIndex}/${TERMS.length}.`,
    );
    await prisma.$disconnect();
    return;
  }

  let cards = 0;
  let refused = 0;
  while (queue.length && spent < budget) {
    const s = queue[0];
    const detail = (await get(`/v1/courses/${s.id}`)) as
      | { course?: { tees?: Record<string, Tee[]> }; tees?: Record<string, Tee[]> }
      | null;
    // Dropped from the queue only once actually judged, so a run that stops on
    // a spent allowance loses no discovery work.
    if (!detail) break;
    queue.shift();
    const course = detail.course ?? detail;
    const tees = Object.values(course.tees ?? {}).flat() as Tee[];
    const card = cardFrom(tees);
    if ((await store(s, card)) === "card") {
      cards++;
      console.log(`  card    ${nameOf(s)}`);
    } else {
      refused++;
    }
  }
  writeQueue(queue);

  console.log(
    `\n${cards} cards stored, ${refused} refused, ${noTees} skipped without tee boxes.` +
      `\nRequests spent: ${spent}. ${queue.length} still queued. ` +
      `Term cursor ${termIndex}/${TERMS.length}.`,
  );
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
