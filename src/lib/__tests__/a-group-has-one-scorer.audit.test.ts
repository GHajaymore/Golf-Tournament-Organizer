import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A GROUP HAS ONE SCORER (2026-11-04, sprint 2 part B).
 *
 * At a real team cup (2026-10-18) every phone in a four-ball could write the
 * match, and two did. On a round kept by ONE SCORER PER GROUP
 * (`Stage.scoreKeeping: "group"`) one phone keeps the group's card: it may
 * keep a groupmate's card, nobody else in the group may write beside it, a
 * take-over moves the card and is logged, and the phone that was taken over
 * is refused from its next save because its epoch is stale.
 *
 * Driven through the real actions against real rows — the round-code saves
 * (`actions/play.ts`) with a phone's cookie jar, and the signed-in player's
 * save (`saveScorecard`) with a session — because the rule is in the action,
 * not the screen, and the screen is what a second phone skips.
 *
 * "Each player enters their own" (every round before this existed) is
 * asserted unchanged, and "Organizer only (paper cards)" refuses players.
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
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

let session: Record<string, string> | null = null;
vi.mock("@/lib/auth", async (original) => ({
  ...(await original<typeof import("@/lib/auth")>()),
  getSession: async () => session,
}));

const { claimPlayerSlot, savePlayCard, keepGroup, handOverGroup } = await import("@/app/actions/play");
const { saveScorecard, setStageScoring } = await import("@/app/actions/tournament");
const { claimGroup } = await import("@/lib/services/group-keeping");
const { clearRateLimit } = await import("@/lib/rate-limit");
const { generateAccessCode } = await import("@/lib/codes");
const { ORGANIZER_KEEPS_THIS_ROUND } = await import("@/lib/domain/round-scoring");

const prisma = new PrismaClient();
const TAG = "zz-one-scorer";
const CODE = generateAccessCode();
const at = (who: string) => `${TAG}.${who}@example.invalid`;
let eventId = "";
let stageId = "";
const p: Record<string, string> = {};
const CARD = new Array(18).fill(4);

/** This phone taps a name, as the round-code screen does. */
async function phoneOf(who: string) {
  jar.clear();
  const res = await claimPlayerSlot(CODE, p[who]);
  expect(res.ok, res.error).toBe(true);
}

const keeperRow = () => prisma.scoringKeeper.findMany({ where: { eventId, stageId } });

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} medal`,
      status: "live",
      shape: "single",
      format: "stroke",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${Date.now()}`,
      customPars: JSON.stringify(new Array(18).fill(4)),
      playerAccess: "both",
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
    },
  });
  eventId = event.id;
  for (const [i, who] of ["ann", "bea", "cat"].entries()) {
    p[who] = (
      await prisma.player.create({ data: { eventId, name: `${TAG} ${who}`, email: at(who), seed: i + 1, status: "confirmed", handicap: 0 } })
    ).id;
  }
  // Ann and Bea off the first tee together; Cat in the group behind.
  const teeSheet = JSON.stringify({
    savedAt: new Date().toISOString(),
    startType: "tee",
    groups: [
      { name: "Group 1", startHole: 1, time: "8:00 AM", playerIds: [p.ann, p.bea] },
      { name: "Group 2", startHole: 1, time: "8:10 AM", playerIds: [p.cat] },
    ],
  });
  stageId = (
    await prisma.stage.create({
      data: {
        eventId,
        position: 0,
        type: "Stroke Play Round",
        format: "Individual Stroke Play",
        holes: 18,
        scoringBasis: "gross",
        accessCode: CODE,
        teeSheet,
        teeSheetPublished: true,
        scoreKeeping: "group",
        endCheck: "on",
      },
    })
  ).id;
  // Bea also has an account, for the signed-in player's door.
  await prisma.account.create({ data: { eventId, email: at("bea"), name: `${TAG} bea`, role: "player" } });
});

