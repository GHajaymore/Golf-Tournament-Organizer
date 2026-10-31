"use server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { isOwner } from "@/lib/owner";
import { revalidatePath } from "next/cache";
import { PLANS, LIMIT_KEYS, isValidPercentOff, keepsDataForever, type PlanKey, type LimitKey } from "@/lib/plans";
import { liftArchive } from "@/lib/services/club-archive";
import { savePricingOverride } from "@/lib/services/platform-pricing";
import { drainWaitlist } from "@/lib/services/waitlist";
import { saveLimitOverride } from "@/lib/services/platform-limits";
import { createDiscount, setDiscountActive } from "@/lib/services/platform-discounts";
import { setSignInsOpen } from "@/lib/services/signins-switch";
import { sendEarlyListCodes as sendCodes } from "@/lib/services/early-list";
import { ownerClockInWords } from "@/lib/services/owner-clock";

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
 * GO LIVE, OR HOLD AGAIN — the one switch for launch (Ajay, 2026-10-21: "make sure its an easy
 * control which we can flip back to allow signup / signin"; 2026-10-23: "one switch to say let's go
 * live"). A row, not a deploy: every page listed in `go-live.ts` follows it on the next page anybody
 * opens. It can only open what production's hold shut; it never shuts dev, CI or a preview
 * (`services/signins-switch.ts`).
 */
export async function setAccountsOpen(open: boolean): Promise<OwnerActionResult & { now?: "open" | "held" }> {
  const session = await getSession();
  if (!session || !isOwner(session.email)) return { ok: false, error: "Not found." };
  if (typeof open !== "boolean") return { ok: false, error: "Say open or held." };
  const now = await setSignInsOpen(open);
  // Every public page reads it, not only / and /owner — the whole router cache, as prices do.
  revalidatePath("/", "layout");
  return { ok: true, now };
}

/**
 * SEND THE EARLY-LIST CODES — the owner's own press, once live (2026-10-23). Never part of Go live
 * and never automatic: the card shows who is waiting and the email they will get, and this runs only
 * when the owner presses Send and confirms. Today's mail allowance is kept; the rest wait for his
 * next press (`services/early-list.ts`).
 */
export async function sendEarlyListCodes(): Promise<OwnerActionResult & { sent?: number; later?: number; nextAt?: string | null }> {
  const session = await getSession();
  if (!session || !isOwner(session.email)) return { ok: false, error: "Not found." };
  const res = await sendCodes();
  revalidatePath("/owner");
  // When the rest can go, in words on the owner's own clock — said beside the press.
  const nextAt = res.nextAt ? await ownerClockInWords(session.userId, res.nextAt) : null;
  return { ok: res.ok, error: res.error, sent: res.sent, later: res.later, nextAt };
}

/**
 * PUT ONE CLUB ON A TIER — Par, Birdie, Eagle or Albatross.
 *
 * Nothing in the app could change a club's plan before this; it was a hand
 * edit in the database, so Albatross could not be given to anybody without
 * one. Found by the club's name, exactly (case aside), and refused when that
 * name matches more than one club rather than guessing which was meant.
 *
 * Only `plan` moves. Whether the club is held to the published terms
 * (`planTermsApply`) is a fact about when it joined and is never touched here —
 * a grandfathered club moved to Par does not start losing tournaments.
 */
export async function setClubPlan(clubName: string, plan: string): Promise<OwnerActionResult & { club?: string }> {
  const session = await getSession();
  if (!session || !isOwner(session.email)) return { ok: false, error: "Not found." };
  if (!(plan in PLANS)) return { ok: false, error: "Pick one of the four tiers." };
  const name = clubName.trim();
  if (!name) return { ok: false, error: "Type the club's name." };

  const matches = await prisma.organization.findMany({
    where: { name: { equals: name, mode: "insensitive" } },
    select: { id: true, name: true },
    take: 2,
  });
  if (matches.length === 0) return { ok: false, error: `No club is called “${name}”.` };
  if (matches.length > 1) {
    return { ok: false, error: `More than one club is called “${name}”, so nothing was changed.` };
  }

  const org = matches[0];
  await prisma.$transaction(async (tx) => {
    await tx.subscription.upsert({
      where: { organizationId: org.id },
      update: { plan },
      // No row is a club that predates the terms, so a new row keeps it so.
      create: { organizationId: org.id, plan, planTermsApply: false },
    });
    // A paid plan arranged directly is the club paying again: a lapsed club's
    // archive lifts, exactly as resubscribing through Stripe lifts it.
    if (keepsDataForever(plan)) await liftArchive(tx, org.id);
  });
  /**
   * A HIGHER CAP OPENS PLACES (2026-10-09). Players put on a waiting list only
   * because the old plan's field was full are owed those places now, in the
   * order they queued. `drainWaitlist` still holds every field to the
   * organizer's own capacity and the new plan's cap, so a downgrade, or a
   * field the organizer chose to keep small, promotes nobody.
   */
  const open = await prisma.event.findMany({
    where: { organizationId: org.id, status: { notIn: ["completed"] } },
    select: { id: true },
  });
  for (const e of open) await drainWaitlist(e.id);
  revalidatePath("/owner");
  return { ok: true, club: org.name };
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

export interface CreateDiscountResult extends OwnerActionResult {
  /** The generated code, so the console can show it the moment it is made. */
  code?: string;
  percentOff?: number;
}

/**
 * Generate a discount code — a percentage off, for the owner to hand out.
 *
 * The owner sets the percent and, optionally, a label, a redemption cap and an
 * expiry; the code is generated and returned so it can be copied straight away.
 * Validated here and again in the service.
 */
export async function createDiscountCode(input: {
  percentOff: number;
  label?: string;
  maxRedemptions?: number | null;
  expiresAt?: string | null;
}): Promise<CreateDiscountResult> {
  const session = await getSession();
  if (!session || !isOwner(session.email)) return { ok: false, error: "Not found." };

  const percentOff = Math.round(Number(input.percentOff));
  if (!isValidPercentOff(percentOff)) {
    return { ok: false, error: "A discount is a whole percent from 1 to 100." };
  }

  const max = input.maxRedemptions == null ? null : Math.round(Number(input.maxRedemptions));
  if (max != null && (!Number.isFinite(max) || max < 1)) {
    return { ok: false, error: "A redemption limit is a whole number of one or more, or blank for no limit." };
  }

  let expiresAt: Date | null = null;
  if (input.expiresAt) {
    const d = new Date(input.expiresAt);
    if (Number.isNaN(d.getTime())) return { ok: false, error: "That expiry date doesn't look right." };
    expiresAt = d;
  }

  try {
    const made = await createDiscount({
      percentOff,
      label: input.label ?? "",
      maxRedemptions: max,
      expiresAt,
    });
    revalidatePath("/owner");
    return { ok: true, code: made.code, percentOff: made.percentOff };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Couldn't create the code." };
  }
}

/** Switch a discount code on or off. */
export async function setDiscountCodeActive(code: string, active: boolean): Promise<OwnerActionResult> {
  const session = await getSession();
  if (!session || !isOwner(session.email)) return { ok: false, error: "Not found." };
  await setDiscountActive(code, active === true);
  revalidatePath("/owner");
  return { ok: true };
}
