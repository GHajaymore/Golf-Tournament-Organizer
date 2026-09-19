import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * ONE PHONE KEEPS THE FOURSOME'S CARD — AND NOBODY ELSE'S.
 *
 * The club asked for score entry "individual and foursome". `saveScorecard`
 * now lets a player keep the card of a partner drawn into their group on the
 * round's PUBLISHED tee sheet (domain/group-entry.ts). Everything that widens
 * who may write a score is asserted here against real rows, because the rule
 * is a join between the session, the field and a stored sheet — a mocked
 * Prisma would be asserting my own stub.
 *
 *   - a partner in the published group: may keep the card;
 *   - a player in ANOTHER group of the same round: refused;
 *   - the same partner while the sheet is still a DRAFT: refused;
 *   - a partner who has WITHDRAWN but is still on the sheet: refused;
 *   - the partner's card: may NOT be certified or disputed by the marker.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-MARKER";

let session: { eventId: string; email: string; viewRole: string; name: string; role: string } | null = null;

vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { saveScorecard, certifyScorecard, disputeScorecard } = await import("@/app/actions/tournament");

let eventId = "";
let stageId = "";
const ids: Record<"me" | "partner" | "gone" | "other", string> = { me: "", partner: "", gone: "", other: "" };
const email = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();

const NINE = [4, 5, 3, 4, 4, 4, 3, 4, 5, null, null, null, null, null, null, null, null, null];

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function sheet(published: boolean) {
  await prisma.stage.update({
    where: { id: stageId },
    data: {
      teeSheetPublished: published,
      teeSheet: JSON.stringify({
        savedAt: "",
        startType: "tee",
        groups: [
          { name: "Group 1", startHole: 1, time: "8:10", playerIds: [ids.me, ids.partner, ids.gone] },
          { name: "Group 2", startHole: 1, time: "8:20", playerIds: [ids.other] },
        ],
      }),
    },
  });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} medal`,
      status: "live",
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
    },
  });
  eventId = event.id;
  const stage = await prisma.stage.create({
    data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 },
  });
  stageId = stage.id;
  const make = async (who: keyof typeof ids, seed: number, status = "confirmed") => {
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} ${who}`, email: email(who), seed, status },
    });
    ids[who] = p.id;
  };
  await make("me", 1);
  await make("partner", 2);
  await make("gone", 3, "withdrawn");
  await make("other", 4);
});

beforeEach(async () => {
  session = { eventId, email: email("me"), viewRole: "player", name: "me", role: "player" };
  await prisma.scorecard.deleteMany({ where: { stageId } });
  await sheet(true);
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const cardOf = (playerId: string) => prisma.scorecard.findFirst({ where: { stageId, playerId } });

describe("a player keeping score for their group", () => {
  it("may keep their own card, as before", async () => {
    const res = await saveScorecard(stageId, ids.me, NINE);
    expect(res.ok).toBe(true);
  });

  it("may keep a partner's card when the published sheet drew them together", async () => {
    const res = await saveScorecard(stageId, ids.partner, NINE);
    expect(res.ok).toBe(true);
    expect(JSON.parse((await cardOf(ids.partner))!.strokes)).toEqual(NINE);
  });

  it("may not keep the card of a player in another group", async () => {
    await expect(saveScorecard(stageId, ids.other, NINE)).rejects.toThrow(/group you were drawn with/);
    expect(await cardOf(ids.other)).toBeNull();
  });

  it("may not keep a partner's card while the sheet is still a draft", async () => {
    await sheet(false);
    await expect(saveScorecard(stageId, ids.partner, NINE)).rejects.toThrow(/group you were drawn with/);
    expect(await cardOf(ids.partner)).toBeNull();
  });

  it("may not keep the card of a partner who has withdrawn", async () => {
    // Refused one guard earlier or here — either way nothing is written.
    await expect(saveScorecard(stageId, ids.gone, NINE)).rejects.toThrow();
    expect(await cardOf(ids.gone)).toBeNull();
  });

  it("may not certify or dispute the partner's card it kept", async () => {
    await saveScorecard(stageId, ids.partner, NINE);
    await expect(certifyScorecard(stageId, ids.partner)).rejects.toThrow(/own scorecard/);
    await expect(disputeScorecard(stageId, ids.partner)).rejects.toThrow(/own scorecard/);
    expect((await cardOf(ids.partner))!.status).toBe("entered");
  });

  it("a player in the other group cannot reach into this one either", async () => {
    session = { eventId, email: email("other"), viewRole: "player", name: "other", role: "player" };
    await expect(saveScorecard(stageId, ids.me, NINE)).rejects.toThrow(/group you were drawn with/);
  });
});
