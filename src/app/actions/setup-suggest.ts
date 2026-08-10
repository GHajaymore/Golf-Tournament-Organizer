"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { PLAYABLE_FORMAT_NAMES } from "@/lib/formats";
import { STAGE_TYPES } from "@/lib/stage-types";
import { extractReadingJson } from "@/lib/domain/card-reading";
import { parseSetupProposal, setupPrompt, type SetupProposal } from "@/lib/domain/setup-proposal";

/**
 * Turn a description of a tournament into a proposed configuration.
 *
 * THIS ACTION NEVER WRITES ANYTHING. It returns a proposal for the organizer
 * to read, change or throw away; applying it goes through the ordinary
 * round-builder actions, which keep every guard they already have.
 *
 * That matters more here than for a scorecard. A wrong score is noticed on
 * the leaderboard; a wrong SETUP is briefed to a field, played for a day, and
 * discovered afterwards. So the model proposes and a person accepts.
 *
 * Security is the same shape as the card reader: staff only, rate limited
 * because each call costs money, key server-side, and everything that comes
 * back treated as untrusted — a format the model invented is dropped rather
 * than coerced into something plausible.
 */

export interface SetupSuggestResult {
  ok: boolean;
  error?: string;
  proposal?: SetupProposal;
  configured?: boolean;
}

/** Long enough to describe a tournament, short enough not to be a payload. */
const MAX_DESCRIPTION = 600;

async function requireStaff(): Promise<{ eventId: string; who: string }> {
  const session = await getSession();
  if (!session?.eventId) throw new Error("Not signed in");
  if (session.viewRole !== "admin" && session.viewRole !== "assistant") {
    throw new Error("Only an organizer or assistant can do that");
  }
  return { eventId: session.eventId, who: session.accountId };
}

export async function suggestSetup(description: string): Promise<SetupSuggestResult> {
  const { who } = await requireStaff();

  const text = description.trim();
  if (text.length < 8) {
    return { ok: false, error: "Describe the tournament in a sentence or two." };
  }
  if (text.length > MAX_DESCRIPTION) {
    return { ok: false, error: "That's longer than this needs. A sentence or two is plenty." };
  }

  // Shares the card-photo budget deliberately: it is one person's spend on
  // AI, not a separate allowance per feature.
  const limit = await checkRateLimit("card-photo", who);
  if (!limit.allowed) return { ok: false, error: limit.message };

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return {
      ok: false,
      configured: false,
      error: "Describing a tournament in words isn't switched on. Build it with the controls instead.",
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
        max_tokens: 700,
        messages: [
          { role: "user", content: setupPrompt(text, PLAYABLE_FORMAT_NAMES, STAGE_TYPES) },
        ],
      }),
    });
    // The status, never the body: an upstream error can echo the request.
    if (!res.ok) return { ok: false, configured: true, error: `Couldn't work that out (${res.status}).` };

    const data = (await res.json()) as { content?: Array<{ text?: string }> };
    const reply = data.content?.[0]?.text ?? "";
    // extractReadingJson finds the first bracketed value in a reply; the
    // object form is what this one returns, so look for braces too.
    const start = reply.indexOf("{");
    const end = reply.lastIndexOf("}");
    let raw: unknown = [];
    if (start !== -1 && end > start) {
      try {
        raw = JSON.parse(reply.slice(start, end + 1));
      } catch {
        raw = extractReadingJson(reply);
      }
    }

    const proposal = parseSetupProposal(raw, PLAYABLE_FORMAT_NAMES, STAGE_TYPES);
    return { ok: true, configured: true, proposal };
  } catch {
    return { ok: false, configured: true, error: "Couldn't reach the assistant. Build it with the controls." };
  }
}

/**
 * Create the rounds an organizer accepted from a proposal.
 *
 * The separation matters: suggestSetup produces words, this writes rounds, and
 * only a person's click connects them. There is no path from the model
 * straight to the database.
 *
 * Everything is validated AGAIN here. The proposal went out to a browser and
 * came back, so it is untrusted input on the way in exactly as the model's
 * reply was — the client could send any format string it liked. Re-running
 * the same parser means one set of rules rather than two that can drift.
 */
export async function applySetupProposal(rounds: unknown): Promise<SetupSuggestResult> {
  const { eventId } = await requireStaff();

  const checked = parseSetupProposal({ rounds }, PLAYABLE_FORMAT_NAMES, STAGE_TYPES);
  if (checked.rounds.length === 0) {
    return { ok: false, error: "Nothing there the app can run." };
  }

  // Appended after whatever exists, never replacing it. An organizer who has
  // already built something and then tries a description should not lose it.
  const agg = await prisma.stage.aggregate({ where: { eventId }, _max: { position: true } });
  const from = (agg._max.position ?? -1) + 1;

  await prisma.stage.createMany({
    data: checked.rounds.map((r, i) => ({
      eventId,
      position: from + i,
      type: r.type,
      format: r.format,
      holes: r.holes,
      scoringBasis: r.scoringBasis,
      description: r.description,
    })),
  });

  revalidatePath("/", "layout");
  return { ok: true, proposal: checked };
}
