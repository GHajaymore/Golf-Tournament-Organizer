import "dotenv/config";
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/** One browser's cookie jar, so a console session round-trips for real. */
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
vi.mock("@/lib/services/board-refresh", () => ({ boardChanged: () => {} }));

import { createSession, setActiveEvent } from "@/lib/auth";
import { setPlayerIndex, indexChangeFacts } from "@/app/actions/player-index";
import { updateSignup } from "@/app/actions/tournament";

/**
 * A PLAYER'S INDEX, CHANGED FROM A TOURNAMENT (2026-10-16).
 *
 * Ajay asked for a player's adjusted handicap to reach the member record; the
 * review panel (docs/handicap-push-brief-2026-10-16.md) set the rules, and
 * these hold them against real rows: the tournament's copy moves for the
 * rounds not played; a round with a card and a round with its own figure keep
 * theirs; Members moves only for a member of THIS club whose index the club
 * keeps, at its organizer's hand, with a reason, and never behind anybody's
 * back from the field screen.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */
const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-INDEX-PUSH";
const mail = (s: string) => `${TAG}-${s}@example.invalid`.toLowerCase();

let orgId = "";
let otherOrgId = "";
let ownerId = "";
let assistantId = "";
let eventId = "";
let stageIds: string[] = [];

async function scrub() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.member.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
}

async function signIn(userId: string) {
  jar.clear();
  await createSession(userId);
  await setActiveEvent(eventId);
}

/** A tournament of three stroke rounds, with an organizer and an assistant. */
async function tournament(policy = "club") {
  await prisma.organization.update({ where: { id: orgId }, data: { handicapPolicy: policy } });
  const event = await prisma.event.create({
    data: {
      organizationId: orgId, name: `${TAG} ${Math.random()}`, status: "live", shape: "series", format: "stroke",
      formationRule: "balanced", dates: "14 May 2026", course: "", city: "", address: "", regDeadline: "", capacity: 0,
      shareToken: `idx-${Date.now()}-${Math.random()}`, registrationToken: `r-idx-${Date.now()}-${Math.random()}`,
    },
  });
  eventId = event.id;
  stageIds = [];
  for (const position of [0, 1, 2]) {
    const s = await prisma.stage.create({
      data: { eventId, position, type: "Stroke Play Round", holes: 18, format: "Stroke Play", scoringBasis: "net" },
    });
    stageIds.push(s.id);
  }
  await prisma.account.create({ data: { eventId, email: mail("owner"), name: `${TAG} Owner`, role: "admin" } });
  await prisma.account.create({ data: { eventId, email: mail("assistant"), name: `${TAG} Assistant`, role: "assistant" } });
}

/** A member of the club, entered in the tournament at `from`. */
async function entrant(name: string, from: number, member: Partial<{ ghin: string; handicapType: string; organizationId: string }> | null = {}) {
  const m = member
    ? await prisma.member.create({
        data: {
          organizationId: member.organizationId ?? orgId, name: `${TAG} ${name}`, email: mail(`${name}-${Math.random()}`),
          handicap: from, handicapType: member.handicapType ?? "18", handicapSource: member.ghin ? "ghin" : "manual", ghin: member.ghin ?? "",
        },
      })
    : null;
  const p = await prisma.player.create({
    data: {
      eventId, name: `${TAG} ${name}`, email: m?.email ?? mail(`guest-${Math.random()}`), handicap: from,
      handicapType: member?.handicapType ?? "18", seed: 1, status: "confirmed", memberId: m?.id ?? null,
    },
  });
  return { playerId: p.id, memberId: m?.id ?? null };
}

