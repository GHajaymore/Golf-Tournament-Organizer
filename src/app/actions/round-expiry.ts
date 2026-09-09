"use server";

import { prisma } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { revalidatePath } from "next/cache";

/**
 * Keeping a casual round that would otherwise be deleted.
 *
 * The counterweight to the sweep. A quick round expires 24 hours after it is
 * set up, which is right for the "let's play Sunday" that never happened and
 * wrong for the one somebody wants to remember — and the second case is the
 * only one where getting it wrong destroys something. So the exit exists, it
 * is one press, and it is permanent.
 *
 * ONE DIRECTION ONLY. This clears an expiry and can never set one. An action
 * that could set `expiresAt` would be an action that can schedule the deletion
 * of any event the caller can reach, which is a way to delete a tournament
 * through a screen built for a Sunday fourball. Nothing outside `createMatch`
 * writes that column, and this is why.
 */

export interface KeepRoundResult {
  ok: boolean;
  error?: string;
}

export async function keepRound(): Promise<KeepRoundResult> {
  const session = await getSession();
  if (!session) throw new Error("Not authenticated");

  /**
   * Staff of the round in question, which for a casual round is whoever set
   * it up.
   *
   * Every export in a "use server" file is a public HTTP endpoint, so this is
   * checked here rather than left to the button being hidden. The active event
   * comes from the session cookie, not from an argument — there is no event id
   * to pass and therefore none to forge.
   */
  if (session.role !== "admin" && session.role !== "assistant") {
    return { ok: false, error: "Only whoever set this round up can keep it." };
  }

  const event = await prisma.event.findUnique({
    where: { id: session.eventId },
    select: { id: true, expiresAt: true },
  });
  if (!event) return { ok: false, error: "That round no longer exists." };

  // Already permanent, including the case where the round was never temporary
  // at all. Reported as success: the caller asked for it to be kept, and it is.
  if (!event.expiresAt) return { ok: true };

  await prisma.event.update({ where: { id: event.id }, data: { expiresAt: null } });
  revalidatePath("/", "layout");
  return { ok: true };
}
