import "server-only";
import { prisma } from "@/lib/db";
import { randomInt } from "node:crypto";
import { normalizeDiscountCode, isValidPercentOff } from "@/lib/plans";
import { discountRefusal, discountSaid } from "@/lib/domain/discount";

/**
 * OWNER-GENERATED DISCOUNT CODES — a percentage off, handed to a club.
 *
 * The owner creates these on the console and gives the code out. Since
 * 2026-10-17 a club USES one: at sign-up (kept on the club) or in the code box
 * on its plan panel, and it comes off the club's first payment only — the rule
 * is `domain/discount.ts`, the Stripe coupon `services/billing.ts`. The count
 * of uses is Stripe's, copied here when a paid checkout completes.
 */

export interface DiscountInput {
  percentOff: number;
  label?: string;
  maxRedemptions?: number | null;
  expiresAt?: Date | null;
}

export interface DiscountCodeView {
  code: string;
  percentOff: number;
  label: string;
  active: boolean;
  maxRedemptions: number | null;
  timesRedeemed: number;
  expiresAt: Date | null;
  createdAt: Date;
}

// Unambiguous alphabet — no 0/O, no 1/I/L — so a code read off a screen or a
// printed card is typed back without a guess.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function randomCode(len = 8): string {
  let out = "";
  // A code is now money off a payment, so it is drawn from a secure source.
  for (let i = 0; i < len; i += 1) out += ALPHABET[randomInt(ALPHABET.length)];
  return out;
}

export async function listDiscountCodes(): Promise<DiscountCodeView[]> {
  return prisma.discountCode.findMany({ orderBy: { createdAt: "desc" } });
}

/**
 * Create a discount code with a unique, unambiguous code.
 *
 * The owner sets the percent and, optionally, a label, a redemption cap and an
 * expiry; the code itself is generated. The percent is validated here and the
 * code is stored in its canonical (upper-case) form, so a later redemption can
 * match it case-insensitively. Retries on the astronomically unlikely collision
 * rather than trusting a single draw.
 */
export async function createDiscount(input: DiscountInput): Promise<DiscountCodeView> {
  const percentOff = Math.round(input.percentOff);
  if (!isValidPercentOff(percentOff)) {
    throw new Error("A discount is a whole percent from 1 to 100.");
  }
  const label = (input.label ?? "").trim().slice(0, 80);
  const maxRedemptions =
    typeof input.maxRedemptions === "number" &&
    Number.isFinite(input.maxRedemptions) &&
    input.maxRedemptions > 0
      ? Math.floor(input.maxRedemptions)
      : null;
  const expiresAt =
    input.expiresAt instanceof Date && !Number.isNaN(input.expiresAt.getTime())
      ? input.expiresAt
      : null;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    const code = randomCode();
    const clash = await prisma.discountCode.findUnique({ where: { code } });
    if (clash) continue;
    return prisma.discountCode.create({
      data: { code, percentOff, label, maxRedemptions, expiresAt },
    });
  }
  throw new Error("Couldn't generate a unique code — try again.");
}

/**
 * What a club's stored code does now, for its plan panel: what comes off, or
 * why it can no longer be used. Read on the server, so opening the page does
 * not spend the club's tries at the code box.
 */
export async function discountNoteFor(code: string): Promise<{ ok: boolean; text: string }> {
  const row = await prisma.discountCode.findUnique({ where: { code: normalizeDiscountCode(code) } });
  const refusal = discountRefusal(row, new Date());
  return refusal || !row ? { ok: false, text: refusal ?? "" } : { ok: true, text: discountSaid(row.percentOff) };
}

/** Switch a code on or off. Uses updateMany so an unknown code is a no-op
 *  rather than a throw — the console never hands this a code that isn't there,
 *  but a stale click after a delete shouldn't error. */
export async function setDiscountActive(code: string, active: boolean): Promise<void> {
  const key = normalizeDiscountCode(code);
  if (!key) return;
  await prisma.discountCode.updateMany({ where: { code: key }, data: { active } });
}
