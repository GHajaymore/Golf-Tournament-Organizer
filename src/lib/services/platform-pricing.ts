import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import {
  WORLD_REGION_ID,
  effectiveRegions,
  parsePricingOverrides,
  pricingOverrides,
  type PlanKey,
  type PriceRegion,
  type PricingOverrides,
} from "@/lib/plans";

/**
 * WHERE THE OWNER'S PRICE OVERRIDES ARE KEPT, AND HOW EVERY SURFACE READS THEM.
 *
 * `plans.ts` designed for this from the start: `effectivePrice(plan, overrides,
 * country)` takes the overrides as a parameter precisely so the source can change
 * without the arithmetic changing. Until now the only source was the
 * `TOURNEYHQ_PRICING` environment value; this adds the owner console as a second,
 * higher-priority source — a `PlatformSetting` row the owner edits on screen.
 *
 * Order: the stored row wins when it is present and valid, else the environment
 * value, else each plan's own default (which `planQuote` supplies last).
 * Every layer is validated by `parsePricingOverrides`, which refuses to throw —
 * a bad value falls through to the next source rather than breaking a price on a
 * page a stranger reads.
 */

const PRICING_KEY = "pricing";

/**
 * The pricing overrides in force, resolved once per request.
 *
 * Memoised with React's `cache`: the landing page, the settings panel, the
 * schema.org offer and the owner console's own MRR all read this in one render,
 * and one request should hit the row once. Outside a render it is simply the
 * function.
 */
export const storedPricingOverrides = cache(async (): Promise<PricingOverrides> => {
  try {
    const row = await prisma.platformSetting.findUnique({ where: { key: PRICING_KEY } });
    if (row?.value) {
      const parsed = parsePricingOverrides(row.value);
      // An empty parse (all values invalid) falls back to the environment layer,
      // so a row someone hand-cleared does not silently blank every override.
      if (Object.keys(parsed.plans).length > 0 || parsed.annualMonths !== undefined || parsed.regions) return parsed;
    }
  } catch {
    // A database blip must never take a price off a page. Fall back to env.
  }
  return pricingOverrides();
});

/**
 * Save the owner's price overrides — a validated JSON blob in one row.
 *
 * The row is ALWAYS written as regions (`effectiveRegions` folds an older row's
 * `monthly` / `byCurrency` in first, so nothing the owner had set is lost), and
 * serialised through `parsePricingOverrides` so exactly the shape the readers
 * expect is stored and nothing else.
 *
 * `prices` are the dollar prices: with a full region list they are Rest of
 * world's; without one they go to every region that quotes in dollars, which
 * is what "set Eagle to $149" meant before regions.
 */
export async function savePricingOverride(
  prices: Partial<Record<PlanKey, number>>,
  more: {
    /** Every region but Rest of world, REPLACING the stored ones. Absent keeps what is stored. */
    regions?: PriceRegion[];
    /** The all-regions months billed for a year; null clears it to the default; undefined keeps what is stored. */
    annualMonths?: number | null;
  } = {},
): Promise<void> {
  const existing = await prisma.platformSetting.findUnique({ where: { key: PRICING_KEY } });
  const current = parsePricingOverrides(existing?.value);
  const stored = effectiveRegions(current);
  const others = more.regions ?? stored.filter((r) => r.id !== WORLD_REGION_ID);
  const world = stored.find((r) => r.id === WORLD_REGION_ID) ?? { id: WORLD_REGION_ID, name: "Rest of world", countries: [], currency: "USD", monthly: {} };

  const regions: PriceRegion[] = [...others, world].map((r) => ({ ...r, monthly: { ...r.monthly } }));
  for (const region of regions) {
    const dollars = more.regions ? region.id === WORLD_REGION_ID : region.currency === "USD";
    if (!dollars) continue;
    for (const [key, monthly] of Object.entries(prices)) {
      if (typeof monthly === "number" && Number.isFinite(monthly) && monthly >= 0) region.monthly[key as PlanKey] = monthly;
    }
  }

  const annualMonths = more.annualMonths === undefined ? current.annualMonths : more.annualMonths ?? undefined;
  // Round-trip through the parser so what we store is exactly what a reader
  // will accept — the same validator on both sides of the write.
  const clean = parsePricingOverrides(JSON.stringify({ plans: {}, regions, ...(annualMonths !== undefined ? { annualMonths } : {}) }));
  const value = JSON.stringify(clean);

  await prisma.platformSetting.upsert({
    where: { key: PRICING_KEY },
    update: { value },
    create: { key: PRICING_KEY, value },
  });
}
