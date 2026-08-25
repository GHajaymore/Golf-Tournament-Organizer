import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * Who may write WHICH game — every branch, against real rows.
 *
 * `audit-guards` proves each action CALLS this rule and `audit-idor` proves the
 * rule is not a reassuring name. Neither proves it returns the right answers,
 * and this is the rule that decides whether a stranger can re-price a
 * fourball's money. A name being called is not a rule being right.
 *
 * It is exercised against a real database because every branch is a query: who
 * is in the field, who is on the tee sheet, who already has a stake. A mocked
 * Prisma would prove the branches are reachable and nothing about whether they
 * ask the database the right question.
 *
 * The session is the one thing mocked — it is a cookie, not a fact about the
 * tournament, and minting one would test Next's cookie jar rather than this.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-ACCESS";

/** Swapped per test. The rule reads the caller from here and nowhere else. */
let session: { eventId: string; email: string; viewRole: string; name: string } | null = null;

vi.mock("@/lib/auth", () => ({
  getSession: async () => session,
}));

const { requirePotAccess } = await import("@/lib/services/game-access");

let eventId = "";
let otherEventId = "";
let stageId = "";
let otherStageId = "";
const player: Record<string, string> = {};
const email: Record<string, string> = {};

const WHO = ["ann", "bob", "cat", "outsider"] as const;

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

async function makeEvent(suffix: string) {
  const org = await prisma.organization.create({
    data: { name: `${TAG} club ${suffix}`, kind: "club" },
  });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} open ${suffix}`,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${suffix}-${process.pid}`,
    },
  });
  const stage = await prisma.stage.create({
    data: { eventId: event.id, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 },
  });
  return { eventId: event.id, stageId: stage.id };
}

