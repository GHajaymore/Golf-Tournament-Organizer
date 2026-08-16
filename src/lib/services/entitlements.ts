import { prisma } from "@/lib/db";
import { DEFAULT_PLAN, hasFeature, METERED_FEATURES, type FeatureKey } from "@/lib/plans";

/**
 * What a club's plan entitles it to.
 *
 * Its own module because the metered features are gated in four places —
 * texting, card reading, and the three drafting actions — and a gate copied
 * four times is a gate that gets updated three times. Everything here reads
 * the plan and nothing writes it.
 *
 * The features these gate are BUILT AND WORKING. They are switched off because
 * each one costs real money per use — a carrier charge per text, a model
 * charge per card or per draft — and the product has no revenue yet to cover
 * them. Nothing here is a stub: flipping the flags in lib/plans.ts is the
 * whole of turning them on. See the features block there.
 */

/** The plan key for one organization, defaulting to free when there's no row. */
export async function planForOrganization(organizationId: string): Promise<string> {
  const sub = await prisma.subscription.findUnique({
    where: { organizationId },
    select: { plan: true },
  });
  return sub?.plan ?? DEFAULT_PLAN;
}

/** The plan key for the club that owns an event. */
export async function planForEvent(eventId: string): Promise<string> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { organizationId: true },
  });
  if (!event) return DEFAULT_PLAN;
  return planForOrganization(event.organizationId);
}

export interface Entitlement {
  allowed: boolean;
  /** Set when not allowed — safe to show to an organizer, and says what still
   *  works and why the feature is off. */
  reason?: string;
}

/**
 * May this event's club use a metered feature right now?
 *
 * The refusal text comes from METERED_FEATURES rather than being written at
 * each call site, so the words at the locked door and the words on the upgrade
 * page are the same string.
 */
export async function entitlementForEvent(
  eventId: string,
  feature: FeatureKey,
): Promise<Entitlement> {
  if (hasFeature(await planForEvent(eventId), feature)) return { allowed: true };
  const row = METERED_FEATURES.find((f) => f.key === feature);
  return { allowed: false, reason: row?.locked ?? "That isn't included in your plan." };
}
