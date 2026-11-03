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
 * Report drafting is to run on Ajay's Vercel AI integration (Groq or xAI's
 * Grok — he is to name it and its variable). Until then that provider is a
 * PLACEHOLDER: `callable: false`, so its job is off and says so, and no request
 * is sent to the wrong account.
 */

/** What the app asks a model to do. */
export type AiJob = "cardReading" | "commentary" | "messageDraft" | "setupSuggest" | "reportDraft";

export type AiProvider = "anthropic" | "vercelIntegration";

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
  vercelIntegration: {
    name: "Vercel AI integration (to be named)",
    callable: false,
    keyVariable: "",
    labelVariable: "",
    readsImages: false,
  },
};

export type JobConfig = {
  provider: AiProvider;
  /** "" while the provider is a placeholder. */
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
  // Not built yet (no "Draft with AI" on the report): the seam only.
  reportDraft: { provider: "vercelIntegration", model: "", needsImages: false },
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
