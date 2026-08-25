import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { skinsPotFor } from "../services/skins-pot";
import { skinsGameLabel } from "../domain/skins-pot";

/**
 * A league night runs FOUR skins games on one round.
 *
 * Front and back nine, each gross and net. Until the unique key included the
 * scope, the four could not coexist: `(stageId, net)` named one row, so
 * creating the back-nine gross pot UPSERTED the front-nine gross one. The
 * front game's entrants and their stakes silently became the back game's, and
 * the front game disappeared with money recorded against it.
 *
 * Nothing looked broken. The screen showed a pot, the pot had entrants, the
 * arithmetic was correct — about the wrong game. That is why this is asserted
 * against the database rather than a mock: the constraint IS the behaviour,
 * and only a real insert proves it.
 */
const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-SKINS-SCOPE";

let eventId = "";
let stageId = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({
    data: { name: `${TAG} club`, kind: "club" },
  });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} thursday league`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      status: "active",
      shape: "series",
      formationRule: "manual",
      shareToken: `${TAG}-${org.id}`,
    },
  });
  eventId = event.id;
  const stage = await prisma.stage.create({
    data: { eventId, position: 0, type: "Round Robin", format: "Stroke Play", holes: 18 },
  });
  stageId = stage.id;
}, 60_000);

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
}, 60_000);

describe("four skins games on one round", () => {
  it("lets front and back, gross and net, all exist at once", async () => {
    const games = [
      { net: false, scope: "front", buyInCents: 500 },
      { net: true, scope: "front", buyInCents: 600 },
      { net: false, scope: "back", buyInCents: 700 },
      { net: true, scope: "back", buyInCents: 800 },
    ];

    // Created one at a time, exactly as an organiser does it. Before the key
    // included the scope, the THIRD of these overwrote the first.
    for (const g of games) {
      await prisma.skinsPot.upsert({
        where: { stageId_net_scope_groupKey: { stageId, net: g.net, scope: g.scope, groupKey: "" } },
        create: { eventId, stageId, net: g.net, scope: g.scope, groupKey: "", buyInCents: g.buyInCents },
        update: { buyInCents: g.buyInCents },
      });
    }

    const rows = await prisma.skinsPot.findMany({ where: { stageId } });
    expect(rows).toHaveLength(4);

    // Each game kept its OWN stake. A shared row would show one buy-in four
    // times, and the money would be wrong for three of them.
    for (const g of games) {
      const row = rows.find((r) => r.net === g.net && r.scope === g.scope);
      expect(row, `${g.scope} ${g.net ? "net" : "gross"} is missing`).toBeTruthy();
      expect(row?.buyInCents).toBe(g.buyInCents);
    }
  });

  it("reads back the game that was asked for, not whichever row turned up", async () => {
    // The reader takes (net, scope) because that pair is what names a game.
    const frontGross = await skinsPotFor(eventId, stageId, false, "front", "");
    const backNet = await skinsPotFor(eventId, stageId, true, "back", "");

    expect(frontGross?.scope).toBe("front");
    expect(backNet?.scope).toBe("back");
    // And their stakes are their own, which is the money half of the same fact.
    expect(frontGross?.buyInCents).toBe(500);
    expect(backNet?.buyInCents).toBe(800);
  });

  it("names each game the same way everywhere", () => {
    // One reader for the label, so the board and the money page cannot call
    // one game two different things.
    expect(skinsGameLabel(false, "front", 18)).toBe("Front 9 Skins (Gross)");
    expect(skinsGameLabel(true, "back", 18)).toBe("Back 9 Skins (Net)");
    expect(skinsGameLabel(true, "full", 18)).toBe("Skins (Net)");
    // A nine-hole round has no nine to slice, so the name must not claim one.
    expect(skinsGameLabel(false, "front", 9)).toBe("Skins (Gross)");
  });
});

/**
 * And the same fact one scope wider: TWO FOURBALLS, one round, one game type.
 *
 * The scope going into the key fixed four games on a round. It did not fix two
 * GROUPS each running their own — `(stageId, net, scope)` still named a single
 * row, so Group 3 setting up their net front-nine skins upserted Group 1's.
 * Identical failure, identical silence: a pot, entrants, correct arithmetic,
 * wrong game.
 *
 * Asserted against the database because the constraint IS the behaviour. A
 * mock would happily hold two objects.
 */
describe("two fourballs, each with their own game on the same round", () => {
  it("keeps both pots, with their own stakes", async () => {
    const groups = [
      { groupKey: "Group 1", buyInCents: 1_000 },
      { groupKey: "Group 3", buyInCents: 2_000 },
    ];

    for (const g of groups) {
      await prisma.skinsPot.upsert({
        where: {
          stageId_net_scope_groupKey: { stageId, net: true, scope: "front", groupKey: g.groupKey },
        },
        create: {
          eventId,
          stageId,
          net: true,
          scope: "front",
          groupKey: g.groupKey,
          buyInCents: g.buyInCents,
        },
        update: { buyInCents: g.buyInCents },
      });
    }

    const rows = await prisma.skinsPot.findMany({
      where: { stageId, net: true, scope: "front", groupKey: { in: ["Group 1", "Group 3"] } },
      orderBy: { groupKey: "asc" },
    });

    expect(rows, "one group's pot overwrote the other's").toHaveLength(2);
    expect(rows[0].buyInCents).toBe(1_000);
    expect(rows[1].buyInCents).toBe(2_000);
  });

  it("keeps the field's own pot separate from either group's", async () => {
    // The whole-field pot is groupKey "", and it already existed on this round
    // from the suite above at 500. A group creating theirs must not touch it.
    const field = await skinsPotFor(eventId, stageId, true, "front", "");
    const group1 = await skinsPotFor(eventId, stageId, true, "front", "Group 1");

    expect(field?.buyInCents, "the field's pot moved when a group made theirs").not.toBe(1_000);
    expect(group1?.buyInCents).toBe(1_000);
  });

  it("reads a group's pot only when asked for that group", async () => {
    // Every read names whose pot it wants. This test used to assert the
    // OPPOSITE — that a caller omitting the group "reads exactly what it
    // always read" — which is precisely the bug the 2026-08-25 audit found in
    // all four readers: they omitted it, every group pot resolved to the
    // field's, and the club's money was counted once per group pot while the
    // groups' vanished. The argument is now required, so the mistake this
    // test blessed cannot be written.
    const field = await skinsPotFor(eventId, stageId, true, "front", "");
    const group1 = await skinsPotFor(eventId, stageId, true, "front", "Group 1");
    const group3 = await skinsPotFor(eventId, stageId, true, "front", "Group 3");

    expect(field?.buyInCents).toBe(600);
    expect(group1?.buyInCents).toBe(1_000);
    expect(group3?.buyInCents).toBe(2_000);
  });

  /**
   * The enumerate-then-re-read shape, which is how all four readers went wrong.
   *
   * Every one of them listed the pots on a round and then fetched each row
   * again. That is fine; what was not fine is that the second read dropped the
   * group. Asserted here against real rows because the failure needs several
   * pots sharing one (stageId, net, scope) to appear at all, and the ledger's
   * zero-sum check cannot see it — a doubled figure still sums to zero.
   */
  it("re-reads each enumerated pot as ITSELF, not as the field's", async () => {
    const rows = await prisma.skinsPot.findMany({
      where: { stageId, net: true, scope: "front" },
      select: { net: true, scope: true, groupKey: true },
      orderBy: { groupKey: "asc" },
    });
    expect(rows.length, "needs the field pot and two group pots").toBe(3);

    const back = await Promise.all(
      rows.map((r) => skinsPotFor(eventId, stageId, r.net, "front", r.groupKey)),
    );
    // Three rows, three DIFFERENT pots. Dropping groupKey gave the same pot
    // three times, which is the whole defect in one assertion.
    const stakes = back.map((v) => v?.buyInCents).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(stakes).toEqual([600, 1_000, 2_000]);
  });
});
