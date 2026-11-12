import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * THE TEE SHEET ON THE MORNING, AGAINST REAL ROWS — day-of field changes, PR B.
 *
 * A stroke medal launched as `launchTournament` leaves it (live, setup
 * locked), at a club on UTC, Round 1 dated TOMORROW at the club with its sheet
 * PUBLISHED: Group 1 full at 8:00 AM, Group 2 three-strong at 8:10 AM. Through
 * the real actions and real sessions:
 *
 *   a late entry, then Put in group   → Group 1 refused (full); Group 2 takes them,
 *                                       nobody else moves, the sheet stays published
 *   the same player again, a stranger to the field, another tournament's round,
 *   a group index that is not a whole number → refused, in words
 *   a player's session                → not staff: refused before anything is read
 *   withdraw a drawn player, no card  → "DNS: they had not teed off", and the group
 *                                       they leave short, in the club's words
 *   the results sheet                 → DNS beneath WD and above DQ, no place; the live
 *                                       board (`standingRows`) has no DNS row
 *   before launch (the control)       → a withdrawn row with no card is not a DNS
 *   the round's day passes            → late entries close, naming the last tee time
 *   a card in Round 1, the sheet's time still to come → late entries stay OPEN
 *   unpublish the sheet               → the first card closes them again (PR A)
 *   completed                         → Put in group refused
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
import { addSignup, removeSignup } from "@/app/actions/tournament";
import { placeInTeeGroup } from "@/app/actions/tee-sheet";
import { loadEventState, resultsSheetRows, standingRows } from "@/lib/services/tournament";
import { clubToday } from "@/lib/domain/club-clock";
import { golfTermsFor } from "@/lib/domain/golf-terms";
import { golfRegisterForEvent } from "@/lib/services/organization";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-DAYOFB";
const ZONE = "UTC";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();
let orgId = "";
let assistantId = "";
let playerUserId = "";
let medal = "";
let stageId = "";
let otherStage = "";
const ids: Record<string, string> = {};

/** The club's day N days from today, by the club's own clock. */
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

async function tournament(name: string, status: string, playedOn: string) {
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
      status,
      configUnlocked: false,
    },
  });
  const stage = await prisma.stage.create({
    data: { eventId: e.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, playedOn },
  });
  await prisma.account.create({ data: { eventId: e.id, email: at("assistant"), name: `${TAG} Assistant`, role: "assistant" } });
  return { id: e.id, stageId: stage.id };
}

async function player(eventId: string, key: string, seed: number, status = "confirmed") {
  const p = await prisma.player.create({ data: { eventId, name: `${TAG} ${key}`, email: at(key), handicap: 10 + seed, seed, status } });
  ids[key] = p.id;
  return p.id;
}

async function card(eventId: string, stage: string, playerId: string) {
  await prisma.scorecard.create({ data: { eventId, stageId: stage, playerId, strokes: JSON.stringify(Array(18).fill(5)), status: "entered" } });
}

async function as(userId: string, eventId: string) {
  jar.clear();
  await createSession(userId);
  await setActiveEvent(eventId);
}

