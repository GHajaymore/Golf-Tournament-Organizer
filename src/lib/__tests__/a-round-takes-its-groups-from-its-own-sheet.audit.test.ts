import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A ROUND'S GROUPS COME FROM THAT ROUND'S SHEET ONLY (Golf Pro ruling,
 * 2026-11-05).
 *
 * A cup: the Saturday medal has a published tee sheet that puts all four in
 * Group 1; the Sunday four-ball session has no sheet of its own yet. The
 * keeper (`keepingContextFor`) and the round-code list (`playGroups`) both fell
 * back to the tournament's first published sheet, so the four-ball's "group"
 * was the medal's Group 1 — its title, its tee time — instead of the match the
 * four-ball plays in. Never borrow: with no sheet of its own the four-ball's
 * group is the match, on the keeper and on the list alike (`roundTeeSheet`).
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

const { keeperFor, keepingContextFor, groupTitleFor } = await import("@/lib/services/group-keeping");
const { redeemRoundCode } = await import("@/app/actions/play");
const { groupKeyFor } = await import("@/lib/domain/group-keeping");
const { clearRateLimit } = await import("@/lib/rate-limit");
const { generateAccessCode } = await import("@/lib/codes");

const prisma = new PrismaClient();
const TAG = "zz-own-sheet";
const MEDAL_CODE = generateAccessCode();
const FOURBALL_CODE = generateAccessCode();
const SINGLES_CODE = generateAccessCode();
const ids = { event: "", medal: "", fourball: "", match: "" };
const p: Record<string, string> = {};

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} cup`,
      status: "live",
      shape: "single",
      format: "match",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${Date.now()}`,
      customPars: JSON.stringify(new Array(18).fill(4)),
      playerAccess: "code",
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
    },
  });
  ids.event = event.id;
  const [reds, golds] = await Promise.all(["Zz Reds", "Zz Golds"].map((name, position) => prisma.group.create({ data: { eventId: event.id, name, position } })));
  for (const [i, who] of ["a1", "a2", "b1", "b2"].entries()) {
    p[who] = (
      await prisma.player.create({
        data: {
          eventId: event.id,
          groupId: who.startsWith("a") ? reds.id : golds.id,
          name: `${TAG} ${who}`,
          email: `${TAG}.${who}@example.invalid`,
          seed: i + 1,
          status: "confirmed",
          handicap: 0,
        },
      })
    ).id;
  }
  // Saturday's medal: its own published sheet, all four in Group 1.
  ids.medal = (
    await prisma.stage.create({
      data: {
        eventId: event.id,
        position: 0,
        type: "Stroke Play Round",
        format: "Individual Stroke Play",
        holes: 18,
        scoringBasis: "gross",
        accessCode: MEDAL_CODE,
        scoreKeeping: "group",
        endCheck: "on",
        teeSheetPublished: true,
        teeSheet: JSON.stringify({
          savedAt: new Date(0).toISOString(),
          startType: "tee",
          groups: [{ name: "Group 1", startHole: 1, time: "8:00 AM", playerIds: [p.a1, p.b1, p.a2, p.b2] }],
        }),
      },
    })
  ).id;
  // Sunday's four-ball session: NO sheet of its own.
  ids.fourball = (
    await prisma.stage.create({
      data: {
        eventId: event.id,
        position: 1,
        type: "Team Session",
        format: "Four-Ball",
        holes: 18,
        scoringBasis: "gross",
        accessCode: FOURBALL_CODE,
        lineupPublished: true,
        matchKeptBy: "holes",
        scoreKeeping: "group",
        endCheck: "on",
      },
    })
  ).id;
  const carrier = await prisma.group.create({ data: { eventId: event.id, name: "Four-Ball — cup session", position: 2, stageId: ids.fourball, isCarrier: true } });
  const side = (name: string, flight: string, players: string[]) =>
    prisma.team.create({
      data: { eventId: event.id, stageId: ids.fourball, name, clubGroupId: flight, members: { create: players.map((playerId, position) => ({ playerId, position })) } },
    });
  const sa = await side("Zz Reds pair", reds.id, [p.a1, p.a2]);
  const sb = await side("Zz Golds pair", golds.id, [p.b1, p.b2]);
  ids.match = (
    await prisma.match.create({
      data: {
        eventId: event.id,
        stageId: ids.fourball,
        groupId: carrier.id,
        round: 1,
        playerAId: "",
        playerBId: "",
        teamAId: sa.id,
        teamBId: sb.id,
        holes: JSON.stringify(new Array(18).fill(null)),
      },
    })
  ).id;
  // A singles round with no sheet of its own: a1 v b1, two of the medal group's four.
  const singles = await prisma.stage.create({
    data: {
      eventId: event.id,
      position: 2,
      type: "Single Match Stage",
      format: "Match Play",
      holes: 18,
      scoringBasis: "gross",
      accessCode: SINGLES_CODE,
      matchKeptBy: "holes",
      scoreKeeping: "group",
      endCheck: "on",
    },
  });
  await prisma.match.create({
    data: { eventId: event.id, stageId: singles.id, groupId: reds.id, round: 1, playerAId: p.a1, playerBId: p.b1, holes: JSON.stringify(new Array(18).fill(null)) },
  });
});

