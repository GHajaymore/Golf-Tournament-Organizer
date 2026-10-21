import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {}, unstable_cache: (fn: unknown) => fn }));

import { moneyFor } from "@/lib/services/expenses";

/**
 * THE DAY A HANDOVER WAS RECORDED IS THE CLUB'S DAY, IN THE CLUB'S WORDS
 * (2026-10-13).
 *
 * "Marcus paid Aj $10 · 2026-10-13 · recorded by the secretary." Both money
 * screens printed that date straight off the server's clock, as the database
 * writes one. So it was the wrong DAY for any club not on the server's side of
 * midnight — a handover recorded at nine in the evening in New York was dated
 * tomorrow — and it was the one date on those screens not written the way the
 * club writes a date. Read off the organizer's ledger while writing the first
 * browser test of settling up.
 *
 * One instant, three clubs. 23:30 UTC on the 14th of May is the 15th in Tokyo
 * and still the 14th in New York, and the old code said "2026-05-14" to all
 * three. A fixture in one zone cannot see this: the server and the club would
 * agree, as they did in every test for a year ("The club's clock", CLAUDE.md).
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-HANDOVERDAY";
const AT = new Date("2026-05-14T23:30:00Z");
const CLUBS = [
  { key: "tokyo", timeZone: "Asia/Tokyo", locale: "en-GB", want: "15 May 2026" },
  { key: "newyork", timeZone: "America/New_York", locale: "en-US", want: "May 14, 2026" },
  // A club that has not said where it is keeps the server's day — and still writes it its own way.
  { key: "unsaid", timeZone: "", locale: "de-DE", want: AT.getDate() === 15 ? "15. Mai 2026" : "14. Mai 2026" },
] as const;
const made: Record<string, { eventId: string; email: string }> = {};

async function cleanup() {
  const bills = await prisma.expense.findMany({ where: { description: { startsWith: TAG } }, select: { id: true } });
  await prisma.expenseShare.deleteMany({ where: { expenseId: { in: bills.map((b) => b.id) } } });
  await prisma.expense.deleteMany({ where: { description: { startsWith: TAG } } });
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  for (const club of CLUBS) {
    const org = await prisma.organization.create({ data: { name: `${TAG} ${club.key}`, kind: "club", timeZone: club.timeZone, locale: club.locale } });
    const event = await prisma.event.create({
      data: { organizationId: org.id, name: `${TAG} ${club.key} trip`, status: "live", dates: "", course: "Home", city: "", address: "", regDeadline: "", shareToken: `${TAG}-${club.key}-${process.pid}` },
    });
    const [ann, bea] = await Promise.all(
      ["Ann", "Bea"].map((n, i) =>
        prisma.player.create({ data: { eventId: event.id, name: `${TAG} ${n}`, email: `${TAG}.${club.key}.${n}@example.invalid`.toLowerCase(), seed: i + 1, status: "confirmed" } }),
      ),
    );
    await prisma.settlement.create({ data: { eventId: event.id, fromPlayerId: bea.id, toPlayerId: ann.id, cents: 1000, recordedBy: "the secretary", settledAt: AT } });
    // A bill with a day on it, as somebody typed it: 14 May, whatever the clock says.
    await prisma.expense.create({
      data: {
        eventId: event.id, description: `${TAG} dinner`, amountCents: 4000, paidBy: ann.id, spentOn: "2026-05-14",
        shares: { create: [{ playerId: ann.id }, { playerId: bea.id }] },
      },
    });
    made[club.key] = { eventId: event.id, email: ann.email };
  }
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("the day a handover was recorded", () => {
  it("is the day it was at the club, written the way the club writes a date", async () => {
    for (const club of CLUBS) {
      const view = await moneyFor(made[club.key].eventId, made[club.key].email);
      expect(view.settlements.length, `${club.key}: the handover is not on the screen`).toBe(1);
      expect(view.settlements[0].settledAt, `${club.key}: the handover is dated by another clock, or in another notation`).toBe(club.want);
    }
  });

  it("CONTROL: the three clubs read one instant as different days", async () => {
    const days = await Promise.all(CLUBS.slice(0, 2).map(async (club) => (await moneyFor(made[club.key].eventId, made[club.key].email)).settlements[0].settledAt));
    // Tokyo is already on the 15th and New York still on the 14th: a reader that dated both alike is reading its own clock.
    expect(days[0]).toContain("15");
    expect(days[1]).toContain("14");
    // And neither is the bare notation a database writes.
    for (const day of days) expect(day).not.toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

/**
 * AND THE DAY ON A BILL IS WRITTEN THE SAME WAY (2026-10-21). Each expense printed the day it was
 * spent as the database keeps it, "2026-10-17", under "Already settled · Oct 20, 2026" on the same
 * screen — and on a phone it broke across two lines at the hyphen. Seen in the first capture of the
 * money screens for a reel. A typed day is already a day, so no clock comes into it: 14 May is
 * 14 May in every club, written each club's way.
 */
describe("the day on a bill", () => {
  it("is written the way the club writes a date, never as the database keeps it", async () => {
    const want = { tokyo: "14 May 2026", newyork: "May 14, 2026", unsaid: "14. Mai 2026" } as const;
    for (const club of CLUBS) {
      const view = await moneyFor(made[club.key].eventId, made[club.key].email);
      const bill = view.expenses.find((e) => e.description.endsWith("dinner"));
      expect(bill, `${club.key}: the bill is not on the screen`).toBeTruthy();
      expect(bill!.spentOn, `${club.key}: the bill's day is in another notation`).toBe(want[club.key]);
    }
  });
});
