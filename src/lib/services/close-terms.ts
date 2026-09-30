import "server-only";
import { prisma } from "../db";
import { wipesOnClose } from "../domain/close-terms";
import { PLANS, effectivePrice, planCurrency } from "../plans";
import { wholeMoney } from "../domain/money-format";
import { storedPricingOverrides } from "./platform-pricing";

/**
 * THE OFFER MADE BEFORE A PAR TOURNAMENT IS DELETED (Ajay, 2026-09-29: "make
 * sure to ask for upgrade before deleting"). The first tier that keeps
 * results, at the price this club is quoted — the same `effectivePrice` in the
 * same currency as its plan panel, so the offer and the panel cannot disagree.
 */
export async function keepItOffer(organizationId: string): Promise<string> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { currency: true, locale: true },
  });
  const keep = PLANS.society;
  const currency = planCurrency(org?.currency);
  const monthly = effectivePrice(keep, await storedPricingOverrides(), currency);
  return `${keep.name} keeps every tournament for good — ${wholeMoney(monthly, currency, org?.locale ?? undefined)} a month.`;
}

/**
 * Whether completing this tournament deletes it: the club's terms, plan and
 * any hold, read in one place for both the button that warns and the action
 * that deletes. See `wipesOnClose` for the rule.
 */
export async function wipesOnCloseFor(eventId: string): Promise<boolean> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      shape: true,
      retainUntil: true,
      organization: { select: { subscription: { select: { plan: true, planTermsApply: true } } } },
    },
  });
  if (!event) return false;
  const sub = event.organization.subscription;
  return wipesOnClose({
    planTermsApply: sub?.planTermsApply,
    plan: sub?.plan,
    shape: event.shape,
    retainUntil: event.retainUntil,
  });
}
