import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A CASUAL ROUND TAKES A HANDICAP CORRECTION; A TOURNAMENT DOES NOT
 * (2026-10-07).
 *
 * A round freezes everybody's handicap at its first card. On a casual round
 * the host's correction in Players & handicaps was saved to the roster and
 * ignored by the round — measured: Bea corrected from 10 to 20 after the 1st
 * kept a 10's shots on every screen while the panel read 20. The correction
 * now un-freezes that player on a casual round, so the round reads it.
 *
 * The CONTROL is the half that must not move: in a tournament a played round
 * is never re-priced by a roster edit — the committee has the override.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-CASUALHCP";
const email = `${TAG}.host@example.invalid`.toLowerCase();

let session: { eventId: string; email: string; viewRole: string; name: string; role: string; userId: string; accountId: string } | null = null;

vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { updateSignup } = await import("@/app/actions/tournament");
const { loadEventState } = await import("@/lib/services/tournament");

type Round = { eventId: string; stageId: string; ann: string; bea: string };
const rounds: { casual: Round; tournament: Round } = {
  casual: { eventId: "", stageId: "", ann: "", bea: "" },
  tournament: { eventId: "", stageId: "", ann: "", bea: "" },
};

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function round(orgId: string, kind: "casual" | "tournament"): Promise<Round> {
  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${kind}`,
      shape: kind === "casual" ? "match" : "single",
      status: "live",
      // As `match-setup.ts` creates every casual round — and on the
      // tournament too, so the control is an organizer who HAS unlocked it
      // to make an edit, which still must not re-price a played round.
      configUnlocked: true,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${kind}-${process.pid}`,
    },
  });
  await prisma.account.create({ data: { eventId: event.id, email, name: "zz host", role: "admin" } });
  const stage = await prisma.stage.create({
    data: { eventId: event.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18, scoringBasis: "net" },
  });
  const ann = await prisma.player.create({ data: { eventId: event.id, name: `${TAG} Ann`, email: `${TAG}.${kind}.ann@example.invalid`.toLowerCase(), seed: 1, status: "confirmed", handicap: 10 } });
  const bea = await prisma.player.create({ data: { eventId: event.id, name: `${TAG} Bea`, email: `${TAG}.${kind}.bea@example.invalid`.toLowerCase(), seed: 2, status: "confirmed", handicap: 10 } });
  return { eventId: event.id, stageId: stage.id, ann: ann.id, bea: bea.id };
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  rounds.casual = await round(org.id, "casual");
  rounds.tournament = await round(org.id, "tournament");
});

beforeEach(async () => {
  // Both rounds as they stand after the first card: Ann and Bea frozen at 10.
  for (const r of Object.values(rounds)) {
    await prisma.player.updateMany({ where: { eventId: r.eventId }, data: { handicap: 10 } });
    await prisma.roundHandicap.deleteMany({ where: { eventId: r.eventId } });
    for (const playerId of [r.ann, r.bea]) {
      await prisma.roundHandicap.create({ data: { eventId: r.eventId, stageId: r.stageId, playerId, frozen: 10, frozenAt: new Date() } });
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

const signInTo = (r: Round) => {
  session = { eventId: r.eventId, email, viewRole: "admin", name: "zz host", role: "admin", userId: "zz", accountId: "" };
};
const frozenOf = async (r: Round, playerId: string) =>
  (await prisma.roundHandicap.findFirst({ where: { stageId: r.stageId, playerId } }))?.frozen ?? null;

describe("a handicap corrected after the first card", () => {
  it("on a casual round, the round plays off the correction", async () => {
    const r = rounds.casual;
    signInTo(r);
    expect((await updateSignup(r.bea, { handicap: 20 })).ok).toBe(true);
    expect(await frozenOf(r, r.bea), "Bea is still frozen at the typo").toBeNull();
    // And the round's own resolver reads it: more shots for a 20 than a 10.
    const state = await loadEventState(r.eventId);
    expect(state!.strokeHandicapFor(r.bea, r.stageId)).toBeGreaterThan(state!.strokeHandicapFor(r.ann, r.stageId));
  });

  it("on a casual round, nobody else's frozen handicap moves", async () => {
    const r = rounds.casual;
    signInTo(r);
    await updateSignup(r.bea, { handicap: 20 });
    expect(await frozenOf(r, r.ann)).toBe(10);
  });

  it("CONTROL: in a tournament, a played round keeps the handicap it was scored on", async () => {
    const r = rounds.tournament;
    signInTo(r);
    expect((await updateSignup(r.bea, { handicap: 20 })).ok).toBe(true);
    expect(await frozenOf(r, r.bea)).toBe(10);
    const state = await loadEventState(r.eventId);
    expect(state!.strokeHandicapFor(r.bea, r.stageId)).toBe(state!.strokeHandicapFor(r.ann, r.stageId));
  });
});
