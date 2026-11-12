import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * "REPLACE … WITH …" ON A SAVED TEE SHEET, AGAINST REAL ROWS — `replaceInTeeSheet` (B43).
 *
 * A stroke round at a club on UTC dated TOMORROW, sheet PUBLISHED; and a league (opt-out) with a
 * pairs week and an interclub week. Through the real action and real sessions:
 *
 *   an assistant replaces a player with a member   → the stored sheet is the same but for one name in the
 *                                                    same place; times and the other groups untouched;
 *                                                    the absentee marked out ("replaced by"), the sub in;
 *                                                    the audit line names both, the staff, the reason and
 *                                                    the handicap; the absentee's side-game entries voided
 *   an organizer replaces with a GUEST             → a guest entry (no email); a blank index is "no index"
 *                                                    gross-only, never nought; "+2.4" is read as a plus handicap
 *   refused, in words, nothing written             → already in another group; marked out for the week;
 *                                                    the group has started; a card in the group; a stale
 *                                                    sheet; a malformed guest; the player's own session
 *   a card in ANOTHER group (late entry closed)    → this group may still change hands
 *   a pairs week                                   → the TeamMember is swapped keeping `position`; the Team and
 *                                                    its Match are the same rows; a pair named for its players
 *                                                    is renamed; the Teams screen's lock is untouched; a pair
 *                                                    that plays every round, a side's own card, and someone
 *                                                    already in another pair are refused
 *   an interclub pair                              → the sub must play for the same club; a guest is given it
 *   singles match play                             → refused (the draw is the pairing)
 *   a tournament with no weekly sign-up            → no attendance rows; the absentee is WITHDRAWN (row kept), so the field
 *                                                    holds the sub and not both and a capped field stays at its cap
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
import { replaceInTeeSheet } from "@/app/actions/tee-sheet";
import { addTeamMember } from "@/app/actions/teams";
import { REPLACE_EVERY_ROUND_NOTE, REPLACE_GROUPS_NOTE } from "@/lib/domain/tee-sheet-replace";
import { recentChanges } from "@/lib/services/recent-changes";
import { clubToday } from "@/lib/domain/club-clock";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-SHEETREPLACE";
const ZONE = "UTC";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();
let orgId = "";
let assistantId = "";
let adminId = "";
let playerUserId = "";
const SAVED = "2026-11-28T18:00:00.000Z";

const clubDayFrom = (n: number) => {
  const [y, m, d] = clubToday(ZONE).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n, 12)).toISOString().slice(0, 10);
};

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.organizationMember.deleteMany({ where: { organizationId: orgId || "none" } });
  await prisma.member.deleteMany({ where: { organization: { name: { startsWith: TAG } } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function as(userId: string, eventId: string) {
  jar.clear();
  await createSession(userId);
  await setActiveEvent(eventId);
}

async function makeEvent(name: string, attendanceMode?: string) {
  const e = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${name}`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${name}-${Date.now()}`,
      status: "live",
      configUnlocked: false,
      ...(attendanceMode ? { attendanceMode } : {}),
    },
  });
  await prisma.account.create({ data: { eventId: e.id, email: at("assistant"), name: `${TAG} Assistant`, role: "assistant" } });
  await prisma.account.create({ data: { eventId: e.id, email: at("admin"), name: `${TAG} Organizer`, role: "admin" } });
  await prisma.account.create({ data: { eventId: e.id, email: at("member"), name: `${TAG} Member`, role: "player" } });
  return e.id;
}

async function players(eventId: string, keys: string[], flight: Record<string, string> = {}) {
  const out: Record<string, string> = {};
  for (const [i, key] of keys.entries()) {
    out[key] = (
      await prisma.player.create({
        data: { eventId, name: `${TAG} ${key}`, email: at(key), handicap: 10 + i, seed: i + 1, status: "confirmed", groupId: flight[key] ?? null },
      })
    ).id;
  }
  return out;
}

const sheetOf = async (stageId: string) => JSON.parse((await prisma.stage.findUniqueOrThrow({ where: { id: stageId } })).teeSheet) as { savedAt: string; groups: Array<{ name: string; time: string; playerIds: string[] }> };
const rawSheet = async (stageId: string) => (await prisma.stage.findUniqueOrThrow({ where: { id: stageId } })).teeSheet;

