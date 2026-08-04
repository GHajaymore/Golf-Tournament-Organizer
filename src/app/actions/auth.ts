"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSession, destroySession, setPreviewRole } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function signInAction(accountId: string) {
  await createSession(accountId);
  redirect("/dashboard");
}

/**
 * Sign in by email instead of picking a name off a public roster. Looks up
 * every account across every event that matches this email — an organizer
 * (or player) only ever sees tournaments they've actually been added to.
 * SQLite has no case-insensitive `contains`/`equals` filter in Prisma, so the
 * match is done in JS against the (small) account list.
 */
export async function signInByEmail(email: string): Promise<{ ok: boolean; error?: string }> {
  const clean = email.trim().toLowerCase();
  if (!clean) return { ok: false, error: "Enter your email." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) {
    return { ok: false, error: "Enter a valid email address." };
  }
  const accounts = await prisma.account.findMany({ include: { event: true } });
  const matches = accounts
    .filter((a) => a.email.trim().toLowerCase() === clean)
    .sort((a, b) => b.event.createdAt.getTime() - a.event.createdAt.getTime());

  if (matches.length === 0) {
    return {
      ok: false,
      error: "No account found for that email. Ask your tournament organizer to add you under Access & staff.",
    };
  }

  await createSession(matches[0].id);
  redirect(matches.length > 1 ? "/event" : "/dashboard");
}

export async function signOutAction() {
  await destroySession();
  redirect("/");
}

export async function setPreviewAction(previewRole: string) {
  await setPreviewRole(previewRole);
  revalidatePath("/", "layout");
}
