import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { applyEvent, planEvent, SweepRefusal } from "../../../scripts/sweep-duplicate-players";

/**
 * J41, second half: a tie written while the sweep runs, the match columns that
 * name a player, and the data the kept row must not lose. Same fixture rules as
 * `sweep-duplicate-players.audit.test.ts`: zz-marked, invented, deleted by the mark.
 */

const MARK = "zz-sweepdup2";
const prisma = new PrismaClient();
const mail = (who: string) => `${MARK}-${who}@example.invalid`;
let seq = 0;

async function club(label: string) {
  const org = await prisma.organization.create({ data: { name: `${MARK} ${label}`, kind: "club" } });
  const ev = await prisma.event.create({
    data: {
      name: `${MARK} ${label} Cup`,
      organizationId: org.id,
      dates: "2026-07-01",
      course: `${MARK} course`,
      city: "Nowhere",
      address: "1 Nowhere Lane",
      regDeadline: "2026-06-01",
      shareToken: `${MARK}-${Math.random().toString(36).slice(2, 10)}`,
    },
  });
  return { org, ev };
}

const enter = (eventId: string, data: Record<string, unknown>) =>
  prisma.player.create({ data: { eventId, name: "", email: "", seed: (seq += 1), status: "confirmed", ...data } as never });

const idsIn = async (eventId: string) =>
  (await prisma.player.findMany({ where: { eventId }, select: { id: true } })).map((p) => p.id).sort();

afterAll(async () => {
  const orgs = await prisma.organization.findMany({ where: { name: { startsWith: MARK } }, select: { id: true } });
  const orgIds = orgs.map((o) => o.id);
  const evs = await prisma.event.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true } });
  const evIds = evs.map((e) => e.id);
  await prisma.settlement.deleteMany({ where: { eventId: { in: evIds } } });
  await prisma.match.deleteMany({ where: { eventId: { in: evIds } } });
  await prisma.group.deleteMany({ where: { eventId: { in: evIds } } });
  await prisma.stage.deleteMany({ where: { eventId: { in: evIds } } });
  await prisma.player.deleteMany({ where: { eventId: { in: evIds } } });
  await prisma.event.deleteMany({ where: { id: { in: evIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.$disconnect();
});

describe("sweeping duplicate players: late writes and data", () => {
  it("a tie written between the plan and the delete rolls the whole apply back", async () => {
    const x = await club("Race");
    const keep = await enter(x.ev.id, { name: `${MARK} Hal Pike`, email: mail("hal") });
    const dup = await enter(x.ev.id, { name: `${MARK} Hal Pike`, email: mail("hal") });
    await expect(
      applyEvent(prisma, x.ev.id, {
        // A settlement has no foreign key to Player, so no row lock stops it: only the re-check can.
        beforeDelete: async () => {
          await prisma.settlement.create({ data: { eventId: x.ev.id, fromPlayerId: dup.id, toPlayerId: keep.id, cents: 100 } });
        },
      }),
    ).rejects.toBeInstanceOf(SweepRefusal);
    expect(await idsIn(x.ev.id)).toEqual([keep.id, dup.id].sort());
  });

  it("sees a match's attested-by, entered-by and confirmed-by as ties, and refuses when both rows have one", async () => {
    const m = await club("Match");
    const stage = await prisma.stage.create({ data: { eventId: m.ev.id, position: 1, type: "Round Robin" } });
    const grp = await prisma.group.create({ data: { eventId: m.ev.id, name: "M", position: 1 } });
    const a = await enter(m.ev.id, { name: `${MARK} Ivy Dunn`, email: mail("ivy") });
    const b = await enter(m.ev.id, { name: `${MARK} Ivy Dunn`, email: mail("ivy") });
    const op = await enter(m.ev.id, { name: `${MARK} Jo Opp`, email: mail("jo") });
    const make = (data: Record<string, unknown>) =>
      prisma.match.create({
        data: { eventId: m.ev.id, stageId: stage.id, groupId: grp.id, round: 1, playerAId: op.id, playerBId: op.id, ...data } as never,
      });

    // On the LATER row, so that ignoring the tie would keep the earlier one and be seen.
    const one = await make({ attestedBy: JSON.stringify([b.id]) });
    expect((await planEvent(prisma, m.ev.id)).clusters[0]).toMatchObject({ keep: b.id, drop: [a.id], refused: null });
    await prisma.match.delete({ where: { id: one.id } });

    await make({ enteredById: a.id });
    await make({ confirmedById: b.id });
    expect((await planEvent(prisma, m.ev.id)).clusters[0].refused).toMatch(/2 of 2 rows carry ties/);
  });

  it("fills the kept row from the dropped one, and refuses when they disagree", async () => {
    const f = await club("Fill");
    const first = await enter(f.ev.id, { name: `${MARK} Kay Lund`, email: mail("kay") });
    await enter(f.ev.id, {
      name: `${MARK} Kay Lund`, email: mail("kay"), phone: "000", ghin: "G1", homeClub: "Hills",
      handicap: 7.5, handicapSource: "ghin", publicNameWithheld: true,
    });
    expect(await applyEvent(prisma, f.ev.id)).toMatchObject({ merged: 1, deleted: 1 });
    expect(await prisma.player.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({
      phone: "000", ghin: "G1", homeClub: "Hills", handicap: 7.5, handicapSource: "ghin", publicNameWithheld: true,
    });

    const g = await club("Disagree");
    const p1 = await enter(g.ev.id, { name: `${MARK} Lee Voss`, email: mail("lee"), ghin: "A" });
    const p2 = await enter(g.ev.id, { name: `${MARK} Lee Voss`, email: mail("lee"), ghin: "B" });
    const r = await applyEvent(prisma, g.ev.id);
    expect(r).toMatchObject({ merged: 0, deleted: 0 });
    expect(r.refused[0]).toMatch(/different values for ghin/);
    expect(await idsIn(g.ev.id)).toEqual([p1.id, p2.id].sort());
  });
});