afterAll(async () => {
  try {
    await clearRateLimit("round-code", CODE);
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("one scorer per group, from the round-code phones", () => {
  it("the first phone to save becomes the group's scorer; a groupmate's save beside it is refused, naming her", async () => {
    await phoneOf("ann");
    const first = await savePlayCard(CARD);
    expect(first.ok, first.error).toBe(true);
    expect(first.epoch).toBe(1);

    await phoneOf("bea");
    const beside = await savePlayCard(CARD);
    expect(beside.ok).toBe(false);
    expect(beside.error).toContain(`${TAG} ann is keeping score for your group`);
    expect(await prisma.scorecard.count({ where: { eventId, stageId, playerId: p.bea } }), "a refused save wrote a card").toBe(0);
    expect(await keeperRow()).toHaveLength(1);
  });

  it("the scorer keeps a groupmate's card — and nobody outside the group's", async () => {
    await phoneOf("ann");
    const bea = await savePlayCard(CARD, { playerId: p.bea, epoch: 1 });
    expect(bea.ok, bea.error).toBe(true);
    expect(await prisma.scorecard.count({ where: { eventId, stageId, playerId: p.bea } })).toBe(1);
    const cat = await savePlayCard(CARD, { playerId: p.cat, epoch: 1 });
    expect(cat.ok).toBe(false);
    expect(cat.error).toMatch(/your own group/);
  });

  it("a take-over moves the card, is logged by both names, and the old phone's epoch is stale", async () => {
    await phoneOf("bea");
    const refusedClaim = await keepGroup({});
    expect(refusedClaim.ok).toBe(false);
    expect(refusedClaim.keeperName).toBe(`${TAG} ann`);

    const took = await keepGroup({ takeOver: true });
    expect(took.ok, took.error).toBe(true);
    expect(took.epoch).toBe(2);
    const log = await prisma.auditLog.findFirst({ where: { eventId, action: "keeper.takeover" } });
    expect(log?.detail).toBe(`${TAG} bea took over keeping score from ${TAG} ann`);

    await phoneOf("ann");
    const stale = await savePlayCard(CARD, { epoch: 1 });
    expect(stale.ok, "a phone that was taken over still wrote the card").toBe(false);
    expect(stale.error).toContain(`${TAG} bea is keeping score for your group`);
  });

  it("the same scorer on a second phone, holding an old epoch, is refused as stale", async () => {
    // Bea keeps it at epoch 2; a phone of hers still holding epoch 1.
    await phoneOf("bea");
    const stale = await savePlayCard(CARD, { epoch: 1 });
    expect(stale.ok).toBe(false);
    expect(stale.error).toMatch(/moved to another phone/);
    const current = await savePlayCard(CARD, { epoch: 2 });
    expect(current.ok, current.error).toBe(true);
  });

  it("the scorer hands the card on, within the group only", async () => {
    await phoneOf("bea");
    const outside = await handOverGroup(p.cat);
    expect(outside.ok).toBe(false);
    const back = await handOverGroup(p.ann);
    expect(back.ok, back.error).toBe(true);
    expect(back.epoch).toBe(3);
    expect((await keeperRow())[0].playerId).toBe(p.ann);
    // Bea no longer keeps it, so she cannot hand it on again.
    expect((await handOverGroup(p.ann)).ok).toBe(false);
  });

  it("two phones claiming at once leave ONE scorer (an upsert, not a read-then-write)", async () => {
    await prisma.scoringKeeper.deleteMany({ where: { eventId, stageId } });
    const both = await Promise.all([
      claimGroup({ eventId, stageId, actorId: p.ann, actorName: "ann", takeOver: false }),
      claimGroup({ eventId, stageId, actorId: p.bea, actorName: "bea", takeOver: false }),
    ]);
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    expect(await keeperRow()).toHaveLength(1);
  });
});

describe("the signed-in player's door asks the same lock", () => {
  it("Bea, signed in, cannot write her card beside the group's scorer", async () => {
    await prisma.scoringKeeper.deleteMany({ where: { eventId, stageId } });
    await claimGroup({ eventId, stageId, actorId: p.ann, actorName: "ann", takeOver: false });
    session = { userId: "", accountId: "", eventId, name: `${TAG} bea`, email: at("bea"), role: "player", viewRole: "player" };
    await expect(saveScorecard(stageId, p.bea, CARD)).rejects.toThrow(`${TAG} ann is keeping score for your group`);
    session = null;
  });
});

describe("the other two ways a round is kept", () => {
  it("each player enters their own: exactly as before — your own card, nobody's else", async () => {
    await prisma.stage.update({ where: { id: stageId }, data: { scoreKeeping: "each" } });
    try {
      await phoneOf("bea");
      const own = await savePlayCard(CARD);
      expect(own.ok, own.error).toBe(true);
      expect(own.epoch, "a round kept 'each' handed out a scorer's epoch").toBeUndefined();
      const other = await savePlayCard(CARD, { playerId: p.ann });
      expect(other.ok).toBe(false);
      expect(other.error).toBe("You can only enter your own card.");
    } finally {
      await prisma.stage.update({ where: { id: stageId }, data: { scoreKeeping: "group" } });
    }
  });

  it("organizer only (paper cards): a player's save is refused in words", async () => {
    await prisma.stage.update({ where: { id: stageId }, data: { scoreKeeping: "organizer" } });
    try {
      await phoneOf("cat");
      const res = await savePlayCard(CARD);
      expect(res.ok).toBe(false);
      expect(res.error).toBe(ORGANIZER_KEEPS_THIS_ROUND);
      session = { userId: "", accountId: "", eventId, name: `${TAG} bea`, email: at("bea"), role: "player", viewRole: "player" };
      await expect(saveScorecard(stageId, p.bea, CARD)).rejects.toThrow(ORGANIZER_KEEPS_THIS_ROUND);
    } finally {
      session = null;
      await prisma.stage.update({ where: { id: stageId }, data: { scoreKeeping: "group" } });
    }
  });
});

describe("the organizer's setting", () => {
  it("refuses a switch to one scorer per group once two players have entered their own; allows the way back", async () => {
    await prisma.stage.update({ where: { id: stageId }, data: { scoreKeeping: "each" } });
    session = { userId: "", accountId: "", eventId, name: "Organizer", email: at("organizer"), role: "admin", viewRole: "admin" };
    try {
      // Ann's and Bea's cards are in, from the cases above.
      const late = await setStageScoring(stageId, { scoreKeeping: "group" });
      expect(late.ok).toBe(false);
      expect(late.error).toMatch(/already entered their own scores/);
      expect((await prisma.stage.findUniqueOrThrow({ where: { id: stageId } })).scoreKeeping).toBe("each");
      expect((await setStageScoring(stageId, { scoreKeeping: "organizer", endCheck: "off" })).ok).toBe(true);
      const after = await prisma.stage.findUniqueOrThrow({ where: { id: stageId } });
      expect([after.scoreKeeping, after.endCheck]).toEqual(["organizer", "off"]);
      expect((await setStageScoring(stageId, { scoreKeeping: "nonsense" })).ok).toBe(false);
    } finally {
      session = null;
    }
  });

  it("CONTROL: before anyone has entered, the switch to one scorer is allowed", async () => {
    await prisma.scorecard.deleteMany({ where: { eventId, stageId } });
    session = { userId: "", accountId: "", eventId, name: "Organizer", email: at("organizer"), role: "admin", viewRole: "admin" };
    try {
      expect((await setStageScoring(stageId, { scoreKeeping: "group" })).ok).toBe(true);
    } finally {
      session = null;
    }
  });
});