async function setSheet(stageId: string, groups: Array<[string, string[]]>, playedOn = clubDayFrom(1)) {
  await prisma.stage.update({
    where: { id: stageId },
    data: {
      playedOn,
      teeSheetPublished: true,
      teeSheet: JSON.stringify({
        savedAt: SAVED,
        startType: "tee",
        groups: groups.map(([time, playerIds], i) => ({ name: `Group ${i + 1}`, startHole: 1, time, playerIds })),
      }),
    },
  });
}

beforeAll(async () => {
  await cleanup();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club", timeZone: ZONE } })).id;
  assistantId = (await prisma.user.create({ data: { email: at("assistant"), name: `${TAG} Assistant`, password: "x", emailVerifiedAt: new Date() } })).id;
  adminId = (await prisma.user.create({ data: { email: at("admin"), name: `${TAG} Organizer`, password: "x", emailVerifiedAt: new Date() } })).id;
  playerUserId = (await prisma.user.create({ data: { email: at("member"), name: `${TAG} Member`, password: "x", emailVerifiedAt: new Date() } })).id;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("replaceInTeeSheet — an individual week (league that asks each week)", () => {
  let eventId = "";
  let stageId = "";
  let p: Record<string, string> = {};

  async function reset(playedOn = clubDayFrom(1)) {
    await prisma.scorecard.deleteMany({ where: { stageId } });
    await prisma.roundAttendance.deleteMany({ where: { stageId } });
    await prisma.player.deleteMany({ where: { eventId, standing: "guest" } });
    await prisma.auditLog.deleteMany({ where: { eventId } });
    await setSheet(
      stageId,
      [
        ["8:00 AM", [p.ann, p.bob, p.cat, p.dan]],
        ["8:10 AM", [p.eve, p.fay, p.gus]],
        ["8:20 AM", [p.hal, p.ivy]],
      ],
      playedOn,
    );
  }

  beforeAll(async () => {
    eventId = await makeEvent("week", "opt-out");
    stageId = (await prisma.stage.create({ data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 } })).id;
    p = await players(eventId, ["ann", "bob", "cat", "dan", "eve", "fay", "gus", "hal", "ivy", "jon", "kim"]);
    await reset();
  });

  it("an assistant replaces Ann with Jon: same slot, one name changed, the week and the record say so, the absentee's side games are voided", async () => {
    await reset();
    const contest = await prisma.contest.create({ data: { eventId, stageId, name: `${TAG} KP`, entryMode: "opt-in" } });
    await prisma.contestEntry.create({ data: { contestId: contest.id, playerId: p.ann, confirmed: true } });
    const game = await prisma.sideGame.create({ data: { eventId, stageId, kind: "low-gross", entryMode: "opt-out", buyInCents: 500 } });
    const pot = await prisma.skinsPot.create({ data: { eventId, stageId } });
    await prisma.skinsEntry.create({ data: { potId: pot.id, playerId: p.ann, confirmed: true } });

    await as(assistantId, eventId);
    const before = await sheetOf(stageId);
    const res = await replaceInTeeSheet(stageId, SAVED, p.ann, { kind: "member", playerId: p.jon }, "no-show");
    expect(res.ok, JSON.stringify(res)).toBe(true);

    const after = await sheetOf(stageId);
    expect(after.groups.map((g) => g.playerIds)).toEqual([[p.jon, p.bob, p.cat, p.dan], [p.eve, p.fay, p.gus], [p.hal, p.ivy]]);
    expect(after.groups.map((g) => g.time)).toEqual(before.groups.map((g) => g.time));
    expect((await prisma.stage.findUniqueOrThrow({ where: { id: stageId } })).teeSheetPublished).toBe(true);
    expect(res.said).toContain("Group 1, 8:00 AM");

    // The absentee's row is kept, marked "replaced by"; the sub is in.
    expect(await prisma.player.findUnique({ where: { id: p.ann } })).not.toBeNull();
    const out = await prisma.roundAttendance.findUniqueOrThrow({ where: { stageId_playerId: { stageId, playerId: p.ann } } });
    expect(out.status).toBe("out");
    expect(out.decidedBy).toBe(`${TAG} Assistant (replaced by ${TAG} jon)`);
    const inn = await prisma.roundAttendance.findUniqueOrThrow({ where: { stageId_playerId: { stageId, playerId: p.jon } } });
    expect(inn.status).toBe("in");
    expect(inn.decidedBy).toBe(`${TAG} Assistant (replacing ${TAG} ann)`);

    // The record: who, whom, when, where, why, which handicap.
    const lines = await recentChanges(eventId);
    const line = lines.find((l) => l.kind === "Field" && l.what.startsWith("Replaced"));
    expect(line, "no audit line").toBeTruthy();
    expect(line!.actor).toBe(`${TAG} Assistant`);
    expect(line!.what).toContain(`Replaced ${TAG} ann with ${TAG} jon by ${TAG} Assistant at ${clubToday(ZONE)} `);
    expect(line!.what).toContain("Group 1, reason no-show, handicap used 19");
    expect(line!.what).toContain("Voided the absentee’s entries in 1 contest, 1 side game, 1 skins pot (2 already paid");

    // Side games: the absentee is out of each (the opt-out game gets an OUT row — silence would be "in and paid"), the sub is in none.
    expect((await prisma.contestEntry.findUniqueOrThrow({ where: { contestId_playerId: { contestId: contest.id, playerId: p.ann } } })).excluded).toBe(true);
    expect((await prisma.sideGameEntry.findUniqueOrThrow({ where: { sideGameId_playerId: { sideGameId: game.id, playerId: p.ann } } })).excluded).toBe(true);
    expect(await prisma.skinsEntry.count({ where: { potId: pot.id, playerId: p.ann } })).toBe(0);
    expect(await prisma.contestEntry.count({ where: { playerId: p.jon } })).toBe(0);
    expect(await prisma.skinsEntry.count({ where: { playerId: p.jon } })).toBe(0);
    await prisma.contest.delete({ where: { id: contest.id } });
    await prisma.sideGame.delete({ where: { id: game.id } });
    await prisma.skinsPot.delete({ where: { id: pot.id } });
  });

  it("an organizer replaces with a guest and no index: a guest entry, gross only (never nought), no email, in the same place", async () => {
    await reset();
    await as(adminId, eventId);
    const res = await replaceInTeeSheet(stageId, SAVED, p.eve, { kind: "guest", name: `${TAG} Visitor`, index: "" }, "cancelled");
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const guest = await prisma.player.findFirstOrThrow({ where: { eventId, name: `${TAG} Visitor` } });
    expect(guest).toMatchObject({ standing: "guest", status: "confirmed", email: "", phone: "", handicapSource: "none" });
    expect((await sheetOf(stageId)).groups[1].playerIds).toEqual([guest.id, p.fay, p.gus]);
    expect((await prisma.roundAttendance.findUniqueOrThrow({ where: { stageId_playerId: { stageId, playerId: guest.id } } })).status).toBe("in");
    const line = (await recentChanges(eventId)).find((l) => l.what.startsWith("Replaced"));
    expect(line!.what).toContain("reason cancelled, handicap used no index (gross only)");
  });

  it("a guest typed as +2.4 is a plus handicap (2.4 better than scratch), a manual figure", async () => {
    await reset();
    await as(adminId, eventId);
    const res = await replaceInTeeSheet(stageId, SAVED, p.hal, { kind: "guest", name: `${TAG} Plus`, index: "+2.4" }, "other");
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const guest = await prisma.player.findFirstOrThrow({ where: { eventId, name: `${TAG} Plus` } });
    expect(guest.handicap).toBe(-2.4);
    expect(guest.handicapSource).toBe("manual");
  });

  it("refused, in words, with nothing written: somebody already in another group, marked out, a bad guest, a name already entered, a stranger", async () => {
    await reset();
    await as(assistantId, eventId);
    const before = await rawSheet(stageId);
    expect(await replaceInTeeSheet(stageId, SAVED, p.ann, { kind: "member", playerId: p.eve }, "no-show")).toEqual({ ok: false, error: `${TAG} eve: Already in Group 2.` });
    await prisma.roundAttendance.create({ data: { eventId, stageId, playerId: p.kim, status: "out", decidedBy: "test" } });
    expect(await replaceInTeeSheet(stageId, SAVED, p.ann, { kind: "member", playerId: p.kim }, "no-show")).toEqual({ ok: false, error: `${TAG} kim: Marked out for this week. Put them back in first.` });
    expect(await replaceInTeeSheet(stageId, SAVED, p.ann, { kind: "member", playerId: p.ann }, "no-show")).toMatchObject({ ok: false });
    expect(await replaceInTeeSheet(stageId, SAVED, p.ann, { kind: "guest", name: "   ", index: "" }, "no-show")).toEqual({ ok: false, error: "Enter the guest’s name." });
    expect(await replaceInTeeSheet(stageId, SAVED, p.ann, { kind: "guest", name: "Rob", index: "abc" }, "no-show")).toMatchObject({ ok: false });
    expect(await replaceInTeeSheet(stageId, SAVED, p.ann, { kind: "guest", name: "Rob", index: "99" }, "no-show")).toEqual({ ok: false, error: "A handicap index runs from +10 to 54." });
    expect(await replaceInTeeSheet(stageId, SAVED, p.ann, { kind: "guest", name: `${TAG} JON`, index: "" }, "no-show")).toEqual({ ok: false, error: `${TAG} jon is already in this tournament. Choose them from the list.` });
    expect(await replaceInTeeSheet(stageId, SAVED, p.ann, { kind: "member", playerId: p.jon }, "sulking")).toEqual({ ok: false, error: "Choose why: no-show, cancelled or other." });
    expect(await replaceInTeeSheet(stageId, SAVED, "not-a-player", { kind: "member", playerId: p.jon }, "no-show")).toMatchObject({ ok: false });
    expect(await rawSheet(stageId), "a refused press wrote").toBe(before);
    expect(await prisma.player.count({ where: { eventId, standing: "guest" } })).toBe(0);
    await prisma.roundAttendance.deleteMany({ where: { stageId, playerId: p.kim } });
  });

  it("a sheet saved by somebody else since is refused (compare-and-set)", async () => {
    await reset();
    await as(assistantId, eventId);
    const before = await rawSheet(stageId);
    expect(await replaceInTeeSheet(stageId, "2026-01-01T00:00:00.000Z", p.ann, { kind: "member", playerId: p.jon }, "no-show")).toEqual({ ok: false, error: "The sheet changed while you were choosing. Look again and choose." });
    expect(await rawSheet(stageId)).toBe(before);
  });

  it("a group whose time has passed on the club's day has started: refused; the day before it was allowed", async () => {
    await reset(clubDayFrom(-1));
    await as(assistantId, eventId);
    const before = await rawSheet(stageId);
    const res = await replaceInTeeSheet(stageId, SAVED, p.ann, { kind: "member", playerId: p.jon }, "no-show");
    expect(res).toMatchObject({ ok: false });
    expect(res.error).toContain("Group 1 teed off at 8:00 AM.");
    expect(res.error).toContain("withdrawal");
    expect(await rawSheet(stageId)).toBe(before);
  });

  it("a card in a group locks that group; a card in ANOTHER group (late entry closed) does not stop this one", async () => {
    await reset();
    await prisma.scorecard.create({ data: { eventId, stageId, playerId: p.hal, strokes: JSON.stringify([4, null, null]) } });
    await as(assistantId, eventId);
    const locked = await replaceInTeeSheet(stageId, SAVED, p.ivy, { kind: "member", playerId: p.jon }, "no-show");
    expect(locked).toMatchObject({ ok: false });
    expect(locked.error).toContain("Group 3 has a card in.");
    const free = await replaceInTeeSheet(stageId, SAVED, p.ann, { kind: "member", playerId: p.jon }, "no-show");
    expect(free.ok, JSON.stringify(free)).toBe(true);
  });

  it("a player's own session is not staff: refused before anything is read", async () => {
    await reset();
    await as(playerUserId, eventId);
    await expect(replaceInTeeSheet(stageId, SAVED, p.ann, { kind: "member", playerId: p.jon }, "no-show")).rejects.toThrow(/Organizer access required/);
  });
});

describe("replaceInTeeSheet — a tournament with no weekly sign-up", () => {
  it("writes no attendance and WITHDRAWS the absentee in the same press: the sub is in, the row is kept, the field holds one name for the slot", async () => {
    const eventId = await makeEvent("everyone");
    const stageId = (await prisma.stage.create({ data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 } })).id;
    const p = await players(eventId, ["a1", "a2", "a3"]);
    await setSheet(stageId, [["9:00 AM", [p.a1, p.a2]]]);
    await as(assistantId, eventId);
    const confirmed = () => prisma.player.count({ where: { eventId, status: "confirmed" } });
    expect(await confirmed()).toBe(3);
    const res = await replaceInTeeSheet(stageId, SAVED, p.a1, { kind: "member", playerId: p.a3 }, "no-show");
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(res.said).toContain("is withdrawn from the field (their row is kept)");
    expect((await sheetOf(stageId)).groups[0].playerIds).toEqual([p.a3, p.a2]);
    expect(await prisma.roundAttendance.count({ where: { eventId } })).toBe(0);
    expect((await prisma.player.findUniqueOrThrow({ where: { id: p.a1 } })).status, "the absentee's row must be kept, withdrawn").toBe("withdrawn");
    expect((await prisma.player.findUniqueOrThrow({ where: { id: p.a3 } })).status).toBe("confirmed");
    expect(await confirmed()).toBe(2);
    const log = await prisma.auditLog.findMany({ where: { eventId }, select: { action: true, detail: true } });
    expect(log.map((l) => l.action).sort()).toEqual(["removed", "replaced"]);
    expect(log.find((l) => l.action === "removed")?.detail).toBe(`${TAG} a1 was withdrawn from the field.`);
  });

  it("a guest sub keeps a capped field at its cap: three in, three in after", async () => {
    const eventId = await makeEvent("capped");
    const stageId = (await prisma.stage.create({ data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 } })).id;
    const p = await players(eventId, ["c1", "c2", "c3"]);
    await setSheet(stageId, [["9:00 AM", [p.c1, p.c2, p.c3]]]);
    await as(adminId, eventId);
    const res = await replaceInTeeSheet(stageId, SAVED, p.c2, { kind: "guest", name: `${TAG} Capguest`, index: "" }, "cancelled");
    expect(res.ok, JSON.stringify(res)).toBe(true);
    expect(await prisma.player.count({ where: { eventId, status: "confirmed" } }), "the field grew past its size").toBe(3);
    expect((await prisma.player.findUniqueOrThrow({ where: { id: p.c2 } })).status).toBe("withdrawn");
  });
});

