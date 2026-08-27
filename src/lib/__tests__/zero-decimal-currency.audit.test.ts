import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A club whose money has no minor unit at all.
 *
 * The yen has no sen, the won no jeon. In those currencies a "cent" IS the
 * whole unit, so ¥500 is 500 minor units and not 50,000 — and the whole ledger
 * in this app is denominated in minor units.
 *
 * The formatter and the parser are both currency-aware and both unit-tested.
 * What has never been tested is a club actually STORED that way: an
 * organization whose `currency` is JPY, an event under it, real expenses, a
 * real settle-up, read back through the services the screens use. A pure test
 * proves `minorUnitsFrom("500", "JPY") === 500`; it cannot prove that the
 * amount reaching the database went through that function rather than a stray
 * `* 100` somewhere in an action.
 *
 * That distinction is the reason this file exists. The bug it guards against
 * was real: every input once did `parseFloat(text) * 100`, so a club in Tokyo
 * entering a ¥500 buy-in ran a pot for ¥50,000. Reading a prize at a hundredth
 * of its value is obvious; charging a hundred times the stake is not.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-JPY";

let session: { eventId: string; email: string; name: string; role: string; viewRole: string } | null =
  null;

vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { addExpense, recordSettlement } = await import("@/app/actions/expenses");
const { moneyFor } = await import("@/lib/services/expenses");
const { currencyForEvent } = await import("@/lib/services/organization");
const { money, minorUnitsFrom, minorUnitDigits } = await import("@/lib/domain/money-format");

let eventId = "";
let aki = "";
let ben = "";

async function cleanup() {
  await prisma.event.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.organization.deleteMany({ where: { name: { startsWith: TAG } } });
}

beforeAll(async () => {
  await cleanup();
  const org = await prisma.organization.create({
    // The whole point: the club is STORED in a zero-decimal currency.
    data: { name: `${TAG} club`, kind: "club", currency: "JPY" },
  });
  const event = await prisma.event.create({
    data: {
      organizationId: org.id,
      name: `${TAG} outing`,
      dates: "",
      course: "Home",
      city: "",
      address: "",
      regDeadline: "",
      shareToken: `${TAG}-${process.pid}`,
    },
  });
  eventId = event.id;

  const mk = async (name: string, seed: number) =>
    (
      await prisma.player.create({
        data: {
          eventId,
          name: `${TAG} ${name}`,
          email: `${TAG}.${name}@example.invalid`.toLowerCase(),
          seed,
          status: "confirmed",
        },
      })
    ).id;
  aki = await mk("aki", 1);
  ben = await mk("ben", 2);
});

beforeEach(async () => {
  await prisma.settlement.deleteMany({ where: { eventId } });
  await prisma.expense.deleteMany({ where: { eventId } });
  session = {
    eventId,
    email: `${TAG}.staff@example.invalid`,
    name: "Treasurer",
    role: "admin",
    viewRole: "admin",
  };
});

afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("a club whose currency has no minor unit", () => {
  it("is what the services actually report for the event", async () => {
    // If this is wrong, nothing below means anything: every amount would be
    // formatted and parsed against the dollar regardless of what was stored.
    expect(await currencyForEvent(eventId)).toBe("JPY");
    expect(minorUnitDigits("JPY")).toBe(0);
  });

  it("stores ¥5000 as 5000, not 500000", async () => {
    /**
     * THE BUG THIS GUARDS. `parseFloat(text) * 100` turned a ¥500 buy-in into
     * 50,000 minor units — a pot a hundred times the stake, and one that looks
     * entirely deliberate on the screen afterwards.
     */
    const typed = "5000";
    const res = await addExpense({
      description: `${TAG} caddie`,
      amountCents: minorUnitsFrom(typed, "JPY"),
      paidBy: aki,
    });
    expect(res.ok, res.error).toBe(true);

    const row = await prisma.expense.findFirst({
      where: { eventId },
      select: { amountCents: true },
    });
    expect(row?.amountCents, "a hundred-fold error would show here").toBe(5000);
  });

  it("reads the stored amount back as the same string the club typed", async () => {
    // The round trip is the property that matters: whatever the parser takes,
    // the formatter must give back. A pair that disagree is how an amount
    // drifts by two decimal places between screens.
    for (const typed of ["500", "5000", "12345", "0"]) {
      const stored = minorUnitsFrom(typed, "JPY");
      expect(money(stored, "JPY").replace(/[^\d]/g, "")).toBe(typed.replace(/[^\d]/g, ""));
    }
  });

  it("splits an odd yen amount without inventing or losing one", async () => {
    /**
     * In a two-decimal currency the remainder is a hundredth of a unit and
     * nobody notices. In yen the remainder IS a yen — a unit somebody can be
     * short by — so the split has to be exact rather than approximately right.
     */
    const res = await addExpense({
      description: `${TAG} greens fee`,
      amountCents: 3001,
      paidBy: aki,
      shares: [
        { playerId: aki, weight: 1 },
        { playerId: ben, weight: 1 },
      ],
    });
    expect(res.ok, res.error).toBe(true);

    const shares = await prisma.expenseShare.findMany({
      where: { expense: { eventId } },
      select: { playerId: true },
    });
    expect(shares).toHaveLength(2);

    const view = await moneyFor(eventId, session!.email, { isStaff: true });
    const total = view.standing.reduce((a, s) => a + s.netCents, 0);
    expect(total, "the ledger must still sum to zero in yen").toBe(0);

    // Ben owes Aki half of 3001. One of them carries the odd yen; which one is
    // a rule, but the pair must come to exactly 3001.
    const owed = view.transfers.find((t) => t.fromPlayerId === ben && t.toPlayerId === aki);
    expect(owed?.cents).toBeGreaterThanOrEqual(1500);
    expect(owed?.cents).toBeLessThanOrEqual(1501);
  });

  it("settles a yen debt to the yen", async () => {
    await addExpense({
      description: `${TAG} dinner`,
      amountCents: 8000,
      paidBy: aki,
      shares: [
        { playerId: aki, weight: 1 },
        { playerId: ben, weight: 1 },
      ],
    });

    const before = await moneyFor(eventId, session!.email, { isStaff: true });
    const owed = before.transfers.find((t) => t.fromPlayerId === ben && t.toPlayerId === aki);
    expect(owed?.cents, "Ben owes half of ¥8000").toBe(4000);

    const res = await recordSettlement(ben, aki, 4000);
    expect(res.ok, res.error).toBe(true);

    const after = await moneyFor(eventId, session!.email, { isStaff: true });
    expect(
      after.transfers.find((t) => t.fromPlayerId === ben && t.toPlayerId === aki),
      "the debt should be cleared exactly, with no yen left over",
    ).toBeUndefined();
  });

  it("never renders a yen amount with a decimal place", async () => {
    /**
     * "¥4,000.00" is not a price anybody in Japan has ever seen, and it is the
     * visible symptom of an amount being divided by 100 on the way out. Checked
     * on the SERVICE's own output rather than on the formatter alone, because
     * that is the string a club actually reads.
     */
    await addExpense({ description: `${TAG} cart`, amountCents: 4000, paidBy: aki });
    const view = await moneyFor(eventId, session!.email, { isStaff: true });
    const row = view.expenses.find((e) => e.description.includes("cart"));
    expect(row, "setup: the expense should be in the view").toBeTruthy();

    expect(money(row!.amountCents, "JPY")).not.toMatch(/[.,]\d{2}$/);
    expect(money(row!.amountCents, "JPY")).toMatch(/4,?000/);
  });
});
