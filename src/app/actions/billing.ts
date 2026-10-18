"use server";
import { headers } from "next/headers";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { organizationAccess } from "@/lib/services/org-access";
import { checkoutUrl, portalUrl } from "@/lib/services/billing";
import { storedPricingOverrides } from "@/lib/services/platform-pricing";
import { isBillingInterval, isPurchasablePlan } from "@/lib/domain/billing";
import { siteOrigin } from "@/lib/site";
import { normalizeDiscountCode } from "@/lib/plans";
import { discountRefusal, discountSaid, type DiscountRow } from "@/lib/domain/discount";
import { checkRateLimit } from "@/lib/rate-limit";

/**
 * Buying or managing a plan — club owners and admins only, the same rule as
 * every other club setting. Both return a Stripe-hosted URL for the browser to
 * open; nothing about a card is ever handled here.
 *
 * A "use server" export is a public endpoint, so both validate their input as
 * if it came from anyone: an unknown plan or interval is refused, never coerced.
 */

/** `about: "discount"` when it is the code that was refused, so the panel says it at the code box. */
export type BillingResult = { ok: true; url: string } | { ok: false; error: string; about?: "discount" };

/** The origin this request came in on, so a preview deploy returns to itself. */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return siteOrigin();
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * A typed discount code, looked up and judged — the row when it can be used
 * now, or the reason it cannot. Empty input is "no code", not an error.
 */
async function usableDiscount(input: unknown): Promise<{ row: DiscountRow | null } | { error: string }> {
  const code = normalizeDiscountCode(typeof input === "string" ? input : "");
  if (!code) return { row: null };
  const row = await prisma.discountCode.findUnique({ where: { code } });
  const refusal = discountRefusal(row, new Date());
  return refusal ? { error: refusal } : { row };
}

/**
 * What a discount code would do for this club, said before anybody pays —
 * the plan panel's "Apply". Staff of a club only, and counted, so it cannot be
 * used to try codes until one works.
 */
export async function checkDiscountCode(input: string): Promise<{ ok: true; code: string; said: string } | { ok: false; error: string }> {
  const session = await getSession();
  const org = await organizationAccess(session);
  if (!org?.canEdit) return { ok: false, error: "Only a Commissioner or Admin can change the plan." };
  const limit = await checkRateLimit("discount-check", session!.userId);
  if (!limit.allowed) return { ok: false, error: limit.message };
  const found = await usableDiscount(input);
  if ("error" in found) return { ok: false, error: found.error };
  if (!found.row) return { ok: false, error: "Enter a discount code." };
  return { ok: true, code: found.row.code, said: discountSaid(found.row.percentOff) };
}

export async function startCheckout(planInput: string, intervalInput: string, discountInput: string = ""): Promise<BillingResult> {
  if (!isPurchasablePlan(planInput)) return { ok: false, error: "That plan can't be bought online." };
  if (!isBillingInterval(intervalInput)) return { ok: false, error: "Choose monthly or yearly." };

  const session = await getSession();
  const org = await organizationAccess(session);
  if (!org) return { ok: false, error: "No club found for this tournament." };
  if (!org.canEdit) return { ok: false, error: "Only a Commissioner or Admin can change the plan." };

  // Judged again here, whatever the panel was told: a code can expire or be
  // switched off between Apply and Pay, and this is a public endpoint.
  const discount = await usableDiscount(discountInput);
  if ("error" in discount) return { ok: false, error: discount.error, about: "discount" };

  const club = await prisma.organization.findUnique({
    where: { id: org.organizationId },
    select: { currency: true, subscription: { select: { plan: true, status: true, providerSubscriptionId: true } } },
  });
  // A club already paying changes plan in the portal, where Stripe prorates —
  // a second checkout would start a second subscription and charge twice.
  const sub = club?.subscription;
  if (sub?.providerSubscriptionId && sub.status !== "canceled") {
    return { ok: false, error: "This club already has a subscription — use Manage billing to change it." };
  }

  const result = await checkoutUrl({
    discount: discount.row,
    organizationId: org.organizationId,
    plan: planInput,
    interval: intervalInput,
    currency: club?.currency ?? "USD",
    overrides: await storedPricingOverrides(),
    email: session?.email ?? null,
    origin: await requestOrigin(),
  });
  return "url" in result ? { ok: true, url: result.url } : { ok: false, error: result.error };
}

export async function openBillingPortal(): Promise<BillingResult> {
  const org = await organizationAccess(await getSession());
  if (!org) return { ok: false, error: "No club found for this tournament." };
  if (!org.canEdit) return { ok: false, error: "Only a Commissioner or Admin can manage billing." };
  const result = await portalUrl(org.organizationId, await requestOrigin());
  return "url" in result ? { ok: true, url: result.url } : { ok: false, error: result.error };
}
