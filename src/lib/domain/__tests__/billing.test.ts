import { describe, it, expect } from "vitest";
import {
  checkoutLineItem,
  clubStatusFor,
  isPurchasablePlan,
  subscriptionIdOf,
  subscriptionWrite,
  type StripeSubscriptionLike,
} from "../billing";
import { PLANS, PLAN_CURRENCIES, effectivePrice, parsePricingOverrides } from "../../plans";
import { handleStripeEvent } from "../../services/billing";
import { golfTermsFor } from "../golf-terms";

const none = parsePricingOverrides(undefined);
const us = golfTermsFor("us");

describe("what Checkout charges", () => {
  it("names the plan in the club's golf", () => {
    expect(checkoutLineItem("society", "month", "USD", none, us).price_data.product_data.description).toBe("Leagues and golf groups");
    expect(checkoutLineItem("society", "month", "GBP", none, golfTermsFor("uk")).price_data.product_data.description).toBe("Leagues and societies");
  });

  it("is the app's own price, in the minor unit, monthly and yearly", () => {
    const month = checkoutLineItem("society", "month", "USD", none, us);
    expect(month.price_data.unit_amount).toBe(Math.round(effectivePrice(PLANS.society, none, "USD") * 100));
    expect(month.price_data.currency).toBe("usd");
    expect(month.price_data.recurring.interval).toBe("month");
    const year = checkoutLineItem("society", "year", "USD", none, us);
    expect(year.price_data.unit_amount).toBe(month.price_data.unit_amount * 10);
    expect(year.price_data.product_data.name).toBe(`TourneyHQ ${PLANS.society.name}`);
  });

  it("follows an owner's price override, so the panel and the charge agree", () => {
    const over = parsePricingOverrides(JSON.stringify({ plans: { club: { monthly: 150 } } }));
    expect(checkoutLineItem("club", "month", "USD", over, us).price_data.unit_amount).toBe(15000);
  });

  it("charges a set local price in the club's currency, never a converted one", () => {
    const gbp = checkoutLineItem("society", "month", "GBP", none, us);
    expect(gbp.price_data.currency).toBe("gbp");
    expect(gbp.price_data.unit_amount).toBe(Math.round(PLANS.society.localMonthly.GBP * 100));
  });

  it("quotes an unpriced currency in dollars", () => {
    expect(checkoutLineItem("society", "month", "JPY", none, us).price_data.currency).toBe("usd");
  });

  it("CONTROL: every plan currency has two decimal places, which ×100 assumes", () => {
    const zeroDecimal = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "UGX", "XAF", "XOF"]);
    expect(PLAN_CURRENCIES.filter((c) => zeroDecimal.has(c))).toEqual([]);
  });

  it("sells only Birdie and Eagle online", () => {
    expect(isPurchasablePlan("society")).toBe(true);
    expect(isPurchasablePlan("club")).toBe(true);
    expect(isPurchasablePlan("free")).toBe(false);
    expect(isPurchasablePlan("enterprise")).toBe(false);
    expect(isPurchasablePlan("anything")).toBe(false);
  });
});

const sub = (over: Partial<StripeSubscriptionLike> = {}): StripeSubscriptionLike => ({
  id: "sub_zz",
  status: "active",
  customer: "cus_zz",
  metadata: { organizationId: "org_zz", plan: "club" },
  items: { data: [{ current_period_end: 1_900_000_000 }] },
  ...over,
});

