import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/**
 * A DISCOUNT CODE COMES OFF A CLUB'S FIRST PAYMENT, AND ONLY THAT (Ajay,
 * 2026-10-17: "25% discount is only for the first term (month or year)").
 *
 * The rule is pure and tested here directly; the CHECKOUT is run against a
 * stand-in Stripe so the test reads exactly what Stripe would have been asked
 * for — a once-only coupon of the code's percent, with its cap and expiry — and
 * the doors (sign-up, the plan panel's checkout) are swept for asking the rule
 * before they act.
 */

// ── A stand-in Stripe and database, so checkoutUrl can be run ─────────────
const stripeCalls: { coupons: unknown[]; sessions: Record<string, unknown>[] } = { coupons: [], sessions: [] };
const existingCoupons = new Set<string>();
vi.mock("stripe", () => ({
  default: class {
    customers = { create: async () => ({ id: "cus_zz" }) };
    coupons = {
      retrieve: async (id: string) => {
        if (!existingCoupons.has(id)) throw Object.assign(new Error("No such coupon"), { code: "resource_missing" });
        return { id, times_redeemed: 3 };
      },
      create: async (c: { id: string }) => {
        stripeCalls.coupons.push(c);
        existingCoupons.add(c.id);
        return { id: c.id };
      },
    };
    checkout = {
      sessions: {
        create: async (s: Record<string, unknown>) => {
          stripeCalls.sessions.push(s);
          return { url: "https://checkout.example.invalid/zz" };
        },
      },
    };
  },
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    subscription: { findUnique: async () => ({ providerCustomerId: "cus_zz" }), upsert: async () => ({}) },
    organization: { findUnique: async () => ({ name: "zz-discount club" }) },
    discountCode: { updateMany: async () => ({ count: 1 }) },
  },
}));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("") }));
vi.mock("@/app/actions/billing", () => ({ startCheckout: vi.fn(), openBillingPortal: vi.fn(), checkDiscountCode: vi.fn() }));
vi.mock("@/app/actions/auth", () => ({ signInWithPassword: vi.fn(), claimPassword: vi.fn(), signUp: vi.fn(), requestPasswordReset: vi.fn() }));

import {
  discountCodeOf,
  discountRefusal,
  discountSaid,
  signUpLinkFor,
  stripeCouponFor,
  stripeCouponId,
  type DiscountRow,
} from "@/lib/domain/discount";
import { checkoutUrl } from "@/lib/services/billing";
import { parsePricingOverrides } from "@/lib/plans";
import { PlanBilling } from "@/components/PlanBilling";
import { LoginPanel } from "@/components/LoginPanel";
import { readSource } from "./source";

const NOW = new Date("2026-10-17T22:00:00Z");
const row = (over: Partial<DiscountRow> = {}): DiscountRow => ({
  code: "ZZ7KQ2MX",
  percentOff: 25,
  active: true,
  maxRedemptions: null,
  timesRedeemed: 0,
  expiresAt: null,
  ...over,
});

describe("when a code may be used", () => {
  it("CONTROL: an active code with room and time left may", () => {
    expect(discountRefusal(row(), NOW)).toBeNull();
    expect(discountRefusal(row({ maxRedemptions: 5, timesRedeemed: 4, expiresAt: new Date("2026-12-31T00:00:00Z") }), NOW)).toBeNull();
  });

  it("an unknown code, a switched-off one, an expired one and a used-up one may not — each saying which", () => {
    expect(discountRefusal(null, NOW)).toMatch(/isn't a discount code we know/);
    expect(discountRefusal(row({ active: false }), NOW)).toMatch(/switched off/);
    expect(discountRefusal(row({ expiresAt: NOW }), NOW)).toMatch(/expired/); // at the instant itself, gone
    expect(discountRefusal(row({ maxRedemptions: 1, timesRedeemed: 1 }), NOW)).toMatch(/used as many times/);
  });

  it("says it is the first payment only — the first month, or the first year", () => {
    expect(discountSaid(25)).toBe("25% off your first payment — the first month, or the first year if you pay yearly.");
  });
});

describe("what Stripe is asked for", () => {
  it("a coupon that applies ONCE — one invoice, which is the first term — of the code's percent", () => {
    const c = stripeCouponFor(row(), NOW);
    expect(c).toMatchObject({ id: "thq-ZZ7KQ2MX", percent_off: 25, duration: "once", metadata: { discountCode: "ZZ7KQ2MX" } });
    expect(c).not.toHaveProperty("duration_in_months");
    expect(c).not.toHaveProperty("max_redemptions");
    expect(c).not.toHaveProperty("redeem_by");
  });

  it("carries the code's cap and expiry, so Stripe holds the club to them at the payment", () => {
    const expires = new Date("2026-12-31T00:00:00Z");
    const c = stripeCouponFor(row({ maxRedemptions: 1, expiresAt: expires }), NOW);
    expect(c.max_redemptions).toBe(1);
    expect(c.redeem_by).toBe(Math.floor(expires.getTime() / 1000));
  });

  it("a checkout with a code applies its coupon and does NOT also offer Stripe's own code box", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_zz";
    stripeCalls.coupons.length = 0;
    stripeCalls.sessions.length = 0;
    existingCoupons.clear();
    const base = { organizationId: "zz-org", plan: "society" as const, interval: "month" as const, currency: "USD", overrides: parsePricingOverrides(undefined), email: null, origin: "https://zz.example.invalid" };
    expect(await checkoutUrl({ ...base, discount: row() })).toEqual({ url: "https://checkout.example.invalid/zz" });
    const s = stripeCalls.sessions[0];
    expect(s.discounts).toEqual([{ coupon: "thq-ZZ7KQ2MX" }]);
    expect(s).not.toHaveProperty("allow_promotion_codes");
    expect(s.metadata).toMatchObject({ discountCode: "ZZ7KQ2MX" });
    expect(stripeCalls.coupons).toHaveLength(1);

    // The same code again: the SAME coupon, not a second one.
    await checkoutUrl({ ...base, discount: row() });
    expect(stripeCalls.coupons).toHaveLength(1);
    expect(stripeCalls.sessions[1].discounts).toEqual([{ coupon: "thq-ZZ7KQ2MX" }]);

    // CONTROL: without a code, Stripe's own box is offered and no discount is applied.
    await checkoutUrl({ ...base, discount: null });
    expect(stripeCalls.sessions[2]).not.toHaveProperty("discounts");
    expect(stripeCalls.sessions[2].allow_promotion_codes).toBe(true);
    delete process.env.STRIPE_SECRET_KEY;
  });

  it("a completed checkout names its code; nothing else does", () => {
    const completed = { type: "checkout.session.completed", data: { object: { metadata: { discountCode: "ZZ7KQ2MX" } } } };
    expect(discountCodeOf(completed)).toBe("ZZ7KQ2MX");
    expect(discountCodeOf({ ...completed, type: "invoice.paid" })).toBe("");
    expect(discountCodeOf({ type: "checkout.session.completed", data: { object: { metadata: {} } } })).toBe("");
  });

  it("the coupon id is the code's, and the sign-up link carries the code to the form", () => {
    expect(stripeCouponId("ZZ7KQ2MX")).toBe("thq-ZZ7KQ2MX");
    expect(signUpLinkFor("https://tourneyhq.club/", "ZZ7KQ2MX")).toBe("https://tourneyhq.club/?code=ZZ7KQ2MX#signup");
  });
});

