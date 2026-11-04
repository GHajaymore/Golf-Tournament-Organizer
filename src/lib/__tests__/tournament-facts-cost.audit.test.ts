import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * WHAT THE STATE MACHINE'S ONE READ COSTS (proposal 3 Nov, PR 2; panel 8.5).
 *
 * The Engineer's condition on `tournamentFactsFor`: "The secretary's home
 * calls it per running tournament. Measure on the seeded club in PR 2. If the
 * home exceeds today's time by more than 20%, use the grouped query." This file
 * is that measurement, made against the development database rather than a
 * browser, and it is kept so the next change to the read is measured the same
 * way.
 *
 * TWO MEASURES, BECAUSE TIME ALONE IS A CLAIM NOBODY CAN CHECK. Milliseconds
 * move with the machine; the number of queries a read sends does not. So the
 * queries are COUNTED (every statement the client sends, through Prisma's own
 * `query` event) and asserted; the milliseconds are printed for the pull
 * request and never asserted, so a slow runner cannot turn this red.
 *
 * THE REQUEST CACHE IS EMULATED. In the app `loadEventState` is React's
 * `cache()`: one read per request however many callers ask. Outside a server
 * component render React's `cache` is a pass-through, so a test would charge
 * the facts read for a state the dashboard or the home has already built.
 * `react` is mocked here with a memo that is emptied at the start of every
 * measured "request" — the same scope, the same sharing.
 *
 * Fixtures: a throwaway club `zz-facts-cost` (a live medal, a live knockout, a
 * live cup), invented names, `@example.invalid`, removed before and after. The
 * home is measured on the SEEDED club when the development database has one
 * (the largest club with an owner); it is only read, never written.
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/tournament-facts-cost.audit.test.ts
 */

/* ------------------------------------------------- counting, and the request */

let queries = 0;
/** Each statement of the run in progress, its parameters blanked, so two runs can be compared. */
let statements: string[] = [];
/** The marked statement `settle()` sends (below), and how many of its reports have arrived. */
const SETTLE_MARK = "zz-facts-cost-settle";
let settled = 0;
const counted = new PrismaClient({ log: [{ emit: "event", level: "query" }] });
counted.$on("query", (e) => {
  if (e.query.includes(SETTLE_MARK)) {
    settled += 1;
    return;
  }
  queries += 1;
  statements.push(e.query.replace(/\$\d+/g, "?"));
});

/**
 * WAIT FOR THE LAST QUERY'S REPORT, NOT FOR THE CLOCK (2026-11-04).
 *
 * Prisma reports a statement to `$on("query")` a moment AFTER the statement's
 * result has come back. A read's last query can therefore be reported after the
 * read has returned — on a slow runner it was, and was counted in the NEXT run:
 * CI saw 16, 18, 17, 17, 17 (the round-card check's event read, 0 then 2 then 1)
 * and 33, 35, 34, 34, 34 (the knockout reports' read) where this machine sees 17
 * and 34 every time. The total was right; the run it was charged to was not.
 *
 * So a run is bounded by one marked statement before it and one after, and is
 * counted only once the closing one's report has arrived. Reports arrive in the
 * order the statements ran, so every query of the run — and none of anybody
 * else's — has been counted by then. No sleep, no guess. Proved by delaying every
 * report 20 ms in order (as CI does, more): without the marks the counts read
 * 30, 23, 32, 34, 34; with the closing mark only, 67, 34, 34, 34, 34 (the first
 * run took the reports of what came before it); with both, steady.
 */
async function settle(): Promise<void> {
  const want = settled + 1;
  await counted.$queryRawUnsafe(`SELECT '${SETTLE_MARK}' AS settle`);
  const until = Date.now() + 10_000;
  while (settled < want) {
    if (Date.now() > until) throw new Error("the settle statement was never reported: the count cannot be trusted");
    await new Promise((r) => setTimeout(r, 1));
  }
}
// `src/lib/db.ts` takes the client already on `globalThis`, as it does across hot reloads.
(globalThis as unknown as { prisma?: PrismaClient }).prisma = counted;