afterAll(async () => {
  try {
    await clearRateLimit("round-code", MEDAL_CODE);
    await clearRateLimit("round-code", FOURBALL_CODE);
    await clearRateLimit("round-code", SINGLES_CODE);
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the four-ball with no sheet of its own: its group is the match", () => {
  it("the keeper reads no tee groups for it, and keys every player to the match", async () => {
    const { ctx } = await keepingContextFor(ids.event, ids.fourball);
    expect(ctx.teeGroups, "the four-ball borrowed the medal's sheet").toEqual([]);
    for (const who of ["a1", "a2", "b1", "b2"]) expect(groupKeyFor(p[who], ctx), who).toBe(`match:${ids.match}`);
  });

  it("who keeps it, and what it is called: the match, never the medal's Group 1", async () => {
    const k = await keeperFor(ids.event, ids.fourball, p.a1);
    expect(k?.groupKey).toBe(`match:${ids.match}`);
    expect([...(k?.members ?? [])].sort()).toEqual([p.a1, p.a2, p.b1, p.b2].sort());
    expect(await groupTitleFor(ids.event, ids.fourball, k!.groupKey)).toBe("Your match");
  });

  it("the round-code list agrees on the grouping: one match, named as a match, never the medal's Group 1", async () => {
    const res = await redeemRoundCode(FOURBALL_CODE);
    expect(res.ok, res.error).toBe(true);
    expect(res.groups?.map((g) => [g.title, g.oneMatch, g.players.length])).toEqual([["Match 1", true, 4]]);
  });
});

/**
 * THE TEE TIME, AND ONLY THE TIME, MAY BE BORROWED (Ajay, 2026-10-16; the
 * coordinator's correction, 2026-11-05). In Ajay's cup the back nine is the
 * same four, so a round with no sheet of its own shows the other round's tee
 * time — but only for a match whose players are EXACTLY that group's
 * (`samePlayers`), and never its grouping or its name.
 */
describe("a tee time borrowed only for the same players", () => {
  it("the cup's four-ball, the same four as the medal's Group 1, shows that tee time — under its own name", async () => {
    const res = await redeemRoundCode(FOURBALL_CODE);
    expect(res.groups?.map((g) => [g.title, g.tee])).toEqual([["Match 1", "8:00 AM off the 1st"]]);
  });

  it("a match whose players differ from every sheet group shows no tee time", async () => {
    const res = await redeemRoundCode(SINGLES_CODE);
    expect(res.ok, res.error).toBe(true);
    expect(res.groups?.map((g) => [g.title, g.tee])).toEqual([["Match 1", ""]]);
  });
});

describe("CONTROL: the medal still takes its groups from its own sheet", () => {
  it("keeps Group 1, by name", async () => {
    const k = await keeperFor(ids.event, ids.medal, p.a1);
    expect(k?.groupKey.startsWith("tee:")).toBe(true);
    expect(await groupTitleFor(ids.event, ids.medal, k!.groupKey)).toBe("Group 1");
    const res = await redeemRoundCode(MEDAL_CODE);
    expect(res.groups?.[0]?.title).toBe("Group 1");
  });
});
