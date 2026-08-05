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
export async function signInByEmail(email: string): Promise<{ ok: boolean; error?: string; notFound?: boolean }> {
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
    return { ok: false, notFound: true, error: "No tournament found for that email yet." };
  }

  await createSession(matches[0].id);
  redirect(matches.length > 1 ? "/event" : "/dashboard");
}

/**
 * Self-serve signup: someone with no existing Account anywhere creates a
 * brand-new tournament and is signed in as its organizer in one step —
 * the landing-page equivalent of "Create tournament" on the Event Setup
 * screen, but reachable before any session exists.
 */
export async function startNewTournament(name: string, email: string, tournamentName: string): Promise<{ ok: boolean; error?: string }> {
  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanName) return { ok: false, error: "Enter your name." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return { ok: false, error: "Enter a valid email address." };

  const event = await prisma.event.create({
    data: {
      name: tournamentName.trim() || "New Tournament",
      dates: "",
      course: "",
      city: "",
      address: "",
      regDeadline: "",
      capacity: 0,
      status: "draft",
    },
  });
  await prisma.stage.create({
    data: {
      eventId: event.id,
      position: 0,
      type: "Round Robin",
      description: "",
      format: "Match Play",
      holes: 18,
      scoringBasis: "gross",
    },
  });
  const account = await prisma.account.create({
    data: { eventId: event.id, name: cleanName, email: cleanEmail, role: "admin" },
  });
  await createSession(account.id);
  redirect("/event");
}

export async function signOutAction() {
  await destroySession();
  redirect("/");
}

export async function setPreviewAction(previewRole: string) {
  await setPreviewRole(previewRole);
  revalidatePath("/", "layout");
}