beforeAll(async () => {
  await cleanup();

  const main = await makeEvent("main");
  eventId = main.eventId;
  stageId = main.stageId;

  // A second tournament, to prove a round from somebody else's event is
  // refused rather than reasoned about.
  const other = await makeEvent("other");
  otherEventId = other.eventId;
  otherStageId = other.stageId;

  for (const [i, who] of WHO.entries()) {
    const addr = `${TAG}.${who}@example.invalid`.toLowerCase();
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} ${who}`, email: addr, seed: i + 1, status: "confirmed" },
    });
    player[who] = p.id;
    email[who] = addr;
  }

  await prisma.stage.update({
    where: { id: stageId },
    data: {
      teeSheet: JSON.stringify({
        savedAt: "",
        startType: "tee",
        groups: [
          { name: "Group 1", startHole: 1, time: "8:00 AM", playerIds: [player.ann, player.bob] },
          { name: "Group 2", startHole: 1, time: "8:10 AM", playerIds: [player.cat, player.outsider] },
        ],
      }),
    },
  });
});

beforeEach(async () => {
  await prisma.skinsPot.deleteMany({ where: { stageId } });
  await prisma.sideGame.deleteMany({ where: { eventId } });
  session = null;
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const asStaff = (role: "admin" | "assistant" = "admin") => {
  session = { eventId, email: `${TAG}.staff@example.invalid`, viewRole: role, name: "Staff" };
};
const asPlayer = (who: string) => {
  session = { eventId, email: email[who], viewRole: "player", name: who };
};

/** Did it allow? Returns the eventId on yes, or the refusal message on no. */
async function ask(key: string, stage = stageId): Promise<string> {
  try {
    return await requirePotAccess(stage, key);
  } catch (e) {
    return (e as Error).message;
  }
}

describe("the field's game belongs to the organizer", () => {
  it("lets an admin run it", async () => {
    asStaff("admin");
    expect(await ask("")).toBe(eventId);
  });

  it("lets an assistant run it", async () => {
    asStaff("assistant");
    expect(await ask("")).toBe(eventId);
  });

  it("refuses a player, whose own group's game this is not", async () => {
    // The tournament's money is the committee's. This is the line the whole
    // widening depends on staying where it is.
    asPlayer("ann");
    expect(await ask("")).toMatch(/organizer or assistant/i);
  });

  it("refuses a key that is only whitespace, which is the field's by another name", async () => {
    asPlayer("ann");
    expect(await ask("   ")).toMatch(/organizer or assistant/i);
  });
});

describe("a fourball's game belongs to the fourball", () => {
  it("lets a player in the group run it", async () => {
    asPlayer("ann");
    expect(await ask("Group 1")).toBe(eventId);
  });

  it("refuses a player from another group", async () => {
    // THE BUG THIS PREVENTS: "players may create group pots" without this
    // check lets any player in the field re-price any other group's game,
    // which is strictly worse than staff-only.
    asPlayer("cat");
    expect(await ask("Group 1")).toMatch(/only somebody in that group/i);
  });

  it("refuses her even when the group has no game yet", async () => {
    /**
     * THE HOLE THIS CLOSES, found by this file on 2026-08-25.
     *
     * A group's game that does not exist yet has no entrants, and the branch
     * that lets anyone start an unclaimed NAME used to catch it. So a player
     * in Group 2 could create Group 1's birdie pot — and `potAudience`
     * resolves a tee-sheet name to that group, so in opt-out mode it entered
     * Ann and Bob and charged them the stake.
     *
     * Asserted at the empty state specifically, because that is the state the
     * bug lived in: with a pot already there the entrant check refuses her
     * anyway, and the test would pass over the hole without touching it.
     */
    expect(await prisma.skinsPot.count({ where: { stageId, groupKey: "Group 1" } })).toBe(0);
    expect(await prisma.sideGame.count({ where: { stageId, groupKey: "Group 1" } })).toBe(0);

    asPlayer("cat");
    expect(await ask("Group 1")).toMatch(/only somebody in that group/i);

    // And the people it belongs to are not locked out of their own empty game.
    asPlayer("ann");
    expect(await ask("Group 1")).toBe(eventId);
  });

  it("still lets staff run any group's game", async () => {
    asStaff();
    expect(await ask("Group 1")).toBe(eventId);
    expect(await ask("Group 2")).toBe(eventId);
  });

  it("refuses somebody who is not in this tournament's field at all", async () => {
    session = { eventId, email: "nobody@example.invalid", viewRole: "player", name: "Nobody" };
    expect(await ask("Group 1")).toMatch(/only a player in that group/i);
  });
});

describe("a bet that is nobody's group", () => {
  it("lets anyone in the field start a name nobody is in yet", async () => {
    // Six friends across three fourballs agreeing a game on the first tee.
    // The gap between creating a bet and naming its entrants is the one
    // moment nobody is in it.
    asPlayer("ann");
    expect(await ask("Saturday sweep")).toBe(eventId);
  });

  it("closes it the moment somebody has a stake", async () => {
    const pot = await prisma.skinsPot.create({
      data: { eventId, stageId, buyInCents: 500, net: true, scope: "full", groupKey: "Saturday sweep" },
    });
    await prisma.skinsEntry.create({ data: { potId: pot.id, playerId: player.ann } });

    asPlayer("ann");
    expect(await ask("Saturday sweep")).toBe(eventId);

    // Cat is not in it, and it is no longer open.
    asPlayer("cat");
    expect(await ask("Saturday sweep")).toMatch(/only somebody in this game/i);
  });

  it("counts a SIDE-GAME stake as being in it, not only a skins stake", async () => {
    // The two are the same people's money under the same name. Asking only
    // about skins would make a crew's second game look like somebody else's.
    const game = await prisma.sideGame.create({
      data: { eventId, stageId, kind: "birdies", buyInCents: 500, groupKey: "Saturday sweep" },
    });
    await prisma.sideGameEntry.create({
      data: { sideGameId: game.id, playerId: player.cat, confirmed: true },
    });

    asPlayer("cat");
    expect(await ask("Saturday sweep")).toBe(eventId);
    asPlayer("ann");
    expect(await ask("Saturday sweep")).toMatch(/only somebody in this game/i);
  });

  it("refuses a name too long to be a name", async () => {
    // It becomes part of a unique key, so it is bounded rather than
    // truncated: two different names cut to the same forty characters would
    // merge two groups' money.
    asPlayer("ann");
    expect(await ask("x".repeat(41))).toMatch(/under 40 characters/i);
  });
});

describe("a redraw cannot take a game from the people who paid into it", () => {
  it("keeps the original entrants in, even once the sheet means four other players", async () => {
    const pot = await prisma.skinsPot.create({
      data: { eventId, stageId, buyInCents: 2000, net: true, scope: "full", groupKey: "Group 1" },
    });
    await prisma.skinsEntry.create({ data: { potId: pot.id, playerId: player.ann } });

    // The draw is republished and "Group 1" now means Cat and the outsider.
    await prisma.stage.update({
      where: { id: stageId },
      data: {
        teeSheet: JSON.stringify({
          savedAt: "",
          startType: "tee",
          groups: [
            { name: "Group 1", startHole: 1, time: "8:00 AM", playerIds: [player.cat, player.outsider] },
          ],
        }),
      },
    });

    try {
      // Having a stake is the one claim a redraw cannot revoke. Under a
      // membership-only rule Ann would be locked out of her own money while
      // two strangers inherited it.
      asPlayer("ann");
      expect(await ask("Group 1")).toBe(eventId);
    } finally {
      await prisma.stage.update({
        where: { id: stageId },
        data: {
          teeSheet: JSON.stringify({
            savedAt: "",
            startType: "tee",
            groups: [
              { name: "Group 1", startHole: 1, time: "8:00 AM", playerIds: [player.ann, player.bob] },
              { name: "Group 2", startHole: 1, time: "8:10 AM", playerIds: [player.cat, player.outsider] },
            ],
          }),
        },
      });
    }
  });
});

describe("the round has to be this tournament's", () => {
  it("refuses a round from somebody else's event, for staff and player alike", async () => {
    // The group check would otherwise be asked about a stage in another club's
    // tournament, and would happily pass for a group name that matched.
    asStaff();
    expect(await ask("", otherStageId)).toBe("Round not found");
    asPlayer("ann");
    expect(await ask("Group 1", otherStageId)).toBe("Round not found");
    expect(otherEventId).not.toBe(eventId);
  });

  it("refuses a stage id that is not a stage", async () => {
    asStaff();
    expect(await ask("", "not-a-real-stage-id")).toBe("Round not found");
  });

  it("refuses anybody who is not signed in", async () => {
    session = null;
    expect(await ask("Group 1")).toBe("Not signed in");
  });
});
