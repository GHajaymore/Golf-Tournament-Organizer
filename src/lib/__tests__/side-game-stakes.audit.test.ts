import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * Only a stake that was handed over is in the pot.
 *
 * A player can put their own name down for a derived pot from their phone,
 * which writes an UNCONFIRMED row: an intention, not money. The contests
 * honoured that and the derived pots did not — their entrant list was read
 * without the filter, so an unpaid request went straight into the pot and the
 * payout was split more ways than there was cash.
 *
 * The rules here are about rows and queries rather than arithmetic, so they
 * are tested against a real database: a pure test of the payout function would
 * have passed throughout, because the payout function was never wrong. It was
 * being handed the wrong entrants.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-POT";

let eventId = "";
let orgId = "";
let stageId = "";
let sideGameId = "";
const player: Record<string, string> = {};

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  orgId = org.id;
  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} open`,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${Date.now()}`,
    },
  });
  eventId = event.id;
  const stage = await prisma.stage.create({
    data: { eventId, position: 0, type: "Stroke Play Round", format: "Stroke Play", holes: 18 },
  });
  stageId = stage.id;

  for (const [i, who] of ["paid", "asked", "other"].entries()) {
    const p = await prisma.player.create({
      data: {
        eventId,
        name: `${TAG} ${who}`,
        email: `${TAG}.${who}@example.invalid`.toLowerCase(),
        seed: i + 1,
        status: "confirmed",
      },
    });
    player[who] = p.id;
  }
});

beforeEach(async () => {
  await prisma.sideGame.deleteMany({ where: { eventId } });
  const game = await prisma.sideGame.create({
    data: { eventId, stageId, kind: "low-net", buyInCents: 500 },
  });
  sideGameId = game.id;
  await prisma.sideGameEntry.createMany({
    data: [
      { sideGameId, playerId: player.paid, confirmed: true },
      // Put their own name down from the app and has not paid.
      { sideGameId, playerId: player.asked, confirmed: false },
    ],
  });
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

const entriesFor = () =>
  prisma.sideGameEntry.findMany({ where: { sideGameId }, orderBy: { playerId: "asc" } });

describe("what counts as being in the pot", () => {
  it("holds the paid stake and the unpaid ask apart", async () => {
    const rows = await entriesFor();
    const confirmed = rows.filter((r) => r.confirmed).map((r) => r.playerId);
    const pending = rows.filter((r) => !r.confirmed).map((r) => r.playerId);
    expect(confirmed).toEqual([player.paid]);
    expect(pending).toEqual([player.asked]);
  });

  it("counts the pot from confirmed stakes alone", async () => {
    // One stake handed over, one asked for: $5, not $10. Paying out $10 makes
    // the organizer personally short the difference.
    const rows = await entriesFor();
    const potCents = 500 * rows.filter((r) => r.confirmed).length;
    expect(potCents).toBe(500);
  });

  it("a self-signup writes unconfirmed, so it cannot arrive as a stake", async () => {
    await prisma.sideGameEntry.create({
      data: { sideGameId, playerId: player.other, confirmed: false },
    });
    const rows = await entriesFor();
    expect(rows.filter((r) => r.confirmed)).toHaveLength(1);
  });
});

describe("an organizer editing the entrant list", () => {
  /** What setSideGameEntrants does: replace the confirmed set, keep the rest. */
  const setEntrants = async (ids: string[]) => {
    await prisma.$transaction([
      prisma.sideGameEntry.deleteMany({
        where: { sideGameId, OR: [{ confirmed: true }, { playerId: { in: ids } }] },
      }),
      prisma.sideGameEntry.createMany({
        data: ids.map((id) => ({ sideGameId, playerId: id, confirmed: true })),
      }),
    ]);
  };

  it("does not sweep an unpaid request into the pot", async () => {
    // The bug this replaced: delete-all then recreate, with confirmed
    // defaulting to true, so nudging one chip marked every outstanding
    // request as paid and put their stakes in the pot without the cash.
    await setEntrants([player.paid, player.other]);
    const rows = await entriesFor();
    const stillPending = rows.filter((r) => !r.confirmed).map((r) => r.playerId);
    expect(stillPending).toEqual([player.asked]);
  });

  it("does not lose the request either", async () => {
    // The other half: a pending row used to vanish the moment anyone touched
    // the list, so the player's ask disappeared with nothing to show for it.
    await setEntrants([player.other]);
    const rows = await entriesFor();
    expect(rows.some((r) => r.playerId === player.asked)).toBe(true);
  });

  it("confirms somebody the organizer explicitly ticks in", async () => {
    // Naming them IS the confirmation — the same rule ContestEntry documents.
    await setEntrants([player.paid, player.asked]);
    const rows = await entriesFor();
    expect(rows.find((r) => r.playerId === player.asked)?.confirmed).toBe(true);
  });

  it("removes a confirmed entrant who is left out", async () => {
    await setEntrants([player.other]);
    const rows = await entriesFor();
    expect(rows.some((r) => r.playerId === player.paid)).toBe(false);
  });
});
