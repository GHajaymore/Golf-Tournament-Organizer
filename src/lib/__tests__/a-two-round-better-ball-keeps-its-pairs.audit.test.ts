import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A TWO-ROUND BETTER-BALL KEEPS ITS PAIRS (2026-10-10).
 *
 * Walked on a club's 120-player Autumn Better-Ball: the secretary drew sides
 * for Round 1 and launched, which locks setup. Round 2 had no sides; its tee
 * sheet was drawn player by player and split every partnership, and drawing
 * Round 2's sides meant unlocking setup mid-event. `autoDrawTeams` now gives
 * the same pairs to every other round of the format that has none.
 *
 * Controls: a round that already has its own sides is left exactly as built,
 * and a round in another format is not touched.
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

import { createSession, setActiveEvent } from "@/lib/auth";
import { autoDrawTeams } from "@/app/actions/teams";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-PAIRS-KEPT";
const at = (who: string) => `${TAG}.${who}@example.invalid`.toLowerCase();

let eventId = "";
const round: Record<string, string> = {};
const p: string[] = [];

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

const pairsOf = async (stageId: string) =>
  (await prisma.team.findMany({ where: { stageId }, select: { members: { select: { playerId: true } } } }))
    .map((t) => t.members.map((m) => m.playerId).sort().join("+"))
    .sort();

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" }, select: { id: true } });
  eventId = (
    await prisma.event.create({
      data: {
        name: `${TAG} better-ball`,
        organizationId: org.id,
        status: "draft",
        format: "stroke",
        dates: "",
        course: "",
        city: "",
        address: "",
        regDeadline: "",
        shareToken: `${TAG}-share`,
      },
      select: { id: true },
    })
  ).id;
  const rounds: Array<[string, string]> = [
    ["r1", "Four-Ball"],
    ["r2", "Four-Ball"],
    ["r3", "Four-Ball"],
    ["scramble", "Scramble"],
  ];
  for (const [i, [key, format]] of rounds.entries()) {
    round[key] = (
      await prisma.stage.create({
        data: { eventId, type: "Stroke Play Round", format, holes: 18, scoringBasis: "net", position: i, description: key },
        select: { id: true },
      })
    ).id;
  }
  for (let i = 0; i < 8; i += 1) {
    p.push(
      (
        await prisma.player.create({
          data: { eventId, name: `${TAG} P${i}`, email: at(`p${i}`), seed: i + 1, status: "confirmed", handicap: 2 + i * 4 },
          select: { id: true },
        })
      ).id,
    );
  }
  // Round 3 already has the committee's own side — a different pairing.
  await prisma.team.create({
    data: { eventId, stageId: round.r3, name: "Hand-made", members: { create: [{ playerId: p[0] }, { playerId: p[1] }] } },
  });
  const admin = await prisma.user.create({ data: { email: at("org"), name: "org", password: "x:unusable" }, select: { id: true } });
  await prisma.account.create({ data: { eventId, email: at("org"), name: "org", role: "admin" } });
  jar.clear();
  await createSession(admin.id);
  await setActiveEvent(eventId);
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("drawing the pairs once for a two-round better-ball", () => {
  it("gives Round 2 the same pairs as Round 1", async () => {
    const res = await autoDrawTeams(round.r1);
    expect(res).toMatchObject({ ok: true, alsoRounds: 1 });
    const one = await pairsOf(round.r1);
    expect(one).toHaveLength(4);
    expect(await pairsOf(round.r2)).toEqual(one);
  });

  it("CONTROL: a round with the committee's own sides is left as built", async () => {
    expect(await pairsOf(round.r3)).toEqual([[p[0], p[1]].sort().join("+")]);
  });

  it("CONTROL: a round in another format is not touched", async () => {
    expect(await pairsOf(round.scramble)).toEqual([]);
  });
});
