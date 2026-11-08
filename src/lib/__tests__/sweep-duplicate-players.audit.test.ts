import { describe, it, expect, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { report, applyEvent, planEvent, SweepRefusal } from "../../../scripts/sweep-duplicate-players";

/**
 * J41 against real rows: the report finds exactly the duplicates and nothing
 * else, and the apply merges one event, keeps the row with ties, refuses where
 * both have them, and does not touch the demo club.
 *
 * Throwaway organizations marked `zz-sweepdup`, invented names, example.invalid
 * addresses, deleted in afterAll by the mark. Never pointed at a real event.
 *
 *   DOTENV_CONFIG_PATH=<main checkout>/.env npx vitest run --config vitest.audit.config.ts sweep-duplicate-players
 */

const MARK = "zz-sweepdup";
const prisma = new PrismaClient();
const mail = (who: string) => `${MARK}-${who}@example.invalid`;
let seq = 0;

async function club(label: string, isDemo = false) {
  const org = await prisma.organization.create({ data: { name: `${MARK} ${label}`, kind: "club", isDemo } });
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
  await prisma.group.deleteMany({ where: { eventId: { in: evIds } } });
  await prisma.player.deleteMany({ where: { eventId: { in: evIds } } });
  await prisma.event.deleteMany({ where: { id: { in: evIds } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  await prisma.$disconnect();
});

describe("sweeping duplicate players", () => {
  it("reports, merges one event, keeps the row with ties, refuses where both have them, leaves the demo club", async () => {
    try {
      // 1. Two duplicates (an email in two cases; a name with no email) and one non-duplicate
      //    (same name, two different emails: two people, as the importer reads it).
      const a = await club("Mixed");
      const first = await enter(a.ev.id, { name: `${MARK} Ada Finch`, email: mail("ada") });
      const askedForAda = await enter(a.ev.id, { name: `${MARK} Bea Cole`, email: mail("bea"), playWith: [] });
      const second = await enter(a.ev.id, { name: `${MARK} Ada F.`, email: mail("ada").toUpperCase() });
      const nameA = await enter(a.ev.id, { name: `${MARK} Dev Naru` });
      const nameB = await enter(a.ev.id, { name: `  ${MARK} dev naru ` });
      const twinA = await enter(a.ev.id, { name: `${MARK} Cy Twin`, email: mail("cy1") });
      const twinB = await enter(a.ev.id, { name: `${MARK} Cy Twin`, email: mail("cy2") });
      await prisma.player.update({ where: { id: askedForAda.id }, data: { playWith: [second.id, twinA.id] } });

      // 2. A duplicate where the LATER row has ties (a flight): it is the one kept.
      const b = await club("Tied");
      const g = await prisma.group.create({ data: { eventId: b.ev.id, name: "A", position: 1 } });
      const old = await enter(b.ev.id, { name: `${MARK} Eli Ward`, email: mail("eli") });
      const placed = await enter(b.ev.id, { name: `${MARK} Eli Ward`, email: mail("eli"), groupId: g.id });

      // 3. A duplicate where BOTH rows have ties: refused, untouched.
      const c = await club("Both");
      const g1 = await prisma.group.create({ data: { eventId: c.ev.id, name: "A", position: 1 } });
      const both1 = await enter(c.ev.id, { name: `${MARK} Fay Moss`, email: mail("fay"), groupId: g1.id });
      const both2 = await enter(c.ev.id, { name: `${MARK} Fay Moss`, email: mail("fay"), groupId: g1.id });

      // 4. The demo club, holding a duplicate.
      const d = await club("Demo", true);
      await enter(d.ev.id, { name: `${MARK} Gus Rowe`, email: mail("gus") });
      await enter(d.ev.id, { name: `${MARK} Gus Rowe`, email: mail("gus") });

      // REPORT: read-only. Counts what is there, by the importer's rule.
      const mine = new Set([a.ev.id, b.ev.id, c.ev.id, d.ev.id]);
      const before = await Promise.all([...mine].map(idsIn));
      const r = await report(prisma);
      const ours = r.perEvent.filter((e) => mine.has(e.eventId));
      expect(ours.map((e) => e.eventId).sort()).toEqual([a.ev.id, b.ev.id, c.ev.id].sort());
      expect(ours.find((e) => e.eventId === a.ev.id)).toMatchObject({ clusters: 2, dropRows: 2, refused: 0 });
      expect(ours.find((e) => e.eventId === b.ev.id)).toMatchObject({ clusters: 1, dropRows: 1, refused: 0 });
      expect(ours.find((e) => e.eventId === c.ev.id)).toMatchObject({ clusters: 1, dropRows: 0, refused: 1 });
      expect(ours.flatMap((e) => e.rowIds).sort()).toEqual([second.id, nameB.id, old.id].sort());
      expect(await Promise.all([...mine].map(idsIn))).toEqual(before); // changed nothing
      // The report output holds ids and counts, never a name or an address.
      expect(JSON.stringify(r)).not.toContain(MARK);

      // APPLY, event A: two clusters merged, two rows deleted, the namesakes with different emails kept.
      const done = await applyEvent(prisma, a.ev.id);
      expect(done).toMatchObject({ merged: 2, deleted: 2, refused: [] });
      expect(await idsIn(a.ev.id)).toEqual([first.id, askedForAda.id, nameA.id, twinA.id, twinB.id].sort());
      // Someone who had asked to play with the dropped row now asks for the kept one; the namesake stays.
      const asked = await prisma.player.findUniqueOrThrow({ where: { id: askedForAda.id } });
      expect(asked.playWith.sort()).toEqual([first.id, twinA.id].sort());
      expect((await planEvent(prisma, a.ev.id)).clusters).toEqual([]); // and a second run has nothing to do

      // APPLY, event B: the row with the flight is kept, the plain one goes.
      expect(await applyEvent(prisma, b.ev.id)).toMatchObject({ merged: 1, deleted: 1 });
      expect(await idsIn(b.ev.id)).toEqual([placed.id]);
      expect(old.id).not.toBe(placed.id);

      // APPLY, event C: both rows tied, so refused and untouched.
      const refused = await applyEvent(prisma, c.ev.id);
      expect(refused).toMatchObject({ merged: 0, deleted: 0 });
      expect(refused.refused).toHaveLength(1);
      expect(await idsIn(c.ev.id)).toEqual([both1.id, both2.id].sort());

      // APPLY, the demo club: refused outright.
      await expect(applyEvent(prisma, d.ev.id)).rejects.toBeInstanceOf(SweepRefusal);
      expect(await idsIn(d.ev.id)).toHaveLength(2);
      // And an event that is not there.
      await expect(applyEvent(prisma, "zz-no-such-event")).rejects.toBeInstanceOf(SweepRefusal);

      // The demo club is left out of the report altogether.
      expect((await report(prisma)).perEvent.some((e) => e.eventId === d.ev.id)).toBe(false);
    } finally {
      // Cleanup is afterAll, by the mark: it does not depend on this body getting this far.
    }
  });
});
