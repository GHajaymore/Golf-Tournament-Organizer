import "server-only";

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
  /** No API key. The feature is off, not broken — screens word that gently. */
  | { ok: false; reason: "not-configured" }
  /** The API answered and refused. `status` only — see the rule above. */
  | { ok: false; reason: "refused"; status: number }
  /** It answered with nothing usable. */
  | { ok: false; reason: "empty" }
  /** Never reached it at all. */
  | { ok: false; reason: "unreachable" };

export async function askClaude({
  model,
  maxTokens,
  content,
}: {
  model: string;
  maxTokens: number;
  /** A prompt, or the content blocks a multimodal request needs. */
  content: ClaudeContent;
}): Promise<ClaudeAnswer> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { ok: false, reason: "not-configured" };

  try {
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
        messages: [{ role: "user", content }],
      }),
    });

    // The status, never the body. See the note above — this is the whole point.
    if (!res.ok) return { ok: false, reason: "refused", status: res.status };

    const data = (await res.json()) as { content?: Array<{ text?: string }> };
    const text = (data.content?.[0]?.text ?? "").trim();
    // Untrusted from here on: every caller parses and bounds what it gets.
    return text ? { ok: true, text } : { ok: false, reason: "empty" };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}
