import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";

/**
 * A LEAGUE WEEK IS DRAWN WHILE THE LEAGUE IS LIVE AND REFUSED ONLY ONCE IT IS COMPLETED (B115).
 *
 * `drawLeagueWeek` asked no lock. A live league is drawn every week, so the launch lock the sides
 * carry cannot apply; but a COMPLETED league's fixtures are the season's record (the table and the
 * play-offs are read off them), and drawing or redrawing one rewrites a finished season. The
 * refusal is the machine's, in its words, returned (not thrown), with the lock for the screen to
 * catch up with, and nothing written.
 *
 * THE CONTROL is the point of (b): the same press on the same launched league goes through, so the
 * refusal is completion and not launch, and not something that refuses every press.
 *
 *   npx vitest run --config vitest.audit.config.ts src/lib/__tests__/league-draw-is-refused-when-completed.audit.test.ts
 */

const prisma = new PrismaClient();
const TAG = "zz-league-completed";

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
const { lockRefusalWords } = await import("@/lib/domain/tournament-status");

const WHAT = "draw a league week";
let week = "";
let playoff = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const matchIds = async (stageId: string) =>
  (await prisma.match.findMany({ where: { eventId: session.eventId, stageId }, select: { id: true }, orderBy: { id: "asc" } })).map((m) => m.id);
const setStatus = (status: "live" | "completed") => prisma.event.update({ where: { id: session.eventId }, data: { status } });

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} league`,
      // LAUNCHED: the state a live league is in all season, and the one the lock must not refuse.
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
  const stage = async (position: number) =>
    (await prisma.stage.create({ data: { eventId: event.id, position, type: "Round Robin", format: "Four-Ball", holes: 18 }, select: { id: true } })).id;
  week = await stage(0);
  playoff = await stage(1);
  for (const stageId of [week, playoff]) {
    for (let c = 0; c < 2; c += 1) {
      for (let p = 0; p < 2; p += 1) {
        await prisma.team.create({
          data: { eventId: event.id, stageId, clubGroupId: clubs[c], name: `${TAG} ${stageId.slice(-4)} c${c} p${p}`, seed: p + 1 },
        });
      }
    }
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("drawing a league week once the tournament is completed", () => {
  it("CONTROL: on the launched, live league the same press goes through and writes the matches", async () => {
    expect(await matchIds(week)).toEqual([]);
    const res = await drawLeagueWeek(week);
    expect(res).toMatchObject({ ok: true, matches: 2 });
    expect(await matchIds(week)).toHaveLength(2);
  });

  it("completed: a REDRAW of the drawn, unscored week is refused in the machine's words, with its lock, and the same matches stand", async () => {
    const before = await matchIds(week);
    expect(before).toHaveLength(2);
    await setStatus("completed");
    try {
      const res = await drawLeagueWeek(week, true);
      expect(res).toMatchObject({ ok: false, lock: { scope: "sides", by: "completed", correctable: false } });
      if (res.ok) throw new Error("unreachable");
      // The words are the machine's (the one place), and say Reopen.
      expect(res.error).toBe(lockRefusalWords(res.lock!, WHAT, "organizer"));
      expect(res.error).toBe("Locked because the tournament is completed. Reopen it on the dashboard to draw a league week.");
      expect(await matchIds(week)).toEqual(before);
    } finally {
      await setStatus("live");
    }
  });

  it("completed: a FIRST draw is refused too, and nothing is written", async () => {
    // Clear the week on the launched league, then complete it.
    await prisma.match.deleteMany({ where: { eventId: session.eventId, stageId: week } });
    await setStatus("completed");
    try {
      const res = await drawLeagueWeek(week);
      expect(res).toMatchObject({ ok: false, lock: { by: "completed" } });
      expect(await prisma.match.count({ where: { eventId: session.eventId } })).toBe(0);
    } finally {
      await setStatus("live");
    }
  });

  it("completed: a play-off round is refused too (one action draws both)", async () => {
    await setStatus("completed");
    try {
      const res = await drawLeagueWeek(playoff);
      expect(res).toMatchObject({ ok: false, lock: { scope: "sides", by: "completed" } });
      expect(await matchIds(playoff)).toEqual([]);
    } finally {
      await setStatus("live");
    }
  });

  it("a week with scores stays refused by its own sentence on the live league (the lock is not what protects scores)", async () => {
    expect(await drawLeagueWeek(week)).toMatchObject({ ok: true });
    const card = await prisma.teamScorecard.create({
      data: {
        eventId: session.eventId,
        stageId: week,
        teamId: (await prisma.team.findFirstOrThrow({ where: { stageId: week }, select: { id: true } })).id,
        strokes: JSON.stringify([4, ...new Array(17).fill(null)]),
      },
    });
    try {
      const before = await matchIds(week);
      expect(await drawLeagueWeek(week, true)).toEqual({ ok: false, error: "Scores have already been recorded for this round." });
      expect(await matchIds(week)).toEqual(before);
    } finally {
      await prisma.teamScorecard.delete({ where: { id: card.id } });
    }
  });

  it("reopened (back to live), the same press draws again", async () => {
    await setStatus("completed");
    expect(await drawLeagueWeek(week, true)).toMatchObject({ ok: false, lock: { by: "completed" } });
    await setStatus("live");
    // The week is drawn: replacing asks first, and the yes goes through.
    expect(await drawLeagueWeek(week)).toMatchObject({ ok: false, needsConfirm: true });
    expect(await drawLeagueWeek(week, true)).toMatchObject({ ok: true, matches: 2 });
  });
});