describe("what a Stripe subscription means for a club", () => {
  it("an active subscription puts the club on the plan it bought", () => {
    const w = subscriptionWrite(sub())!;
    expect(w).toMatchObject({ organizationId: "org_zz", plan: "club", status: "active", providerCustomerId: "cus_zz", providerSubscriptionId: "sub_zz" });
    expect(w.currentPeriodEnd?.getTime()).toBe(1_900_000_000 * 1000);
    expect(w.planTermsApply).toBeUndefined();
  });

  it("a payment Stripe is still retrying keeps the plan and flags it — a reminder, not a lockout", () => {
    const w = subscriptionWrite(sub({ status: "past_due" }))!;
    expect(w).toMatchObject({ plan: "club", status: "past_due" });
    expect(w.lapsedAt).toBeUndefined();
  });

  it("Stripe GIVING UP (unpaid) lapses the club, from the moment it is seen (decision A8)", () => {
    const seen = new Date("2026-11-03T10:00:00Z");
    const w = subscriptionWrite(sub({ status: "unpaid" }), seen)!;
    expect(w).toMatchObject({ plan: "free", status: "unpaid", planTermsApply: true });
    expect(w.lapsedAt?.getTime()).toBe(seen.getTime());
  });

  it("a cancelled subscription lapses the club from Stripe's END date, not from when we heard", () => {
    const ended = 1_800_000_000; // Stripe's ended_at, in seconds
    const heard = new Date(ended * 1000 + 5 * 86_400_000);
    const w = subscriptionWrite(sub({ status: "canceled", ended_at: ended }), heard)!;
    expect(w).toMatchObject({ plan: "free", status: "canceled", planTermsApply: true });
    expect(w.lapsedAt?.getTime()).toBe(ended * 1000);
    expect(w.currentPeriodEnd?.getTime()).toBe(ended * 1000);
    // Replayed a week later, the same instant: the archive's end cannot be pushed forward.
    expect(subscriptionWrite(sub({ status: "canceled", ended_at: ended }), new Date(heard.getTime() + 7 * 86_400_000))!.lapsedAt?.getTime()).toBe(ended * 1000);
  });

  it("a checkout that expired unpaid lapses nothing — the club never had the plan", () => {
    const w = subscriptionWrite(sub({ status: "incomplete_expired", ended_at: 1_800_000_000 }))!;
    expect(w).toMatchObject({ plan: "free", status: "canceled" });
    expect(w.lapsedAt).toBeUndefined();
    expect(w.planTermsApply).toBeUndefined();
  });

  it("a paid plan that is still running lapses nothing and doesn't touch the terms", () => {
    const w = subscriptionWrite(sub({ status: "active" }))!;
    expect(w.lapsedAt).toBeUndefined();
    expect(w.planTermsApply).toBeUndefined();
  });

  it("a checkout still waiting on its first payment changes nothing", () => {
    expect(subscriptionWrite(sub({ status: "incomplete" }))).toBeNull();
  });

  it("refuses to guess: no club, or a plan that can't be bought, writes nothing", () => {
    expect(subscriptionWrite(sub({ metadata: {} }))).toBeNull();
    expect(subscriptionWrite(sub({ metadata: { organizationId: "org_zz", plan: "enterprise" } }))).toBeNull();
    expect(subscriptionWrite(sub({ metadata: { organizationId: "org_zz", plan: "free" } }))).toBeNull();
    expect(subscriptionWrite(sub({ metadata: null }))).toBeNull();
  });

  it("reads the customer whether Stripe sends an id or an object", () => {
    expect(subscriptionWrite(sub({ customer: { id: "cus_obj" } }))?.providerCustomerId).toBe("cus_obj");
  });

  it("maps every Stripe status it knows, and leaves unknown ones pending", () => {
    expect(clubStatusFor("trialing")).toBe("trialing");
    expect(clubStatusFor("paused")).toBe("past_due");
    expect(clubStatusFor("unpaid")).toBe("unpaid");
    expect(clubStatusFor("something_new")).toBe("pending");
  });
});

describe("which subscription an event is about", () => {
  it("reads it from every event shape the webhook handles", () => {
    expect(subscriptionIdOf({ type: "customer.subscription.updated", data: { object: { id: "sub_a" } } })).toBe("sub_a");
    expect(subscriptionIdOf({ type: "checkout.session.completed", data: { object: { subscription: "sub_b" } } })).toBe("sub_b");
    expect(subscriptionIdOf({ type: "invoice.paid", data: { object: { subscription: { id: "sub_c" } } } })).toBe("sub_c");
    expect(
      subscriptionIdOf({ type: "invoice.paid", data: { object: { parent: { subscription_details: { subscription: "sub_d" } } } } }),
    ).toBe("sub_d");
    expect(subscriptionIdOf({ type: "invoice.paid", data: { object: {} } })).toBeNull();
  });
});

describe("handling an event", () => {
  const applied: unknown[] = [];
  const deps = (current: StripeSubscriptionLike) => ({
    retrieveSubscription: async () => current,
    apply: async (w: unknown) => {
      applied.push(w);
    },
  });

  it("ignores events that cannot change a plan", async () => {
    expect(await handleStripeEvent({ type: "charge.succeeded", data: { object: {} } }, deps(sub()))).toBe("ignored");
  });

  it("acts on the subscription AS STRIPE HAS IT NOW, not the event's copy — so a late event can't undo a cancel", async () => {
    applied.length = 0;
    // A stale "updated" whose payload still says active arrives after the cancel.
    const stale = { type: "customer.subscription.updated", data: { object: { id: "sub_zz", status: "active" } } };
    expect(await handleStripeEvent(stale, deps(sub({ status: "canceled" })))).toBe("applied");
    expect(applied[0]).toMatchObject({ plan: "free", status: "canceled" });
  });

  it("does nothing with a subscription that names no club", async () => {
    applied.length = 0;
    const e = { type: "customer.subscription.created", data: { object: { id: "sub_zz" } } };
    expect(await handleStripeEvent(e, deps(sub({ metadata: {} })))).toBe("unrecognised");
    expect(applied).toEqual([]);
  });
});
