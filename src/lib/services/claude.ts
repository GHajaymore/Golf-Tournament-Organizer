import "server-only";
import { aiKey, jobStatus, JOBS, type AiJob } from "@/lib/ai-config";
import { aiCheckLine, type AiCheckLine } from "@/lib/domain/ai-check";
import { PROBE_IMAGE, solidSquarePng } from "@/lib/domain/probe-image";
import { aiBudgetStop, recordAiSpend } from "@/lib/services/ai-spend";

/**
 * One way to ask Claude a question.
 *
 * Six call sites across four action files each built the same request by hand:
 * the same URL, the same three headers, the same API version, the same key
 * check, and the same `data.content?.[0]?.text` on the way back. What differed
 * was the model, the token ceiling, the prompt, and the wording of the refusal
 * — and only the last of those is a screen's own business.
 *
 * THE RULE THIS EXISTS TO HOLD, and the reason it is a function rather than a
 * tidy-up: **never return the response body to a caller.** Two of the six sites
 * said so in a comment and the others did not:
 *
 *     "The status, never the body: an upstream error can echo the request back,
 *      and the request contains the field's names."
 *     "...and this one contained a photograph."
 *
 * The repository is public and CLAUDE.md's second hard rule is that no player
 * PII may ever leave. An upstream error that quotes the request back is exactly
 * how a field list or a scorecard photograph escapes into a log or a screen. A
 * rule written in two comments out of six is a rule that will be forgotten by
 * the seventh caller — so this returns a STATUS and never the text of a
 * failure.
 */

export type ClaudeContent = string | unknown[];

export type ClaudeAnswer =
  | { ok: true; text: string }
  /**
   * Off, not broken: no API key, or this month's AI budget is spent (`why`
   * then says so, with the day it starts again). Screens word it gently.
   */
  | { ok: false; reason: "not-configured"; why?: string }
  /** The API answered and refused. `status` only — see the rule above. */
  | { ok: false; reason: "refused"; status: number }
  /** It answered with nothing usable. */
  | { ok: false; reason: "empty" }
  /** Never reached it at all. */
  | { ok: false; reason: "unreachable" };

export async function askClaude({
  job,
  maxTokens,
  content,
}: {
  /**
   * What is being asked — the model for it, and the account that pays, are
   * configuration (`src/lib/ai-config.ts`), never a caller's choice.
   */
  job: AiJob;
  maxTokens: number;
  /** A prompt, or the content blocks a multimodal request needs. */
  content: ClaudeContent;
}): Promise<ClaudeAnswer> {
  // A job configured onto another provider is not this function's to send.
  const key = JOBS[job].provider === "anthropic" ? aiKey(job) : null;
  if (!key) return { ok: false, reason: "not-configured" };
  try {
    const res = await post(key, job, maxTokens, content);
    // This month's AI budget is spent: off, in words, exactly as a missing key is.
    if (res.kind === "stopped") return { ok: false, reason: "not-configured", why: res.why };

    // The status, never the body. See the note above — this is the whole point.
    if (!res.ok) return { ok: false, reason: "refused", status: res.status };

    const data = res.body as { content?: Array<{ type?: string; text?: string }> } | null;
    // The first TEXT block, not the first block: a current model may put a
    // thinking block ahead of the answer, and its text is empty.
    const text = (data?.content?.find((b) => b.type === "text")?.text ?? "").trim();
    // Untrusted from here on: every caller parses and bounds what it gets.
    return text ? { ok: true, text } : { ok: false, reason: "empty" };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

type Sent =
  /** Not sent: this month's AI budget is spent (or cannot be checked). */
  | { kind: "stopped"; why: string }
  /** Sent and answered. `body` is the parsed JSON, or null; it is recorded and handed back, never logged. */
  | { kind: "answered"; ok: boolean; status: number; body: unknown };

/**
 * THE ONE REQUEST, AND THE ONE GATE EVERY MODEL CALL PASSES: the job's model
 * and thinking setting from ai-config, the AI budget asked first, and what the
 * call cost recorded after (`services/ai-spend.ts`). Every job's `askClaude`
 * and the owner's Check AI come through here, so none can spend past the
 * budget or go unrecorded; `model-calls-leak-nothing.test.ts` holds that this
 * is the only file that calls the API.
 */
async function post(key: string, job: AiJob, maxTokens: number, content: ClaudeContent): Promise<Sent> {
  const { model, thinking } = JOBS[job];
  const stop = await aiBudgetStop();
  if (stop) return { kind: "stopped", why: stop };
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      thinking,
      messages: [{ role: "user", content }],
    }),
  });
  // Read once, here. A failed call that reports usage was still billed.
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  await recordAiSpend(job, model, body);
  return { kind: "answered", ok: res.ok, status: res.status, body };
}

/**
 * THE OWNER'S "CHECK AI": one tiny real request for a job, through the same
 * `post` every real request uses — so it proves the account, the model id and
 * the thinking setting exactly as the feature will send them.
 *
 * It takes a JOB and nothing else: the content is fixed here (a sentence, and a
 * drawn square for the job that reads photographs). That is why, unlike
 * `askClaude`, it may hand back the API's own error message — the request it
 * might echo holds nothing about anybody (`domain/ai-check.ts`).
 */
export async function checkAiJob(job: AiJob): Promise<AiCheckLine> {
  const status = jobStatus(job);
  const line = { job, words: status.words, model: status.model };
  const key = JOBS[job].provider === "anthropic" ? aiKey(job) : null;
  if (!status.on || !key) return aiCheckLine(line, { kind: "off", why: status.on ? "No key." : status.why }, 0, null);

  const content: ClaudeContent = JOBS[job].needsImages
    ? [
        { type: "image", source: { type: "base64", media_type: PROBE_IMAGE.media, data: solidSquarePng(PROBE_IMAGE.size, PROBE_IMAGE.rgb) } },
        { type: "text", text: "What colour is this square? Reply with one word." },
      ]
    : "Reply with the word OK.";

  const started = Date.now();
  try {
    const res = await post(key, job, 16, content);
    if (res.kind === "stopped") return aiCheckLine(line, { kind: "off", why: res.why }, 0, key);
    return aiCheckLine(line, { kind: "answered", status: res.status, body: res.body }, Date.now() - started, key);
  } catch {
    return aiCheckLine(line, { kind: "unreachable" }, Date.now() - started, key);
  }
}
