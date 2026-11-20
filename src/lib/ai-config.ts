/**
 * THE ONE PLACE THE APP'S AI ACCOUNTS ARE DECIDED.
 *
 * Ajay, 2026-11-03: "plug in my claude account for any AI but make sure to
 * replace the one which I will get for the app before launch or post launch".
 * So the account the app spends on is CONFIGURATION, never code: changing it is
 * changing environment values in Vercel (Production and Preview) and in the
 * developer's own `.env.local`, then redeploying. `docs/ai-account.md` is the
 * runbook.
 *
 * Each JOB names its provider and model here. A caller names the job and never
 * a model, a provider or a key; `ai-config-is-the-one-place.test.ts` refuses a
 * model id or a key read anywhere but this file.
 *
 * What is read from the environment, and only here:
 *
 *   ANTHROPIC_API_KEY  the key for the "anthropic" provider. Its VALUE is never
 *                      returned by anything that draws a screen — `aiAccount()`
 *                      reports on/off, the variable's NAME, the label and the
 *                      models; `aiKey()` is for the one caller that sends it.
 *   AI_ACCOUNT_LABEL   a plain name for the Anthropic account, e.g. "Ajay's
 *                      personal account", shown on /owner so it is obvious
 *                      which account is paying. Never the key.
 *
 * Every job runs on the Anthropic provider today (Ajay's key). Provider and
 * model are per job so that moving one job elsewhere later is a setting here:
 * a provider this build cannot call (`callable: false`) leaves its jobs OFF
 * and saying so, rather than sending a request to the wrong account.
 */

/** What the app asks a model to do. */
export type AiJob = "cardReading" | "commentary" | "messageDraft" | "setupSuggest" | "reportDraft";

export type AiProvider = "anthropic";

/**
 * How a request turns thinking off. These jobs are short and bounded, with
 * small `max_tokens` ceilings that thinking would spend before any answer was
 * written, and each current Claude model turns it off a different way — so the
 * setting belongs beside the model.
 */
export type Thinking = { type: "disabled" } | { type: "between_tools" };

export type ProviderConfig = {
  name: string;
  /** Whether this build can call it. A provider it cannot call leaves its jobs OFF. */
  callable: boolean;
  /** The environment variable holding its key ("" = not yet named). Read only in this file. */
  keyVariable: string;
  /** The environment variable holding a plain name for the account ("" = none). */
  labelVariable: string;
  /** Whether its models read photographs. Card reading cannot run on a provider without it. */
  readsImages: boolean;
};

export const PROVIDERS: Record<AiProvider, ProviderConfig> = {
  anthropic: {
    name: "Anthropic (Claude)",
    callable: true,
    keyVariable: "ANTHROPIC_API_KEY",
    labelVariable: "AI_ACCOUNT_LABEL",
    readsImages: true,
  },
};

export type JobConfig = {
  provider: AiProvider;
  /** "" = no model chosen yet; the job is off. */
  model: string;
  thinking?: Thinking;
  /** Sends a photograph. Refused on a provider that does not read images. */
  needsImages: boolean;
};

// Two current Claude models, chosen per the claude-api reference (2026-11):
// - the current HAIKU for reading cards: narrow extraction of numbers off a
//   photograph, the highest-volume call in the product (one per card), and
//   nothing read is saved without a person checking it. Haiku 5.5 accepts
//   `disabled` at its default effort.
// - the current SONNET for writing a person reads: commentary, message drafts,
//   setup suggestions — low-volume. Sonnet 5.5 refuses `disabled`;
//   `between_tools` is its thinking-off setting.
const HAIKU = "claude-haiku-5-5";
const SONNET = "claude-sonnet-5-5";

export const JOBS: Record<AiJob, JobConfig> = {
  cardReading: { provider: "anthropic", model: HAIKU, thinking: { type: "disabled" }, needsImages: true },
  commentary: { provider: "anthropic", model: SONNET, thinking: { type: "between_tools" }, needsImages: false },
  messageDraft: { provider: "anthropic", model: SONNET, thinking: { type: "between_tools" }, needsImages: false },
  setupSuggest: { provider: "anthropic", model: SONNET, thinking: { type: "between_tools" }, needsImages: false },
  // Writing a person reads, like the three above. No screen asks for it yet
  // (no "Draft with AI" on the report); it is configured so that one can.
  reportDraft: { provider: "anthropic", model: SONNET, thinking: { type: "between_tools" }, needsImages: false },
};

