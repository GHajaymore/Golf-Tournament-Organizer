import "server-only";
import { cache } from "react";
import { prisma } from "@/lib/db";
import {
  parsePricingOverrides,
  pricingOverrides,
  type PlanKey,
  type PricingOverrides,
} from "@/lib/plans";

/**
 * WHERE THE OWNER'S PRICE OVERRIDES ARE KEPT, AND HOW EVERY SURFACE READS THEM.
 *
 * `plans.ts` designed for this from the start: `effectivePrice(plan, overrides)`
 * takes the overrides as a parameter precisely so the source can change without
 * the arithmetic changing. Until now the only source was the `TOURNEYHQ_PRICING`
 * environment value; this adds the owner console as a second, higher-priority
 * source — a `PlatformSetting` row the owner edits on screen.
 *
 * Order: the stored row wins when it is present and valid, else the environment
 * value, else each plan's own default (which `effectivePrice` supplies last).
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
      if (Object.keys(parsed.plans).length > 0) return parsed;
    }
  } catch {
    // A database blip must never take a price off a page. Fall back to env.
  }
  return pricingOverrides();
});

/**
 * Save the owner's price overrides — a validated JSON blob in one row.
 *
 * Serialised through `parsePricingOverrides` so exactly the shape the readers
 * expect is stored and nothing else: an unknown plan key, a negative price or a
 * non-number is dropped here rather than written and tripped over later. A price
 * cleared back to a plan's default is stored as the absence of an override for
 * that plan, which is what makes "reset to default" just mean "send no number".
 */
export async function savePricingOverride(
  prices: Partial<Record<PlanKey, number>>,
): Promise<void> {
  const plans: PricingOverrides["plans"] = {};
  for (const [key, monthly] of Object.entries(prices)) {
    if (typeof monthly === "number" && Number.isFinite(monthly) && monthly >= 0) {
      plans[key as PlanKey] = { monthly };
    }
  }
  // Round-trip through the parser so what we store is exactly what a reader
  // will accept — the same validator on both sides of the write.
  const clean = parsePricingOverrides(JSON.stringify({ plans }));
  const value = JSON.stringify(clean);

  await prisma.platformSetting.upsert({
    where: { key: PRICING_KEY },
    update: { value },
    create: { key: PRICING_KEY, value },
  });
}