describe("replaceInTeeSheet — a pairs week", () => {
  let eventId = "";
  let stageId = "";
  let p: Record<string, string> = {};
  let teamA = "";
  let teamB = "";
  let matchId = "";

  async function reset() {
    await prisma.teamScorecard.deleteMany({ where: { stageId } });
    await prisma.match.deleteMany({ where: { stageId } });
    await prisma.team.deleteMany({ where: { eventId, stageId } });
    await prisma.roundAttendance.deleteMany({ where: { stageId } });
    await prisma.player.deleteMany({ where: { eventId, standing: "guest" } });
    await setSheet(stageId, [
      ["7:00 AM", [p.x1, p.x2, p.y1, p.y2]],
      ["7:10 AM", [p.z1, p.z2]],
    ]);
    const flight = await prisma.group.findFirstOrThrow({ where: { eventId } });
    teamA = (await prisma.team.create({ data: { eventId, stageId, name: `${TAG} x1 / ${TAG} x2`, seed: 1 } })).id;
    teamB = (await prisma.team.create({ data: { eventId, stageId, name: "The Reds", seed: 2 } })).id;
    for (const [i, id] of [p.x1, p.x2].entries()) await prisma.teamMember.create({ data: { teamId: teamA, playerId: id, position: i } });
    for (const [i, id] of [p.y1, p.y2].entries()) await prisma.teamMember.create({ data: { teamId: teamB, playerId: id, position: i } });
    matchId = (await prisma.match.create({ data: { eventId, stageId, groupId: flight.id, round: 1, playerAId: "", playerBId: "", teamAId: teamA, teamBId: teamB } })).id;
  }

  beforeAll(async () => {
    eventId = await makeEvent("pairs", "opt-out");
    await prisma.group.create({ data: { eventId, name: `${TAG} carrier`, position: 0 } });
    stageId = (await prisma.stage.create({ data: { eventId, position: 0, type: "Round Robin", format: "Four-Ball", holes: 18 } })).id;
    p = await players(eventId, ["x1", "x2", "y1", "y2", "z1", "z2", "w1"]);
    await reset();
  });

  it("swaps the TeamMember keeping its position; the Team and its Match are the same rows; the pair is renamed; the Teams screen stays locked", async () => {
    await reset();
    await as(assistantId, eventId);
    // The Teams screen's own door is shut on a live tournament; this press does not go through it.
    expect((await addTeamMember(teamA, p.w1)).ok, "the Teams lock was expected to be on").toBe(false);

    const res = await replaceInTeeSheet(stageId, SAVED, p.x2, { kind: "member", playerId: p.w1 }, "no-show");
    expect(res.ok, JSON.stringify(res)).toBe(true);

    const members = await prisma.teamMember.findMany({ where: { teamId: teamA }, orderBy: { position: "asc" } });
    expect(members.map((m) => [m.playerId, m.position])).toEqual([[p.x1, 0], [p.w1, 1]]);
    expect((await prisma.team.findUniqueOrThrow({ where: { id: teamA } })).name).toBe(`${TAG} x1 / ${TAG} w1`);
    const match = await prisma.match.findUniqueOrThrow({ where: { id: matchId } });
    expect([match.teamAId, match.teamBId]).toEqual([teamA, teamB]);
    expect((await sheetOf(stageId)).groups[0].playerIds).toEqual([p.x1, p.w1, p.y1, p.y2]);
    // The partner kept their place and the week says who is out.
    expect((await prisma.roundAttendance.findUniqueOrThrow({ where: { stageId_playerId: { stageId, playerId: p.x2 } } })).status).toBe("out");
  });

  it("a name somebody chose for the pair is kept; a guest takes the place with no index", async () => {
    await reset();
    await as(adminId, eventId);
    const res = await replaceInTeeSheet(stageId, SAVED, p.y1, { kind: "guest", name: `${TAG} Pairguest`, index: "" }, "cancelled");
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const guest = await prisma.player.findFirstOrThrow({ where: { eventId, name: `${TAG} Pairguest` } });
    const members = await prisma.teamMember.findMany({ where: { teamId: teamB }, orderBy: { position: "asc" } });
    expect(members.map((m) => [m.playerId, m.position])).toEqual([[guest.id, 0], [p.y2, 1]]);
    expect((await prisma.team.findUniqueOrThrow({ where: { id: teamB } })).name).toBe("The Reds");
    expect(guest.handicapSource).toBe("none");
  });

  it("somebody already in another pair is refused; so is a side with a card in, or a pair that plays every round", async () => {
    await reset();
    await as(assistantId, eventId);
    // Z1 and Z2 are on the sheet in Group 2 but hold no pair: Z1 is refused for the group, not the pair.
    expect(await replaceInTeeSheet(stageId, SAVED, p.x2, { kind: "member", playerId: p.y1 }, "no-show")).toEqual({ ok: false, error: `${TAG} y1: Already in Group 1.` });
    // A side's own card: strokes on the pair's card, no player card at all.
    await prisma.teamScorecard.create({ data: { eventId, stageId, teamId: teamA, strokes: JSON.stringify([4, 5]) } });
    const started = await replaceInTeeSheet(stageId, SAVED, p.x2, { kind: "member", playerId: p.w1 }, "no-show");
    expect(started).toMatchObject({ ok: false });
    expect(started.error).toContain("has started");
    await prisma.teamScorecard.deleteMany({ where: { stageId } });
    // A match that already holds a result.
    await prisma.match.update({ where: { id: matchId }, data: { holes: JSON.stringify(["A", null]) } });
    expect(await replaceInTeeSheet(stageId, SAVED, p.x2, { kind: "member", playerId: p.w1 }, "no-show")).toMatchObject({ ok: false });
    await prisma.match.update({ where: { id: matchId }, data: { holes: "[]" } });
    // A pair that belongs to no round in particular plays them all.
    await prisma.team.update({ where: { id: teamA }, data: { stageId: null } });
    await prisma.team.update({ where: { id: teamB }, data: { stageId: null } });
    expect(await replaceInTeeSheet(stageId, SAVED, p.x2, { kind: "member", playerId: p.w1 }, "no-show")).toEqual({ ok: false, error: REPLACE_EVERY_ROUND_NOTE });
    expect((await prisma.teamMember.findMany({ where: { teamId: teamA } })).map((m) => m.playerId).sort()).toEqual([p.x1, p.x2].sort());
  });
});

