"use server";
import { getSession } from "@/lib/auth";
import { isOwner } from "@/lib/owner";
import { revalidatePath } from "next/cache";
import { PLANS, LIMIT_KEYS, type PlanKey, type LimitKey } from "@/lib/plans";
import { savePricingOverride } from "@/lib/services/platform-pricing";
import { saveLimitOverride } from "@/lib/services/platform-limits";

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

/**
 * Set the tier LIMITS and the enforcement master switch.
 *
 * The counterpart to `saveTierPrices`, writing the other half of what a tier is
 * — its caps (active tournaments, staff seats, field size) and whether they are
 * enforced at all. `enforce` is the safety catch: OFF by default, and turning it
 * on begins refusing over-limit adds across every club at once, which is why it
 * is a deliberate switch and not implied by setting a number.
 *
 * Validated here and again inside `saveLimitOverride`, so nothing but clean caps
 * reach the row the entry gates read. A blank field means "no cap" (unlimited);
 * an unknown plan key or a negative number is refused.
 */
export async function saveTierLimits(input: {
  enforce: boolean;
  plans: Record<string, Record<string, number | null>>;
}): Promise<OwnerActionResult> {
  const session = await getSession();
  if (!session || !isOwner(session.email)) return { ok: false, error: "Not found." };

  const plans: Partial<Record<PlanKey, Partial<Record<LimitKey, number | null>>>> = {};
  for (const [key, limits] of Object.entries(input.plans ?? {})) {
    if (!(key in PLANS)) continue;
    const per: Partial<Record<LimitKey, number | null>> = {};
    for (const limit of LIMIT_KEYS) {
      if (!(limit in limits)) continue;
      const v = limits[limit];
      if (v === null) {
        per[limit] = null; // an explicit "unlimited"
        continue;
      }
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) {
        return { ok: false, error: `${key} · ${limit}: a limit is a whole number, zero or more.` };
      }
      per[limit] = Math.floor(n);
    }
    if (Object.keys(per).length > 0) plans[key as PlanKey] = per;
  }

  await saveLimitOverride({ enforce: input.enforce === true, plans });
  // The gates read this per request, but revalidate so the console itself
  // re-renders with the saved values rather than a stale render.
  revalidatePath("/owner");
  return { ok: true };
}
