"use server";
import { getSession } from "@/lib/auth";
import { isOwner } from "@/lib/owner";
import { checkRateLimit } from "@/lib/rate-limit";
import { checkAiJob } from "@/lib/services/claude";
import { JOBS, type AiJob } from "@/lib/ai-config";
import type { AiCheckLine } from "@/lib/domain/ai-check";

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
