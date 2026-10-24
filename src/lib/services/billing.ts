import Stripe from "stripe";
import { prisma } from "@/lib/db";
import {
  PAYING_STATUSES,
  PLAN_EVENTS,
  checkoutLineItem,
  subscriptionIdOf,
  subscriptionWrite,
  type BillingInterval,
  type StripeSubscriptionLike,
  type SubscriptionWrite,
} from "@/lib/domain/billing";
import type { PlanKey, PricingOverrides } from "@/lib/plans";
import { stripeCouponFor, stripeCouponId, type DiscountRow } from "@/lib/domain/discount";
import { liftArchive } from "@/lib/services/club-archive";

/**
 * Subscription billing through Stripe — the I/O half. The rules are in
 * `domain/billing.ts`; read its header for why this is not golf money.
 *
 * SWITCHED OFF UNTIL CONFIGURED. With no `STRIPE_SECRET_KEY` the app behaves
 * exactly as it did before billing existed: the plan panel says plans are
 * arranged directly and nothing offers to take a card. Turning billing on is
 * setting two environment values, not shipping code.
 */

let client: Stripe | null = null;

/** The Stripe client, or null when billing is not configured. */
export function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  client ??= new Stripe(key);
  return client;
}

export function billingEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

/** Said when Stripe can't be reached or refuses — nothing was charged either way. */
const STRIPE_DOWN = "Couldn't reach the payment page just now. Nothing was charged — try again in a moment.";

/** The club's existing Stripe customer, or a new one recorded on its Subscription row. */
async function customerFor(stripe: Stripe, organizationId: string, email: string | null): Promise<string> {
  const sub = await prisma.subscription.findUnique({
    where: { organizationId },
    select: { providerCustomerId: true },
  });
  if (sub?.providerCustomerId) return sub.providerCustomerId;

  const org = await prisma.organization.findUnique({ where: { id: organizationId }, select: { name: true } });
  const customer = await stripe.customers.create({
    name: org?.name ?? undefined,
    email: email ?? undefined,
    metadata: { organizationId },
  });
  // Recorded straight away, so a second click cannot create a second customer.
  await prisma.subscription.upsert({
    where: { organizationId },
    create: { organizationId, providerCustomerId: customer.id },
    update: { providerCustomerId: customer.id },
  });
  return customer.id;
}

/**
 * The code's Stripe coupon — found by its id, made the first time a club uses
 * the code. One code is one coupon, so Stripe's own count of redemptions is the
 * code's count, and its cap and expiry are enforced at the payment.
 */
async function couponFor(stripe: Stripe, row: DiscountRow): Promise<string> {
  const id = stripeCouponId(row.code);
  try {
    return (await stripe.coupons.retrieve(id)).id;
  } catch (err) {
    if ((err as { code?: string }).code !== "resource_missing") throw err;
  }
  try {
    return (await stripe.coupons.create(stripeCouponFor(row, new Date()))).id;
  } catch (err) {
    // Two clubs at once: the other request made it first, which is the same coupon.
    if ((err as { code?: string }).code === "resource_already_exists") return id;
    throw err;
  }
}

/**
 * Copy Stripe's count of a code's redemptions onto its row — idempotent, so a
 * retried webhook writes the same number again rather than counting twice.
 */
export async function syncDiscountRedemptions(code: string): Promise<void> {
  const stripe = stripeClient();
  if (!stripe || !code) return;
  try {
    const coupon = await stripe.coupons.retrieve(stripeCouponId(code));
    await prisma.discountCode.updateMany({ where: { code }, data: { timesRedeemed: coupon.times_redeemed } });
  } catch (err) {
    console.error("discount redemption sync failed", code, err);
  }
}

export interface CheckoutRequest {
  /** A code the action has already found usable (`discountRefusal`), or none. */
  discount?: DiscountRow | null;
  organizationId: string;
  plan: PlanKey;
  interval: BillingInterval;
  currency: string;
  overrides: PricingOverrides;
  email: string | null;
  /** Absolute origin, e.g. https://tourneyhq.club — Stripe needs full URLs. */
  origin: string;
}

/** A Stripe Checkout page for this plan, or a reason it can't be offered. */
export async function checkoutUrl(req: CheckoutRequest): Promise<{ url: string } | { error: string }> {
  const stripe = stripeClient();
  if (!stripe) return { error: "Online payment isn't switched on yet. Contact us to change plan." };

  try {
    const customer = await customerFor(stripe, req.organizationId, req.email);
    // The club and the plan travel on the SUBSCRIPTION, so every later event
    // about it says which club it is for without trusting anything else.
    const metadata = {
      organizationId: req.organizationId,
      plan: req.plan,
      ...(req.discount ? { discountCode: req.discount.code } : {}),
    };
    // Stripe takes a discount OR its own promotion-code box, never both: with
    // our code applied the box would only invite a second one.
    const discount = req.discount
      ? { discounts: [{ coupon: await couponFor(stripe, req.discount) }] }
      : { allow_promotion_codes: true };
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer,
      client_reference_id: req.organizationId,
      line_items: [checkoutLineItem(req.plan, req.interval, req.currency, req.overrides)],
      subscription_data: { metadata },
      metadata,
      ...discount,
      success_url: `${req.origin}/organization?billing=success#plan`,
      cancel_url: `${req.origin}/organization?billing=cancelled#plan`,
    });
    return session.url ? { url: session.url } : { error: STRIPE_DOWN };
  } catch (err) {
    console.error("stripe checkout failed", err);
    return { error: STRIPE_DOWN };
  }
}

