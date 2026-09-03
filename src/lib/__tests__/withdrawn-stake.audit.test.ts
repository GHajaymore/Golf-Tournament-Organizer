import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { skinsPotFor } from "@/lib/services/skins-pot";

/**
 * A stake that has been paid stays paid.
 *
 * The pot loaded its field as `status: "confirmed"`, so a player who paid in
 * and was later withdrawn vanished from it — and their money with them. The
 * Prizes screen printed "2 × £20.00 = £20.00", listed the withdrawn entrant as
 * "—" because no name could be found for them, and the player who won every
 * skin took home NOTHING: they won a pot one stake short of the two that were
 * handed over, so their winnings exactly equalled their own buy-in.
 *
 * Withdrawing from a tournament is not a refund. CLAUDE.md rule 7 says this app
 * records money rather than moving it, which makes the record the only thing
 * there is — and a record that quietly drops a payment is worse than none.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-WITHDRAWN-STAKE";
const BUY_IN = 2000; // £20.00 in minor units

const PARS = new Array(18).fill(4);
const SI = Array.from({ length: 18 }, (_, i) => i + 1);

let orgId = "";

/**
 * THREE players pay £20 each into a gross skins pot: two play it out, and one
 * is withdrawn before the round and never returns a card.
 *
 * Three rather than two, because a skin has to be genuinely WON for the pot to
 * be divided by anything. The first version of this fixture had one card and
 * one absentee, so no hole was won outright, `skinsPot` fell back to returning
 * every stake to its owner, and both players netted zero whether the withdrawn
 * stake was counted or not — a fixture that could not fail.
 */
async function seedPot(opts: { withdrawnPaid: boolean }) {
  const event = await prisma.event.create({
    data: {
      organizationId: orgId,
      name: `${TAG} ${Date.now()}`,
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      status: "active",
      shape: "series",
      formationRule: "balanced",
      shareToken: `audit-stake-${Date.now()}-${Math.random()}`,
      customPars: JSON.stringify(PARS),
      customYards: JSON.stringify(new Array(18).fill(400)),
      customStrokeIndex: JSON.stringify(SI),
    },
  });
  const eventId = event.id;
  const stage = await prisma.stage.create({
    data: { eventId, position: 0, type: "Round Robin", format: "Stroke Play", holes: 18 },
  });

  const mk = async (label: string, status: string, seed: number) =>
    (
      await prisma.player.create({
        data: {
          eventId,
          name: `${TAG} ${label}`,
          email: `${TAG.toLowerCase()}-${label}-${Date.now()}-${Math.random()}@example.invalid`,
          handicap: 0,
          seed,
          status,
          teeId: null,
        },
      })
    ).id;

  const winner = await mk("WINNER", "confirmed", 1);
  const loser = await mk("LOSER", "confirmed", 2);
  const gone = await mk("WITHDRAWN", "withdrawn", 3);

  // A three on every hole beats a five on every hole, so the winner takes all
  // eighteen skins outright and nothing carries.
  const card = (n: number) => JSON.stringify(new Array(18).fill(n));
  await prisma.scorecard.create({
    data: { eventId, stageId: stage.id, playerId: winner, strokes: card(3) },
  });
  await prisma.scorecard.create({
    data: { eventId, stageId: stage.id, playerId: loser, strokes: card(5) },
  });

  const pot = await prisma.skinsPot.create({
    data: { eventId, stageId: stage.id, net: false, scope: "full", groupKey: "", buyInCents: BUY_IN },
  });
  for (const id of [winner, loser]) {
    await prisma.skinsEntry.create({ data: { potId: pot.id, playerId: id, confirmed: true } });
  }
  await prisma.skinsEntry.create({
    // `confirmed` is the difference between money and an intention.
    data: { potId: pot.id, playerId: gone, confirmed: opts.withdrawnPaid },
  });

  return { eventId, stageId: stage.id, winner, loser, gone };
}

beforeAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  const org = await prisma.organization.create({ data: { name: `${TAG} club`, kind: "club" } });
  orgId = org.id;
});

afterAll(async () => {
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("a paid entrant who is later withdrawn", () => {
  it("keeps their stake in the pot", async () => {
    const { eventId, stageId, winner, loser, gone } = await seedPot({ withdrawnPaid: true });

    const view = await skinsPotFor(eventId, stageId, false, "full", "");

    expect(view).not.toBeNull();
    // All three stakes are in, so the pot is £60 and not £40.
    expect(view!.entrantIds.sort()).toEqual([winner, loser, gone].sort());

    const net = new Map(view!.result!.shares.map((s) => [s.playerId, s.netCents]));
    // The winner took every skin, so they win the whole £60 and are up by the
    // other two stakes. Dropping the withdrawn one left them up by only £20.
    expect(net.get(winner)).toBe(BUY_IN * 2);
    expect(net.get(loser)).toBe(-BUY_IN);
    expect(net.get(gone)).toBe(-BUY_IN);
    // And the money balances, which is the property that actually matters.
    expect([...net.values()].reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("is named on the sheet rather than shown as a dash", async () => {
    // The names came from the confirmed field, so a withdrawn entrant had no
    // name to print beside the money they had paid.
    const { eventId, stageId, gone } = await seedPot({ withdrawnPaid: true });
    const view = await skinsPotFor(eventId, stageId, false, "full", "");
    expect(view!.nameById[gone]).toContain("WITHDRAWN");
  });

  it("is not offered the pot as though they were still playing", async () => {
    /**
     * The other half of the same rule, and the reason the two questions are
     * asked separately: whose money is in, and who is still in the field. A
     * withdrawn player keeps their stake and is not invited to anything.
     */
    const { eventId, stageId, winner, gone } = await seedPot({ withdrawnPaid: true });
    const view = await skinsPotFor(eventId, stageId, false, "full", "");
    const fieldIds = view!.field.map((f) => f.id);
    expect(fieldIds).toContain(winner);
    expect(fieldIds).not.toContain(gone);
  });

  it("adds no money when the withdrawn entry was never paid", async () => {
    /**
     * The guard against the guard. An unpaid entry is an intention, not a
     * stake — counting it would invent £20 that nobody handed over, which is
     * the same fault as dropping one, in the opposite direction.
     */
    const { eventId, stageId, winner, loser, gone } = await seedPot({ withdrawnPaid: false });

    const view = await skinsPotFor(eventId, stageId, false, "full", "");

    expect(view!.entrantIds.sort()).toEqual([winner, loser].sort());
    expect(view!.pendingIds).toEqual([gone]);
    const net = new Map(view!.result!.shares.map((s) => [s.playerId, s.netCents]));
    // Two stakes in, so the winner is up by one — not two.
    expect(net.get(winner)).toBe(BUY_IN);
    expect(net.get(loser)).toBe(-BUY_IN);
    expect(net.has(gone)).toBe(false);
  });
});
