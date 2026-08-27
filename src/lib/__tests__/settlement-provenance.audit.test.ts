import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * A recorded payment has to remember what it was paying.
 *
 * The standing position is computed LIVE from the expenses, the skins and the
 * side games. A settlement that exactly cleared a debt therefore stops looking
 * like one the moment any input moves — an expense corrected the following
 * week, a skins result adjusted, a money rule fixed. The row said only
 * "Ana paid Bo £23.50", and a committee reading it a month later could not
 * tell whether that was the whole debt or two thirds of it.
 *
 * Against real rows because the thing under test is the interaction between a
 * live calculation and a stored one. A mocked Prisma would be asserting that
 * my own stub agrees with itself.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();
const TAG = "ZZ-AUDIT-SETTLE";

let session: { eventId: string; email: string; name: string; role: string; viewRole: string } | null =
  null;

vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { recordSettlement } = await import("@/app/actions/expenses");
const { moneyFor } = await import("@/lib/services/expenses");
const { moneyRulesVersion } = await import("@/lib/domain/money-rules-version");

let eventId = "";
let ana = "";
let bo = "";

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
  ana = await mk("ana", 1);
  bo = await mk("bo", 2);
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

/** Bo pays for something both share, so Ana owes Bo half of it. */
async function anaOwesBo(amountCents: number) {
  await prisma.expense.create({
    data: {
      eventId,
      description: `${TAG} dinner`,
      amountCents,
      paidBy: bo,
      shares: {
        create: [
          { playerId: ana, weight: 1 },
          { playerId: bo, weight: 1 },
        ],
      },
    },
  });
}

const settlementRow = async () =>
  prisma.settlement.findFirst({
    where: { eventId },
    select: { cents: true, owedCents: true, rulesVersion: true },
  });

describe("a settlement records the position it settled", () => {
  it("captures what was owed at the moment the money changed hands", async () => {
    await anaOwesBo(5000); // Ana owes Bo 2500

    const res = await recordSettlement(ana, bo, 2500);
    expect(res.ok, res.error).toBe(true);

    const row = await settlementRow();
    expect(row?.owedCents, "the standing debt was not captured").toBe(2500);
    expect(row?.cents).toBe(2500);
  });

  it("still says the payment cleared its debt after the ledger moves under it", async () => {
    /**
     * THE FAILURE THIS PREVENTS. Ana paid exactly what she owed. A week later
     * somebody corrects the dinner upwards, and the live position now says Ana
     * owes another £15 — which is true and fine. What is NOT fine is that the
     * payment on file becomes indistinguishable from an underpayment, so the
     * committee cannot tell whether Ana settled honestly against a smaller
     * number or short-changed Bo.
     */
    await anaOwesBo(5000);
    await recordSettlement(ana, bo, 2500);

    // The correction: dinner was really £80, not £50.
    await prisma.expense.updateMany({
      where: { eventId, description: `${TAG} dinner` },
      data: { amountCents: 8000 },
    });

    const view = await moneyFor(eventId, session!.email, { isStaff: true });
    const settled = view.settlements[0];

    expect(settled.owedCents, "the captured debt must not move with the ledger").toBe(2500);
    expect(settled.clearedItsDebt, "Ana paid what she owed AT THE TIME").toBe(true);

    // And the live position has genuinely moved, which is the whole point:
    // both facts are now on record instead of only the newer one.
    const outstanding = view.transfers.find(
      (t) => t.fromPlayerId === ana && t.toPlayerId === bo,
    );
    expect(outstanding?.cents, "the correction should leave more owed").toBe(1500);
  });

  it("stamps which generation of the money rules produced the figure", async () => {
    await anaOwesBo(5000);
    await recordSettlement(ana, bo, 2500);

    const row = await settlementRow();
    expect(row?.rulesVersion).toBe(moneyRulesVersion());
    expect(row?.rulesVersion).toMatch(/^m[0-9a-z]+$/);
  });

  it("records a part payment as a part payment", async () => {
    await anaOwesBo(5000);
    await recordSettlement(ana, bo, 1000);

    const view = await moneyFor(eventId, session!.email, { isStaff: true });
    expect(view.settlements[0].owedCents).toBe(2500);
    expect(view.settlements[0].clearedItsDebt).toBe(false);
  });

  it("leaves the debt unknown rather than zero when nothing was outstanding", async () => {
    /**
     * Somebody settling ahead of the expense being entered is real, and the
     * honest record of it is "we do not know what this was against" — not
     * "nothing was owed", which is a claim the row would be making up.
     */
    const res = await recordSettlement(ana, bo, 2000);
    expect(res.ok, res.error).toBe(true);

    const row = await settlementRow();
    expect(row?.owedCents).toBeNull();

    const view = await moneyFor(eventId, session!.email, { isStaff: true });
    expect(view.settlements[0].clearedItsDebt, "unknown must not read as failed").toBeNull();
  });

  it("does not take the caller's word for what was owed", async () => {
    /**
     * `recordSettlement` is a public HTTP endpoint. It takes an amount, and it
     * must not take a debt: a client that could name the position it was
     * clearing could write a settlement claiming to have cleared one that
     * never existed.
     */
    await anaOwesBo(5000);
    await (recordSettlement as unknown as (
      f: string,
      t: string,
      c: number,
      owed?: number,
    ) => Promise<{ ok: boolean }>)(ana, bo, 100, 999_999);

    const row = await settlementRow();
    expect(row?.owedCents, "the debt came from the caller, not the ledger").toBe(2500);
  });
});
