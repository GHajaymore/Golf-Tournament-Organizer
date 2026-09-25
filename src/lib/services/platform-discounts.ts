import "server-only";
import { prisma } from "@/lib/db";
import { normalizeDiscountCode, isValidPercentOff } from "@/lib/plans";

/**
 * OWNER-GENERATED DISCOUNT CODES — a percentage off, handed to a club.
 *
 * The owner creates these on the console and gives the code out. Redemption at
 * a paid upgrade is a future step — there is no billing flow yet — so for now
 * this is generation and management: create a code, see how it is doing, switch
 * it off. Everything a redemption will need (the cap, the expiry, the count) is
 * recorded so wiring it up later needs no schema change.
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
  for (let i = 0; i < len; i += 1) out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
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

/** Switch a code on or off. Uses updateMany so an unknown code is a no-op
 *  rather than a throw — the console never hands this a code that isn't there,
 *  but a stale click after a delete shouldn't error. */
export async function setDiscountActive(code: string, active: boolean): Promise<void> {
  const key = normalizeDiscountCode(code);
  if (!key) return;
  await prisma.discountCode.updateMany({ where: { code: key }, data: { active } });
}
