import "dotenv/config";
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import {
  PLANS, WORLD_REGION_ID, defaultMonthly, effectiveRegions,
  parsePricingOverrides, parseOfferSettings, publicOffers, effectivePrice, effectiveAnnualPrice, planFor,
} from "@/lib/plans";

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

const { saveTierPrices, saveOffers } = await import("@/app/actions/owner");

const sess = (email: string): Session => ({ eventId: "e", email, name: "Zz", role: "admin", viewRole: "admin" });
const pricingRow = () => prisma.platformSetting.findUnique({ where: { key: "pricing" } });

// The development database's own prices and offers, put back exactly as they were when this file ends:
// a test that wipes the rows every pricing surface reads leaves the next person's screens quoting defaults.
const KEYS = ["pricing", "offers"];
const before = new Map<string, string>();

beforeAll(async () => {
  for (const row of await prisma.platformSetting.findMany({ where: { key: { in: KEYS } } })) before.set(row.key, row.value);
});

beforeEach(async () => {
  await prisma.platformSetting.deleteMany({ where: { key: { in: KEYS } } });
  session = null;
});

afterAll(async () => {
  try {
    await prisma.platformSetting.deleteMany({ where: { key: { in: KEYS } } });
    for (const [key, value] of before) await prisma.platformSetting.create({ data: { key, value } });
  } finally {
    await prisma.$disconnect();
  }
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
    expect(effectivePrice(planFor("club"), overrides, "US")).toBe(149);
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
    expect(effectivePrice(planFor("club"), overrides, "US")).toBe(120);
    // The bogus key resolves to free and is never priced.
    expect(planFor("enterprise-gold").key).toBe("free");
  });

  it("keeps the local prices in the row when a dollar price is saved", async () => {
    /**
     * The save rebuilt the whole row from the USD prices it was handed. With
     * `byCurrency` in the same row, that silently deleted every local price
     * the moment the owner touched a dollar figure.
     */
    await prisma.platformSetting.create({
      data: {
        key: "pricing",
        value: JSON.stringify({
          plans: { club: { monthly: 175, byCurrency: { GBP: 129 } }, society: { byCurrency: { EUR: 44 } } },
        }),
      },
    });
    session = sess(OWNER);
    const res = await saveTierPrices({ club: 160 });
    expect(res.ok).toBe(true);

    const overrides = parsePricingOverrides((await pricingRow())!.value);
    expect(effectivePrice(planFor("club"), overrides, "US")).toBe(160);
    expect(effectivePrice(planFor("club"), overrides, "GB"), "the sterling price was wiped").toBe(129);
    // A plan this save did not name keeps its local price too.
    expect(effectivePrice(planFor("society"), overrides, "DE")).toBe(44);
    // CONTROL: a currency nobody overrode reads the plan's own set price.
    expect(effectivePrice(planFor("club"), overrides, "DE")).toBe(159);
  });
});

describe("the Plans panel's own press: every region as it opens, one Rest of world price changed", () => {
  it("stores Rest of world's price and quotes it to a country in no region, keeping every other region's", async () => {
    session = sess(OWNER);
    // Exactly what OwnerPricing sends on a first save: every default region but Rest of world, each box
    // opened on its quoted default, and Rest of world's boxes with Birdie typed as 51.
    const regions = effectiveRegions({ plans: {} })
      .filter((r) => r.id !== WORLD_REGION_ID)
      .map((r) => ({
        id: r.id,
        name: r.name,
        currency: r.currency,
        countries: r.countries,
        monthly: { society: defaultMonthly(PLANS.society, r.currency) ?? null, club: defaultMonthly(PLANS.club, r.currency) ?? null },
        annualMonths: null,
      }));
    const res = await saveTierPrices({ society: 51, club: 175 }, { regions, annualMonths: null });
    expect(res).toEqual({ ok: true });
    const overrides = parsePricingOverrides((await pricingRow())!.value);
    expect(overrides.regions?.find((r) => r.id === WORLD_REGION_ID)?.monthly.society, "Rest of world's Birdie was not stored").toBe(51);
    expect(effectivePrice(PLANS.society, overrides, "BR"), "a country in no region is not quoted it").toBe(51);
    // CONTROL: the regions sent at their defaults kept their own prices; the dollar box moved only Rest of world.
    expect(effectivePrice(PLANS.society, overrides, "GB")).toBe(PLANS.society.localMonthly.GBP);
    expect(effectivePrice(PLANS.society, overrides, "US")).toBe(PLANS.society.priceMonthly);
  });
});

