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
  await prisma.account.deleteMany({ where: { eventId, email: cleanEmail, role: "player" } });
}
