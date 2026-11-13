"use server";
import { getSession } from "@/lib/auth";
import { isOwner } from "@/lib/owner";
import { revalidatePath } from "next/cache";
import { addCost, saveRate, voidCost, voidRate, type FinanceResult } from "@/lib/services/owner-finance";
import type { CostBoxes, RateBoxes } from "@/lib/domain/finance-input";

/**
 * The owner's books: the three things the Finance tab writes (B44). Each export is a public endpoint, so
 * each asks `isOwner` against `OWNER_EMAILS` ITSELF, first, and fails closed to "Not found." exactly as the
 * console does — not an Admin of any club, not a pilot on SIGNIN_ALLOW_EMAILS, not a signed-out visitor.
 * Records only: nothing here charges, pays or refunds anybody (Hard rule 7).
 */

const NOT_FOUND: FinanceResult = { ok: false, error: "Not found." };

export async function addCostEntry(boxes: CostBoxes): Promise<FinanceResult> {
  const session = await getSession();
  if (!session || !isOwner(session.email)) return NOT_FOUND;
  const done = await addCost(boxes, session.email);
  if (done.ok) revalidatePath("/owner");
  return done;
}

export async function voidCostEntry(id: string, reason: string): Promise<FinanceResult> {
  const session = await getSession();
  if (!session || !isOwner(session.email)) return NOT_FOUND;
  const done = await voidCost(id, reason, session.email, new Date());
  if (done.ok) revalidatePath("/owner");
  return done;
}

export async function saveFxRate(boxes: RateBoxes): Promise<FinanceResult> {
  const session = await getSession();
  if (!session || !isOwner(session.email)) return NOT_FOUND;
  const done = await saveRate(boxes, session.email, new Date());
  if (done.ok) revalidatePath("/owner");
  return done;
}

export async function voidFxRate(id: string, reason: string): Promise<FinanceResult> {
  const session = await getSession();
  if (!session || !isOwner(session.email)) return NOT_FOUND;
  const done = await voidRate(id, reason, session.email, new Date());
  if (done.ok) revalidatePath("/owner");
  return done;
}
