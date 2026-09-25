"use server";
import { getSession } from "@/lib/auth";
import { isOwner } from "@/lib/owner";
import { revalidatePath } from "next/cache";
import { PLANS, type PlanKey } from "@/lib/plans";
import { savePricingOverride } from "@/lib/services/platform-pricing";

/**
 * Owner-only writes — the platform's own controls, not a club's.
 *
 * The owner console is otherwise read-only; this is the one file that changes
 * the business. Every export is gated on `isOwner` against `OWNER_EMAILS` and
 * FAILS CLOSED to a "not found": a caller who is not the owner is told exactly
 * what the console's own page tells a stranger, so a probe of this endpoint
 * cannot even confirm it exists.
 */

export interface OwnerActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Set the monthly price of one or more tiers.
 *
 * Whole currency units, zero or more — the same shape `priceMonthly` uses and
 * `effectivePrice` reads. The value is validated here and again in
 * `savePricingOverride`, so nothing but a clean number reaches the row every
 * pricing surface renders from. An unknown plan key is ignored, never stored.
 */
export async function saveTierPrices(prices: Record<string, number>): Promise<OwnerActionResult> {
  const session = await getSession();
  if (!session || !isOwner(session.email)) return { ok: false, error: "Not found." };

  const clean: Partial<Record<PlanKey, number>> = {};
  for (const [key, monthly] of Object.entries(prices)) {
    if (!(key in PLANS)) continue;
    const n = Number(monthly);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, error: `${key}: a price is a number, zero or more.` };
    }
    clean[key as PlanKey] = Math.round(n);
  }

  await savePricingOverride(clean);
  // Every price on the site is derived from this, so clear the whole router
  // cache — the landing page, the settings panel and the schema.org offer all
  // move together, which is the point of one source.
  revalidatePath("/", "layout");
  return { ok: true };
}
