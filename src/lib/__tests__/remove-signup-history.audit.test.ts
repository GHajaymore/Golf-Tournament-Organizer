import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * Taking a name off the roster never destroys what they did.
 *
 * From the 2026-08-27 exploratory audit. `removeSignup` chooses between a soft
 * `withdrawn` and a hard `delete` from a "does this person have a history"
 * check that counted exactly two tables — `Scorecard` and `Match`.
 *
 * TEAM GOLF WRITES NEITHER. A partner's card goes to `TeamScorecard`, and a
 * team match leaves the player columns empty on purpose. So a pairs
 * member-guest that had already played took the hard-delete branch: `TeamMember`
 * cascades, the side lost that partner, and `teamStandings` rebuilt the
 * four-ball from ONE ball — a finished round re-scored, silently, and no longer
 * agreeing with the `Match.holes` already stored for it.
 *
 * And `SkinsEntry` cascades, which is MONEY. Take a name out between the cash
 * being collected and the cards going in, and the stake row goes with them: the
 * pot drops by their buy-in and the winner is paid less than was collected,
 * with nothing left to show a stake existed.
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
import { removeSignup } from "@/app/actions/tournament";

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-REMOVESIGNUP";

let eventId = "";
let stageId = "";
let organizerUserId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: TAG.toLowerCase() } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

/** A fresh confirmed player with no history at all. */
async function newPlayer(who: string) {
  return prisma.player.create({
    data: {
      eventId,
      name: `${TAG} ${who}`,
      email: `${TAG}.${who}.${Math.round(performance.now() * 1000)}@example.invalid`.toLowerCase(),
      seed: 99,
      status: "confirmed",
      handicap: 12,
    },
  });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} member-guest`,
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
    data: { eventId, position: 0, type: "Stroke Play Round", format: "Four-Ball", holes: 18 },
  });
  stageId = stage.id;

  const boss = await prisma.user.create({
    data: { email: `${TAG}.boss@example.invalid`.toLowerCase(), name: "boss", password: "x" },
  });
  organizerUserId = boss.id;
  await prisma.account.create({
    data: { eventId, email: `${TAG}.boss@example.invalid`.toLowerCase(), name: "boss", role: "admin" },
  });
});

beforeEach(async () => {
  jar.clear();
  await createSession(organizerUserId);
  await setActiveEvent(eventId);
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("somebody who has genuinely done nothing", () => {
  it("is deleted outright, which is the point of the two paths", async () => {
    // The guard must not become "never delete anything" — a duplicate entry or
    // a no-show should leave no trace, which is why removeSignups exists.
    const p = await newPlayer("ghost");
    expect(await removeSignup(p.id)).toBe("deleted");
    expect(await prisma.player.count({ where: { id: p.id } })).toBe(0);
  });
});

describe("a partner in a pairs event who has already played", () => {
  it("is withdrawn, not deleted", async () => {
    const p = await newPlayer("guest");
    const team = await prisma.team.create({
      data: { eventId, name: `${TAG} side`, seed: 1, stageId },
    });
    await prisma.teamMember.create({ data: { teamId: team.id, playerId: p.id, position: 0 } });
    await prisma.teamScorecard.create({
      data: {
        eventId,
        stageId,
        teamId: team.id,
        matchId: "",
        playerId: p.id,
        strokes: JSON.stringify(new Array(18).fill(4)),
      },
    });

    expect(await removeSignup(p.id)).toBe("withdrawn");
  });

  it("keeps their side intact, so a finished round is not re-scored", async () => {
    // TeamMember cascades. Losing it rebuilt the four-ball from one ball.
    const p = await newPlayer("partner");
    const team = await prisma.team.create({
      data: { eventId, name: `${TAG} side two`, seed: 2, stageId },
    });
    await prisma.teamMember.create({ data: { teamId: team.id, playerId: p.id, position: 0 } });
    await prisma.teamScorecard.create({
      data: {
        eventId,
        stageId,
        teamId: team.id,
        matchId: "",
        playerId: p.id,
        strokes: JSON.stringify(new Array(18).fill(4)),
      },
    });

    await removeSignup(p.id);

    expect(await prisma.teamMember.count({ where: { playerId: p.id } })).toBe(1);
    const row = await prisma.player.findUniqueOrThrow({ where: { id: p.id } });
    expect(row.status).toBe("withdrawn");
  });

  it("is withdrawn on team membership alone, before any card is in", async () => {
    // Drawn into a side and the round not yet played: deleting still re-shapes
    // the side, so it is still not a delete.
    const p = await newPlayer("drawn");
    const team = await prisma.team.create({
      data: { eventId, name: `${TAG} side three`, seed: 3, stageId },
    });
    await prisma.teamMember.create({ data: { teamId: team.id, playerId: p.id, position: 0 } });

    expect(await removeSignup(p.id)).toBe("withdrawn");
  });
});

describe("somebody whose money is already in the pot", () => {
  it("is withdrawn, so the stake survives", async () => {
    /**
     * The league-night case: cash handed over and ticked in before play, the
     * name taken out before the cards go in. `SkinsEntry` cascades, so the
     * stake was deleted with the person and the pot silently shrank.
     */
    const p = await newPlayer("staker");
    const pot = await prisma.skinsPot.create({
      data: { eventId, stageId, buyInCents: 2000, net: true, scope: "full" },
    });
    await prisma.skinsEntry.create({ data: { potId: pot.id, playerId: p.id, confirmed: true } });

    expect(await removeSignup(p.id)).toBe("withdrawn");
    expect(
      await prisma.skinsEntry.count({ where: { potId: pot.id, playerId: p.id } }),
      "the stake must still be on the books",
    ).toBe(1);
  });

  it("leaves the pot the size the cash actually was", async () => {
    const p = await newPlayer("payer");
    const other = await newPlayer("other");
    // A separate game on the same round — a league night runs four, and the
    // unique key is (stage, net, scope, whose).
    const pot = await prisma.skinsPot.create({
      data: { eventId, stageId, buyInCents: 2000, net: true, scope: "front" },
    });
    await prisma.skinsEntry.createMany({
      data: [
        { potId: pot.id, playerId: p.id, confirmed: true },
        { potId: pot.id, playerId: other.id, confirmed: true },
      ],
    });

    await removeSignup(p.id);

    const stakes = await prisma.skinsEntry.count({ where: { potId: pot.id, confirmed: true } });
    expect(stakes, "two players paid, so two stakes are in the pot").toBe(2);
  });
});
