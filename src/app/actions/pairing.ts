"use server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { logAudit } from "@/lib/services/action-shared";
import { myPlayerIds } from "@/lib/services/me";
import { MAX_REQUESTS } from "@/lib/domain/pairing-requests";

/**
 * PAIRING REQUESTS — "can I play with Bea?".
 *
 * Two doors. The committee records a request it was sent by phone or at the
 * desk (`setPairingRequest`); a player asks for themself from their phone
 * (`setMyPlayWith`). Both only ever name players in the SAME tournament who are
 * in its field, and both are public HTTP endpoints like every "use server"
 * export, so every id is checked against the caller's own event here.
 *
 * A request never moves anybody by itself — the draw reads it. So neither door
 * is behind the setup lock, and neither touches a standing.
 */

export interface PairingResult {
  ok: boolean;
  error?: string;
}

/** Record or remove "A would like to play with B", as the committee. */
export async function setPairingRequest(playerId: string, withPlayerId: string, on: boolean): Promise<PairingResult> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");
  if (session.role !== "admin" && session.role !== "assistant") {
    throw new Error("Only an organizer or assistant can do that");
  }
  if (playerId === withPlayerId) return { ok: false, error: "Pick two different players." };
  const pair = await prisma.player.findMany({
    where: { id: { in: [playerId, withPlayerId] }, eventId: session.eventId, status: "confirmed" },
    select: { id: true, name: true, playWith: true },
  });
  const a = pair.find((p) => p.id === playerId);
  const b = pair.find((p) => p.id === withPlayerId);
  if (!a || !b) return { ok: false, error: "Both players must be in this tournament's field." };

  if (on) {
    if (a.playWith.includes(b.id) || b.playWith.includes(a.id)) return { ok: true };
    if (a.playWith.length >= MAX_REQUESTS) {
      return { ok: false, error: `${a.name} has already asked for ${MAX_REQUESTS} — a group only holds four.` };
    }
    await prisma.player.update({ where: { id: a.id }, data: { playWith: [...a.playWith, b.id] } });
  } else {
    // A request is one fact whichever of the two made it, so removing it
    // clears both directions.
    await prisma.player.update({ where: { id: a.id }, data: { playWith: a.playWith.filter((id) => id !== b.id) } });
    await prisma.player.update({ where: { id: b.id }, data: { playWith: b.playWith.filter((id) => id !== a.id) } });
  }
  await logAudit(
    session.eventId,
    "pairing-request",
    on ? `Pairing request: ${a.name} with ${b.name}` : `Pairing request removed: ${a.name} and ${b.name}`,
  );
  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * A player's own request — up to three others in the field, replacing whatever
 * they asked for before. Empty clears it.
 */
export async function setMyPlayWith(withPlayerIds: string[]): Promise<PairingResult> {
  const session = await getSession();
  if (!session?.eventId) throw new Error("Not authenticated");
  if (!Array.isArray(withPlayerIds) || withPlayerIds.some((id) => typeof id !== "string")) {
    return { ok: false, error: "Not a list of players." };
  }
  const wanted = [...new Set(withPlayerIds)];
  if (wanted.length > MAX_REQUESTS) return { ok: false, error: `Ask for up to ${MAX_REQUESTS} — a group only holds four.` };

  const mine = [...(await myPlayerIds(session.eventId, session.email))];
  if (mine.length === 0) return { ok: false, error: "You aren't in this tournament's field yet." };
  const me = mine[0];
  if (wanted.includes(me)) return { ok: false, error: "You can't ask to play with yourself." };

  const field = await prisma.player.findMany({
    where: { id: { in: withPlayerIds }, eventId: session.eventId, status: "confirmed" },
    select: { id: true, name: true },
  });
  if (field.length !== wanted.length) return { ok: false, error: "Everyone you ask for must be in this tournament's field." };

  await prisma.player.update({ where: { id: me }, data: { playWith: wanted } });
  await logAudit(
    session.eventId,
    "pairing-request",
    wanted.length
      ? `${session.name} asked to play with ${field.map((p) => p.name).join(", ")}`
      : `${session.name} withdrew their pairing request`,
  );
  revalidatePath("/", "layout");
  return { ok: true };
}
