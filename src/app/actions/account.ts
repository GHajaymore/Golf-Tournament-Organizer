"use server";
import { redirect } from "next/navigation";
import { destroySession, getSession } from "@/lib/auth";
import { accountDeletionRefusal } from "@/lib/domain/account-deletion";
import { deleteAccountAndAccess, soleOwnedClubs } from "@/lib/services/account-deletion";

/**
 * A person deletes their own account (2026-10-03). The rule and what it does
 * and does not remove are in `domain/account-deletion.ts`.
 *
 * WHOSE account is the session's, never an argument: a "use server" export is
 * a public endpoint, and the only thing it takes from the caller is the typed
 * confirmation. Afterwards the session is destroyed and they land on the front
 * page, signed out, with nothing left to sign back in to.
 */
export async function deleteMyAccount(typedEmailInput: unknown): Promise<{ ok: false; error: string }> {
  const typedEmail = typeof typedEmailInput === "string" ? typedEmailInput : "";
  const session = await getSession();
  if (!session) return { ok: false, error: "Sign in first." };

  const refusal = accountDeletionRefusal({
    email: session.email,
    typedEmail,
    soleOwnerOf: await soleOwnedClubs(session.userId),
  });
  if (refusal) return { ok: false, error: refusal };

  await deleteAccountAndAccess(session.userId, session.email);
  await destroySession();
  redirect("/");
}
