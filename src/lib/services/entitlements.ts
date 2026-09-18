import { prisma } from "@/lib/db";
import { DEFAULT_PLAN, featureAllowed, METERED_FEATURES, type FeatureKey } from "@/lib/plans";

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

/**
 * MAY THIS CLUB DO THIS? The one question, and the one place it is answered.
 *
 * Tier first, then this club's own exceptions — `featureAllowed` decides which
 * wins, and it is a pure function so the rule is testable without a database.
 *
 * WHY EVERY GATE COMES THROUGH HERE rather than reading `hasFeature` on a plan
 * key it fetched itself: an override honoured in one place and forgotten in
 * another is worse than no override at all. A club told it has the honours
 * board, on a screen that then shows nothing, has been lied to twice.
 *
 * No row means the free tier, which is what `planForOrganization` already
 * says. A club with no subscription row and an override is not a state that
 * exists — the override lives ON the subscription.
 */
export async function organizationAllows(
  organizationId: string,
  feature: FeatureKey,
): Promise<boolean> {
  const sub = await prisma.subscription.findUnique({
    where: { organizationId },
    select: { plan: true, featureOverrides: true },
  });
  return featureAllowed(sub?.plan ?? DEFAULT_PLAN, sub?.featureOverrides, feature);
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
  /**
   * THE CLUB, not the plan key, because a club's exceptions are the club's.
   *
   * This read `hasFeature(planForEvent(...))`, which answers from the tier
   * alone — so a club grandfathered into a feature would have been allowed it
   * everywhere `organizationAllows` is asked and refused it everywhere this
   * is, which is four of the app's gates. One question, one answer.
   */
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { organizationId: true },
  });
  if (!event) return { allowed: featureAllowed(DEFAULT_PLAN, "", feature) };

  if (await organizationAllows(event.organizationId, feature)) return { allowed: true };
  const row = METERED_FEATURES.find((f) => f.key === feature);
  return { allowed: false, reason: row?.locked ?? "That isn't included in your plan." };
}
