"use server";
import { getSession } from "@/lib/auth";
import { isOwner } from "@/lib/owner";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkAiJob } from "@/lib/services/claude";
import { JOBS, type AiJob } from "@/lib/ai-config";
import type { AiCheckLine } from "@/lib/domain/ai-check";
import { revalidatePath } from "next/cache";
import { setAiBudgetCents } from "@/lib/services/ai-spend";
import { MAX_AI_BUDGET_CENTS } from "@/lib/domain/ai-cost";
import { minorUnitsFrom, money, moneyBoxRefusal } from "@/lib/domain/money-format";
import { plainFigure } from "@/lib/domain/decimal-text";

/**
 * CHECK AI — the owner's press on the /owner AI card (2026-11-03).
 *
 * One tiny real request per AI job, through the same request every feature
 * sends (`checkAiJob` in `services/claude.ts`), so after any swap of account it
 * proves the key, the model ids and the thinking settings live. Each line is
 * OK with the model and the time it took, or the API's own error; never the
 * key (`domain/ai-check.ts`).
 *
 * Owner-only, failing closed to "Not found." like every owner write
 * (`actions/owner.ts`). It spends money, so one press a minute.
 */
export async function checkAiAccount(...args: unknown[]): Promise<{ ok: boolean; error?: string; lines?: AiCheckLine[] }> {
  const session = await getSession();
  if (!session || !isOwner(session.email)) return { ok: false, error: "Not found." };
  // A "use server" export is a public endpoint and types are erased: this one
  // takes nothing, so anything sent to it is refused rather than ignored.
  if (args.length > 0) return { ok: false, error: "Check AI takes no input." };
  const limit = await checkRateLimit("ai-check", session.userId);
  if (!limit.allowed) return { ok: false, error: limit.message };

  const jobs = Object.keys(JOBS) as AiJob[];
  const lines = await Promise.all(jobs.map((job) => checkAiJob(job)));
  return { ok: true, lines };
}

/**
 * THE AI BUDGET — the owner's change on the /owner AI card (Ajay, 2026-11-03:
 * "let's set the budget to $20 / month. make it configurable in owner's
 * console"). A record and a stop, never a payment (`services/ai-spend.ts`).
 *
 * Takes the box as typed, in dollars, and reads it the way every money box in
 * the app is read (`minorUnitsFrom`, `moneyBoxRefusal`). Refused in words:
 * anything that is not a plain figure, a negative, and anything over
 * $1,000.00 a month. $0 is allowed and means AI is off for everyone.
 */
export async function setAiBudget(typed: unknown): Promise<{ ok: boolean; error?: string; cents?: number }> {
  const session = await getSession();
  if (!session || !isOwner(session.email)) return { ok: false, error: "Not found." };
  // A "use server" export is a public endpoint and types are erased.
  if (typeof typed !== "string" || typed.length > 40) return { ok: false, error: "Enter the budget in dollars, like 20 or 12.50." };
  const text = plainFigure(typed).replace(/^\$\s*/, "").replace(/\s+/g, "");
  if (/^-/.test(text)) return { ok: false, error: "The budget can't be less than nothing." };
  if (!/^[0-9][0-9.,]*$/.test(text)) return { ok: false, error: "Enter the budget in dollars, like 20 or 12.50." };
  // US dollars: the bill is the AI account's, in the currency it is charged in.
  const cents = minorUnitsFrom(text, "USD");
  if (cents > MAX_AI_BUDGET_CENTS) return { ok: false, error: `The budget can be at most ${money(MAX_AI_BUDGET_CENTS, "USD")} a month.` };
  const refused = moneyBoxRefusal(text, cents, MAX_AI_BUDGET_CENTS);
  if (refused) return { ok: false, error: refused };
  await setAiBudgetCents(cents);
  revalidatePath("/owner");
  return { ok: true, cents };
}