const groups = async () =>
  (JSON.parse((await prisma.stage.findUniqueOrThrow({ where: { id: stageId }, select: { teeSheet: true } })).teeSheet).groups as Array<{ name: string; playerIds: string[] }>);

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club", timeZone: ZONE } });
  orgId = org.id;
  const assistant = await prisma.user.create({ data: { email: at("assistant"), name: `${TAG} Assistant`, password: "x", emailVerifiedAt: new Date() } });
  assistantId = assistant.id;
  const member = await prisma.user.create({ data: { email: at("member"), name: `${TAG} Member`, password: "x", emailVerifiedAt: new Date() } });
  playerUserId = member.id;

  const m = await tournament("medal", "live", clubDayFrom(1));
  medal = m.id;
  stageId = m.stageId;
  await prisma.account.create({ data: { eventId: medal, email: at("member"), name: `${TAG} Member`, role: "player" } });
  for (const [i, key] of ["ann", "bob", "cat", "dan", "eve", "fay", "gus"].entries()) await player(medal, key, i + 1);
  // Two who left the field after beginning: one withdrawn (WD), one disqualified (DQ).
  await player(medal, "hal", 8, "withdrawn");
  await player(medal, "ivy", 9, "disqualified");
  await card(medal, stageId, ids.hal);
  await card(medal, stageId, ids.ivy);
  await prisma.stage.update({
    where: { id: stageId },
    data: {
      teeSheetPublished: true,
      teeSheet: JSON.stringify({
        savedAt: "2026-11-28T18:00:00.000Z",
        startType: "tee",
        groups: [
          { name: "Group 1", startHole: 1, time: "8:00 AM", playerIds: [ids.ann, ids.bob, ids.cat, ids.dan] },
          { name: "Group 2", startHole: 1, time: "8:10 AM", playerIds: [ids.eve, ids.fay, ids.gus] },
        ],
      }),
    },
  });
  otherStage = (await tournament("other", "live", clubDayFrom(1))).stageId;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("Put in group: one named player, one group with room", () => {
  it("a late entry is taken while Round 1's last tee time is still to come", async () => {
    await as(assistantId, medal);
    const res = await addSignup({ name: `${TAG} lee`, email: at("lee"), handicap: 14.2 });
    expect(res.error).toBeUndefined();
    ids.lee = (await prisma.player.findFirstOrThrow({ where: { eventId: medal, email: at("lee") } })).id;
  });

  it("a full group is refused; the group with room takes them, nobody else moves, the sheet stays published", async () => {
    await as(assistantId, medal);
    expect(await placeInTeeGroup(stageId, ids.lee, 0)).toEqual({ ok: false, error: "Group 1 is full. Choose a group with room." });
    const before = await groups();
    const res = await placeInTeeGroup(stageId, ids.lee, 1);
    expect(res).toEqual({ ok: true, said: `${TAG} lee is in Group 2, off at 8:10 AM.` });
    const after = await groups();
    expect(after[0]).toEqual(before[0]);
    expect(after[1]).toEqual({ ...before[1], playerIds: [ids.eve, ids.fay, ids.gus, ids.lee] });
    const stage = await prisma.stage.findUniqueOrThrow({ where: { id: stageId }, select: { teeSheetPublished: true, teeSheet: true } });
    expect(stage.teeSheetPublished).toBe(true);
    expect(JSON.parse(stage.teeSheet).groups[1].time).toBe("8:10 AM");
  });

  it("refuses, in words: the same player again, a stranger to the field, another tournament's round, a bad index", async () => {
    await as(assistantId, medal);
    expect(await placeInTeeGroup(stageId, ids.lee, 1)).toEqual({ ok: false, error: "They are already in Group 2. To move them, re-draw the sheet." });
    expect(await placeInTeeGroup(stageId, ids.hal, 1)).toEqual({ ok: false, error: "That player isn't in the field." });
    expect(await placeInTeeGroup(otherStage, ids.ann, 0)).toEqual({ ok: false, error: "That round isn't in this tournament." });
    expect(await placeInTeeGroup(stageId, ids.lee, "1" as unknown as number)).toEqual({ ok: false, error: "Choose a group." });
    expect(await placeInTeeGroup(stageId, ids.lee, 0.5)).toEqual({ ok: false, error: "Choose a group." });
    expect(await placeInTeeGroup("", ids.lee, 0)).toEqual({ ok: false, error: "Choose a player and a group." });
  });

  it("a player already drawn is told to re-draw, not moved", async () => {
    await as(assistantId, medal);
    // Room made in Group 2 for the check: Group 1's player is still not moved there.
    await prisma.player.update({ where: { id: ids.gus }, data: { status: "withdrawn" } });
    try {
      expect(await placeInTeeGroup(stageId, ids.ann, 1)).toEqual({ ok: false, error: "They are already in Group 1. To move them, re-draw the sheet." });
    } finally {
      await prisma.player.update({ where: { id: ids.gus }, data: { status: "confirmed" } });
    }
  });

  it("a player's own session is not staff: refused before anything is read", async () => {
    await as(playerUserId, medal);
    await expect(placeInTeeGroup(stageId, ids.lee, 1)).rejects.toThrow(/Organizer access required/);
  });
});