const playerIndex = async (id: string) => (await prisma.player.findUniqueOrThrow({ where: { id } })).handicap;
const memberRow = async (id: string) => prisma.member.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  await scrub();
  orgId = (await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club", country: "GB" } })).id;
  otherOrgId = (await prisma.organization.create({ data: { name: `${TAG} other club`, kind: "club", country: "GB" } })).id;
  ownerId = (await prisma.user.create({ data: { email: mail("owner"), name: `${TAG} Owner`, password: "x", emailVerifiedAt: new Date() } })).id;
  assistantId = (await prisma.user.create({ data: { email: mail("assistant"), name: `${TAG} Assistant`, password: "x", emailVerifiedAt: new Date() } })).id;
  await prisma.organizationMember.create({ data: { organizationId: orgId, userId: ownerId, role: "owner" } });
});
beforeEach(() => jar.clear());
afterAll(async () => {
  try {
    await scrub();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the tournament's copy", () => {
  it("moves the rounds not played; a played round and a round with its own figure keep theirs", async () => {
    await tournament();
    const chris = await entrant("Chris", 15);
    // Round 1 has a card in and froze at 15; Round 3 holds its own 12.
    await prisma.scorecard.create({ data: { eventId, stageId: stageIds[0], playerId: chris.playerId, strokes: JSON.stringify([5, 4, 4]) } });
    await prisma.roundHandicap.create({ data: { eventId, stageId: stageIds[0], playerId: chris.playerId, frozen: 15, frozenExact: 15 } });
    await prisma.roundHandicap.create({ data: { eventId, stageId: stageIds[2], playerId: chris.playerId, override: 12 } });
    await signIn(ownerId);

    const res = await setPlayerIndex(chris.playerId, { index: 14.2, expectedFrom: 15, alsoMember: false, reason: "" });
    expect(res.ok, res.error).toBe(true);
    expect(res.plan?.moves).toEqual(["Round 2"]);
    expect(res.plan?.keepsPlayed).toEqual(["Round 1"]);
    expect(res.plan?.keepsOwnFigure).toEqual([{ label: "Round 3", figure: 12 }]);
    expect(await playerIndex(chris.playerId)).toBe(14.2);
    const rows = await prisma.roundHandicap.findMany({ where: { playerId: chris.playerId }, orderBy: { stageId: "asc" } });
    expect(rows.find((r) => r.stageId === stageIds[0])?.frozen).toBe(15);
    expect(rows.find((r) => r.stageId === stageIds[2])?.override).toBe(12);
    // Members untouched without the tick.
    expect((await memberRow(chris.memberId!)).handicap).toBe(15);
    // And the history says it.
    const log = await prisma.auditLog.findFirst({ where: { eventId }, orderBy: { createdAt: "desc" } });
    expect(log?.detail).toContain("index 15 → 14.2");
  });

  it("refuses a stale figure, two decimals, and a player from another tournament", async () => {
    await tournament();
    const sam = await entrant("Sam", 10);
    await signIn(ownerId);
    expect((await setPlayerIndex(sam.playerId, { index: 9, expectedFrom: 11, alsoMember: false, reason: "" })).error).toMatch(/changed to 10 meanwhile/);
    expect((await setPlayerIndex(sam.playerId, { index: 9.25, expectedFrom: 10, alsoMember: false, reason: "" })).error).toMatch(/one decimal/);
    expect((await setPlayerIndex(sam.playerId, { index: 60, expectedFrom: 10, alsoMember: false, reason: "" })).error).toMatch(/\+10 to 54/);
    expect(await playerIndex(sam.playerId)).toBe(10);
    const elsewhere = sam.playerId;
    await tournament();
    await signIn(ownerId);
    expect((await setPlayerIndex(elsewhere, { index: 9, expectedFrom: 10, alsoMember: false, reason: "" })).error).toMatch(/isn't in this tournament/);
    expect(await playerIndex(elsewhere)).toBe(10);
  });

  it("CONTROL: a player is refused outright", async () => {
    await tournament();
    const pat = await entrant("Pat", 20);
    const playerUser = await prisma.user.create({ data: { email: mail(`player-${Math.random()}`), name: `${TAG} Player`, password: "x", emailVerifiedAt: new Date() } });
    await prisma.account.create({ data: { eventId, email: playerUser.email, name: `${TAG} Player`, role: "player" } });
    await signIn(playerUser.id);
    await expect(setPlayerIndex(pat.playerId, { index: 2, expectedFrom: 20, alsoMember: false, reason: "" })).rejects.toThrow();
    expect(await playerIndex(pat.playerId)).toBe(20);
  });
});

describe("a round's strokes, carried to later rounds", () => {
  /**
   * The figure is a COURSE handicap: strokes for one course, set of tees and
   * length of round (Rules of Handicapping 6.1). Carried onto a nine-hole round
   * it is twice what that round gives; the golf professional on the review
   * panel found "Use in later rounds too" copied it anyway.
   */
  it("goes only to later rounds of the same course, tees and holes", async () => {
    await tournament();
    await prisma.stage.update({ where: { id: stageIds[2] }, data: { holes: 9 } });
    const kim = await entrant("Kim", 16);
    await signIn(ownerId);
    const { setRoundHandicapOverride, applyRoundHandicapToRest } = await import("@/app/actions/tournament");
    expect((await setRoundHandicapOverride(stageIds[0], kim.playerId, 12)).ok).toBe(true);
    const res = await applyRoundHandicapToRest(stageIds[0], kim.playerId);
    expect(res).toMatchObject({ ok: true, written: 1, skipped: 1 });
    const rows = await prisma.roundHandicap.findMany({ where: { playerId: kim.playerId } });
    expect(rows.find((r) => r.stageId === stageIds[1])?.override).toBe(12);
    expect(rows.find((r) => r.stageId === stageIds[2])?.override ?? null).toBeNull();
  });
});

describe("Members", () => {
  it("takes the index from the club's organizer, with a reason, as a committee adjustment", async () => {
    await tournament();
    const lee = await entrant("Lee", 18.4);
    const other = await prisma.event.create({
      data: {
        organizationId: orgId, name: `${TAG} Spring Meeting`, status: "registration", shape: "single", format: "stroke",
        formationRule: "balanced", dates: "", course: "", city: "", address: "", regDeadline: "", capacity: 0,
        shareToken: `idx-o-${Math.random()}`, registrationToken: `r-idx-o-${Math.random()}`,
      },
    });
    await prisma.player.create({ data: { eventId: other.id, name: `${TAG} Lee`, email: mail(`lee-o-${Math.random()}`), handicap: 18.4, seed: 1, status: "confirmed", memberId: lee.memberId } });
    await signIn(ownerId);

    const facts = await indexChangeFacts(lee.playerId);
    expect(facts.memberRefusal).toBeNull();
    expect(facts.otherEntries?.map((e) => e.name)).toEqual([`${TAG} Spring Meeting`]);

    expect((await setPlayerIndex(lee.playerId, { index: 15, expectedFrom: 18.4, alsoMember: true, reason: "" })).error).toMatch(/Say why/);
    const res = await setPlayerIndex(lee.playerId, { index: 15, expectedFrom: 18.4, alsoMember: true, reason: "Committee adjustment after the championship" });
    expect(res.ok, res.error).toBe(true);
    const m = await memberRow(lee.memberId!);
    expect(m.handicap).toBe(15);
    expect(m.handicapSource).toBe("manual");
    // The other tournament's copy is its own.
    const otherCopy = await prisma.player.findFirstOrThrow({ where: { eventId: other.id } });
    expect(otherCopy.handicap).toBe(18.4);
    const log = await prisma.auditLog.findFirst({ where: { eventId, action: "Committee adjustment (Rule 7.1)" } });
    expect(log?.detail).toContain("and on Members (was 18.4)");
    expect(log?.detail).toContain("Reason: Committee adjustment after the championship");
  });

  it("refuses an assistant, a guest, an association's index, a nine-hole figure, and another club's member", async () => {
    await tournament("hybrid");
    const withGhin = await entrant("Gail", 12, { ghin: "1234567" });
    const nine = await entrant("Nina", 20, { handicapType: "9" });
    const guest = await entrant("Gus", 22, null);
    const stranger = await entrant("Stan", 8, { organizationId: otherOrgId });
    const plain = await entrant("Pia", 11);
    const push = (id: string, from: number) => setPlayerIndex(id, { index: 7, expectedFrom: from, alsoMember: true, reason: "test" });

    await signIn(assistantId);
    expect((await push(plain.playerId, 11)).error).toMatch(/Only the club's organizer/);
    expect((await memberRow(plain.memberId!)).handicap).toBe(11);

    await signIn(ownerId);
    expect((await push(withGhin.playerId, 12)).error).toMatch(/Handicap Committee/);
    expect((await push(nine.playerId, 20)).error).toMatch(/nine-hole/);
    expect((await push(guest.playerId, 22)).error).toMatch(/no member record/);
    // Linked to a member of ANOTHER club: never written; reads as no member here.
    expect((await push(stranger.playerId, 8)).error).toMatch(/no member record/);
    expect((await memberRow(stranger.memberId!)).handicap).toBe(8);
    for (const p of [withGhin, nine, guest, stranger]) expect(await playerIndex(p.playerId)).not.toBe(7);

    // CONTROL: hybrid without a number, at the organizer's hand, goes through.
    expect((await push(plain.playerId, 11)).ok).toBe(true);
    expect((await memberRow(plain.memberId!)).handicap).toBe(7);
  });

  it("the field screen's old door no longer writes Members behind anybody's back", async () => {
    await tournament();
    const ray = await entrant("Ray", 9);
    // The details door is behind the setup lock; this tournament is live, so unlock it for the edit.
    await prisma.event.update({ where: { id: eventId }, data: { configUnlocked: true } });
    await signIn(ownerId);
    const res = await updateSignup(ray.playerId, { handicap: 6 });
    expect(res.ok, res.error).toBe(true);
    expect(await playerIndex(ray.playerId)).toBe(6);
    expect((await memberRow(ray.memberId!)).handicap).toBe(9);
  });
});
