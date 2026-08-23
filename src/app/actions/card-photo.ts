"use server";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { entitlementForEvent } from "@/lib/services/entitlements";
import { holesPlayed } from "@/lib/domain/handicap";
import {
  parseCardReading,
  extractReadingJson,
  cardReadingPrompt,
  type CardReading,
} from "@/lib/domain/card-reading";
import {
  groupCardPrompt,
  parseGroupCardReading,
  type GroupCardReading,
} from "@/lib/domain/group-card-reading";

/**
 * Read a photographed scorecard into proposed scores.
 *
 * THIS ACTION NEVER SAVES ANYTHING. It returns numbers for a human to look
 * at, correct and submit through the ordinary score-entry path, which keeps
 * every existing guard — approval, attestation, the lock — in force. A model
 * that misreads a 6 as a 5 must be caught by the person holding the card, and
 * a save here would remove the only opportunity to catch it.
 *
 * Security, in the order it is applied:
 *  - organizer or assistant only, on their own tournament
 *  - the round and the player are proven to belong to that tournament
 *  - the upload is size-capped and its type checked before anything is sent
 *  - the call is rate limited, because each one costs money
 *  - the API key is read on the server and never reaches the browser
 *  - whatever comes back is parsed as untrusted input (see card-reading.ts)
 */

export interface CardPhotoResult {
  ok: boolean;
  error?: string;
  /** Present only on success. Proposed scores — nothing is stored. */
  reading?: CardReading;
  /** False when no API key is set, so the UI can say so honestly. */
  configured?: boolean;
}

/**
 * The largest image accepted, as a base64 data URL.
 *
 * Phone cameras produce 3-6MB, and base64 adds a third. Eight covers a modern
 * photo without letting a request body become a way to exhaust the server.
 */
const MAX_DATA_URL_BYTES = 8 * 1024 * 1024;

/** Formats a phone actually produces, and that the API accepts. */
const ALLOWED_MEDIA = ["image/jpeg", "image/png", "image/webp", "image/gif"] as const;

/** Organizer or assistant, on the active tournament. */
async function requireStaff(): Promise<{ eventId: string; who: string }> {
  const session = await getSession();
  if (!session?.eventId) throw new Error("Not signed in");
  if (session.viewRole !== "admin" && session.viewRole !== "assistant") {
    throw new Error("Only an organizer or assistant can do that");
  }
  // Identified by account, not email: the budget follows the person even if
  // a club changes the address on their account mid-season.
  return { eventId: session.eventId, who: session.accountId };
}

/**
 * Split a data URL into its media type and payload, refusing anything else.
 *
 * Parsed rather than trusted: the string arrives over HTTP, and forwarding an
 * arbitrary one to an external API would make this endpoint a way to post
 * whatever somebody likes using our key.
 */
function readDataUrl(dataUrl: string): { media: string; base64: string } | null {
  const m = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(dataUrl.trim());
  if (!m) return null;
  const media = m[1].toLowerCase();
  if (!(ALLOWED_MEDIA as readonly string[]).includes(media)) return null;
  const base64 = m[2].replace(/\s+/g, "");
  if (base64.length === 0) return null;
  return { media, base64 };
}

export async function readScorecardPhoto(
  stageId: string,
  playerId: string,
  dataUrl: string,
): Promise<CardPhotoResult> {
  const { eventId, who } = await requireStaff();

  // The round and the player must both be this tournament's. Narrowed in the
  // queries themselves so a foreign id can only fail to match.
  const [stage, player] = await Promise.all([
    prisma.stage.findFirst({ where: { id: stageId, eventId }, select: { holes: true } }),
    prisma.player.findFirst({ where: { id: playerId, eventId }, select: { name: true } }),
  ]);
  if (!stage) return { ok: false, error: "Round not found." };
  if (!player) return { ok: false, error: "Player not found." };

  // Checked before the rate limit, so a malformed upload does not spend
  // somebody's budget, and before the API call, so it never leaves the server.
  if (dataUrl.length > MAX_DATA_URL_BYTES) {
    return { ok: false, error: "That image is too large. Try a smaller photo." };
  }
  const image = readDataUrl(dataUrl);
  if (!image) {
    return { ok: false, error: "That doesn't look like a photo. Use a JPEG, PNG or WebP." };
  }

  // Per person: a shared budget would let one busy organizer lock out a club.
  const limit = await checkRateLimit("card-photo", who);
  if (!limit.allowed) return { ok: false, error: limit.message };

  // The plan gate comes before the key check: whether the club is entitled to
  // this is a different answer from whether the server can do it, and the
  // organizer needs the one that tells them what to do next. Checked here
  // rather than in the UI because this action spends money per call.
  const entitled = await entitlementForEvent(eventId, "cardScan");
  if (!entitled.allowed) return { ok: false, configured: false, error: entitled.reason };

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return {
      ok: false,
      configured: false,
      error: "Reading cards from a photo is not switched on. Enter the scores by hand.",
    };
  }

  const holes = holesPlayed(stage.holes);
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        // Haiku rather than Sonnet, and this is the one action where that is
        // clearly right. Reading a grid of two-digit numbers off a photograph
        // is narrow extraction, not judgement — and it is the highest-volume
        // model call in the product, one per card rather than one per round,
        // so it dominates the AI bill at any real scale. Haiku is a third of
        // Sonnet's price per token on both sides.
        //
        // The accuracy trade is bounded by the design above: this action NEVER
        // SAVES ANYTHING. Every number comes back for the person holding the
        // card to check and correct before it goes through the ordinary entry
        // path. A misread here costs a correction, not a wrong result — which
        // is exactly the shape of task where the cheaper model belongs.
        model: "claude-haiku-4-5",
        max_tokens: 400,
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: image.media, data: image.base64 } },
              { type: "text", text: cardReadingPrompt(holes, player.name) },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      // The status, never the body: an upstream error message can carry
      // details of the request, and this one contained a photograph.
      return { ok: false, configured: true, error: `Could not read the card (${res.status}).` };
    }
    const data = (await res.json()) as { content?: Array<{ text?: string }> };
    const reply = data.content?.[0]?.text ?? "";
    // Untrusted from here: shape, length and every value are checked.
    return { ok: true, configured: true, reading: parseCardReading(extractReadingJson(reply), holes) };
  } catch {
    return { ok: false, configured: true, error: "Could not reach the reader. Enter the scores by hand." };
  }
}

