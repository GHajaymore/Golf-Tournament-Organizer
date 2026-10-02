"use server";
import { headers } from "next/headers";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { organizationAccess } from "@/lib/services/org-access";
import { checkoutUrl, portalUrl } from "@/lib/services/billing";
import { storedPricingOverrides } from "@/lib/services/platform-pricing";
import { isBillingInterval, isPurchasablePlan } from "@/lib/domain/billing";
import { siteOrigin } from "@/lib/site";

/**
 * Buying or managing a plan — club owners and admins only, the same rule as
 * every other club setting. Both return a Stripe-hosted URL for the browser to
 * open; nothing about a card is ever handled here.
 *
 * A "use server" export is a public endpoint, so both validate their input as
 * if it came from anyone: an unknown plan or interval is refused, never coerced.
 */

export type BillingResult = { ok: true; url: string } | { ok: false; error: string };

/** The origin this request came in on, so a preview deploy returns to itself. */
async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return siteOrigin();
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function startCheckout(planInput: string, intervalInput: string): Promise<BillingResult> {
  if (!isPurchasablePlan(planInput)) return { ok: false, error: "That plan can't be bought online." };
  if (!isBillingInterval(intervalInput)) return { ok: false, error: "Choose monthly or yearly." };

  const session = await getSession();
  const org = await organizationAccess(session);
  if (!org) return { ok: false, error: "No club found for this tournament." };
  if (!org.canEdit) return { ok: false, error: "Only a club owner or admin can change the plan." };

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
  if (!org.canEdit) return { ok: false, error: "Only a club owner or admin can manage billing." };
  const result = await portalUrl(org.organizationId, await requestOrigin());
  return "url" in result ? { ok: true, url: result.url } : { ok: false, error: result.error };
}