/** One request's worth of `cache()` — emptied by `request()`. */
let generation = 0;
vi.mock("react", async (importOriginal) => {
  const real = await importOriginal<typeof import("react")>();
  const cache = <A extends unknown[], R>(fn: (...args: A) => R) => {
    let seen = -1;
    const memo = new Map<string, R>();
    return (...args: A): R => {
      if (seen !== generation) {
        memo.clear();
        seen = generation;
      }
      const key = JSON.stringify(args);
      if (!memo.has(key)) memo.set(key, fn(...args));
      return memo.get(key) as R;
    };
  };
  return { ...real, cache, default: { ...(real as unknown as { default: object }).default, cache } };
});
vi.mock("@/lib/auth", () => ({ getSession: async () => null }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { tournamentFactsFor, tournamentFactsForMany } = await import("@/lib/services/tournament-facts");
const { loadEventState } = await import("@/lib/services/tournament");
const { setupFlowFor, launchCheckFor } = await import("@/lib/services/setup-flow");
const { secretaryHomeFor } = await import("@/lib/services/whats-next");
const { tournamentStatus } = await import("@/lib/domain/tournament-status");
const { isFinished } = await import("@/lib/domain/lifecycle-state");

const prisma = new PrismaClient();
const TAG = "zz-facts-cost";
const TODAY = "2026-11-03";
const ids = { medal: "", knockout: "", cup: "" };

interface Cost {
  ms: number;
  queries: number;
}

/** The statements whose count differs from the first run's, with both counts; "" when none do. */
function differences(sent: string[][]): string {
  const tally = (run: string[]) => run.reduce((m, q) => m.set(q, (m.get(q) ?? 0) + 1), new Map<string, number>());
  const first = tally(sent[0] ?? []);
  const out = new Set<string>();
  for (const run of sent.slice(1)) {
    const t = tally(run);
    for (const q of new Set([...first.keys(), ...t.keys()])) {
      if (first.get(q) !== t.get(q)) out.add(`\n  ${first.get(q) ?? 0} then ${t.get(q) ?? 0}: ${q.slice(0, 200)}`);
    }
  }
  return [...out].join("");
}

/** One request: an empty cache, the reads, the median of `runs` timings and the (constant) query count. */
async function request(fn: () => Promise<unknown>, runs = 5): Promise<Cost> {
  const times: number[] = [];
  const counts = new Set<number>();
  const sent: string[][] = [];
  for (let i = 0; i < runs; i += 1) {
    generation += 1;
    // Settled at both ends: before, so nothing sent earlier is charged to this run; after (below),
    // so nothing of this run is charged to the next.
    await settle();
    const q0 = queries;
    statements = [];
    const t0 = performance.now();
    await fn();
    times.push(performance.now() - t0);
    await settle();
    counts.add(queries - q0);
    sent.push(statements);
  }
  times.sort((a, b) => a - b);
  // A read whose query count changes between identical runs is not measuring what it says.
  // Said with what changed, statement by statement — which is how the late report above was found.
  expect(counts.size, `the same read sent a different number of queries on two runs: ${sent.map((s) => s.length).join(", ")}${differences(sent)}`).toBe(1);
  return { ms: Math.round(times[Math.floor(runs / 2)] * 10) / 10, queries: [...counts][0] };
}

const report: string[] = [];
const line = (what: string, c: Cost) => report.push(`${what.padEnd(58)} ${String(c.ms).padStart(8)} ms ${String(c.queries).padStart(5)} queries`);

/* ------------------------------------------------------------------ fixtures */

async function clean() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function event(orgId: string, name: string, data: Record<string, unknown> = {}) {
  return (
    await prisma.event.create({
      data: {
        name: `${TAG} ${name}`,
        organizationId: orgId,
        status: "live",
        dates: "14 Nov 2026",
        startOn: "2026-11-14",
        course: "Invented Links",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-${name}-${process.pid}`,
        customPars: JSON.stringify(Array(18).fill(4)),
        customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
        ...data,
      },
      select: { id: true },
    })
  ).id;
}

async function field(eventId: string, n: number, extra: (i: number) => Record<string, unknown> = () => ({})): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `Invented Golfer ${i + 1}`,
        email: `${TAG}-${eventId.slice(-6)}-${i + 1}@example.invalid`,
        seed: i + 1,
        status: "confirmed",
        handicap: 8 + (i % 10),
        ...extra(i),
      },
      select: { id: true },
    });
    out.push(p.id);
  }
  return out;
}

const card = (over: number) => JSON.stringify(Array.from({ length: 18 }, (_, h) => 4 + (h < over ? 1 : 0)));
const won = (w: "A" | "B") => JSON.stringify([...Array(3).fill(w), ...Array(13).fill("H"), null, null]);

beforeAll(async () => {
  await clean();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });

  // A live one-round medal, 24 players, every card in. (One round: two stroke
  // rounds read as a league family — see the report on PR 2.)
  ids.medal = await event(org.id, "medal");
  const r1 = await prisma.stage.create({
    data: { eventId: ids.medal, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, playedOn: "2026-11-14" },
    select: { id: true },
  });
  const medalists = await field(ids.medal, 24);
  for (const [i, id] of medalists.entries()) {
    await prisma.scorecard.create({ data: { eventId: ids.medal, stageId: r1.id, playerId: id, strokes: card(i % 7), status: "approved" } });
  }

  // A live straight knockout of sixteen, three ties decided.
  ids.knockout = await event(org.id, "knockout", { bracketMode: "single", format: "match" });
  await prisma.stage.create({ data: { eventId: ids.knockout, position: 0, type: "Bracket Stage", format: "Match Play", holes: 18 } });
  const ko = await field(ids.knockout, 16);
  for (const [k, w] of [
    ["winners-0-0", ko[0]],
    ["winners-0-1", ko[7]],
    ["winners-0-2", ko[4]],
  ] as const) {
    await prisma.bracketWinner.create({ data: { eventId: ids.knockout, key: k, winnerId: w, result: "3&2" } });
  }

  // A live cup: two teams of eight, one singles session, four matches played.
  ids.cup = await event(org.id, "cup", { format: "match" });
  const oak = await prisma.group.create({ data: { eventId: ids.cup, name: "Invented Oaks", position: 0 }, select: { id: true } });
  const elm = await prisma.group.create({ data: { eventId: ids.cup, name: "Invented Elms", position: 1 }, select: { id: true } });
  const singles = await prisma.stage.create({
    data: { eventId: ids.cup, position: 0, type: "Team Session", format: "Match Play", holes: 18, description: "Singles", lineupPublished: true },
    select: { id: true },
  });
  const cupField = await field(ids.cup, 16, (i) => ({ groupId: i < 8 ? oak.id : elm.id }));
  for (let i = 0; i < 8; i += 1) {
    await prisma.match.create({
      data: { eventId: ids.cup, stageId: singles.id, groupId: oak.id, round: i + 1, playerAId: cupField[i], playerBId: cupField[i + 8], holes: i < 4 ? won(i % 2 ? "B" : "A") : "[]" },
    });
  }
}, 180_000);

afterAll(async () => {
  try {
    await clean();
  } finally {
    console.log(`\nTHE FACTS READ, MEASURED (${TODAY}; median of 5, ms move with the machine, queries do not)\n${report.join("\n")}\n`);
    await prisma.$disconnect();
    await counted.$disconnect();
  }
});

/* ------------------------------------------------------------- measurements */

describe("the cost of the one read, per family", () => {
  for (const which of ["medal", "knockout", "cup"] as const) {
    it(`${which}: the facts read beside the readers it will replace`, async () => {
      const facts = await request(() => tournamentFactsFor(ids[which], TODAY));
      const state = await request(() => loadEventState(ids[which]));
      const flow = await request(() => setupFlowFor(ids[which]));
      const launch = await request(() => launchCheckFor(ids[which]));
      // The dashboard's request: the state it always builds, then the facts beside it.
      const dashboard = await request(async () => {
        await loadEventState(ids[which]);
        await tournamentFactsFor(ids[which], TODAY);
      });
      line(`${which}: tournamentFactsFor, alone`, facts);
      line(`${which}: loadEventState, alone`, state);
      line(`${which}: setupFlowFor`, flow);
      line(`${which}: launchCheckFor`, launch);
      line(`${which}: loadEventState then the facts (one request)`, dashboard);
      line(`${which}:   so the facts add, on the dashboard`, { ms: Math.round((dashboard.ms - state.ms) * 10) / 10, queries: dashboard.queries - state.queries });
      // A set-up dashboard asks the rail AND the gate in one request: one read since PR 2.
      const both = await request(async () => {
        await setupFlowFor(ids[which]);
        await launchCheckFor(ids[which]);
      });
      line(`${which}: setupFlowFor + launchCheckFor (one request)`, both);
      expect(both.queries, "the rail and the gate share the request's one read").toBe(flow.queries);
      expect(facts.queries, "a read that sends no query read nothing").toBeGreaterThan(0);
      // The machine reads it as what it is: live, and its family.
      const st = tournamentStatus((await tournamentFactsFor(ids[which], TODAY))!);
      expect(st.family).toBe(which === "medal" ? "stroke" : which === "knockout" ? "knockout" : "teamCup");
      expect(st.step).toBe("live");
    });
  }
});

describe("the secretary's home on the seeded club", () => {
  it("today's home, and the home with the facts read once per running tournament", async (ctx) => {
    // The club with the most tournaments that has an owner — the seeded demo club on a development database.
    const owners = await prisma.organizationMember.findMany({
      where: { role: "owner" },
      select: { organizationId: true, user: { select: { id: true, email: true, name: true } } },
    });
    const sizes = await prisma.event.groupBy({ by: ["organizationId"], _count: true, where: { organizationId: { in: owners.map((o) => o.organizationId) } } });
    sizes.sort((a, b) => b._count - a._count);
    const club = owners.find((o) => o.organizationId === sizes[0]?.organizationId);
    if (!club || sizes[0]._count < 5) {
      report.push("home: no seeded club on this database (an owner with five tournaments or more) — not measured");
      ctx.skip();
      return;
    }
    const running = await prisma.event.findMany({
      where: { organizationId: club.organizationId, shape: { not: "match" }, expiresAt: null, archivedAt: null },
      select: { id: true, status: true },
    });
    const open = running.filter((e) => !isFinished(e.status));
    expect(open.length, "a club with nothing running measures nothing").toBeGreaterThan(0);
    const session = {
      userId: club.user.id,
      accountId: "",
      eventId: open[0].id,
      name: club.user.name ?? "",
      email: club.user.email,
      role: "admin" as const,
      viewRole: "admin" as const,
    };

    const home = await request(() => secretaryHomeFor(session), 3);
    const withFacts = await request(async () => {
      await secretaryHomeFor(session);
      for (const e of open) await tournamentFactsFor(e.id, TODAY);
    }, 3);
    const factsOnly = await request(async () => {
      for (const e of open) await tournamentFactsFor(e.id, TODAY);
    }, 3);
    // The grouped read (PR 2): the whole club's facts in one batch.
    const grouped = await request(async () => {
      await secretaryHomeFor(session);
      await tournamentFactsForMany(open.map((e) => e.id), TODAY);
    }, 3);
    const n = open.length;
    report.push(`home: the seeded club, ${running.length} tournaments, ${n} running`);
    line(`home: today (secretaryHomeFor)`, home);
    line(`home: today + tournamentFactsFor × ${n} (one request)`, withFacts);
    line(`home: tournamentFactsFor × ${n}, with no home beside it`, factsOnly);
    line(`home: today + tournamentFactsForMany(${n}) (one request)`, grouped);
    report.push(`home: one read per tournament takes ${Math.round((withFacts.ms / home.ms) * 100)}% of today's time; the grouped read ${Math.round((grouped.ms / home.ms) * 100)}% (the panel's line is 120%)`);
    expect(withFacts.queries).toBeGreaterThan(home.queries);
    // The grouped read's own batch does not grow with the club: a fixed set of
    // queries plus the card check per tournament (`roundsMissingCards`, four
    // reads), not the batch per tournament.
    expect(grouped.queries - home.queries).toBeLessThan(withFacts.queries - home.queries);
  });
});
