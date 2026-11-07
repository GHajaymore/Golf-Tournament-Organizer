import "server-only";
import { prisma } from "../db";
import { JOB_WORDS, type AiJob } from "../ai-config";
import {
  budgetDecision,
  costOfCall,
  DEFAULT_AI_BUDGET_CENTS,
  MAX_AI_BUDGET_CENTS,
  MICRO_USD_PER_CENT,
  spendMonth,
  usageOf,
} from "../domain/ai-cost";

/**
 * THE AI BUDGET: what this month's model calls cost, and the stop when it is
 * spent (Ajay, 2026-11-03: "let's set the budget to $20 / month. make it
 * configurable in owner's console").
 *
 * A record and a stop, nothing else — TourneyHQ moves no money. The budget is
 * a `PlatformSetting` row in whole cents (the pattern of `signins-switch.ts`),
 * $20.00 when it has never been set. The record is `AiSpend`, one row per call.
 *
 * Both are asked in ONE place: `post` in `services/claude.ts`, the only code
 * that sends a request to a model, asks `aiBudgetStop` before it sends and
 * calls `recordAiSpend` after. So every job — and the owner's Check AI, which
 * costs money too — passes the same gate, and a new job cannot forget it.
 *
 * The Anthropic console's own monthly spend limit is a separate HARD cap the
 * owner sets there (`docs/ai-account.md`); this one is the app's, and stops
 * the app asking before that one would refuse it.
 */
export const AI_BUDGET_KEY = "ai-budget-cents";

/** The budget in whole cents: the owner's setting, or $20.00 when it has never been set. */
export async function aiBudgetCents(): Promise<number> {
  const row = await prisma.platformSetting.findUnique({ where: { key: AI_BUDGET_KEY }, select: { value: true } });
  if (!row) return DEFAULT_AI_BUDGET_CENTS;
  const n = Number(row.value);
  // Only the owner's validated action writes it; a row that is not a whole
  // number in range anyway is read as the default rather than as "no limit".
  return Number.isInteger(n) && n >= 0 && n <= MAX_AI_BUDGET_CENTS ? n : DEFAULT_AI_BUDGET_CENTS;
}

/** The owner's change. Validated by the action; held to range here too. */
export async function setAiBudgetCents(cents: number): Promise<number> {
  if (!Number.isInteger(cents) || cents < 0 || cents > MAX_AI_BUDGET_CENTS) throw new Error("budget out of range");
  const value = String(cents);
  await prisma.platformSetting.upsert({ where: { key: AI_BUDGET_KEY }, update: { value }, create: { key: AI_BUDGET_KEY, value } });
  return cents;
}

/** Micro-dollars recorded for this UTC month. */
export async function spentThisMonth(now: Date = new Date()): Promise<number> {
  const sum = await prisma.aiSpend.aggregate({ where: { month: spendMonth(now) }, _sum: { microUsd: true } });
  return Number(sum._sum.microUsd ?? 0);
}

/**
 * Words saying why no model may be called now, or null when one may.
 *
 * Asked before EVERY call. A database that cannot be read stops the call: a
 * budget nobody can check is not one, and the app's other doors are shut by
 * the same fault anyway.
 *
 * THE RACE, said rather than hidden: this is check-then-call, not a lock. Calls
 * that pass the check together all go ahead, so a month can end over its
 * budget by at most the calls that were in flight when it was crossed — a few
 * cents at these jobs' token ceilings. Nothing is sent once the record shows
 * the line crossed.
 */
export async function aiBudgetStop(now: Date = new Date()): Promise<string | null> {
  try {
    const [budget, spent] = await Promise.all([aiBudgetCents(), spentThisMonth(now)]);
    const d = budgetDecision(spent, budget, now);
    return d.allowed ? null : d.why;
  } catch {
    return "The AI budget could not be checked, so AI is paused for now.";
  }
}

/**
 * Record what one call cost, from the `usage` its response reported. A body
 * with no usage records nothing; an ERROR body with usage was billed and is
 * recorded like any other. Never throws: a call already made must still reach
 * its caller — but a record that failed is spend the gate cannot see, so it is
 * said in the server's log.
 */
export async function recordAiSpend(job: AiJob, model: string, body: unknown, now: Date = new Date()): Promise<void> {
  const usage = usageOf(body);
  if (!usage) return;
  const cost = costOfCall(model, usage);
  try {
    await prisma.aiSpend.create({
      data: {
        month: spendMonth(now),
        job,
        model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        cacheReadTokens: usage.cacheReadTokens,
        cacheWriteTokens: usage.cacheWrite5mTokens + usage.cacheWrite1hTokens,
        microUsd: cost.microUsd,
        priced: cost.priced,
      },
    });
  } catch {
    console.error(`[ai-spend] a ${job} call's cost could not be recorded`);
  }
}

export type AiSpendSummary = {
  month: string;
  budgetCents: number;
  /** Micro-dollars spent this month. */
  spentMicroUsd: number;
  /** Whole cents left, never below zero. */
  leftCents: number;
  /** Words when no call may be made now, else null. */
  stopped: string | null;
  /** Per job this month, dearest first. */
  jobs: { job: string; words: string; calls: number; microUsd: number; unpriced: number }[];
};

/** What the owner's AI card shows. */
export async function aiSpendSummary(now: Date = new Date()): Promise<AiSpendSummary> {
  const month = spendMonth(now);
  const [budgetCents, rows, unpriced] = await Promise.all([
    aiBudgetCents(),
    prisma.aiSpend.groupBy({ by: ["job"], where: { month }, _sum: { microUsd: true }, _count: { _all: true } }),
    prisma.aiSpend.groupBy({ by: ["job"], where: { month, priced: false }, _count: { _all: true } }),
  ]);
  const jobs = rows
    .map((r) => ({
      job: r.job,
      words: JOB_WORDS[r.job as AiJob] ?? r.job,
      calls: r._count._all,
      microUsd: Number(r._sum.microUsd ?? 0),
      unpriced: unpriced.find((u) => u.job === r.job)?._count._all ?? 0,
    }))
    .sort((a, b) => b.microUsd - a.microUsd);
  const spentMicroUsd = jobs.reduce((s, j) => s + j.microUsd, 0);
  const d = budgetDecision(spentMicroUsd, budgetCents, now);
  return {
    month,
    budgetCents,
    spentMicroUsd,
    leftCents: Math.max(0, Math.floor((budgetCents * MICRO_USD_PER_CENT - spentMicroUsd) / MICRO_USD_PER_CENT)),
    stopped: d.allowed ? null : d.why,
    jobs,
  };
}
