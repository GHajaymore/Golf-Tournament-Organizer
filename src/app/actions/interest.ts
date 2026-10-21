"use server";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkInterest, roleLabel, sizeLabel } from "@/lib/domain/interest";
import { sendInterestEmail } from "@/lib/email";
import { SALES_EMAIL } from "@/lib/contact";

export interface InterestResult {
  ok: boolean;
  error?: string;
  /** The box the refusal is about, so it is said beside it. */
  field?: string;
}

/**
 * REGISTER INTEREST BEFORE LAUNCH (2026-10-21) — the public /interest form.
 *
 * Anybody may call it: it is for people who cannot sign in yet. So it asks
 * nothing of a session, reads every field as unknown (`checkInterest`), is
 * rate-limited on the address given, and answers a filled hidden box as if it
 * had been sent, so a script learns nothing. The row is the record; the email
 * to inquiries@ is a copy.
 */
export async function registerInterest(raw: unknown): Promise<InterestResult> {
  const checked = checkInterest(raw);
  if (!checked.ok) {
    if ("spam" in checked) return { ok: true };
    return { ok: false, error: checked.error, field: checked.field };
  }
  const who = checked.clean;

  const limit = await checkRateLimit("interest", who.email);
  if (!limit.allowed) return { ok: false, error: limit.message };

  await prisma.interestRequest.create({ data: who });
  await sendInterestEmail(SALES_EMAIL, {
    name: who.name,
    email: who.email,
    phone: who.phone,
    club: who.club,
    role: roleLabel(who.role),
    size: sizeLabel(who.members),
    note: who.note,
  });
  return { ok: true };
}
