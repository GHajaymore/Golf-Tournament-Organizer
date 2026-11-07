/**
 * WHAT THE OWNER'S "CHECK AI" SAYS ABOUT EACH JOB (2026-11-03).
 *
 * One tiny real request per job proves the account, the model id and the
 * thinking setting live — the check after any swap of account. Its answer per
 * job is either OK with the model and the time it took, or the API's own
 * error: the status and the API's message, because "refused, 400" is no help
 * when the fix depends on which field the API objected to.
 *
 * Showing the API's message is safe HERE and nowhere else: the check's request
 * is a fixed sentence and a drawn square (`probe-image.ts`), so an error that
 * echoes the request back echoes nothing about anybody. `askClaude`, which
 * sends real fields and real cards, still returns a status only.
 *
 * And the key is never in what comes back: the message is scrubbed of the key
 * itself and of anything shaped like one, then cut short.
 */

export type AiCheckLine =
  | { job: string; words: string; model: string; ok: true; ms: number; said: string }
  | { job: string; words: string; model: string; ok: false; ms: number; status: number | null; error: string };

const MAX_ERROR = 300;

/** Anything shaped like an Anthropic key, whatever account it belongs to. */
const KEY_SHAPE = /sk-ant-[A-Za-z0-9_-]+/g;

function scrubSecret(text: string, key: string | null): string {
  let out = text;
  if (key && key.length >= 8) out = out.split(key).join("[key]");
  out = out.replace(KEY_SHAPE, "[key]");
  return out.length > MAX_ERROR ? `${out.slice(0, MAX_ERROR - 1)}…` : out;
}

/** The API's own message out of an error body, `{ type: "error", error: { type, message } }`. */
function apiErrorWords(body: unknown): string {
  if (body && typeof body === "object" && "error" in body) {
    const e = (body as { error?: unknown }).error;
    if (e && typeof e === "object") {
      const type = typeof (e as { type?: unknown }).type === "string" ? (e as { type: string }).type : "";
      const message = typeof (e as { message?: unknown }).message === "string" ? (e as { message: string }).message : "";
      if (type || message) return [type, message].filter(Boolean).join(": ");
    }
  }
  return "no error message came back";
}

/** The first text block of a successful reply. */
function replyText(body: unknown): string {
  if (!body || typeof body !== "object") return "";
  const content = (body as { content?: unknown }).content;
  if (!Array.isArray(content)) return "";
  const block = content.find((b) => b && typeof b === "object" && (b as { type?: unknown }).type === "text");
  const text = block ? (block as { text?: unknown }).text : "";
  return typeof text === "string" ? text.trim() : "";
}

export type AiCheckOutcome =
  | { kind: "off"; why: string }
  | { kind: "unreachable" }
  | { kind: "answered"; status: number; body: unknown };

/** One job's line, from what happened when its request was sent. */
export function aiCheckLine(
  job: { job: string; words: string; model: string },
  outcome: AiCheckOutcome,
  ms: number,
  key: string | null,
): AiCheckLine {
  const base = { ...job, ms: Math.max(0, Math.round(ms)) };
  if (outcome.kind === "off") return { ...base, ok: false, status: null, error: scrubSecret(outcome.why, key) };
  if (outcome.kind === "unreachable") return { ...base, ok: false, status: null, error: "Could not reach the API." };
  if (outcome.status < 200 || outcome.status >= 300) {
    return { ...base, ok: false, status: outcome.status, error: scrubSecret(apiErrorWords(outcome.body), key) };
  }
  const said = replyText(outcome.body);
  if (!said) return { ...base, ok: false, status: outcome.status, error: "The model answered with no text." };
  return { ...base, ok: true, said: scrubSecret(said, key).slice(0, 40) };
}
