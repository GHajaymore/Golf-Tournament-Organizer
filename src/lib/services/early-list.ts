import "server-only";
import { prisma } from "../db";
import { sendEarlyListCodeEmail } from "../email";
import { createDiscount, setDiscountActive } from "./platform-discounts";
import { launchSwitch } from "./signins-switch";
import { earlyListBatch, owedCodes, resendDailyLimit } from "../domain/early-list";
import { EARLY_LIST } from "../go-live";

/**
 * SENDING THE EARLY-LIST CODES (2026-10-23) — the owner's press on /owner, once live.
 *
 * Never automatic and never part of Go live: it is his message going out, so the card shows who is
 * waiting and what they will get, and this runs only when he presses Send and confirms. Each person
 * gets a code of their own (single-use, 25% off the first term), and `EarlyListSend` records who was
 * sent which. The row is written BEFORE the email goes — its key is the address — so two presses
 * cannot send one person two codes; if the email is refused, the row is removed and the code
 * switched off, and the press stops there rather than spending the rest of the list on a refusal.
 * No more than the mail service's daily allowance goes in any 24 hours (`RESEND_DAILY_LIMIT`).
 */

const DAY = 24 * 3600_000;

export interface EarlyListStatus {
  owed: Array<{ email: string; name: string }>;
  sent: number;
  limit: number;
  now: number;
  later: number;
  nextAt: Date | null;
}

/** Who is waiting, how many already went, and what a press would send now. Null while held. */
export async function earlyListStatus(at: Date = new Date()): Promise<EarlyListStatus | null> {
  const sw = await launchSwitch();
  if (sw.state !== "live") return null;
  const [notes, sends] = await Promise.all([
    prisma.interestRequest.findMany({ select: { email: true, name: true, createdAt: true }, orderBy: { createdAt: "asc" } }),
    prisma.earlyListSend.findMany({ select: { email: true, status: true, sentAt: true } }),
  ]);
  const owed = owedCodes(notes, new Set(sends.map((s) => s.email)), sw.liveSince);
  const recent = sends.filter((s) => at.getTime() - s.sentAt.getTime() < DAY);
  const oldest = recent.reduce<Date | null>((o, s) => (!o || s.sentAt < o ? s.sentAt : o), null);
  const limit = resendDailyLimit();
  const batch = earlyListBatch({ owed: owed.length, sentInLastDay: recent.length, oldestInLastDay: oldest, limit, now: at });
  return { owed, sent: sends.filter((s) => s.status === "sent").length, limit, now: batch.now, later: batch.later, nextAt: batch.nextAt };
}

export interface EarlyListResult {
  ok: boolean;
  sent: number;
  later: number;
  nextAt: Date | null;
  error?: string;
}

/** The press. Sends what today's allowance holds, to the people waiting longest, and records each. */
export async function sendEarlyListCodes(): Promise<EarlyListResult> {
  const status = await earlyListStatus();
  if (!status) return { ok: false, sent: 0, later: 0, nextAt: null, error: EARLY_LIST.heldRefusal };
  let sent = 0;
  for (const who of status.owed.slice(0, status.now)) {
    // Claim the address first: a second press, or a second tab, finds it taken and moves on.
    try {
      await prisma.earlyListSend.create({ data: { email: who.email, name: who.name, status: "sending" } });
    } catch {
      continue;
    }
    const made = await createDiscount({ percentOff: EARLY_LIST.percentOff, label: EARLY_LIST.codeLabel, maxRedemptions: 1 });
    await prisma.earlyListSend.update({ where: { email: who.email }, data: { code: made.code } });
    const res = await sendEarlyListCodeEmail(who.email, who.name, made.code);
    if (!res.ok) {
      await prisma.earlyListSend.delete({ where: { email: who.email } });
      await setDiscountActive(made.code, false);
      const after = await earlyListStatus();
      return { ok: false, sent, later: after?.owed.length ?? 0, nextAt: after?.nextAt ?? null, error: res.error ?? "The mail service refused." };
    }
    await prisma.earlyListSend.update({ where: { email: who.email }, data: { status: "sent", sentAt: new Date() } });
    sent += 1;
  }
  const after = await earlyListStatus();
  return { ok: true, sent, later: after?.owed.length ?? 0, nextAt: after?.nextAt ?? null };
}