describe("the owner's regions and yearly months", () => {
  const india = { name: "India", currency: "INR", countries: ["IN"], monthly: { society: 2999, club: 9999 }, annualMonths: null };

  it("saves a region and the months billed, and every reader quotes them", async () => {
    session = sess(OWNER);
    const res = await saveTierPrices({ society: 49, club: 175 }, { regions: [india], annualMonths: 9 });
    expect(res.ok).toBe(true);
    const overrides = parsePricingOverrides((await pricingRow())!.value);
    expect(effectivePrice(planFor("club"), overrides, "IN")).toBe(9999);
    expect(effectiveAnnualPrice(planFor("club"), overrides, "IN")).toBe(9999 * 9);
    expect(effectivePrice(planFor("club"), overrides, "BR")).toBe(175);
  });

  it("REFUSES a non-owner, and writes nothing", async () => {
    session = sess(STRANGER);
    const res = await saveTierPrices({ club: 1 }, { regions: [india], annualMonths: 9 });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not found/i);
    expect(await pricingRow()).toBeNull();
  });

  it("refuses a country that is already in a region, naming it, and writes nothing", async () => {
    session = sess(OWNER);
    const res = await saveTierPrices(
      { society: 49, club: 175 },
      { regions: [{ ...india, name: "Raj", countries: ["IN", "GB"] }, { ...india, name: "Brit", currency: "GBP", countries: ["GB"], monthly: {} }] },
    );
    expect(res.ok).toBe(false);
    expect(res.error).toBe("United Kingdom is already in Raj.");
    expect(await pricingRow()).toBeNull();
  });

  it("refuses what is not a price list or a regions object, in words, rather than throwing; writes nothing", async () => {
    session = sess(OWNER);
    const call = saveTierPrices as unknown as (a: unknown, b?: unknown) => Promise<{ ok: boolean; error?: string }>;
    for (const [prices, more] of [[null, undefined], ["49", undefined], [{ club: 175 }, 5], [{ club: 175 }, "regions"], [{ club: 175 }, null]] as const) {
      const res = await call(prices, more);
      expect(res.ok, `${JSON.stringify(prices)} / ${JSON.stringify(more)}`).toBe(false);
      expect(res.error).toMatch(/did not arrive/);
    }
    expect(await pricingRow()).toBeNull();
  });

  it("never prices Par or Albatross, even when a call names them", async () => {
    session = sess(OWNER);
    const res = await saveTierPrices({ free: 9, enterprise: 999, club: 170 });
    expect(res.ok).toBe(true);
    const overrides = parsePricingOverrides((await pricingRow())!.value);
    expect(effectivePrice(planFor("free"), overrides, "US")).toBe(0);
    expect(effectivePrice(planFor("enterprise"), overrides, "US")).toBe(0);
    expect(effectivePrice(planFor("club"), overrides, "US"), "CONTROL: the paid price in the same press was stored").toBe(170);
  });

  it("refuses months billed outside 1 to 12, and writes nothing", async () => {
    session = sess(OWNER);
    for (const bad of [0, 13, 9.5]) {
      const res = await saveTierPrices({ club: 175 }, { annualMonths: bad });
      expect(res.ok, String(bad)).toBe(false);
    }
    expect(await pricingRow()).toBeNull();
  });

  it("a plain dollar save keeps the regions the owner added", async () => {
    session = sess(OWNER);
    await saveTierPrices({ society: 49, club: 175 }, { regions: [india], annualMonths: 9 });
    await saveTierPrices({ club: 160 });
    const overrides = parsePricingOverrides((await pricingRow())!.value);
    expect(effectivePrice(planFor("club"), overrides, "IN"), "the Indian region was wiped").toBe(9999);
    expect(overrides.annualMonths, "the months billed were wiped").toBe(9);
    expect(effectivePrice(planFor("club"), overrides, "BR")).toBe(160);
  });
});

describe("the owner's event passes and seasonal plan", () => {
  const offers = {
    onSale: false,
    passes: [{ name: "Event pass", prices: { world: 31 }, maxPlayers: 64 }],
    seasonal: { tier: "society", months: 6, prices: { world: 250 } },
  };
  const offersRow = () => prisma.platformSetting.findUnique({ where: { key: "offers" } });

  it("saves them, still not on sale", async () => {
    session = sess(OWNER);
    const res = await saveOffers(offers);
    expect(res.ok).toBe(true);
    const stored = parseOfferSettings((await offersRow())!.value);
    expect(stored.onSale).toBe(false);
    expect(stored.passes[0].prices.world).toBe(31);
    expect(stored.seasonal.prices.world).toBe(250);
    expect(publicOffers(stored)).toEqual({ passes: [], seasonal: null });
  });

  it("REFUSES a non-owner and nobody signed in, and writes nothing", async () => {
    for (const s of [sess(STRANGER), null]) {
      session = s;
      const res = await saveOffers({ ...offers, onSale: true });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/not found/i);
    }
    expect(await offersRow()).toBeNull();
  });

  it("refuses even the owner turning On sale on while nothing can sell a pass, and writes nothing", async () => {
    session = sess(OWNER);
    const res = await saveOffers({ ...offers, onSale: true });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/cannot be bought until billing sells them/);
    expect(await offersRow()).toBeNull();
  });

  it("refuses a negative price, a cap of 0 and a free tier for the season, and writes nothing", async () => {
    session = sess(OWNER);
    const bad = [
      { ...offers, passes: [{ ...offers.passes[0], prices: { world: -1 } }] },
      { ...offers, passes: [{ ...offers.passes[0], maxPlayers: 0 }] },
      { ...offers, seasonal: { ...offers.seasonal, tier: "free" } },
    ];
    for (const b of bad) expect((await saveOffers(b)).ok).toBe(false);
    expect(await offersRow()).toBeNull();
  });
});