/**
 * WHAT A CALL COSTS, per model (2026-11-03: Ajay set a $20-a-month AI budget).
 *
 * Prices in MICRO-DOLLARS PER MILLION TOKENS — whole numbers, so $0.10/MTok is
 * 100_000 and nothing here or in the spend table is ever a float. Anthropic's
 * list prices for the two models `JOBS` uses (claude-api reference, cached
 * 2026-10-06): Haiku 5.5 $0.10 in / $0.50 out for a prompt up to 100K tokens
 * and $0.50 / $2.50 above it; Sonnet 5.5 $2 / $10. A cache read is billed at
 * 0.1x the input price, a 5-minute cache write at 1.25x and a 1-hour write at
 * 2x — `domain/ai-cost.ts` derives those from `input` rather than listing them.
 *
 * A model `JOBS` names that this card does not price is NOT costed at zero:
 * `costOfCall` charges it at the dearest rate here and flags it, and
 * `ai-cost.test.ts` refuses a job whose model is missing from this card.
 */
export type ModelRates = {
  /** Micro-dollars per million input tokens. */
  input: number;
  /** Micro-dollars per million output tokens. */
  output: number;
  /** Above this many prompt tokens (input + cache reads + cache writes) the `above` rates apply to the whole call. */
  longPromptOver?: number;
  above?: { input: number; output: number };
};

export const RATE_CARD: Record<string, ModelRates> = {
  [HAIKU]: { input: 100_000, output: 500_000, longPromptOver: 100_000, above: { input: 500_000, output: 2_500_000 } },
  [SONNET]: { input: 2_000_000, output: 10_000_000 },
};

export const JOB_WORDS: Record<AiJob, string> = {
  cardReading: "Card reading",
  commentary: "Commentary",
  messageDraft: "Message drafts",
  setupSuggest: "Setup suggestions",
  reportDraft: "Report drafts",
};

type Env = Record<string, string | undefined>;

export type JobStatus =
  | { job: AiJob; words: string; on: true; provider: AiProvider; providerName: string; model: string }
  | { job: AiJob; words: string; on: false; provider: AiProvider; providerName: string; model: string; why: string };

/** Whether a job can run, and if not, why — in words for the owner. Never contains a key. */
export function jobStatus(job: AiJob, env: Env = process.env): JobStatus {
  const j = JOBS[job];
  const p = PROVIDERS[j.provider];
  const base = { job, words: JOB_WORDS[job], provider: j.provider, providerName: p.name, model: j.model };
  if (!p.callable || !j.model) return { ...base, on: false, why: `${p.name} is not connected yet.` };
  if (j.needsImages && !p.readsImages) return { ...base, on: false, why: `${p.name} does not read photographs.` };
  if (!(env[p.keyVariable] ?? "").trim()) return { ...base, on: false, why: `No ${p.keyVariable} is set on this server.` };
  return { ...base, on: true };
}

export type AccountLine = { provider: AiProvider; name: string; on: boolean; label: string; keyVariable: string };

/**
 * What the owner may see: each provider on or off with its account label, and
 * each job with its model. Never the key or any part of it.
 */
export function aiAccount(env: Env = process.env): { providers: AccountLine[]; jobs: JobStatus[] } {
  const providers = (Object.keys(PROVIDERS) as AiProvider[]).map((provider) => {
    const p = PROVIDERS[provider];
    return {
      provider,
      name: p.name,
      on: p.callable && !!p.keyVariable && !!(env[p.keyVariable] ?? "").trim(),
      label: p.labelVariable ? (env[p.labelVariable] ?? "").trim() : "",
      keyVariable: p.keyVariable,
    };
  });
  const jobs = (Object.keys(JOBS) as AiJob[]).map((job) => jobStatus(job, env));
  return { providers, jobs };
}

/** The key to SEND for a job, for the one caller that sends it. Null = that job is off. */
export function aiKey(job: AiJob, env: Env = process.env): string | null {
  if (!jobStatus(job, env).on) return null;
  return (env[PROVIDERS[JOBS[job].provider].keyVariable] ?? "").trim() || null;
}

/** Whether a job is switched on, for a screen that hides its button when it is not. */
export function aiJobOn(job: AiJob, env: Env = process.env): boolean {
  return jobStatus(job, env).on;
}
