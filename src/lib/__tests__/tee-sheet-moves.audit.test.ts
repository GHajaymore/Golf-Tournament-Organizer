import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * MOVES ON A SAVED TEE SHEET, AGAINST REAL ROWS — `moveInTeeSheet`.
 *
 * A stroke medal, live, at a club on UTC, Round 1 dated TOMORROW, sheet
 * PUBLISHED: Group 1 four (ann bob cat dan) at 8:00 AM, Group 2 three
 * (eve fay gus) at 8:10 AM, Group 3 two (hal ivy) at 8:20 AM. Through the real
 * action and real sessions:
 *
 *   an assistant moves a player and a group   → the stored sheet is the one the rules give,
 *                                               the times stayed with the slots, still published
 *   a full group, a fifth                      → refused, in words, nothing written
 *   a group emptied by moving its players out   → allowed: removed on Save, the others keep their times;
 *                                                 a later group moved up into the freed slot takes its time
 *   a sheet saved by somebody else since       → refused (compare-and-set), nothing written
 *   a card in Group 3                          → nobody moves in or out of it, and it stays
 *   the round's day passes (club's clock)      → every group has teed off: refused
 *   a stranger's id, a side move on a stroke round, a malformed move → refused
 *   a player's own session                     → not staff: refused before anything is read
 *   a league week: a player marked OUT but still stored in Group 2 leaves a place (the move
 *   is accepted); the same player marked IN → "Group 2 is full" (the screen counts the same
 *   field: `sheetFieldFor`)
 *   what may move, by round: individual stroke (players), four-ball pairs (whole sides),
 *   singles match (whole groups only) — the server answers as `moveModeOf` says
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => {
      const value = jar.get(name);
      return value === undefined ? undefined : { name, value };
    },
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

import { createSession, setActiveEvent } from "@/lib/auth";
import { moveInTeeSheet } from "@/app/actions/tee-sheet";
import { GROUPS_NOTE, SIDES_NOTE } from "@/lib/domain/tee-sheet-moves";
import { clubToday } from "@/lib/domain/club-clock";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-SHEETMOVES";
const ZONE = "UTC";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();
let orgId = "";
let assistantId = "";
let playerUserId = "";
let eventId = "";
let stageId = "";
const ids: Record<string, string> = {};

const clubDayFrom = (n: number) => {
  const [y, m, d] = clubToday(ZONE).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
};

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: orgId || "none" } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function as(userId: string, onEvent = eventId) {
  jar.clear();
  await createSession(userId);
  await setActiveEvent(onEvent);
}

const stored = async () => prisma.stage.findUniqueOrThrow({ where: { id: stageId }, select: { teeSheet: true, teeSheetPublished: true } });
const groups = async () => JSON.parse((await stored()).teeSheet).groups as Array<{ name: string; time: string; playerIds: string[] }>;
const SAVED = "2026-11-28T18:00:00.000Z";