/** Stripe's Billing Portal for this club: change card, see invoices, cancel. */
export async function portalUrl(organizationId: string, origin: string): Promise<{ url: string } | { error: string }> {
  const stripe = stripeClient();
  if (!stripe) return { error: "Online payment isn't switched on yet." };
  const sub = await prisma.subscription.findUnique({
    where: { organizationId },
    select: { providerCustomerId: true },
  });
  if (!sub?.providerCustomerId) return { error: "There's no billing account for this club yet." };
  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: sub.providerCustomerId,
      return_url: `${origin}/organization#plan`,
    });
    return { url: session.url };
  } catch (err) {
    console.error("stripe portal failed", err);
    return { error: "Couldn't open billing just now. Try again in a moment." };
  }
}

/**
 * Write a Stripe subscription's meaning onto the club's Subscription row —
 * and, when a paid plan LAPSES, archive the club's tournaments; when it is
 * paid again, lift the archive (`domain/club-archive.ts`).
 *
 * ONE TRANSACTION, the archive FIRST in it. Par's terms reach a club the
 * moment its plan reads "free", and the sweep runs on a clock that does not
 * wait for this function; a club that is briefly "free and unarchived" is a
 * club whose tournaments the Par sweep could take in the gap. So the stamp and
 * the plan change land together or not at all.
 *
 * Three things it refuses to let an event do, each a real Stripe behaviour:
 *
 *   - A LATE OR REPLAYED LAPSE of a subscription that is no longer the club's —
 *     the old cancelled one, arriving after the club resubscribed on a new one —
 *     changes nothing. Without this a resubscribed club was put back in the
 *     archive by Stripe retrying yesterday's event.
 *   - A SECOND lapse event (a replay, or `unpaid` followed by `canceled`) keeps
 *     the first instant, and stamps nothing new: a tournament the club made on
 *     Par since is Par's, not the archive's.
 *   - A checkout that expired unpaid (`incomplete_expired`) lifts nothing and
 *     archives nothing.
 */
export async function applySubscriptionWrite(w: SubscriptionWrite): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const row = await tx.subscription.findUnique({
      where: { organizationId: w.organizationId },
      select: { providerSubscriptionId: true, status: true, plan: true, lapsedAt: true },
    });
    const anotherIsLive =
      !!row?.providerSubscriptionId &&
      row.providerSubscriptionId !== w.providerSubscriptionId &&
      row.plan !== "free" &&
      PAYING_STATUSES.includes(row.status);
    if (anotherIsLive && !PAYING_STATUSES.includes(w.status)) return;

    const archive: { lapsedAt?: Date } = {};
    if (w.lapsedAt) {
      const lapsedAt = row?.lapsedAt ?? w.lapsedAt;
      if (!row?.lapsedAt) {
        // Every tournament the club holds NOW — completed and unfinished alike.
        await tx.event.updateMany({
          where: { organizationId: w.organizationId, archivedAt: null },
          data: { archivedAt: lapsedAt },
        });
      }
      archive.lapsedAt = lapsedAt;
    } else if (PAYING_STATUSES.includes(w.status) && w.plan !== "free" && row?.lapsedAt) {
      // Paid again: the archive lifts, every tournament carries on as it was.
      await liftArchive(tx, w.organizationId);
    }

    const data = {
      plan: w.plan,
      status: w.status,
      provider: "stripe",
      providerCustomerId: w.providerCustomerId,
      providerSubscriptionId: w.providerSubscriptionId,
      currentPeriodEnd: w.currentPeriodEnd,
      ...(w.planTermsApply ? { planTermsApply: true } : {}),
      ...archive,
    };
    await tx.subscription.upsert({
      where: { organizationId: w.organizationId },
      create: { organizationId: w.organizationId, ...data },
      update: data,
    });
  });
}

export interface EventDeps {
  retrieveSubscription: (id: string) => Promise<StripeSubscriptionLike>;
  apply: (w: SubscriptionWrite) => Promise<void>;
}

/**
 * HANDLE ONE STRIPE EVENT — by asking Stripe for the subscription as it is NOW.
 *
 * Never from the event's own copy. Stripe does not promise order, and it
 * retries: a `customer.subscription.updated` from an hour ago can arrive after
 * the `deleted` that followed it. Re-reading the subscription makes every
 * event idempotent and order-proof — whichever arrives, the row ends as Stripe
 * says the subscription is, so a club is never left on a plan it cancelled or
 * locked out of one it paid for.
 *
 * Returns what it did, for the log and the tests.
 */
export async function handleStripeEvent(
  event: { type: string; data: { object: Record<string, unknown> } },
  deps: EventDeps,
): Promise<"ignored" | "no-subscription" | "unrecognised" | "applied"> {
  if (!PLAN_EVENTS.has(event.type)) return "ignored";
  const id = subscriptionIdOf(event);
  if (!id) return "no-subscription";
  const write = subscriptionWrite(await deps.retrieveSubscription(id));
  if (!write) return "unrecognised";
  await deps.apply(write);
  return "applied";
}