describe("replaceInTeeSheet — an interclub pair", () => {
  it("the substitute must play for the same club; a guest is given it", async () => {
    const eventId = await makeEvent("interclub", "captains");
    const home = await prisma.group.create({ data: { eventId, name: `${TAG} Home`, position: 1 } });
    const away = await prisma.group.create({ data: { eventId, name: `${TAG} Away`, position: 2 } });
    const stageId = (await prisma.stage.create({ data: { eventId, position: 0, type: "Round Robin", format: "Four-Ball", holes: 18 } })).id;
    const p = await players(eventId, ["h1", "h2", "h3", "a1", "a2"], { h1: home.id, h2: home.id, h3: home.id, a1: away.id, a2: away.id });
    await setSheet(stageId, [["6:00 PM", [p.h1, p.h2, p.a1, p.a2]]]);
    const pair = await prisma.team.create({ data: { eventId, stageId, clubGroupId: home.id, name: `${TAG} h1 / ${TAG} h2`, seed: 1 } });
    for (const [i, id] of [p.h1, p.h2].entries()) await prisma.teamMember.create({ data: { teamId: pair.id, playerId: id, position: i } });
    await as(assistantId, eventId);
    expect(await replaceInTeeSheet(stageId, SAVED, p.h2, { kind: "member", playerId: p.a1 }, "no-show")).toMatchObject({ ok: false });
    const wrongClub = await prisma.player.create({ data: { eventId, name: `${TAG} other`, email: at("other"), handicap: 5, seed: 99, status: "confirmed", groupId: away.id } });
    expect(await replaceInTeeSheet(stageId, SAVED, p.h2, { kind: "member", playerId: wrongClub.id }, "no-show")).toEqual({ ok: false, error: `${TAG} other: Plays for another club.` });
    const res = await replaceInTeeSheet(stageId, SAVED, p.h2, { kind: "member", playerId: p.h3 }, "no-show");
    expect(res.ok, JSON.stringify(res)).toBe(true);
    const guest = await replaceInTeeSheet(stageId, (await sheetOf(stageId)).savedAt, p.h3, { kind: "guest", name: `${TAG} Homeguest`, index: "14.2" }, "other");
    expect(guest.ok, JSON.stringify(guest)).toBe(true);
    const g = await prisma.player.findFirstOrThrow({ where: { eventId, name: `${TAG} Homeguest` } });
    expect(g.groupId).toBe(home.id);
    expect((await prisma.teamMember.findMany({ where: { teamId: pair.id }, orderBy: { position: "asc" } })).map((m) => m.playerId)).toEqual([p.h1, g.id]);
  });
});

describe("replaceInTeeSheet — singles match play", () => {
  it("is refused: the draw is the pairing", async () => {
    const eventId = await makeEvent("singles");
    const stageId = (await prisma.stage.create({ data: { eventId, position: 0, type: "Single Match Stage", format: "Match Play", holes: 18 } })).id;
    const p = await players(eventId, ["s1", "s2", "s3"]);
    await setSheet(stageId, [["9:00 AM", [p.s1, p.s2]]]);
    await as(assistantId, eventId);
    expect(await replaceInTeeSheet(stageId, SAVED, p.s1, { kind: "member", playerId: p.s3 }, "no-show")).toEqual({ ok: false, error: REPLACE_GROUPS_NOTE });
  });
});
