import {
  PLANS,
  effectivePrice,
  effectiveAnnualPrice,
  planCurrency,
  planTagline,
  type PlanKey,
  type PricingOverrides,
} from "../plans";
import type { GolfWords } from "./golf-terms";

/**
 * SUBSCRIPTION BILLING — what TourneyHQ charges a club for the SOFTWARE
 * (Ajay, 2026-10-02: "start building the stripe").
 *
 * Not golf money. Hard rule 7 is about the money a FIELD plays for — skins,
 * prizes, settle-ups — which the app works out and writes down and never moves.
 * This is the club paying for its plan, and it runs entirely on Stripe's own
 * hosted pages (Checkout and the Billing Portal): no card number, bank detail
 * or payment form ever touches TourneyHQ.
 *
 * Everything here is pure, so the rules — what can be bought, at what price,
 * and what a Stripe subscription means for a club's plan — are tested without
 * Stripe or a database. The I/O lives in `services/billing.ts`.
 */

/** The plans a club can buy on its own. Par is free; Albatross is "Let's talk". */
export const PURCHASABLE_PLANS: readonly PlanKey[] = ["society", "club"] as const;

export type BillingInterval = "month" | "year";

export function isPurchasablePlan(key: string): key is PlanKey {
  return (PURCHASABLE_PLANS as readonly string[]).includes(key);
}

export function isBillingInterval(v: string): v is BillingInterval {
  return v === "month" || v === "year";
}

/**
 * The line Checkout charges: the app's own price for this plan, interval and
 * currency, in the currency's minor unit.
 *
 * FROM `effectivePrice`, not from a price id configured in Stripe, so there is
 * one price in the system. An owner override or a local price set in the owner
 * console reaches Checkout the moment it reaches the pricing panel — a club is
 * never shown one number and charged another.
 *
 * Every plan currency in `PLAN_CURRENCIES` has two decimal places, so ×100 is
 * the minor unit for all of them. A currency added later without that property
 * must change this, which is why the currency list is checked in the test.
 */
export function checkoutLineItem(
  planKey: PlanKey,
  interval: BillingInterval,
  currency: string,
  overrides: PricingOverrides,
  /** The club's golf words — the plan's line on Stripe's page is in its golf too. */
  words: GolfWords,
) {
  const plan = PLANS[planKey];
  const code = planCurrency(currency);
  const whole = interval === "year" ? effectiveAnnualPrice(plan, overrides, code) : effectivePrice(plan, overrides, code);
  return {
    quantity: 1,
    price_data: {
      currency: code.toLowerCase(),
      unit_amount: Math.round(whole * 100),
      recurring: { interval },
      product_data: { name: `TourneyHQ ${plan.name}`, description: planTagline(plan, words) },
    },
  };
}

/** What a Stripe subscription status means here. */
export type ClubBillingStatus = "active" | "trialing" | "past_due" | "unpaid" | "canceled";

/** The stored statuses that keep a paid plan. */
export const PAYING_STATUSES: readonly string[] = ["active", "trialing", "past_due"];

/**
 * Stripe's subscription statuses, mapped to the five this app stores.
 *
 * `past_due` keeps the plan: a card that failed is a reminder, not a lockout,
 * while Stripe retries it — the owners are shown a notice to update the card.
 * `unpaid` is Stripe GIVING UP after its retries (Ajay, 2026-10-21, decision
 * A8): until then it kept the paid plan for ever. Now it LAPSES the club, as
 * `canceled` does — see `domain/club-archive.ts`. It is stored apart from
 * `canceled` because the subscription still exists at Stripe: paying its open
 * invoice from Manage billing brings it back to `active`.
 *
 * `incomplete_expired` (a checkout that never paid) reads as `canceled` but is
 * NOT a lapse: the club never had the plan, so nothing of its is archived.
 * `incomplete` is a checkout still waiting on its first payment: the club has
 * not bought anything yet, so it stays where it was. `paused` (a trial that
 * ended with no card) keeps the plan as `past_due` does.
 */
export function clubStatusFor(stripeStatus: string): ClubBillingStatus | "pending" {
  switch (stripeStatus) {
    case "active":
      return "active";
    case "trialing":
      return "trialing";
    case "past_due":
    case "paused":
      return "past_due";
    case "unpaid":
      return "unpaid";
    case "canceled":
    case "incomplete_expired":
      return "canceled";
    default:
      return "pending";
  }
}

