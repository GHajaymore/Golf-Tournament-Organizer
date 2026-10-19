/**
 * A DISCOUNT CODE AT CHECKOUT — the rule, with no database and no Stripe in it.
 *
 * The owner makes a code on `/owner` (a whole percent, an optional cap on how
 * many clubs may use it, an optional expiry) and hands it out. A club types it
 * at sign-up or on its plan panel, and it comes off the club's FIRST PAYMENT
 * ONLY (Ajay, 2026-10-17: "25% discount is only for the first term (month or
 * year)") — the first month on a monthly plan, the first year on a yearly one.
 * In Stripe's terms that is a coupon with `duration: "once"`, which applies to
 * one invoice, and a subscription's first invoice is its first term.
 *
 * Stripe is handed the cap and the expiry too (`max_redemptions`, `redeem_by`),
 * so the limit is enforced where the payment is taken, not only where the code
 * is typed — two clubs pressing Pay on a single-use code at once cannot both
 * have it.
 *
 * This never moves money. It changes the price Stripe asks a club for its plan.
 */

export interface DiscountRow {
  code: string;
  percentOff: number;
  active: boolean;
  maxRedemptions: number | null;
  timesRedeemed: number;
  expiresAt: Date | null;
}

/**
 * Why this code cannot be used now, in words for the club — or null when it can.
 * Asked with the moment of asking: an expiry is an instant, the same everywhere.
 */
export function discountRefusal(row: DiscountRow | null, now: Date): string | null {
  if (!row) return "That isn't a discount code we know. Check it and try again.";
  if (!row.active) return "That discount code has been switched off.";
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return "That discount code has expired.";
  if (row.maxRedemptions !== null && row.timesRedeemed >= row.maxRedemptions) {
    return "That discount code has already been used as many times as it allows.";
  }
  return null;
}

/** What the club is told a valid code does — the first payment, and only that. */
export function discountSaid(percentOff: number): string {
  return `${percentOff}% off your first payment — the first month, or the first year if you pay yearly.`;
}

/** A sign-up link that opens the form with the code filled in (`LoginPanel` reads `?code=`). */
export function signUpLinkFor(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/?code=${encodeURIComponent(code)}#signup`;
}

/** The id the code's Stripe coupon is filed under, so one code is one coupon however often it is used. */
export function stripeCouponId(code: string): string {
  return `thq-${code}`;
}

/** The code a completed checkout was paid with, from its own metadata — or "" for none. */
export function discountCodeOf(event: { type: string; data: { object: Record<string, unknown> } }): string {
  if (event.type !== "checkout.session.completed") return "";
  const meta = event.data.object.metadata as Record<string, unknown> | null | undefined;
  const code = meta?.discountCode;
  return typeof code === "string" ? code : "";
}

/** The coupon Stripe is asked to make for a code, the first time a club uses it. */
export function stripeCouponFor(row: DiscountRow, now: Date) {
  const redeemBy = row.expiresAt && row.expiresAt.getTime() > now.getTime() ? Math.floor(row.expiresAt.getTime() / 1000) : undefined;
  return {
    id: stripeCouponId(row.code),
    percent_off: row.percentOff,
    duration: "once" as const,
    name: `${row.code} · ${row.percentOff}% off the first payment`,
    ...(row.maxRedemptions !== null ? { max_redemptions: row.maxRedemptions } : {}),
    ...(redeemBy !== undefined ? { redeem_by: redeemBy } : {}),
    metadata: { discountCode: row.code },
  };
}
