"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomBytes, createHash } from "node:crypto";
import { createSession, destroySession, setPreviewRole, setActiveEvent, getSession, hashPassword, verifyPasswordHash } from "@/lib/auth";
import { sendPasswordResetEmail } from "@/lib/email";
import { prisma } from "@/lib/db";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Sign in to whichever of this email's Accounts belongs to the most
 *  recently created event — the picker at /choose lets them switch from
 *  there. Returns false if this email has no Account anywhere. */
async function signInToAnyAccount(email: string): Promise<boolean> {
  const accounts = await prisma.account.findMany({ where: { email }, include: { event: true } });
  if (accounts.length === 0) return false;
  const sorted = accounts.sort((a, b) => b.event.createdAt.getTime() - a.event.createdAt.getTime());
  await createSession(sorted[0].id);
  return true;
}

export type EmailStatus = "signin" | "claim" | "signup";

/**
 * First step of login: figure out which flow this email belongs to,
 * without revealing anything sensitive. A User with a password set means
 * a normal password sign-in; an email with Account rows but no password
 * yet means an organizer pre-provisioned them (via CSV, registration, or
 * Access & staff) and they need to claim it with a password the first
 * time; anything else is a brand-new identity.
 */
export async function checkEmailStatus(email: string): Promise<{ ok: boolean; error?: string; status?: EmailStatus }> {
  const clean = email.trim().toLowerCase();
  if (!clean) return { ok: false, error: "Enter your email." };
  if (!EMAIL_RE.test(clean)) return { ok: false, error: "Enter a valid email address." };
  const user = await prisma.user.findUnique({ where: { email: clean } });
  if (user && user.password) return { ok: true, status: "signin" };
  const hasAccounts = (await prisma.account.count({ where: { email: clean } })) > 0;
  return { ok: true, status: hasAccounts ? "claim" : "signup" };
}

export async function signInWithPassword(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const clean = email.trim().toLowerCase();
  if (!clean || !EMAIL_RE.test(clean)) return { ok: false, error: "Enter a valid email address." };
  if (!password) return { ok: false, error: "Enter your password." };
  const user = await prisma.user.findUnique({ where: { email: clean } });
  if (!user || !user.password || !verifyPasswordHash(password, user.password)) {
    return { ok: false, error: "Wrong email or password." };
  }
  const signedIn = await signInToAnyAccount(clean);
  if (!signedIn) return { ok: false, error: "No tournament access found for this account." };
  redirect("/choose");
}

/** First-time password for an email an organizer already provisioned. */
export async function claimPassword(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const clean = email.trim().toLowerCase();
  if (!clean || !EMAIL_RE.test(clean)) return { ok: false, error: "Enter a valid email address." };
  if (password.length < 8) return { ok: false, error: "Use at least 8 characters." };
  const accounts = await prisma.account.findMany({ where: { email: clean } });
  if (accounts.length === 0) return { ok: false, error: "No tournament access found for this email." };
  await prisma.user.upsert({
    where: { email: clean },
    update: { password: hashPassword(password) },
    create: { email: clean, name: accounts[0].name, password: hashPassword(password) },
  });
  const signedIn = await signInToAnyAccount(clean);
  if (!signedIn) return { ok: false, error: "Something went wrong." };
  redirect("/choose");
}

/**
 * Request a password-reset email. Always reports success regardless of
 * whether the email has an account, so this can't be used to enumerate
 * registered users. A User that exists but has never claimed a password
 * (organizer-provisioned only) is directed to sign-in instead — sending a
 * reset link would let someone hijack an identity nobody has claimed yet.
 */
export async function requestPasswordReset(email: string): Promise<{ ok: boolean; error?: string }> {
  const clean = email.trim().toLowerCase();
  if (!clean || !EMAIL_RE.test(clean)) return { ok: false, error: "Enter a valid email address." };

  const user = await prisma.user.findUnique({ where: { email: clean } });
  if (user && user.password) {
    const token = randomBytes(32).toString("hex");
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
    });
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const sent = await sendPasswordResetEmail(clean, `${base}/reset-password?token=${token}`);
    if (!sent.ok) return { ok: false, error: sent.error };
  }
  return { ok: true };
}

/** Complete a password reset from the emailed link. */
export async function resetPassword(token: string, password: string): Promise<{ ok: boolean; error?: string }> {
  if (!token) return { ok: false, error: "Missing reset token." };
  if (password.length < 8) return { ok: false, error: "Use at least 8 characters." };

  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return { ok: false, error: "This reset link is invalid or has expired — request a new one." };
  }

  const user = await prisma.user.update({ where: { id: record.userId }, data: { password: hashPassword(password) } });
  await prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });

  const signedIn = await signInToAnyAccount(user.email);
  if (!signedIn) return { ok: false, error: "Password updated, but no tournament access was found for this account." };
  redirect("/choose");
}

/**
 * Self-serve signup: someone with no existing Account anywhere creates a
 * brand-new tournament (and their password identity) and is signed in as
 * its organizer in one step — reachable before any session exists.
 */
export async function startNewTournament(
  name: string,
  email: string,
  tournamentName: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanName) return { ok: false, error: "Enter your name." };
  if (!EMAIL_RE.test(cleanEmail)) return { ok: false, error: "Enter a valid email address." };
  if (password.length < 8) return { ok: false, error: "Use at least 8 characters." };

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
  await prisma.user.upsert({
    where: { email: cleanEmail },
    update: { name: cleanName, password: hashPassword(password) },
    create: { email: cleanEmail, name: cleanName, password: hashPassword(password) },
  });
  await createSession(account.id);
  redirect("/event");
}

/** Switch into one of the tournaments this signed-in user has access to
 *  (picked from /choose) and land on its dashboard. */
export async function enterTournament(eventId: string): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/");
  const acct = await prisma.account.findFirst({ where: { eventId, email: session.email } });
  if (!acct) throw new Error("You don't have access to that tournament");
  await setActiveEvent(eventId);
  redirect("/dashboard");
}

export async function signOutAction() {
  await destroySession();
  redirect("/");
}

export async function setPreviewAction(previewRole: string) {
  await setPreviewRole(previewRole);
  revalidatePath("/", "layout");
}
