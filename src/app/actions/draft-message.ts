"use server";
import { getSession } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { draftFactsFor } from "@/lib/services/draft-facts";
import { checkDraft, draftPrompt, DRAFT_KINDS, type DraftKind } from "@/lib/domain/draft-check";

/**
 * Draft a message an organizer is about to send, from the event's own data.
 *
 * THIS ACTION NEVER SENDS ANYTHING. It returns text. Sending stays where it
 * already is — the communications screen, with its own explicit act and its own
 * record of who sent what to whom.
 *
 * That separation is the entire safety argument, and it is structural rather
 * than a matter of care: there is no code path from this function to an email.
 * A drafting tool that could also send is one bad model reply away from
 * telling two hundred members the wrong player won.
 *
 * The other half is that the model narrates a fact sheet it is handed rather
 * than recalling a tournament. See draft-facts.ts for what it is allowed to
 * know, and draft-check.ts for the one lie that can still be caught afterwards.
 */

export interface DraftResult {
  ok: boolean;
  error?: string;
  draft?: string;
  /** Names in the draft that match nobody in the field. Shown, never silently
   *  stripped: the organizer decides, and a quiet edit hides the failure. */
  unknownNames?: string[];
  /** The exact text the draft was built from, so it can be checked against. */
  facts?: string;
  configured?: boolean;
}

/** Room for "mention the weather delay", not room for a second prompt. */
const MAX_EXTRA = 300;

export async function draftMessage(kind: string, extra: string): Promise<DraftResult> {
  const session = await getSession();
  if (!session?.eventId) return { ok: false, error: "Not signed in" };
  if (session.viewRole !== "admin" && session.viewRole !== "assistant") {
    return { ok: false, error: "Only an organizer or assistant can do that" };
  }

  if (!Object.prototype.hasOwnProperty.call(DRAFT_KINDS, kind)) {
    return { ok: false, error: "Pick what you'd like drafted." };
  }
  const note = (extra ?? "").trim();
  if (note.length > MAX_EXTRA) {
    return { ok: false, error: "That note is longer than this needs — a sentence is plenty." };
  }

  // Shares the one AI budget rather than getting its own: it is a person's
  // spend on the model, not an allowance per feature.
  const limit = await checkRateLimit("card-photo", session.accountId);
  if (!limit.allowed) return { ok: false, error: limit.message };

  const facts = await draftFactsFor(session.eventId);
  if (facts.empty) {
    return {
      ok: false,
      error: "There are no results to write about yet. Enter some scores first.",
    };
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return {
      ok: false,
      configured: false,
      error: "Drafting isn't switched on. You can still write and send from Communications.",
    };
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 800,
        messages: [
          {
            role: "user",
            content: draftPrompt(
              DRAFT_KINDS[kind as DraftKind],
              facts.eventName,
              facts.text,
              note,
            ),
          },
        ],
      }),
    });
    // The status, never the body: an upstream error can echo the request back,
    // and the request contains the field's names.
    if (!res.ok) {
      return { ok: false, configured: true, error: `Couldn't draft that (${res.status}).` };
    }

    const data = (await res.json()) as { content?: Array<{ text?: string }> };
    const draft = (data.content?.[0]?.text ?? "").trim();
    if (!draft) {
      return { ok: false, configured: true, error: "Nothing came back. Try again." };
    }

    const checked = checkDraft(draft, facts.names);
    return {
      ok: true,
      configured: true,
      draft,
      unknownNames: checked.unknownNames,
      facts: facts.text,
    };
  } catch {
    return { ok: false, configured: true, error: "Couldn't reach the assistant. Write it yourself in Communications." };
  }
}