async function reset(playedOn = clubDayFrom(1)) {
  await prisma.scorecard.deleteMany({ where: { stageId } });
  await prisma.stage.update({
    where: { id: stageId },
    data: {
      playedOn,
      teeSheetPublished: true,
      teeSheet: JSON.stringify({
        savedAt: SAVED,
        startType: "tee",
        groups: [
          { name: "Group 1", startHole: 1, time: "8:00 AM", playerIds: [ids.ann, ids.bob, ids.cat, ids.dan] },
          { name: "Group 2", startHole: 1, time: "8:10 AM", playerIds: [ids.eve, ids.fay, ids.gus] },
          { name: "Group 3", startHole: 1, time: "8:20 AM", playerIds: [ids.hal, ids.ivy] },
        ],
      }),
    },
  });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club", timeZone: ZONE } });
  orgId = org.id;
  assistantId = (await prisma.user.create({ data: { email: at("assistant"), name: `${TAG} Assistant`, password: "x", emailVerifiedAt: new Date() } })).id;
  playerUserId = (await prisma.user.create({ data: { email: at("member"), name: `${TAG} Member`, password: "x", emailVerifiedAt: new Date() } })).id;
  const e = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} medal`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${Date.now()}`,
      status: "live",
      configUnlocked: false,
    },
  });
  eventId = e.id;
  stageId = (await prisma.stage.create({ data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, playedOn: clubDayFrom(1) } })).id;
  await prisma.account.create({ data: { eventId, email: at("assistant"), name: `${TAG} Assistant`, role: "assistant" } });
  await prisma.account.create({ data: { eventId, email: at("member"), name: `${TAG} Member`, role: "player" } });
  for (const [i, key] of ["ann", "bob", "cat", "dan", "eve", "fay", "gus", "hal", "ivy"].entries()) {
    ids[key] = (await prisma.player.create({ data: { eventId, name: `${TAG} ${key}`, email: at(key), handicap: 10 + i, seed: i + 1, status: "confirmed" } })).id;
  }
  await reset();
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("moveInTeeSheet", () => {
  it("an assistant moves a player and a group; the times stay with the slots; the sheet stays published", async () => {
    await reset();
    await as(assistantId);
    // dan to Group 3 (room: two), then Group 3 to the front: slots slide down.
    const res = await moveInTeeSheet(stageId, SAVED, [
      { kind: "player", playerId: ids.dan, toGroup: 2 },
      { kind: "group", from: 2, to: 0 },
    ]);
    expect(res.ok).toBe(true);
    const g = await groups();
    expect(g.map((x) => x.playerIds)).toEqual([[ids.hal, ids.ivy, ids.dan], [ids.ann, ids.bob, ids.cat], [ids.eve, ids.fay, ids.gus]]);
    expect(g.map((x) => x.time)).toEqual(["8:00 AM", "8:10 AM", "8:20 AM"]);
    expect((await stored()).teeSheetPublished).toBe(true);
  });

  it("a fifth player and a player into a full group are refused; nothing is written", async () => {
    await reset();
    await as(assistantId);
    const before = (await stored()).teeSheet;
    expect(await moveInTeeSheet(stageId, SAVED, [{ kind: "player", playerId: ids.eve, toGroup: 0 }])).toEqual({ ok: false, error: "Group 1 is full. Choose a group with room." });
    // Two moves in one Save: the first fits Group 2 (three, so four), the second would make it five — the whole Save is refused.
    expect(
      await moveInTeeSheet(stageId, SAVED, [
        { kind: "player", playerId: ids.hal, toGroup: 1 },
        { kind: "player", playerId: ids.ivy, toGroup: 1 },
      ]),
    ).toEqual({ ok: false, error: "Group 2 is full. Choose a group with room." });
    expect((await stored()).teeSheet, "a refused Save wrote").toBe(before);
  });

  async function fourGroups() {
    await reset();
    await prisma.stage.update({
      where: { id: stageId },
      data: {
        teeSheet: JSON.stringify({
          savedAt: SAVED,
          startType: "tee",
          groups: [
            { name: "Group 1", startHole: 1, time: "8:00 AM", playerIds: [ids.ann, ids.bob, ids.cat] },
            { name: "Group 2", startHole: 1, time: "8:10 AM", playerIds: [ids.dan, ids.eve] },
            { name: "Group 3", startHole: 1, time: "8:20 AM", playerIds: [ids.fay, ids.gus, ids.hal] },
            { name: "Group 4", startHole: 1, time: "8:30 AM", playerIds: [ids.ivy] },
          ],
        }),
      },
    });
  }

  it("a group emptied by moving its two players out is removed on Save; the others keep their own times", async () => {
    await fourGroups();
    await as(assistantId);
    const res = await moveInTeeSheet(stageId, SAVED, [
      { kind: "player", playerId: ids.dan, toGroup: 0 },
      { kind: "player", playerId: ids.eve, toGroup: 2 },
    ]);
    expect(res).toEqual({ ok: true, said: "The sheet is saved. Group 2 removed (no players left)." });
    const g = await groups();
    expect(g.map((x) => x.playerIds)).toEqual([[ids.ann, ids.bob, ids.cat, ids.dan], [ids.fay, ids.gus, ids.hal, ids.eve], [ids.ivy]]);
    expect(g.map((x) => x.time)).toEqual(["8:00 AM", "8:20 AM", "8:30 AM"]);
    expect(g.map((x) => x.name)).toEqual(["Group 1", "Group 2", "Group 3"]);
    expect((await stored()).teeSheetPublished).toBe(true);
  });

  it("then a later group moved up into the freed slot takes that slot's time; the slot it left goes", async () => {
    await fourGroups();
    await as(assistantId);
    const res = await moveInTeeSheet(stageId, SAVED, [
      { kind: "player", playerId: ids.dan, toGroup: 0 },
      { kind: "player", playerId: ids.eve, toGroup: 2 },
      { kind: "group", from: 3, to: 1 },
    ]);
    expect(res.ok).toBe(true);
    const g = await groups();
    expect(g.map((x) => x.playerIds)).toEqual([[ids.ann, ids.bob, ids.cat, ids.dan], [ids.ivy], [ids.fay, ids.gus, ids.hal, ids.eve]]);
    expect(g.map((x) => x.time)).toEqual(["8:00 AM", "8:10 AM", "8:20 AM"]);
  });

  it("a locked group is never emptied: its only player cannot leave it", async () => {
    await fourGroups();
    await prisma.scorecard.create({ data: { eventId, stageId, playerId: ids.ivy, strokes: JSON.stringify(Array(18).fill(5)), status: "entered" } });
    await as(assistantId);
    expect(await moveInTeeSheet(stageId, SAVED, [{ kind: "player", playerId: ids.ivy, toGroup: 1 }])).toEqual({ ok: false, error: "Group 4 has a card in. Nobody moves out of it." });
  });

  it("a sheet saved by somebody else since is refused in a sentence, nothing written", async () => {
    await reset();
    await as(assistantId);
    const before = (await stored()).teeSheet;
    expect(await moveInTeeSheet(stageId, "2026-11-28T17:00:00.000Z", [{ kind: "group", from: 2, to: 0 }])).toEqual({
      ok: false,
      error: "The sheet changed while you were choosing. Look again and choose.",
    });
    expect((await stored()).teeSheet).toBe(before);
  });

  it("a group with a card in is locked: nobody moves out of or into it, and its slot stays", async () => {
    await reset();
    await prisma.scorecard.create({ data: { eventId, stageId, playerId: ids.hal, strokes: JSON.stringify(Array(18).fill(5)), status: "entered" } });
    await as(assistantId);
    expect(await moveInTeeSheet(stageId, SAVED, [{ kind: "player", playerId: ids.hal, toGroup: 1 }])).toEqual({ ok: false, error: "Group 3 has a card in. Nobody moves out of it." });
    expect(await moveInTeeSheet(stageId, SAVED, [{ kind: "player", playerId: ids.eve, toGroup: 2 }])).toEqual({ ok: false, error: "Group 3 has a card in. Nobody moves into it." });
    expect(await moveInTeeSheet(stageId, SAVED, [{ kind: "group", from: 2, to: 0 }])).toEqual({ ok: false, error: "Group 3 has a card in. It stays where it is." });
    // The unlocked groups can still change places around it.
    expect((await moveInTeeSheet(stageId, SAVED, [{ kind: "group", from: 1, to: 0 }])).ok).toBe(true);
  });

  it("once the round's day has passed at the club every group has teed off", async () => {
    await reset(clubDayFrom(-1));
    await as(assistantId);
    expect(await moveInTeeSheet(stageId, SAVED, [{ kind: "group", from: 1, to: 0 }])).toEqual({ ok: false, error: "Group 2 teed off at 8:10 AM. It stays where it is." });
  });

  it("a stranger's id, a side move in a stroke round, and a malformed move are refused", async () => {
    await reset();
    await as(assistantId);
    expect((await moveInTeeSheet(stageId, SAVED, [{ kind: "player", playerId: "nobody", toGroup: 1 }])).ok).toBe(false);
    expect(await moveInTeeSheet(stageId, SAVED, [{ kind: "side", playerIds: [ids.eve, ids.fay], toGroup: 2 }])).toEqual({
      ok: false,
      error: "This round is played one by one. Move a player, not a side.",
    });
    expect(await moveInTeeSheet(stageId, SAVED, [{ kind: "player", playerId: ids.eve, toGroup: "2" } as never])).toEqual({ ok: false, error: "That isn't a change to a tee sheet." });
    expect(await moveInTeeSheet(stageId, SAVED, [])).toEqual({ ok: false, error: "There is nothing to save." });
    expect(await moveInTeeSheet("", SAVED, [{ kind: "group", from: 1, to: 0 }])).toEqual({ ok: false, error: "Look at the sheet again and choose." });
  });

  it("a player's own session is not staff: refused before anything is read", async () => {
    await reset();
    await as(playerUserId);
    await expect(moveInTeeSheet(stageId, SAVED, [{ kind: "group", from: 1, to: 0 }])).rejects.toThrow(/Organizer access required/);
  });
});

