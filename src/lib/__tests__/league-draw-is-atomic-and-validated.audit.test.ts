import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

/**
 * A LEAGUE WEEK'S DRAW IS ONE TRANSACTION, RE-CHECKS COMPLETION INSIDE IT, AND VALIDATES ITS PAYLOAD (B124).
 *
 *  (1) ATOMIC: the redraw deleted the old matches and created the new ones one by one, so a reader mid-redraw saw a partial
 *      week and a failure part-way left one. A create that fails on the second match must leave the OLD week whole, and a
 *      reader on another connection, between the creates, must still see the old week whole.
 *  (2) RACE: the completion lock is read before the writes. The tournament is completed in the gap (deterministically: the
 *      step between the check and the write completes it); nothing is written and the refusal is the machine's words.
 *  (3) PAYLOAD: the types are erased. A malformed request is refused in words and writes nothing; a string "false" must not
 *      mean "replace the drawn week".
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/league-draw-is-atomic-and-validated.audit.test.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-league-atomic";

const session = {
  email: `${TAG}@example.invalid`,
  name: `${TAG} organizer`,
  eventId: "",
  role: "admin",
  viewRole: "admin",
};
vi.mock("@/lib/auth", () => ({ getSession: async () => session, setActiveEvent: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/services/board-refresh", () => ({ boardChanged: () => {} }));

const { drawLeagueWeek } = await import("@/app/actions/league");
const { prisma: appPrisma } = await import("@/lib/db");

let week = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const matchIds = async () =>
  (await prisma.match.findMany({ where: { eventId: session.eventId, stageId: week }, select: { id: true }, orderBy: { id: "asc" } })).map((m) => m.id);
const setStatus = (status: "live" | "completed") => prisma.event.update({ where: { id: session.eventId }, data: { status } });

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} league`,
      status: "live",
      launchedAt: new Date(),
      shape: "series",
      format: "stroke",
      formationRule: "balanced",
      leaguePoints: "match",
      leaguePlayoffClubs: 2,
      dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
      shareToken: randomBytes(12).toString("hex"),
      registrationToken: randomBytes(8).toString("hex"),
    },
    select: { id: true },
  });
  session.eventId = event.id;
  const clubs: string[] = [];
  for (let c = 0; c < 2; c += 1) {
    clubs.push((await prisma.group.create({ data: { eventId: event.id, name: `${TAG} club ${c}`, position: c }, select: { id: true } })).id);
  }
  week = (await prisma.stage.create({ data: { eventId: event.id, position: 0, type: "Round Robin", format: "Four-Ball", holes: 18 }, select: { id: true } })).id;
  for (let c = 0; c < 2; c += 1) {
    for (let p = 0; p < 2; p += 1) {
      await prisma.team.create({
        data: { eventId: event.id, stageId: week, clubGroupId: clubs[c], name: `${TAG} c${c} p${p}`, seed: p + 1 },
      });
    }
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the redraw is one transaction", () => {
  it("CONTROL: the first draw writes two matches", async () => {
    expect(await drawLeagueWeek(week)).toMatchObject({ ok: true, matches: 2 });
    expect(await matchIds()).toHaveLength(2);
  });

  it("a write that fails after the old matches are deleted leaves the OLD week whole, and a reader between the creates sees it whole", async () => {
    const before = await matchIds();
    expect(before).toHaveLength(2);
    const real = appPrisma.$transaction.bind(appPrisma);
    let seenMidway: string[] | null = null;
    vi.spyOn(appPrisma, "$transaction").mockImplementation(((fn: unknown, ...rest: unknown[]) => {
      if (typeof fn !== "function") return (real as (...a: unknown[]) => unknown)(fn, ...rest);
      return (real as (...a: unknown[]) => unknown)(async (tx: { match: { createMany: (a: unknown) => Promise<unknown> } }) => {
        const create = tx.match.createMany.bind(tx.match);
        let n = 0;
        tx.match.createMany = async (args: unknown) => {
          n += 1;
          if (n === 1) {
            // Mid-redraw (B134: the week is written by ONE createMany): the old matches are deleted INSIDE the transaction.
            // A reader outside it must still see the old week, whole.
            seenMidway = await matchIds();
            throw new Error("zz-injected failure on the write");
          }
          return create(args);
        };
        return (fn as (t: unknown) => Promise<unknown>)(tx);
      }, ...rest);
    }) as never);

    await expect(drawLeagueWeek(week, true)).rejects.toThrow("zz-injected failure");
    expect(seenMidway).toEqual(before);
    expect(await matchIds()).toEqual(before);
  });

  it("and without the failure the same redraw replaces the week", async () => {
    const before = await matchIds();
    expect(await drawLeagueWeek(week, true)).toMatchObject({ ok: true, matches: 2 });
    const after = await matchIds();
    expect(after).toHaveLength(2);
    expect(after.some((id) => before.includes(id))).toBe(false);
  });
});

describe("a completion that commits between the check and the write", () => {
  it("leaves the old week standing, and says why in the machine's words", async () => {
    const before = await matchIds();
    // The step between the lock check and the transaction: complete the tournament there, once.
    const realFind = appPrisma.scorecard.findMany.bind(appPrisma.scorecard);
    vi.spyOn(appPrisma.scorecard, "findMany").mockImplementation((async (args: never) => {
      await setStatus("completed");
      return realFind(args);
    }) as never);
    try {
      const res = await drawLeagueWeek(week, true);
      expect(res).toMatchObject({ ok: false, lock: { scope: "sides", by: "completed" } });
      if (res.ok) throw new Error("unreachable");
      expect(res.error).toBe("Locked because the tournament is completed. Reopen it on the dashboard to draw a league week.");
      expect(await matchIds()).toEqual(before);
    } finally {
      vi.restoreAllMocks();
      await setStatus("live");
    }
  });

  it("CONTROL: with no completion in the gap the same press draws", async () => {
    expect(await drawLeagueWeek(week, true)).toMatchObject({ ok: true });
  });

  it("a FIRST draw that loses the same race writes nothing", async () => {
    await prisma.match.deleteMany({ where: { eventId: session.eventId, stageId: week } });
    const realFind = appPrisma.match.findMany.bind(appPrisma.match);
    vi.spyOn(appPrisma.match, "findMany").mockImplementation((async (args: never) => {
      await setStatus("completed");
      return realFind(args);
    }) as never);
    try {
      expect(await drawLeagueWeek(week)).toMatchObject({ ok: false, lock: { by: "completed" } });
      expect(await matchIds()).toEqual([]);
    } finally {
      vi.restoreAllMocks();
      await setStatus("live");
    }
  });
});

describe("two first draws pressed together", () => {
  it("end with exactly one week's matches: the second counts what the first wrote, under the lock", async () => {
    await prisma.match.deleteMany({ where: { eventId: session.eventId, stageId: week } });
    const realFind = appPrisma.match.findMany.bind(appPrisma.match);
    let fired = false;
    let other: Awaited<ReturnType<typeof drawLeagueWeek>> | null = null;
    // Draw A has just read "no matches yet" (the read before its transaction). In that gap draw B runs to the end and commits,
    // and A is then handed the STALE empty answer: a fixed order, no timing.
    vi.spyOn(appPrisma.match, "findMany").mockImplementation((async (args: { where?: { stageId?: string }; select?: { id?: boolean } }) => {
      const rows = await realFind(args as never);
      if (!fired && args?.where?.stageId === week && args?.select?.id) {
        fired = true;
        other = await drawLeagueWeek(week);
        return [] as never;
      }
      return rows;
    }) as never);
    try {
      const first = await drawLeagueWeek(week);
      expect(fired).toBe(true);
      expect(other).toMatchObject({ ok: true, matches: 2 });
      // A saw the week B drew and asked, rather than writing a second one beside it.
      expect(first).toMatchObject({ ok: false, needsConfirm: true });
      expect(await matchIds()).toHaveLength(2);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("a malformed payload is refused and writes nothing", () => {
  it("each bad shape is refused in words, with the week untouched", async () => {
    expect(await drawLeagueWeek(week, true)).toMatchObject({ ok: true });
    const before = await matchIds();
    const bad: unknown[][] = [
      [undefined],
      [null],
      [""],
      ["   "],
      [{ $ne: "x" }],
      [["a"]],
      [42],
      ["x".repeat(200)],
      [week, "false"],
      [week, 1],
      [week, null],
      [week, true, "yes"],
      [week, true, 0],
    ];
    for (const args of bad) {
      const res = await (drawLeagueWeek as (...a: unknown[]) => ReturnType<typeof drawLeagueWeek>)(...args);
      expect(res, JSON.stringify(args)).toMatchObject({ ok: false });
      if (res.ok) throw new Error("unreachable");
      expect(res.error.length).toBeGreaterThan(10);
      expect(res.needsConfirm).toBeUndefined();
      expect(await matchIds(), JSON.stringify(args)).toEqual(before);
    }
  });

  it("the string 'false' does not mean replace: the drawn week asks first and stands", async () => {
    const before = await matchIds();
    const res = await (drawLeagueWeek as (...a: unknown[]) => ReturnType<typeof drawLeagueWeek>)(week, "false");
    expect(res).toMatchObject({ ok: false });
    expect(await matchIds()).toEqual(before);
  });

  it("CONTROL: a well-formed redraw (and an omitted flag) still goes through", async () => {
    expect(await drawLeagueWeek(week)).toMatchObject({ ok: false, needsConfirm: true });
    expect(await drawLeagueWeek(week, true, false)).toMatchObject({ ok: true, matches: 2 });
  });
});
