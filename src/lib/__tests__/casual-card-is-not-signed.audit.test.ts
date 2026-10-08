import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A CASUAL CARD IS NOT SIGNED, AND THE SERVER SAYS SO (Ajay, 2026-10-07: "no
 * certification for casual card").
 *
 * The screens stopped offering Certify and "Something on this card is wrong"
 * on a casual round. A server action is a public endpoint, so the refusal
 * lives where the row is written: `certifyCard`, which the console, the
 * player's card and the Round Code all sign through, and `disputeScorecard`.
 *
 * The control is the same card on a tournament, which still signs and still
 * disputes. Without it a refusal for everybody would pass.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CASUALSIGN";
const email = `${TAG}.host@example.invalid`.toLowerCase();

let session: { eventId: string; email: string; viewRole: string; name: string; role: string; userId: string; accountId: string } | null = null;

vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { certifyScorecard, disputeScorecard } = await import("@/app/actions/tournament");
const { certifyCard } = await import("@/lib/services/scorecard-write");
const { NO_SIGNING_REFUSAL } = await import("@/lib/tournament-shape");

type Round = { event: string; stage: string; player: string };
const casual: Round = { event: "", stage: "", player: "" };
const medal: Round = { event: "", stage: "", player: "" };
const CARD = JSON.stringify(new Array(18).fill(4));

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function round(into: Round, orgId: string, shape: string) {
  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${shape}`,
      shape,
      status: "live",
      configUnlocked: true,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${shape}-${process.pid}`,
    },
  });
  await prisma.account.create({ data: { eventId: event.id, email, name: "zz host", role: "admin" } });
  const stage = await prisma.stage.create({
    data: { eventId: event.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 },
  });
  const player = await prisma.player.create({
    data: { eventId: event.id, name: `${TAG} Ann`, email: `${TAG}.ann@example.invalid`.toLowerCase(), seed: 1, status: "confirmed" },
  });
  Object.assign(into, { event: event.id, stage: stage.id, player: player.id });
}

const asHost = (r: Round) => {
  session = { eventId: r.event, email, viewRole: "admin", name: "zz host", role: "admin", userId: "zz", accountId: "" };
};
const status = async (r: Round) =>
  (await prisma.scorecard.findFirst({ where: { eventId: r.event, stageId: r.stage, playerId: r.player } }))?.status;

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  await round(casual, org.id, "match");
  await round(medal, org.id, "single");
});

beforeEach(async () => {
  for (const r of [casual, medal]) {
    await prisma.scorecard.deleteMany({ where: { eventId: r.event } });
    await prisma.scorecard.create({ data: { eventId: r.event, stageId: r.stage, playerId: r.player, strokes: CARD } });
  }
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("a casual card", () => {
  it("refuses a signature from the console or the player's card", async () => {
    asHost(casual);
    await expect(certifyScorecard(casual.stage, casual.player)).rejects.toThrow(NO_SIGNING_REFUSAL);
    expect(await status(casual)).toBe("entered");
  });

  it("refuses a signature by round code, which signs through the same function", async () => {
    await expect(
      certifyCard({ eventId: casual.event, stageId: casual.stage, playerId: casual.player, by: "Ann" }),
    ).rejects.toThrow(NO_SIGNING_REFUSAL);
    expect(await status(casual)).toBe("entered");
  });

  it("refuses a dispute — nobody accepts the card, so nobody can be asked not to", async () => {
    asHost(casual);
    await expect(disputeScorecard(casual.stage, casual.player)).rejects.toThrow(NO_SIGNING_REFUSAL);
    expect(await status(casual)).toBe("entered");
  });
});

describe("the control: a tournament card", () => {
  it("still signs", async () => {
    asHost(medal);
    await certifyScorecard(medal.stage, medal.player);
    expect(await status(medal)).toBe("certified");
  });

  it("still disputes", async () => {
    asHost(medal);
    await disputeScorecard(medal.stage, medal.player);
    expect(await status(medal)).toBe("disputed");
  });
});
