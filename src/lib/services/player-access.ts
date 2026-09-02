import "server-only";
import { prisma } from "../db";

/**
 * Sign-in access granted by being registered in a tournament.
 *
 * Lives here rather than in an action file so both registration and the roster
 * can call it: a `"use server"` module turns every export into a callable
 * endpoint, and these must only ever run behind an authorized action.
 */

/**
 * Access is email-based (see signInByEmail in actions/auth.ts): whoever
 * matches an Account's email for this event can sign in as that role. A
 * registered player's email is therefore how they get in, not just a
 * contact detail — so registering them also grants their sign-in access
 * directly, instead of requiring a separate manual step on Access & staff.
 * Never downgrades an existing admin/assistant Account (e.g. an organizer
 * who's also playing in their own event) — only sets role "player" when
 * creating a brand new Account for that email.
 */
export async function syncPlayerAccount(eventId: string, name: string, email: string): Promise<void> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) return;
  await prisma.account.upsert({
    where: { eventId_email: { eventId, email: cleanEmail } },
    update: { name },
    create: { eventId, name, email: cleanEmail, role: "player" },
  });
}

/** Revoke sign-in access granted via syncPlayerAccount — only removes a
 *  "player" role Account, never an admin/assistant one that happens to
 *  share the same email. */
export async function revokePlayerAccount(eventId: string, email: string): Promise<void> {
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanEmail) return;

  /**
   * ONLY IF NOBODY ELSE IN THIS EVENT IS STILL USING THE ADDRESS.
   *
   * An Account is keyed on the event and the email, not on the Player row that
   * happened to prompt it — so revoking one entry's access revoked it for
   * everyone entered under that address. That is not hypothetical: `addSignup`
   * had no duplicate check, so an organizer typing in somebody who had already
   * self-registered created a SECOND row for one person. Tidying up the extra
   * row then deleted the Account and locked the real entry out of the app, and
   * the surviving row looks perfectly healthy while it happens.
   *
   * Shared household addresses make the same shape legitimately — a junior and
   * a parent, or a couple, entered under one inbox. So the question is not "is
   * this address duplicated" but "does anyone still in the field need it".
   *
   * Withdrawn rows do not count. A withdrawal is one of the two things that
   * calls this, and the row survives with `status: "withdrawn"` when the player
   * has history worth keeping — so counting it would mean access was never
   * revoked from anyone who had ever played.
   */
  const stillEntered = await prisma.player.count({
    where: {
      eventId,
      email: { equals: cleanEmail, mode: "insensitive" },
      status: { not: "withdrawn" },
    },
  });
  if (stillEntered > 0) return;

  await prisma.account.deleteMany({ where: { eventId, email: cleanEmail, role: "player" } });
}
