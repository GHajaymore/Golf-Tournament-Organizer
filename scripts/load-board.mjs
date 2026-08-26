/**
 * How much database does one leaderboard cost?
 *
 * The public board is the only page in this app that a crowd looks at
 * simultaneously — a club's players, their families, and whoever has the link
 * — and since it started refreshing itself every thirty seconds, each of those
 * people is a standing request every thirty seconds for five hours.
 *
 * The number that matters is therefore not requests per second. It is
 * DATABASE QUERIES PER REQUEST, because that is what decides whether a hundred
 * spectators cost a hundred times one spectator or barely more than one. A
 * cached board answers everybody from one computation; an uncached board
 * commissions a fresh one per viewer, and the difference does not show up
 * until a real Saturday morning.
 *
 * Measured at Postgres rather than in the app. `pg_stat_database.xact_commit`
 * counts committed transactions, and Prisma runs each query in autocommit, so
 * the delta across a run is the query count — including any the app makes that
 * nobody remembered to count. An in-process counter can only report the
 * queries somebody thought to instrument, which is precisely the wrong
 * property for a measurement whose job is to find work you did not know about.
 *
 *   node scripts/load-board.mjs --viewers 40 --seconds 20
 *
 * Seeds its own tournament, prefixed `zz-load`, and removes it in a finally.
 * Runs against a dev server; never point it at production.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const BASE = arg("base", process.env.SMOKE_BASE_URL ?? "http://localhost:3100");
const VIEWERS = Number(arg("viewers", 40));
const SECONDS = Number(arg("seconds", 20));
const FIELD = Number(arg("field", 24));
const TAG = "zz-load";

const prisma = new PrismaClient();

/** Committed transactions on this database, all-time. The delta is what we want. */
async function transactions() {
  const [row] = await prisma.$queryRawUnsafe(
    "SELECT xact_commit FROM pg_stat_database WHERE datname = current_database()",
  );
  return Number(row.xact_commit);
}

async function cleanup() {
  const events = await prisma.event.findMany({
    where: { name: { startsWith: TAG } },
    select: { id: true },
  });
  for (const e of events) await prisma.event.delete({ where: { id: e.id } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/**
 * A tournament big enough to be honest.
 *
 * A two-player event would understate the per-request cost: several of the
 * queries behind the board scale with the field, so measuring against a field
 * of two would report a number no real club would ever see.
 */
async function seed() {
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const token = `${TAG}-${randomBytes(8).toString("hex")}`;
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} Open`,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: token,
      leaderboardVisibility: "public",
    },
  });
  const stage = await prisma.stage.create({
    data: { eventId: event.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 },
  });

  for (let i = 0; i < FIELD; i += 1) {
    const player = await prisma.player.create({
      data: {
        eventId: event.id,
        name: `${TAG} Player ${i + 1}`,
        email: `${TAG}.${i}@example.invalid`,
        handicap: 4 + (i % 20),
        seed: i + 1,
        status: "confirmed",
      },
    });
    // A round in progress: twelve holes in, which is when a board is busiest.
    const strokes = new Array(18).fill(null);
    for (let h = 0; h < 12; h += 1) strokes[h] = 3 + ((i + h) % 4);
    await prisma.scorecard.create({
      data: {
        eventId: event.id,
        stageId: stage.id,
        playerId: player.id,
        strokes: JSON.stringify(strokes),
      },
    });
  }
  return `${BASE}/live/${token}`;
}

/** One viewer, refreshing for the duration. Records how long each took. */
async function viewer(url, until, latencies) {
  while (Date.now() < until) {
    const started = Date.now();
    try {
      // No cache-busting header. A spectator's phone does not send one, and a
      // load test that suppresses the very caching it is measuring reports the
      // uncached number forever — which is exactly what this one did first.
      const res = await fetch(url);
      await res.text();
      latencies.push(Date.now() - started);
    } catch {
      latencies.push(-1);
    }
  }
}

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;

async function main() {
  await cleanup();
  const url = await seed();
  console.log(`Board:    ${url}`);
  console.log(`Load:     ${VIEWERS} viewers, ${SECONDS}s, field of ${FIELD}\n`);

  // One warm request first. The very first render compiles the route in dev
  // and would otherwise be counted as though it were the steady state.
  const warm = await fetch(url);
  if (!warm.ok) throw new Error(`Board returned ${warm.status} — is the dev server up?`);
  await warm.text();

  const before = await transactions();
  const startedAt = Date.now();
  const latencies = [];
  await Promise.all(
    Array.from({ length: VIEWERS }, () => viewer(url, startedAt + SECONDS * 1000, latencies)),
  );
  const elapsed = (Date.now() - startedAt) / 1000;
  const after = await transactions();

  const ok = latencies.filter((n) => n >= 0);
  const failed = latencies.length - ok.length;
  const sorted = [...ok].sort((a, b) => a - b);
  // This run's own two counter reads are on the same connection, so they land
  // in the delta. Subtracting them keeps a low number honest.
  const queries = Math.max(0, after - before - 2);
  const perRequest = ok.length ? queries / ok.length : 0;

  console.log(`Requests:            ${ok.length}${failed ? `  (${failed} failed)` : ""}`);
  console.log(`Throughput:          ${(ok.length / elapsed).toFixed(1)} req/s`);
  console.log(`Latency p50 / p95:   ${pct(sorted, 0.5)}ms / ${pct(sorted, 0.95)}ms`);
  console.log(`Database queries:    ${queries}`);
  console.log(`\n  ==> ${perRequest.toFixed(2)} database queries per request\n`);

  /**
   * Two or three queries is the FLOOR, not a failure.
   *
   * The share token is a credential and the published flag is a permission, so
   * both are checked on every request and neither may come from a cache — see
   * services/live-board.ts. What should not survive is the board itself, which
   * measured at about twenty.
   */
  const CREDENTIAL_FLOOR = 4;
  const perThousand = ((perRequest * 300) / 30).toFixed(0);
  if (perRequest < CREDENTIAL_FLOOR) {
    console.log(
      `Cached: the crowd shares one computed board.\n` +
        `What remains is the per-request credential check, which is meant to be there.\n` +
        `300 spectators polling every 30s would be ~${perThousand} queries/second.`,
    );
  } else {
    console.log(
      `Uncached: every viewer commissions their own board.\n` +
        `At ${perRequest.toFixed(1)} queries each, 300 spectators polling every 30s is ` +
        `${perThousand} queries/second on one event.`,
    );
  }
}

try {
  await main();
} finally {
  await cleanup();
  await prisma.$disconnect();
}