/** The parts of a Stripe subscription this app reads. */
export interface StripeSubscriptionLike {
  id: string;
  status: string;
  customer: string | { id: string };
  metadata?: Record<string, string> | null;
  /** When it ended, in Unix seconds — the hold counts from here, not from when we heard. */
  ended_at?: number | null;
  canceled_at?: number | null;
  /** Stripe moved the period end onto the items in 2025; read either. */
  current_period_end?: number | null;
  items?: { data?: { current_period_end?: number | null }[] } | null;
}

/** What to write on the club's Subscription row, or null to leave it alone. */
export interface SubscriptionWrite {
  organizationId: string;
  plan: PlanKey;
  status: ClubBillingStatus;
  providerCustomerId: string;
  providerSubscriptionId: string;
  currentPeriodEnd: Date | null;
  /**
   * Set when a paid subscription LAPSES: the club is on Par's published terms
   * from now on for anything it makes, like any club that signed up to them.
   */
  planTermsApply?: true;
  /**
   * Set when a paid subscription LAPSES (`canceled` after paying, or `unpaid`):
   * the instant it ended. Every tournament the club holds becomes a read-only
   * archive from it (`domain/club-archive.ts`). The service keeps the FIRST one
   * it saw, so a replayed or later event cannot move the archive's end.
   */
  lapsedAt?: Date;
}

/**
 * THE ONE PLACE a Stripe subscription becomes a club's plan.
 *
 * The plan and the club come from the subscription's own metadata, written at
 * checkout — never from anything the browser sent back. A subscription that
 * names no club, or a plan that cannot be bought, is ignored rather than
 * guessed at: a webhook that guesses gives somebody a plan they did not pay
 * for, or takes away one they did.
 */
export function subscriptionWrite(sub: StripeSubscriptionLike, now: Date = new Date()): SubscriptionWrite | null {
  const organizationId = sub.metadata?.organizationId?.trim();
  const planKey = sub.metadata?.plan?.trim() ?? "";
  if (!organizationId || !isPurchasablePlan(planKey)) return null;

  const status = clubStatusFor(sub.status);
  if (status === "pending") return null;

  const periodEnd = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end ?? null;
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const base = {
    organizationId,
    providerCustomerId: customer,
    providerSubscriptionId: sub.id,
    currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
  };

  /**
   * A checkout that never paid ends nothing: the club returns to where it was,
   * which is Par, and no tournament of its is archived — it never had a paid
   * plan to lapse from.
   */
  if (sub.status === "incomplete_expired") {
    return { ...base, plan: "free", status };
  }

  /**
   * A LAPSE returns the club to Par for anything it makes from now on, and
   * archives everything it holds (`domain/club-archive.ts`). From Stripe's own
   * end date for a cancelled subscription, not the moment this event was
   * processed, so a retried event cannot move the archive. An `unpaid` one has
   * no end date — it still exists at Stripe — so it lapses from when it is
   * first seen, and the service keeps that first instant.
   */
  if (status === "canceled" || status === "unpaid") {
    const endedSeconds = status === "canceled" ? (sub.ended_at ?? sub.canceled_at ?? null) : null;
    const lapsedAt = endedSeconds ? new Date(endedSeconds * 1000) : now;
    return {
      ...base,
      plan: "free",
      status,
      planTermsApply: true,
      currentPeriodEnd: status === "canceled" ? lapsedAt : base.currentPeriodEnd,
      lapsedAt,
    };
  }
  return { ...base, plan: planKey, status };
}

/** The events that can change a club's plan. Everything else is acknowledged and ignored. */
export const PLAN_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "invoice.paid",
  "invoice.payment_failed",
]);

/** The subscription id an event is about, whatever its shape. */
export function subscriptionIdOf(event: { type: string; data: { object: Record<string, unknown> } }): string | null {
  const o = event.data.object;
  if (event.type.startsWith("customer.subscription.")) return typeof o.id === "string" ? o.id : null;
  // checkout.session and invoice both carry a `subscription` field (an id or an object).
  const s = o.subscription;
  if (typeof s === "string") return s;
  if (s && typeof s === "object" && typeof (s as { id?: unknown }).id === "string") return (s as { id: string }).id;
  // Newer invoice payloads keep it under parent.subscription_details.
  const parent = o.parent as { subscription_details?: { subscription?: unknown } } | undefined;
  const nested = parent?.subscription_details?.subscription;
  return typeof nested === "string" ? nested : null;
}
