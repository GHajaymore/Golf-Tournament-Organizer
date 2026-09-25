import "dotenv/config";
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { parsePricingOverrides, effectivePrice, planFor } from "@/lib/plans";

/**
 * ONLY THE OWNER MAY CHANGE THE PRICE, AND WHEN THEY DO EVERY SURFACE MOVES.
 *
 * `saveTierPrices` is the one write the owner console has, and it changes the
 * number a stranger reads on the pricing page. So the two things that matter
 * are: a non-owner cannot touch it (and is told exactly what the console tells
 * a stranger — "not found"), and an owner's save lands in the `PlatformSetting`
 * row every pricing surface derives from. Against real rows, because both are
 * decisions made from a session and a stored value together.
 *
 *   npx vitest run --config vitest.audit.config.ts
 */

const prisma = new PrismaClient();

// A known allow-list, so the test does not depend on the machine's real owners.
process.env.OWNER_EMAILS = "zz-owner@example.invalid";
const OWNER = "zz-owner@example.invalid";
const STRANGER = "zz-stranger@example.invalid";

type Session = { eventId: string; email: string; name: string; role: string; viewRole: string };
let session: Session | null = null;

vi.mock("@/lib/auth", () => ({ getSession: async () => session }));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));

const { saveTierPrices } = await import("@/app/actions/owner");

const sess = (email: string): Session => ({ eventId: "e", email, name: "Zz", role: "admin", viewRole: "admin" });
const pricingRow = () => prisma.platformSetting.findUnique({ where: { key: "pricing" } });

beforeEach(async () => {
  await prisma.platformSetting.deleteMany({ where: { key: "pricing" } });
  session = null;
});

afterAll(async () => {
  await prisma.platformSetting.deleteMany({ where: { key: "pricing" } });
  await prisma.$disconnect();
});

describe("the owner's price control", () => {
  it("lets the owner set a price, and every surface reads it back", async () => {
    session = sess(OWNER);
    const res = await saveTierPrices({ club: 149 });
    expect(res.ok).toBe(true);

    // Stored in the one row the readers derive from.
    const row = await pricingRow();
    expect(row).not.toBeNull();
    const overrides = parsePricingOverrides(row!.value);

    // The same reader the landing page, the settings panel and the schema.org
    // offer use now quotes the new number.
    expect(effectivePrice(planFor("club"), overrides)).toBe(149);
  });

  it("REFUSES a non-owner, and writes nothing", async () => {
    session = sess(STRANGER);
    const res = await saveTierPrices({ club: 1 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
    expect(await pricingRow()).toBeNull();
  });

  it("refuses a nonsense price, and writes nothing", async () => {
    session = sess(OWNER);
    const res = await saveTierPrices({ club: -5 });
    expect(res.ok).toBe(false);
    expect(await pricingRow()).toBeNull();
  });

  it("refuses when nobody is signed in", async () => {
    session = null;
    const res = await saveTierPrices({ club: 99 });
    expect(res.ok).toBe(false);
    expect(await pricingRow()).toBeNull();
  });

  it("ignores an unknown plan key rather than storing it", async () => {
    session = sess(OWNER);
    const res = await saveTierPrices({ club: 120, "enterprise-gold": 999 } as Record<string, number>);
    expect(res.ok).toBe(true);
    const overrides = parsePricingOverrides((await pricingRow())!.value);
    expect(effectivePrice(planFor("club"), overrides)).toBe(120);
    // The bogus key resolves to free and is never priced.
    expect(planFor("enterprise-gold").key).toBe("free");
  });
});
