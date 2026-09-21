import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * TWO DOORS THAT LET SOMETHING THROUGH, FOUND BY AUDIT ON 2026-09-21.
 *
 * They are unrelated in the code and the same in shape: each is the SECOND
 * door onto a question whose first door already asks it properly, and each was
 * missed because the sweep that would catch it looks at a different axis.
 *
 *   a private pot   `requestSkinsEntry` refuses an ask from outside the
 *                   group, in those words, and is pinned by
 *                   `skins-join.audit.test.ts`. `requestSideGameEntry` is the
 *                   same act on the same kind of pot and asked nothing.
 *
 *   a knockout      `enteredCardCount` unions the tables a score can live in
 *                   and its docstring says so. It did not count
 *                   `BracketWinner`, so a straight knockout reported ZERO
 *                   results to the guard that asks before destroying them.
 *
 * `audit-idor.test.ts` cannot see the first: it checks that an id is narrowed
 * to the caller's scope, and `sideGameId` IS — by `eventId`. The group
 * boundary inside an event is finer than any scope key it knows.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-TWODOORS";

let session: { eventId: string; email: string; viewRole: string; name: string } | null = null;

vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { requestSideGameEntry } = await import("@/app/actions/side-games");
const { enteredCardCount } = await import("@/lib/services/round-cards");

let eventId = "";
let stageId = "";
const player: Record<string, string> = {};
const email: Record<string, string> = {};

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
      name: `${TAG} open`,
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

  for (const [i, who] of ["ann", "bob", "cat"].entries()) {
    const addr = `${TAG}.${who}@example.invalid`.toLowerCase();
    const p = await prisma.player.create({
      data: { eventId, name: `${TAG} ${who}`, email: addr, seed: i + 1, status: "confirmed" },
    });
    player[who] = p.id;
    email[who] = addr;
  }

  // Ann alone in Group 1; Bob and Cat in Group 2.
  await prisma.stage.update({
    where: { id: stageId },
    data: {
      teeSheet: JSON.stringify({
        savedAt: "",
        startType: "tee",
        groups: [
          { name: "Group 1", startHole: 1, time: "8:00 AM", playerIds: [player.ann] },
          { name: "Group 2", startHole: 1, time: "8:10 AM", playerIds: [player.bob, player.cat] },
        ],
      }),
    },
  });
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("a side game named after a fourball belongs to that fourball", () => {
  let groupPot = "";
  let openPot = "";

  beforeEach(async () => {
    await prisma.sideGameEntry.deleteMany({ where: { sideGame: { stageId } } });
    await prisma.sideGame.deleteMany({ where: { stageId } });
    const own = await prisma.sideGame.create({
      data: { eventId, stageId, kind: "birdies", groupKey: "Group 1", buyInCents: 2000, entryMode: "opt-in" },
    });
    groupPot = own.id;
    const open = await prisma.sideGame.create({
      data: { eventId, stageId, kind: "birdies", groupKey: "", buyInCents: 500, entryMode: "opt-in" },
    });
    openPot = open.id;
    // Cat is in the field, in Group 2, and signed in.
    session = { eventId, email: email.cat, viewRole: "player", name: "cat" };
  });

  it("refuses an ask into another group's game", async () => {
    /**
     * THE DEFECT. Cat is confirmed in the tournament and drawn in Group 2.
     * Group 1's birdie pot is Ann's fourball's. Cat could put her name on it
     * and appear on their collect list — the id is in her own money screen's
     * markup, and the only checks were "is this game in my tournament" and
     * "am I in the field", both of which she passes.
     */
    const res = await requestSideGameEntry(groupPot, true);
    expect(res.ok, "an outsider was let into a fourball's private pot").toBe(false);
    expect(res.error).toBe("That game belongs to another group.");

    const rows = await prisma.sideGameEntry.count({
      where: { sideGameId: groupPot, playerId: player.cat },
    });
    expect(rows, "a row was written despite the refusal").toBe(0);
  });

  it("still lets anyone in the field join a game with no group", async () => {
    /**
     * THE CONTROL, and it is what stops the fix being "refuse everybody". An
     * ad-hoc bet with an empty `groupKey` is open to the whole field — that is
     * how a game across three fourballs works — so the refusal above must come
     * from the AUDIENCE and not from the door being shut.
     */
    const res = await requestSideGameEntry(openPot, true);
    expect(res.ok, "the fix closed the open pot as well").toBe(true);
    const rows = await prisma.sideGameEntry.count({
      where: { sideGameId: openPot, playerId: player.cat },
    });
    expect(rows).toBe(1);
  });

  it("lets a member of the group join their own", async () => {
    // The second half of the control: Ann IS Group 1.
    session = { eventId, email: email.ann, viewRole: "player", name: "ann" };
    const res = await requestSideGameEntry(groupPot, true);
    expect(res.ok, "the group's own member was refused their own game").toBe(true);
  });
});

describe("a knockout's results are results", () => {
  beforeEach(async () => {
    await prisma.bracketWinner.deleteMany({ where: { eventId } });
  });

  it("counts decided ties, so the destroy-results guard can see them", async () => {
    /**
     * A Bracket Stage files no `Scorecard` and no `Match` — its results are
     * `BracketWinner` rows. `scoredMatchCount` is what gates the "this will
     * destroy results" confirmation on resizing the field, moving a player
     * between flights and changing the formation rule; on a straight knockout
     * it saw nothing and all three acted without asking.
     */
    expect(await enteredCardCount(eventId), "the fixture starts clean").toBe(0);

    await prisma.bracketWinner.createMany({
      data: [
        { eventId, key: "r0m0", winnerId: player.ann, result: "3&2" },
        { eventId, key: "r0m1", winnerId: player.bob, result: "2up" },
      ],
    });
    expect(await enteredCardCount(eventId), "decided ties are invisible to the guard").toBe(2);
  });

  it("does not count a slot nobody has filled", async () => {
    /**
     * THE CONTROL. Counting rows rather than DECIDED rows would report a drawn
     * but unplayed bracket as full of results, and the guard would then refuse
     * a change that destroys nothing — the opposite failure, and just as
     * wrong.
     */
    await prisma.bracketWinner.createMany({
      data: [
        { eventId, key: "r0m0", winnerId: "", result: "" },
        { eventId, key: "r0m1", winnerId: player.ann, result: "4&3" },
      ],
    });
    expect(await enteredCardCount(eventId), "an empty slot was counted as a result").toBe(1);
  });
});
