import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

/**
 * ONLY THE OWNERS MAY READ OR WRITE THE BOOKS (B44), against real rows.
 *
 * The Finance tab's three writes, its CSV and its page all decide from a session and a stored allow-list
 * together, so they are held here with real rows. Refused, and told exactly what the console tells a
 * stranger ("Not found."), and NOTHING written:
 *
 *   a signed-out visitor, a club's Admin, a pilot on SIGNIN_ALLOW_EMAILS who is not an owner, a stranger
 *
 * and for the owner: a cost is stored in the minor units of the currency typed, read back in dollars at the
 * dated rate, left out once voided (the row kept, with its reason), a typed rate for one day is one row,
 * and a provider reference written twice is one billing record (so a webhook delivered twice cannot count twice).
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();

process.env.OWNER_EMAILS = "zz-finance-owner@example.invalid";
process.env.SIGNIN_ALLOW_EMAILS = "zz-finance-pilot@example.invalid";
const OWNER = "zz-finance-owner@example.invalid";
const PILOT = "zz-finance-pilot@example.invalid";
const ADMIN = "zz-finance-admin@example.invalid";
const STRANGER = "zz-finance-stranger@example.invalid";
const MARK = "zz-finance-audit";

type Session = { eventId: string; email: string; name: string; role: string; viewRole: string; userId: string };
let session: Session | null = null;
const as = (email: string, role = "admin"): Session => ({ eventId: "e", email, name: "Zz", role, viewRole: role, userId: "zz-finance-user" });

vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { addCostEntry, voidCostEntry, saveFxRate } = await import("@/app/actions/owner-finance");
const { GET } = await import("@/app/owner/finance-export/route");
const { financeView } = await import("@/lib/services/owner-finance");
const { default: OwnerConsolePage } = await import("@/app/owner/page");

const COST = { month: "2026-11", category: "hosting", vendor: `${MARK}-vendor`, currency: "GBP", amount: "39.00", cadence: "once", endsMonth: "", note: "" };
const RATE = { currency: "GBP", day: "2026-11-01", rate: "1.27", reason: `${MARK} bank statement` };

const costs = () => prisma.costEntry.count({ where: { vendor: { startsWith: MARK } } });
const rates = () => prisma.fxRate.count({ where: { reason: { startsWith: MARK } } });

async function cleanup() {
  await prisma.costEntry.deleteMany({ where: { vendor: { startsWith: MARK } } });
  await prisma.fxRate.deleteMany({ where: { reason: { startsWith: MARK } } });
  await prisma.billingRecord.deleteMany({ where: { providerRef: { startsWith: MARK } } });
  const orgs = await prisma.organization.findMany({ where: { name: { startsWith: MARK } }, select: { id: true } });
  await prisma.subscription.deleteMany({ where: { organizationId: { in: orgs.map((o) => o.id) } } });
  await prisma.organization.deleteMany({ where: { id: { in: orgs.map((o) => o.id) } } });
}

beforeAll(cleanup);
afterAll(async () => {
  try {
    await cleanup();
  } finally {
    await prisma.$disconnect();
  }
});

describe("who may touch the books", () => {
  const refused: [string, () => Session | null][] = [
    ["a signed-out visitor", () => null],
    ["a club's Admin", () => as(ADMIN, "admin")],
    ["a pilot on SIGNIN_ALLOW_EMAILS who is not an owner", () => as(PILOT, "admin")],
    ["a stranger", () => as(STRANGER, "player")],
  ];

  for (const [who, make] of refused) {
    it(`${who} is refused every write, told "Not found.", and nothing is stored`, async () => {
      session = make();
      expect(await addCostEntry(COST)).toEqual({ ok: false, error: "Not found." });
      expect(await saveFxRate(RATE)).toEqual({ ok: false, error: "Not found." });
      expect(await voidCostEntry("any-id", "because")).toEqual({ ok: false, error: "Not found." });
      expect(await costs()).toBe(0);
      expect(await rates()).toBe(0);
    });

    it(`${who} gets a 404 from the CSV`, async () => {
      session = make();
      const res = await GET();
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain("month,line");
    });

    it(`${who} gets a 404 from the Finance tab`, async () => {
      session = make();
      await expect(OwnerConsolePage({ searchParams: Promise.resolve({ tab: "finance" }) })).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
    });
  }

  it("an owner whose address is typed with a capital and a space is still the owner", async () => {
    session = as(`  ${OWNER.toUpperCase()} `);
    expect((await addCostEntry({ ...COST, vendor: `${MARK}-case` })).ok).toBe(true);
    await cleanup();
  });
});

describe("what the owner writes", () => {
  it("a cost is stored in minor units of its own currency, with who typed it, and is read back in dollars at the dated rate", async () => {
    session = as(OWNER);
    expect(await saveFxRate(RATE)).toEqual({ ok: true });
    expect(await addCostEntry(COST)).toEqual({ ok: true });
    const row = await prisma.costEntry.findFirstOrThrow({ where: { vendor: COST.vendor } });
    expect(row).toMatchObject({ amountMinor: 3900, currency: "GBP", cadence: "once", source: "typed", enteredByEmail: OWNER, voidedAt: null });

    const view = await financeView("2026-11");
    const november = view.months.find((m) => m.month === "2026-11")!;
    const line = november.lines.find((l) => l.costId === row.id)!;
    // 39.00 GBP at 1.27 is $49.53, worked by hand: 3900 x 1.27 = 4953 cents.
    expect(line.usd?.usdMinor).toBe(4953);
    expect(line.usd?.rate).toMatchObject({ usdMicrosPerUnit: 1_270_000, rateDate: "2026-11-01", source: "override" });
    expect(line.amountMinor).toBe(3900);
  });

  it("the CSV, as an owner, is a 200 that holds the cost and is never cached", async () => {
    session = as(OWNER);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="tourneyhq-finance-\d{4}-\d{2}-\d{2}\.csv"$/);
    const body = await res.text();
    expect(body).toContain(`${MARK}-vendor`);
    expect(body).toContain("GBP,39.00,1.270000,2026-11-01,override,49.53");
  });

  it("a rate for one currency and day typed twice is one row, the second replacing the first", async () => {
    session = as(OWNER);
    expect(await saveFxRate({ ...RATE, rate: "1.30" })).toEqual({ ok: true });
    expect(await rates()).toBe(1);
    expect((await prisma.fxRate.findFirstOrThrow({ where: { reason: { startsWith: MARK } } })).usdMicrosPerUnit).toBe(1_300_000);
  });

  it("a box that is not a figure is refused in words and stores nothing", async () => {
    session = as(OWNER);
    const before = await costs();
    const res = await addCostEntry({ ...COST, amount: "abc" });
    expect(res.ok).toBe(false);
    expect(await costs()).toBe(before);
    expect((await saveFxRate({ ...RATE, reason: "" })).ok).toBe(false);
  });

  it("a voided cost leaves every report, and the row stays with its reason and who", async () => {
    session = as(OWNER);
    const row = await prisma.costEntry.findFirstOrThrow({ where: { vendor: COST.vendor } });
    expect((await voidCostEntry(row.id, "")).ok).toBe(false);
    expect(await voidCostEntry(row.id, "typed twice")).toEqual({ ok: true });
    const kept = await prisma.costEntry.findUniqueOrThrow({ where: { id: row.id } });
    expect(kept.voidedAt).not.toBeNull();
    expect(kept.voidReason).toContain("typed twice");
    expect(kept.voidReason).toContain(OWNER);
    expect((await financeView("2026-11")).costs.map((c) => c.id)).not.toContain(row.id);
    expect((await voidCostEntry(row.id, "again")).ok).toBe(false);
  });
});

describe("billing, which has no writer yet", () => {
  it("the same provider reference twice is one record, so a repeated webhook cannot count twice", async () => {
    const data = { kind: "manual_invoice", providerRef: `${MARK}-inv-1`, currency: "USD", amountMinor: 100_000, paidAt: new Date("2026-11-01T00:00:00Z") };
    await prisma.billingRecord.create({ data });
    await expect(prisma.billingRecord.create({ data })).rejects.toThrow(/Unique constraint/);
    expect(await prisma.billingRecord.count({ where: { providerRef: data.providerRef } })).toBe(1);
  });

  it("a club on a paid plan with no billing record is counted as comped, and stops being once it has one", async () => {
    const before = (await financeView("2026-11")).compedClubs;
    const org = await prisma.organization.create({ data: { name: `${MARK} Heathfield Golf Club`, kind: "club" } });
    await prisma.subscription.create({ data: { organizationId: org.id, plan: "club" } });
    expect((await financeView("2026-11")).compedClubs).toBe(before + 1);
    await prisma.billingRecord.create({
      data: { kind: "subscription_invoice", providerRef: `${MARK}-inv-2`, organizationId: org.id, currency: "USD", amountMinor: 17500, paidAt: new Date("2026-11-01T00:00:00Z") },
    });
    expect((await financeView("2026-11")).compedClubs).toBe(before);
  });
});