describe("a drawn player withdrawn before teeing off is DNS", () => {
  it("the desk is told DNS, and which group goes out short, in the club's words", async () => {
    await as(assistantId, medal);
    const res = await removeSignup(ids.eve);
    expect(res.ok).toBe(true);
    const terms = golfTermsFor(await golfRegisterForEvent(medal));
    const said = res.ok ? res.said : "";
    expect(said).toContain(`The results list ${TAG} eve as DNS: they had not teed off.`);
    // Group 2 was eve, fay, gus and the late entry: three left.
    expect(said).toContain(`Group 2 goes out as a ${terms.groupOfThree}. Leave it, or put someone in on the Tee sheet.`);
    expect((await prisma.player.findUniqueOrThrow({ where: { id: ids.eve } })).status).toBe("withdrawn");
  });

  it("the results sheet lists DNS beneath WD and above DQ, with no place; the live board does not", async () => {
    const state = (await loadEventState(medal))!;
    const sheet = resultsSheetRows(state);
    const order = sheet.map((r) => r.name.replace(`${TAG} `, ""));
    expect(order.slice(-3)).toEqual(["hal", "eve", "ivy"]);
    const eve = sheet.find((r) => r.id === ids.eve)!;
    expect(eve).toMatchObject({ didNotStart: true, ranked: false, rank: 0, thru: 0, withdrew: false, disqualified: false });
    expect(sheet.find((r) => r.id === ids.hal)).toMatchObject({ withdrew: true, ranked: false });
    expect(sheet.find((r) => r.id === ids.ivy)).toMatchObject({ disqualified: true, ranked: false });
    const live = standingRows(state);
    expect(live.some((r) => r.id === ids.eve), "the live board shows a DNS").toBe(false);
    // The control: the live board still has the WD and DQ rows it always had.
    expect(live.map((r) => r.id)).toEqual(sheet.filter((r) => r.id !== ids.eve).map((r) => r.id));
  });

  it("before launch a withdrawn row with no card is not a DNS (the control)", async () => {
    await prisma.event.update({ where: { id: medal }, data: { status: "registration" } });
    try {
      const state = (await loadEventState(medal))!;
      expect(resultsSheetRows(state).some((r) => r.didNotStart)).toBe(false);
    } finally {
      await prisma.event.update({ where: { id: medal }, data: { status: "live" } });
    }
  });
});

describe("late entries close at Round 1's last published tee time, by the club's clock", () => {
  const closedByTee =
    "Late entries are closed. Round 1’s last tee time (8:10 AM) has passed. An Organizer can open the field with a committee correction.";

  it("the round's day passed at the club: closed, naming the time", async () => {
    await as(assistantId, medal);
    await prisma.stage.update({ where: { id: stageId }, data: { playedOn: clubDayFrom(-1) } });
    try {
      expect(await addSignup({ name: `${TAG} too-late`, email: at("too-late"), handicap: 9 })).toEqual({ ok: false, error: closedByTee });
    } finally {
      await prisma.stage.update({ where: { id: stageId }, data: { playedOn: clubDayFrom(1) } });
    }
  });

  it("a card in Round 1 does not close it while a published tee time is still to come", async () => {
    await as(assistantId, medal);
    await card(medal, stageId, ids.ann);
    const res = await addSignup({ name: `${TAG} walk-in`, email: at("walk-in"), handicap: 20 });
    expect(res.error).toBeUndefined();
    expect(res.ok).toBe(true);
  });

  it("with the sheet unpublished, the first card closes it again (PR A)", async () => {
    await as(assistantId, medal);
    await prisma.stage.update({ where: { id: stageId }, data: { teeSheetPublished: false } });
    try {
      const res = await addSignup({ name: `${TAG} after-card`, email: at("after-card"), handicap: 20 });
      expect(res).toEqual({
        ok: false,
        error: "The first card of Round 1 is in, so late entries are closed. To add someone anyway, an Organizer can make a committee correction to the field on the dashboard.",
      });
    } finally {
      await prisma.stage.update({ where: { id: stageId }, data: { teeSheetPublished: true } });
    }
  });
});

describe("completed", () => {
  it("Put in group is refused once the tournament is completed", async () => {
    await as(assistantId, medal);
    await prisma.event.update({ where: { id: medal }, data: { status: "completed" } });
    try {
      const walkIn = (await prisma.player.findFirstOrThrow({ where: { eventId: medal, email: at("walk-in") } })).id;
      expect(await placeInTeeGroup(stageId, walkIn, 0)).toEqual({
        ok: false,
        error: "The tournament is completed, so its tee sheets are final. An Organizer can reopen it on the dashboard.",
      });
    } finally {
      await prisma.event.update({ where: { id: medal }, data: { status: "live" } });
    }
  });
});
