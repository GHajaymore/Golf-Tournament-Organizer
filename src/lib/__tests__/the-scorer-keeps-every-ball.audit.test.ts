import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * THE GROUP'S SCORER KEEPS EVERY BALL, ON A MATCH KEPT ON STROKE CARDS (PM and
 * Golf Pro, 2026-11-05).
 *
 * On a round whose matches are kept on stroke cards (`matchKeptBy: "cards"`)
 * each ball has its own card, and on a round kept by one scorer per group
 * nobody but the scorer may write. So the scorer's phone keeps the other
 * ball too: `savePlayMatchCard(match, strokes, { epoch, playerId })` writes the
 * NAMED ball's card, never the scorer's own — and the match is derived from
 * both. Driven through the real action with a phone's cookie jar; the screen's
 * half (a card a ball, picked by name) is `e2e/scoring-by-group-phones.spec.ts`.
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

const { claimPlayerSlot, savePlayMatchCard } = await import("@/app/actions/play");
const { clearRateLimit } = await import("@/lib/rate-limit");
const { generateAccessCode } = await import("@/lib/codes");

const prisma = new PrismaClient();
const TAG = "zz-every-ball";
const CODE = generateAccessCode();
const ids = { event: "", stage: "", match: "", ann: "", bea: "" };

async function phoneOf(id: string) {
  jar.clear();
  const res = await claimPlayerSlot(CODE, id);
  expect(res.ok, res.error).toBe(true);
}

const slotCard = async (slot: "A" | "B") =>
  (await prisma.matchScorecard.findFirst({ where: { matchId: ids.match, slot }, select: { strokes: true } }))?.strokes ?? null;

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
      name: `${TAG} singles`,
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
      customStrokeIndex: JSON.stringify(Array.from({ length: 18 }, (_, i) => i + 1)),
      playerAccess: "code",
      scoreEntryBy: "players",
      scoreEntryWindow: "during",
    },
  });
  ids.event = event.id;
  const group = await prisma.group.create({ data: { eventId: event.id, name: "A", position: 0 } });
  const person = async (who: string, i: number) =>
    (
      await prisma.player.create({
        data: { eventId: event.id, groupId: group.id, name: `${TAG} ${who}`, email: `${TAG}.${who}@example.invalid`, seed: i + 1, status: "confirmed", handicap: 0 },
      })
    ).id;
  ids.ann = await person("ann", 0);
  ids.bea = await person("bea", 1);
  ids.stage = (
    await prisma.stage.create({
      data: {
        eventId: event.id,
        position: 0,
        type: "Single Match Stage",
        format: "Match Play",
        holes: 9,
        nine: "front",
        scoringBasis: "gross",
        accessCode: CODE,
        matchKeptBy: "cards",
        scoreKeeping: "group",
        endCheck: "on",
      },
    })
  ).id;
  ids.match = (
    await prisma.match.create({
      data: { eventId: event.id, stageId: ids.stage, groupId: group.id, round: 1, playerAId: ids.ann, playerBId: ids.bea, holes: JSON.stringify(new Array(9).fill(null)) },
    })
  ).id;
});

afterAll(async () => {
  try {
    await clearRateLimit("round-code", CODE);
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const nine = (first: number) => [first, ...new Array(8).fill(null)];

describe("a match kept on stroke cards, one scorer per group", () => {
  it("the scorer enters the other player's ball, named — and it lands on that ball's card, not hers", async () => {
    await phoneOf(ids.ann); // the confirmation makes Ann's phone the scorer
    const own = await savePlayMatchCard(ids.match, nine(4));
    expect(own.ok, own.error).toBe(true);
    const epoch = own.epoch;
    expect(epoch).toBeGreaterThan(0);
    const bea = await savePlayMatchCard(ids.match, nine(5), { epoch, playerId: ids.bea });
    expect(bea.ok, bea.error).toBe(true);
    expect(JSON.parse((await slotCard("B")) ?? "[]")[0], "Bea's ball was not written to her card").toBe(5);
    expect(JSON.parse((await slotCard("A")) ?? "[]")[0], "the scorer's own card was overwritten with Bea's ball").toBe(4);
    // Both balls in: the match is derived from them — Ann's four beats Bea's five.
    const holes = JSON.parse((await prisma.match.findUniqueOrThrow({ where: { id: ids.match } })).holes) as unknown[];
    expect(holes[0]).toBe("A");
  });

  it("Bea's own phone is refused beside the scorer, in words", async () => {
    await phoneOf(ids.bea);
    const res = await savePlayMatchCard(ids.match, nine(3));
    expect(res.ok).toBe(false);
    expect(res.error).toContain(`${TAG} ann is keeping score for your group`);
    expect(JSON.parse((await slotCard("B")) ?? "[]")[0]).toBe(5);
  });

  it("CONTROL: where each player keeps their own, nobody writes another's ball", async () => {
    await prisma.stage.update({ where: { id: ids.stage }, data: { scoreKeeping: "each" } });
    try {
      await phoneOf(ids.ann);
      const res = await savePlayMatchCard(ids.match, nine(6), { playerId: ids.bea });
      expect(res.ok).toBe(false);
      expect(res.error).toBe("You can only enter your own card.");
    } finally {
      await prisma.stage.update({ where: { id: ids.stage }, data: { scoreKeeping: "group" } });
    }
  });
});
