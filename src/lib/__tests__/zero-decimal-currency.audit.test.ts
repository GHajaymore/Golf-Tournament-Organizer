import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
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

/**
 * The same club, on the day it CHANGES its currency.
 *
 * Everything above fixes the currency at JPY and proves the ledger is
 * denominated correctly. This block is about the transition, which is a
 * different fault entirely and lives on the client.
 *
 * `useMoney()` hands a screen a `parse` closure BOUND TO THE CURRENT
 * CURRENCY, memoized on it, so it takes a new identity when the club's
 * currency changes. That change reaches a MOUNTED screen: every money action
 * ends in `revalidatePath("/", "layout")`, the layout re-reads the club's
 * currency, and React delivers the new context value without unmounting —
 * client state is deliberately preserved across a server re-render.
 *
 * MoneyClient's `shares` and `payers` memos called that parser and did not
 * depend on it, so after a switch they kept returning amounts parsed in the
 * currency the club had LEFT, while the bill total beside them — computed
 * inline, not memoized — had already moved to the new one. A hundred-fold
 * disagreement between two numbers on the same form.
 *
 * The assertions below are the server's half of that story, against real
 * rows: that the currency is re-read rather than cached, that the two parses
 * really are a hundred-fold apart, and that a payload built with the stale
 * parser is REFUSED rather than silently banked. The refusal is the good
 * outcome and the reason this was a usability fault rather than a corrupted
 * ledger — but it is a refusal the person typing cannot act on, because the
 * numbers on their screen add up.
 */
describe("a club that changes its currency under an open screen", () => {
  /** Set the club's currency where the picker sets it — on the organization. */
  async function setCurrency(code: string) {
    const ev = await prisma.event.findUnique({
      where: { id: eventId },
      select: { organizationId: true },
    });
    await prisma.organization.update({
      where: { id: ev!.organizationId },
      data: { currency: code },
    });
  }

  // Put the fixture back however a test above left it, so the order of this
  // file cannot change what any other test in it is asserting.
  afterEach(async () => {
    await setCurrency("JPY");
  });

  it("reports the new currency immediately, with nothing cached anywhere", async () => {
    /**
     * If the SERVER cached the currency, the client bug would be unreachable
     * and this whole block would be theatre. It does not: the value is read
     * per request, which is exactly why it can change under a mounted screen.
     */
    await setCurrency("USD");
    expect(await currencyForEvent(eventId)).toBe("USD");

    await setCurrency("JPY");
    expect(await currencyForEvent(eventId)).toBe("JPY");
  });

  it("parses one typed string a hundred-fold apart on either side of the switch", async () => {
    // The size of the mistake, stated once. "500" is ¥500 and $500, and those
    // are 500 and 50,000 minor units. Nothing about the text tells you which.
    await setCurrency("USD");
    const asDollars = minorUnitsFrom("500", await currencyForEvent(eventId));

    await setCurrency("JPY");
    const asYen = minorUnitsFrom("500", await currencyForEvent(eventId));

    expect(asDollars).toBe(50_000);
    expect(asYen).toBe(500);
  });

  it("refuses an exact split whose shares were parsed in the previous currency", async () => {
    /**
     * THE STALE MEMO, reproduced as a payload.
     *
     * A ¥3,000 bill split ¥1,000 / ¥2,000. The bill total is parsed fresh —
     * MoneyClient computes it inline on every render — while the shares come
     * from a memo still holding the dollar parser. So the amount says 3000
     * and the shares say 100,000 and 200,000.
     */
    await setCurrency("USD");
    const stale = (text: string) => minorUnitsFrom(text, "USD");
    await setCurrency("JPY");
    const fresh = (text: string) => minorUnitsFrom(text, "JPY");

    const res = await addExpense({
      description: `${TAG} clubhouse round`,
      amountCents: fresh("3000"),
      paidBy: aki,
      shares: [
        { playerId: aki, weight: 1, amountCents: stale("1000") },
        { playerId: ben, weight: 1, amountCents: stale("2000") },
      ],
    });

    expect(res.ok, "a hundred-fold split must never be banked").toBe(false);
    // The message names both figures, and the gap between them is the tell.
    expect(res.error).toMatch(/300,?000/);
    expect(await prisma.expense.count({ where: { eventId } })).toBe(0);
  });

  it("accepts the same split once the shares follow the CURRENT currency", async () => {
    /**
     * The fix, end to end: the memo depends on the parser, so after the switch
     * the shares are parsed in yen like the bill is, and the identical form
     * the person was looking at goes through.
     */
    const yen = (text: string) => minorUnitsFrom(text, "JPY");
    expect(await currencyForEvent(eventId), "setup: the club is in yen").toBe("JPY");

    const res = await addExpense({
      description: `${TAG} clubhouse round`,
      amountCents: yen("3000"),
      paidBy: aki,
      shares: [
        { playerId: aki, weight: 1, amountCents: yen("1000") },
        { playerId: ben, weight: 1, amountCents: yen("2000") },
      ],
    });
    expect(res.ok, res.error).toBe(true);

    const row = await prisma.expense.findFirst({
      where: { eventId },
      select: { amountCents: true },
    });
    expect(row?.amountCents, "¥3,000 is 3000 minor units").toBe(3000);

    const stored = await prisma.expenseShare.findMany({
      where: { expense: { eventId } },
      select: { playerId: true, amountCents: true },
    });
    expect(
      stored.find((s) => s.playerId === aki)?.amountCents,
      "and each share is yen too, not a hundred times it",
    ).toBe(1000);
    expect(stored.find((s) => s.playerId === ben)?.amountCents).toBe(2000);
  });

  it("refuses multi-payer amounts still parsed in the previous currency", async () => {
    /**
     * `payers` is the second memo with the same fault, and it fails the same
     * way — against a different guard, because what everybody PAID has to
     * total the bill just as what everybody OWES does.
     */
    await setCurrency("USD");
    const stale = (text: string) => minorUnitsFrom(text, "USD");
    await setCurrency("JPY");

    const res = await addExpense({
      description: `${TAG} two payers`,
      amountCents: minorUnitsFrom("3000", "JPY"),
      paidBy: aki,
      payers: [
        { playerId: aki, amountCents: stale("1000") },
        { playerId: ben, amountCents: stale("2000") },
      ],
    });

    expect(res.ok, "credits a hundred times the bill must not stand").toBe(false);
    expect(res.error).toMatch(/300,?000/);
    expect(await prisma.expense.count({ where: { eventId } })).toBe(0);
  });
});
