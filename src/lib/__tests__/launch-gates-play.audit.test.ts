import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { playRefusalFor } from "@/lib/services/action-shared";

/**
 * THE GATE AGAINST REAL ROWS.
 *
 * `launch-gates-play.test.ts` proves the RULE. This proves the QUERY behind it,
 * which is the half that can be wrong on its own: "has anything been played"
 * is answered from two different tables, and asking either alone gets it wrong
 * for half the product — a pure stroke tournament has no matches and a pure
 * match one has no cards. That is the exact fault `resultsIn` was written to
 * fix for the dashboard banner, and this gate would have reintroduced it.
 *
 * Every case here decides whether a real person can enter a real score, and
 * the one that matters most is the tournament already UNDER WAY in draft: it
 * must be let through, because a player mid-round cannot launch anything.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-LAUNCH-GATE";

let orgId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  orgId = org.id;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

async function event(name: string, status: string) {
  return prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${name}`,
      status,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${name}-${Date.now()}`,
    },
  });
}

async function stage(eventId: string) {
  return prisma.stage.create({
    data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 },
  });
}

describe("a tournament nobody has played yet", () => {
  it("refuses a score while it sits in draft", async () => {
    const e = await event("fresh", "draft");
    await stage(e.id);
    const refusal = await playRefusalFor(e.id);
    expect(refusal, "a draft tournament with nothing played let a score through").toBeTruthy();
    expect(refusal!).toMatch(/launch/i);
  });

  it("lets it through the moment it is launched", async () => {
    const e = await event("launched", "live");
    await stage(e.id);
    expect(await playRefusalFor(e.id), "a launched tournament was gated").toBeNull();
  });
});

describe("a tournament already under way is not locked out", () => {
  it("a SCORECARD counts as under way", async () => {
    /**
     * The stroke-play half. This tournament has no matches at all, so a gate
     * that asked only about matches would refuse it — which is the shape of
     * the bug the dashboard banner had before `resultsIn` counted both.
     */
    const e = await event("cards-in-draft", "draft");
    const s = await stage(e.id);
    const player = await prisma.player.create({
      data: { eventId: e.id, name: `${TAG} P`, seed: 1, status: "confirmed" },
    });
    await prisma.scorecard.create({
      data: {
        eventId: e.id,
        stageId: s.id,
        playerId: player.id,
        strokes: JSON.stringify([4, ...new Array(17).fill(null)]),
      },
    });
    expect(
      await playRefusalFor(e.id),
      "a draft tournament with a card in was locked out mid-round",
    ).toBeNull();
  });

  it("a PLAYED MATCH counts as under way", async () => {
    /**
     * The match-play half, and the one with a trap in it: a match ROW exists
     * from the moment a draw is made, holes and all, so its mere existence is
     * not evidence anybody has played. Only a hole with something in it is.
     */
    const e = await event("match-in-draft", "draft");
    const s = await stage(e.id);
    const [a, b] = await Promise.all([
      prisma.player.create({ data: { eventId: e.id, name: `${TAG} A`, seed: 1, status: "confirmed" } }),
      prisma.player.create({ data: { eventId: e.id, name: `${TAG} B`, seed: 2, status: "confirmed" } }),
    ]);
    const group = await prisma.group.create({ data: { eventId: e.id, name: "A", position: 0 } });
    const match = await prisma.match.create({
      data: {
        eventId: e.id,
        stageId: s.id,
        groupId: group.id,
        round: 1,
        playerAId: a.id,
        playerBId: b.id,
        holes: JSON.stringify(new Array(18).fill(null)),
      },
    });

    // Drawn but not played: still refused, because a draw is setting up.
    expect(
      await playRefusalFor(e.id),
      "an empty draw was treated as a tournament already under way",
    ).toBeTruthy();

    // One hole played is enough — the same line the lifecycle warning draws.
    await prisma.match.update({
      where: { id: match.id },
      data: { holes: JSON.stringify(["A", ...new Array(17).fill(null)]) },
    });
    expect(
      await playRefusalFor(e.id),
      "a draft tournament with a hole played was locked out mid-round",
    ).toBeNull();
  });
});