describe("the field a group's room is counted against (a league week)", () => {
  let leagueEvent = "";
  let weekStage = "";
  const lid: Record<string, string> = {};
  const SAVED_W = "2026-11-29T18:00:00.000Z";

  beforeAll(async () => {
    const e = await prisma.event.create({
      data: {
        organizationId: orgId,
        name: `${TAG} league`,
        dates: "",
        course: "",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-league-${Date.now()}`,
        status: "live",
        configUnlocked: false,
        attendanceMode: "opt-out",
      },
    });
    leagueEvent = e.id;
    weekStage = (await prisma.stage.create({ data: { eventId: leagueEvent, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, playedOn: clubDayFrom(1) } })).id;
    await prisma.account.create({ data: { eventId: leagueEvent, email: at("assistant"), name: `${TAG} Assistant`, role: "assistant" } });
    for (const [i, key] of ["x", "p1", "p2", "p3", "y", "z"].entries()) {
      lid[key] = (await prisma.player.create({ data: { eventId: leagueEvent, name: `${TAG} L${key}`, email: at(`l${key}`), handicap: 10 + i, seed: i + 1, status: "confirmed" } })).id;
    }
    await prisma.stage.update({
      where: { id: weekStage },
      data: {
        teeSheetPublished: true,
        teeSheet: JSON.stringify({
          savedAt: SAVED_W,
          startType: "tee",
          groups: [
            { name: "Group 1", startHole: 1, time: "6:30 PM", playerIds: [lid.y, lid.z] },
            { name: "Group 2", startHole: 1, time: "6:40 PM", playerIds: [lid.x, lid.p1, lid.p2, lid.p3] },
          ],
        }),
      },
    });
  });

  it("X marked out, still stored in Group 2: Group 2 has three of the field, so Y may join", async () => {
    await prisma.roundAttendance.upsert({
      where: { stageId_playerId: { stageId: weekStage, playerId: lid.x } },
      update: { status: "out" },
      create: { eventId: leagueEvent, stageId: weekStage, playerId: lid.x, status: "out", decidedBy: "test" },
    });
    await as(assistantId, leagueEvent);
    const res = await moveInTeeSheet(weekStage, SAVED_W, [{ kind: "player", playerId: lid.y, toGroup: 1 }]);
    expect(res).toMatchObject({ ok: true });
    const g = JSON.parse((await prisma.stage.findUniqueOrThrow({ where: { id: weekStage } })).teeSheet).groups as Array<{ playerIds: string[] }>;
    expect(g[1].playerIds).toEqual([lid.x, lid.p1, lid.p2, lid.p3, lid.y]);
  });

  it("the same with X marked in: four in the field, Group 2 is full", async () => {
    await prisma.roundAttendance.update({ where: { stageId_playerId: { stageId: weekStage, playerId: lid.x } }, data: { status: "in" } });
    await prisma.stage.update({
      where: { id: weekStage },
      data: {
        teeSheet: JSON.stringify({
          savedAt: SAVED_W,
          startType: "tee",
          groups: [
            { name: "Group 1", startHole: 1, time: "6:30 PM", playerIds: [lid.y, lid.z] },
            { name: "Group 2", startHole: 1, time: "6:40 PM", playerIds: [lid.x, lid.p1, lid.p2, lid.p3] },
          ],
        }),
      },
    });
    await as(assistantId, leagueEvent);
    expect(await moveInTeeSheet(weekStage, SAVED_W, [{ kind: "player", playerId: lid.y, toGroup: 1 }])).toEqual({ ok: false, error: "Group 2 is full. Choose a group with room." });
  });

  it("two no-shows marked out leave a two-ball; its remaining two move into other groups and the group goes", async () => {
    await prisma.roundAttendance.update({ where: { stageId_playerId: { stageId: weekStage, playerId: lid.x } }, data: { status: "in" } });
    await prisma.stage.update({
      where: { id: weekStage },
      data: {
        teeSheet: JSON.stringify({
          savedAt: SAVED_W,
          startType: "tee",
          groups: [
            { name: "Group 1", startHole: 1, time: "6:30 PM", playerIds: [lid.y, lid.z] },
            { name: "Group 2", startHole: 1, time: "6:40 PM", playerIds: [lid.x, lid.p1, lid.p2, lid.p3] },
          ],
        }),
      },
    });
    await as(assistantId, leagueEvent);
    // p2 and p3 are marked out: Group 2 is a two-ball (x and p1). Move both into Group 1; Group 2 has nobody left and goes.
    for (const k of ["p2", "p3"]) {
      await prisma.roundAttendance.upsert({
        where: { stageId_playerId: { stageId: weekStage, playerId: lid[k] } },
        update: { status: "out" },
        create: { eventId: leagueEvent, stageId: weekStage, playerId: lid[k], status: "out", decidedBy: "test" },
      });
    }
    const res = await moveInTeeSheet(weekStage, SAVED_W, [
      { kind: "player", playerId: lid.x, toGroup: 0 },
      { kind: "player", playerId: lid.p1, toGroup: 0 },
    ]);
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const g = JSON.parse((await prisma.stage.findUniqueOrThrow({ where: { id: weekStage } })).teeSheet).groups as Array<{ name: string; time: string; playerIds: string[] }>;
    expect(g.map((x) => x.time)).toEqual(["6:30 PM"]);
    expect(g[0].playerIds).toEqual([lid.y, lid.z, lid.x, lid.p1]);
    expect(g.some((x) => x.playerIds.includes(lid.p2)), "the marked-out players were kept in a group that stayed").toBe(false);
  });

  async function roundOf(type: string, format: string, withSides: boolean) {
    const stage = await prisma.stage.create({ data: { eventId: leagueEvent, position: 5 + Math.floor(Math.random() * 1000), type, format, holes: 18, playedOn: clubDayFrom(1) } });
    if (withSides) {
      for (const [n, pair] of [["A", [lid.x, lid.p1]], ["B", [lid.p2, lid.p3]]] as const) {
        const t = await prisma.team.create({ data: { eventId: leagueEvent, stageId: stage.id, name: `${TAG} ${n}` } });
        for (const [k, id] of pair.entries()) await prisma.teamMember.create({ data: { teamId: t.id, playerId: id, position: k } });
      }
    }
    await prisma.stage.update({
      where: { id: stage.id },
      data: {
        teeSheetPublished: false,
        teeSheet: JSON.stringify({
          savedAt: SAVED_W,
          startType: "tee",
          groups: [
            { name: "Group 1", startHole: 1, time: "7:00 AM", playerIds: [lid.x, lid.p1, lid.p2, lid.p3] },
            { name: "Group 2", startHole: 1, time: "7:10 AM", playerIds: [lid.y, lid.z] },
          ],
        }),
      },
    });
    return stage.id;
  }

  it("individual stroke moves players, not sides; four-ball pairs move whole sides, not players; singles match moves whole groups only", async () => {
    await as(assistantId, leagueEvent);
    // individual stroke (the control)
    const stroke = await roundOf("Stroke Play Round", "Stroke Play", false);
    expect(await moveInTeeSheet(stroke, SAVED_W, [{ kind: "side", playerIds: [lid.x, lid.p1], toGroup: 1 }])).toEqual({ ok: false, error: "This round is played one by one. Move a player, not a side." });
    expect((await moveInTeeSheet(stroke, SAVED_W, [{ kind: "player", playerId: lid.x, toGroup: 1 }])).ok).toBe(true);
    // four-ball pairs: the pair moves together (into Group 2, which has room for two); a lone player is refused
    const pairs = await roundOf("Stroke Play Round", "Four-Ball", true);
    expect(await moveInTeeSheet(pairs, SAVED_W, [{ kind: "player", playerId: lid.x, toGroup: 1 }])).toEqual({ ok: false, error: SIDES_NOTE });
    expect(await moveInTeeSheet(pairs, SAVED_W, [{ kind: "side", playerIds: [lid.x, lid.y], toGroup: 1 }])).toEqual({ ok: false, error: "That isn't one of this round's sides." });
    const moved = await moveInTeeSheet(pairs, SAVED_W, [{ kind: "side", playerIds: [lid.x, lid.p1], toGroup: 1 }]);
    expect(moved.ok, JSON.stringify(moved)).toBe(true);
    // singles match play (no sides): a player and a side are both refused; a whole group moves
    const singles = await roundOf("Single Match Stage", "Match Play", false);
    expect(await moveInTeeSheet(singles, SAVED_W, [{ kind: "player", playerId: lid.x, toGroup: 1 }])).toEqual({ ok: false, error: GROUPS_NOTE });
    expect(await moveInTeeSheet(singles, SAVED_W, [{ kind: "side", playerIds: [lid.x, lid.p1], toGroup: 1 }])).toEqual({ ok: false, error: GROUPS_NOTE });
    expect((await moveInTeeSheet(singles, SAVED_W, [{ kind: "group", from: 1, to: 0 }])).ok).toBe(true);
  });
});