describe("where a club meets it", () => {
  const plain = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  const offers = [{ plan: "society", interval: "year" as const, label: "Birdie · $490/yr" }];

  it("the plan panel has a code box before the buy buttons, filled with the club's code and what it does", () => {
    const html = renderToStaticMarkup(
      <PlanBilling offers={offers} hasSubscription={false} pastDue={false} canEdit discountCode="ZZ7KQ2MX" discountNote={{ ok: true, text: discountSaid(25) }} />,
    );
    expect(html).toContain('value="ZZ7KQ2MX"');
    expect(plain(html)).toContain("25% off your first payment");
    expect(html.indexOf("plan-discount")).toBeLessThan(html.indexOf("Birdie · $490/yr"));
  });

  it("CONTROL: a club already paying has no code box — its plan changes in the portal", () => {
    const html = renderToStaticMarkup(<PlanBilling offers={offers} hasSubscription pastDue={false} canEdit />);
    expect(html).not.toContain("plan-discount");
  });

  it("sign-up offers it folded away; logging in does not", () => {
    expect(plain(renderToStaticMarkup(<LoginPanel initialMode="signup" autoFocusFields={false} />))).toContain("Have a discount code?");
    expect(plain(renderToStaticMarkup(<LoginPanel initialMode="login" autoFocusFields={false} />))).not.toContain("discount code");
  });
});

describe("the doors ask the rule before they act", () => {
  const body = (src: string, start: string, end: string) => src.slice(src.indexOf(start), src.indexOf(end, src.indexOf(start) + 1));

  it("checkout judges the code before it opens a payment page", () => {
    const actions = readSource("src/app/actions/billing.ts");
    const checkout = body(actions, "export async function startCheckout(", "export async function openBillingPortal(");
    expect(checkout.indexOf("usableDiscount(discountInput)")).toBeGreaterThan(-1);
    expect(checkout.indexOf("usableDiscount(discountInput)")).toBeLessThan(checkout.indexOf("checkoutUrl("));
    expect(checkout).toMatch(/discount: discount\.row/);
    expect(body(actions, "async function usableDiscount(", "export async function")).toMatch(/discountRefusal\(row, new Date\(\)\)/);
  });

  it("sign-up refuses an unusable code before it makes an account, and keeps a usable one on the club", () => {
    const auth = readSource("src/app/actions/auth.ts");
    const signUp = body(auth, "export async function signUp(", "export async function enterTournament(");
    // Asked AND acted on: a refusal that is worked out and then ignored is the
    // shape this first passed with (a mutation found it).
    const refused = signUp.search(/const refusal = discountRefusal\([\s\S]*?\);\s*if \(refusal\) return \{ ok: false, error: refusal \};/);
    expect(refused).toBeGreaterThan(-1);
    expect(refused).toBeLessThan(signUp.indexOf("prisma.user.upsert("));
    expect(signUp).toMatch(/data: \{ discountCode \}/);
  });

  it("checking a code is staff-only and counted", () => {
    const check = body(readSource("src/app/actions/billing.ts"), "export async function checkDiscountCode(", "export async function startCheckout(");
    expect(check).toMatch(/org\?\.canEdit/);
    expect(check).toMatch(/checkRateLimit\("discount-check"/);
  });
});

beforeEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
});