export interface GroupPhotoResult {
  ok: boolean;
  error?: string;
  /** Present only on success. Proposed cards — nothing is stored. */
  reading?: GroupCardReading;
  configured?: boolean;
}

/**
 * Read EVERY player on a photographed card, in one call.
 *
 * The same guards as `readScorecardPhoto`, in the same order, and the same
 * promise: **this action never saves anything.** It proposes a card per player
 * for a human to check, and the scores then go through the ordinary entry path
 * — which lands them at `entered`, where the players certify and the committee
 * approves, exactly as a hand-typed card does.
 *
 * One call rather than four. A fourball used to photograph the same piece of
 * paper once per player, which is four uploads and four times the cost for one
 * card. It is also more accurate: the model sees every row at once, so the
 * names discriminate each other rather than being matched in isolation.
 *
 * The players are supplied from the round's own field, so the model is
 * verifying names it has been given rather than identifying strangers — and
 * `parseGroupCardReading` still refuses to attach a row whose name it cannot
 * place. See the note there on why identity is the strict half.
 */
export async function readGroupCardPhoto(
  stageId: string,
  playerIds: string[],
  dataUrl: string,
): Promise<GroupPhotoResult> {
  const { eventId, who } = await requireStaff();

  const stage = await prisma.stage.findFirst({
    where: { id: stageId, eventId },
    select: { holes: true },
  });
  if (!stage) return { ok: false, error: "Round not found." };

  // Every id narrowed to this tournament in the query itself, so a foreign one
  // can only fail to match. The GROUP is what the model is told to look for,
  // so an id from elsewhere would put a stranger's name in the prompt.
  const group = await prisma.player.findMany({
    // Deduped and capped inline rather than through a named intermediate,
    // because a variable is how an id stops visibly being narrowed by the
    // eventId beside it — which is the one thing this query is for.
    where: {
      id: {
        in: [...new Set(playerIds.filter((id) => typeof id === "string" && id.trim()))].slice(0, 8),
      },
      eventId,
    },
    select: { id: true, name: true },
  });
  if (group.length === 0) return { ok: false, error: "Nobody on that card is in this tournament." };

  if (dataUrl.length > MAX_DATA_URL_BYTES) {
    return { ok: false, error: "That image is too large. Try a smaller photo." };
  }
  const image = readDataUrl(dataUrl);
  if (!image) {
    return { ok: false, error: "That doesn't look like a photo. Use a JPEG, PNG or WebP." };
  }

  // One card is one call, so it costs one unit of the same budget however many
  // players are on it — which is the point.
  const limit = await checkRateLimit("card-photo", who);
  if (!limit.allowed) return { ok: false, error: limit.message };

  const entitled = await entitlementForEvent(eventId, "cardScan");
  if (!entitled.allowed) return { ok: false, configured: false, error: entitled.reason };

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return {
      ok: false,
      configured: false,
      error: "Reading cards from a photo is not switched on. Enter the scores by hand.",
    };
  }

  const holes = holesPlayed(stage.holes);
  const roster = group.map((p) => ({ playerId: p.id, name: p.name }));
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        // Haiku, for the reasons on readScorecardPhoto — narrow extraction
        // rather than judgement, and nothing here is saved without a person
        // checking it. The token budget rises with the number of rows.
        model: "claude-haiku-4-5",
        max_tokens: 250 * Math.max(1, roster.length),
        messages: [
          {
            role: "user",
            content: [
              { type: "image", source: { type: "base64", media_type: image.media, data: image.base64 } },
              { type: "text", text: groupCardPrompt(holes, roster.map((p) => p.name)) },
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      // The status, never the body — an upstream error can quote the request,
      // and this one contained a photograph of somebody's card.
      return { ok: false, configured: true, error: `Could not read the card (${res.status}).` };
    }
    const data = (await res.json()) as { content?: Array<{ text?: string }> };
    const reply = data.content?.[0]?.text ?? "";
    return {
      ok: true,
      configured: true,
      // Untrusted from here: shape, every score, and every name.
      reading: parseGroupCardReading(extractReadingJson(reply), holes, roster),
    };
  } catch {
    return { ok: false, configured: true, error: "Could not reach the reader. Enter the scores by hand." };
  }
}
