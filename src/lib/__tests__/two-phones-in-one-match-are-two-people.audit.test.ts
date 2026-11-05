import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * TWO PHONES IN ONE MATCH ARE TWO PEOPLE (2026-11-05, the rounds on 60bf2912).
 *
 * A match kept by tapping is one card, the same whoever opens it, so sprint 1
 * opened a confirmed match group as its FIRST player — side A's — whoever held
 * the phone. On a round kept by ONE SCORER PER GROUP that made every phone in
 * the match the same player: Ailsa confirmed and kept the card, then Bram
 * confirmed the same match, his phone became Ailsa too, and it was the keeper
 * as well — two phones each believing they keep the card, the defect this
 * sprint exists to prevent. Found by `e2e/scoring-by-group-phones.spec.ts` on
 * every device.
 *
 * Now, where the round keeps one scorer per group, a confirmed match group asks
 * "Which one are you?" (`groupNeedsName`), so each phone is its own player, and
 * the second to confirm follows the first. Driven through the form path the
 * no-script phone posts (`claimPlayerSlotForm`) — the same decision the
 * scripted tap takes in `PlayClient`.
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

const { claimPlayerSlotForm, redeemRoundCode } = await import("@/app/actions/play");
const { getPlaySession } = await import("@/lib/play-auth");
const { keeperFor } = await import("@/lib/services/group-keeping");
const { keepingRole } = await import("@/lib/domain/keeping-words");
const { clearRateLimit } = await import("@/lib/rate-limit");
const { generateAccessCode } = await import("@/lib/codes");

const prisma = new PrismaClient();
const TAG = "zz-two-phones";
const CODE = generateAccessCode();
const ids = { event: "", stage: "", match: "", ailsa: "", bram: "" };

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

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
  ids.ailsa = await person("ailsa", 0);
  ids.bram = await person("bram", 1);
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
        matchKeptBy: "holes",
        scoreKeeping: "group",
        endCheck: "on",
      },
    })
  ).id;
  ids.match = (
    await prisma.match.create({
      data: { eventId: event.id, stageId: ids.stage, groupId: group.id, round: 1, playerAId: ids.ailsa, playerBId: ids.bram, holes: JSON.stringify(new Array(9).fill(null)) },
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

/** A phone confirms the match group, then — asked which one it is — names its player. */
async function confirmAs(playerId: string) {
  jar.clear();
  const key = (await redeemRoundCode(CODE)).groups?.[0]?.key ?? "";
  expect(key).toBe(`match:${ids.match}`);
  const asked = await claimPlayerSlotForm(null, form({ code: CODE, group: key, confirmed: "yes" }));
  // Never opened as side A's player on somebody else's phone.
  expect(asked.step?.kind, "a confirmed match opened as its first player, whoever holds the phone").toBe("pick");
  expect(await getPlaySession()).toBeNull();
  await expect(claimPlayerSlotForm(null, form({ code: CODE, group: key, confirmed: "yes", playerId }))).rejects.toThrow(/NEXT_REDIRECT/);
  expect((await getPlaySession())?.playerId).toBe(playerId);
}

describe("one scorer per group: the second phone in a match follows the first", () => {
  it("Ailsa confirms and keeps; Bram confirms the same match as Bram, and follows her", async () => {
    await confirmAs(ids.ailsa);
    const ailsa = await keeperFor(ids.event, ids.stage, ids.ailsa);
    expect(ailsa?.keeper?.playerId).toBe(ids.ailsa);
    expect(keepingRole({ me: ids.ailsa, keeperId: ailsa?.keeper?.playerId ?? null, refusedBy: null })).toBe("keeper");

    await confirmAs(ids.bram);
    const bram = await keeperFor(ids.event, ids.stage, ids.bram);
    expect(bram?.keeper?.playerId, "Bram's confirmation took the card").toBe(ids.ailsa);
    expect(keepingRole({ me: ids.bram, keeperId: bram?.keeper?.playerId ?? null, refusedBy: null })).toBe("follower");
    expect(await prisma.scoringKeeper.count({ where: { eventId: ids.event, stageId: ids.stage } })).toBe(1);
  });
});
