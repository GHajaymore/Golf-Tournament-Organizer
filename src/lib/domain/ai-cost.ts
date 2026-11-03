import { RATE_CARD, type ModelRates } from "@/lib/ai-config";
import { dateWordsFor, fieldsOfDay, writeDate } from "@/lib/domain/date-words";
import { DEFAULT_LOCALE } from "@/lib/domain/locale";

/**
 * WHAT ONE MODEL CALL COST, AND WHETHER THE NEXT ONE MAY BE MADE (2026-11-03).
 *
 * Ajay: "let's set the budget to $20 / month. make it configurable in owner's
 * console". TourneyHQ never moves money (CLAUDE.md, hard rule 7): this is a
 * RECORD of what the AI account was charged, worked out from the `usage` each
 * response reports, and a STOP when the month's record reaches the budget.
 * Nothing here pays, tops up or bills anybody.
 *
 * Everything is whole MICRO-DOLLARS (1e-6 USD). The budget is whole CENTS
 * (what the owner types); one cent is 10_000 micro-dollars.
 */

/** The fields of a Messages API `usage` this costs. Anything else in it is ignored. */
export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  /** 5-minute cache writes, 1.25x input. */
  cacheWrite5mTokens: number;
  /** 1-hour cache writes, 2x input. */
  cacheWrite1hTokens: number;
};

export const MICRO_USD_PER_CENT = 10_000;

/** A count the API sent, or 0: never negative, never a fraction, never NaN. */
function count(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/**
 * The usage out of a response body, or null when it reports none — in which
 * case nothing is recorded (a call that never reached a model costs nothing).
 * An error body that DOES carry usage is read like any other: it was billed.
 */
export function usageOf(body: unknown): ModelUsage | null {
  if (!body || typeof body !== "object") return null;
  const u = (body as { usage?: unknown }).usage;
  if (!u || typeof u !== "object") return null;
  const r = u as Record<string, unknown>;
  const written = count(r.cache_creation_input_tokens);
  // Newer responses split the writes by lifetime. Where they do not, every
  // write is taken as the 5-minute kind, which is what this app asks for (it
  // sets no `ttl`); where the split adds up to less than the total, the rest
  // is taken as 5-minute too, so no written token goes uncounted.
  const split = r.cache_creation && typeof r.cache_creation === "object" ? (r.cache_creation as Record<string, unknown>) : null;
  const oneHour = split ? count(split.ephemeral_1h_input_tokens) : 0;
  const fiveMin = Math.max(split ? count(split.ephemeral_5m_input_tokens) : 0, written - oneHour);
  return {
    inputTokens: count(r.input_tokens),
    outputTokens: count(r.output_tokens),
    cacheReadTokens: count(r.cache_read_input_tokens),
    cacheWrite5mTokens: fiveMin,
    cacheWrite1hTokens: oneHour,
  };
}

/** The dearest input and output rates on the card: what an unpriced model is charged. */
function dearest(): { input: number; output: number } {
  let input = 0;
  let output = 0;
  for (const r of Object.values(RATE_CARD)) {
    input = Math.max(input, r.input, r.above?.input ?? 0);
    output = Math.max(output, r.output, r.above?.output ?? 0);
  }
  return { input, output };
}

export type CallCost = {
  microUsd: number;
  /** False when the model is not on the rate card and was charged at the dearest rate instead. */
  priced: boolean;
  /** In words, for a reader of the record. */
  note: string;
};

/**
 * The cost of one call in micro-dollars, from the rate card in `ai-config.ts`.
 *
 * FAILS CLOSED: a model the card does not price is charged at the dearest
 * rate on it and says so (`priced: false`), never at zero — a budget that an
 * unknown model could spend past without counting would not be a budget.
 *
 * Rounded UP once, at the end: the record never says less than was spent.
 */
export function costOfCall(model: string, usage: ModelUsage): CallCost {
  const card: ModelRates | undefined = RATE_CARD[model];
  const prompt = usage.inputTokens + usage.cacheReadTokens + usage.cacheWrite5mTokens + usage.cacheWrite1hTokens;
  let rates: { input: number; output: number };
  let note: string;
  if (!card) {
    rates = dearest();
    note = `${model || "an unnamed model"} is not on the rate card; charged at the dearest rate on it.`;
  } else if (card.above && card.longPromptOver !== undefined && prompt > card.longPromptOver) {
    rates = card.above;
    note = `long-prompt rate (over ${card.longPromptOver.toLocaleString("en-US")} prompt tokens)`;
  } else {
    rates = card;
    note = "standard rate";
  }
  // Micro-dollars per million tokens times tokens, all scaled by 20 so the
  // cache multipliers stay whole (a read is 0.1x = 2/20, a 5-minute write
  // 1.25x = 25/20, a 1-hour write 2x = 40/20): integers throughout, divided once.
  const twentieths =
    usage.inputTokens * rates.input * 20 +
    usage.outputTokens * rates.output * 20 +
    usage.cacheReadTokens * rates.input * 2 +
    usage.cacheWrite5mTokens * rates.input * 25 +
    usage.cacheWrite1hTokens * rates.input * 40;
  return { microUsd: Math.ceil(twentieths / 20_000_000), priced: !!card, note };
}

/** "2026-11": the month a spend belongs to. UTC — see `budgetDecision`. */
export function spendMonth(now: Date): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** The first day of the next UTC month, as "YYYY-MM-DD". */
export function nextMonthStarts(now: Date): string {
  const y = now.getUTCMonth() === 11 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
  const m = (now.getUTCMonth() + 1) % 12;
  return `${y}-${String(m + 1).padStart(2, "0")}-01`;
}

/** The day the budget starts again, in words: "Dec 1, 2026". */
export function budgetRestartsWords(now: Date): string {
  const words = dateWordsFor(DEFAULT_LOCALE);
  const day = fieldsOfDay(nextMonthStarts(now));
  return words && day ? writeDate(words, "day", day) : nextMonthStarts(now);
}

/** The budget when the owner has never set one: $20.00 a month (Ajay, 2026-11-03). */
export const DEFAULT_AI_BUDGET_CENTS = 2_000;
/** The most the owner console accepts: $1,000.00 a month. A typo is not a budget. */
export const MAX_AI_BUDGET_CENTS = 100_000;

export type BudgetDecision = { allowed: true } | { allowed: false; why: string };

/**
 * May a model be called now?
 *
 * The month is UTC, on purpose and unlike everything a club sees: the bill is
 * the AI ACCOUNT's, one account for the whole platform, not a club's day — so
 * no club's clock (`club-clock.ts`) has a say in when it starts again.
 *
 * Spent at or over the budget means no. $0 means AI is off for everyone.
 */
export function budgetDecision(spentMicroUsd: number, budgetCents: number, now: Date): BudgetDecision {
  if (budgetCents <= 0) return { allowed: false, why: "AI is switched off: this month's AI budget is set to $0." };
  if (spentMicroUsd >= budgetCents * MICRO_USD_PER_CENT) {
    return { allowed: false, why: `This month's AI budget is used up; it starts again on ${budgetRestartsWords(now)} (UTC).` };
  }
  return { allowed: true };
}
