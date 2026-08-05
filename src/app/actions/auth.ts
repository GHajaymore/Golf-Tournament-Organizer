"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomBytes, createHash } from "node:crypto";
import { createSession, destroySession, setPreviewRole, setActiveEvent, getSession, hashPassword, verifyPasswordHash } from "@/lib/auth";
import { sendPasswordResetEmail } from "@/lib/email";
import { rateLimit, clearRateLimit, retryAfterText } from "@/lib/rate-limit";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-constants";
import { prisma } from "@/lib/db";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

// Password guessing throttle: 5 attempts per email per 15 minutes.
const LOGIN_LIMIT = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
// Reset requests are cheaper to abuse (they send mail), so cap them too.
const RESET_LIMIT = 5;
const RESET_WINDOW_MS = 60 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Start a session for this person. Sessions are anchored to the User, not to
 * any one tournament, so this succeeds even before they have any — /choose
 * then lets them create or pick one.
 */
async function startSessionFor(email: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return false;
  await createSession(user.id);
  return true;
}

/**
 * Sign in with email + password.
 *
 * `needsClaim` is returned when the email was pre-provisioned by an organizer
 * (via registration, CSV import, or Access & staff) but has never had a
 * password set. The UI sends those people to the "set your password" step
 * rather than showing a misleading "wrong password" error.
 */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<{ ok: boolean; error?: string; needsClaim?: boolean }> {
  const clean = email.trim().toLowerCase();
  if (!clean || !EMAIL_RE.test(clean)) return { ok: false, error: "Enter a valid email address." };
  if (!password) return { ok: false, error: "Enter your password." };

  const limit = rateLimit(`login:${clean}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
  if (!limit.ok) {
    return { ok: false, error: `Too many sign-in attempts. Try again in ${retryAfterText(limit.retryAfterSeconds)}.` };
  }

  const user = await prisma.user.findUnique({ where: { email: clean } });

  // Provisioned but never claimed — route to password setup, not an error.
  if ((!user || !user.password) && (await prisma.account.count({ where: { email: clean } })) > 0) {
    return { ok: false, needsClaim: true };
  }

  if (!user || !user.password || !verifyPasswordHash(password, user.password)) {
    return { ok: false, error: "Wrong email or password." };
  }

  const signedIn = await startSessionFor(clean);
  if (!signedIn) return { ok: false, error: "Something went wrong." };
  clearRateLimit(`login:${clean}`);
  redirect("/choose");
}

/** First-time password for an email an organizer already provisioned. */
export async function claimPassword(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const clean = email.trim().toLowerCase();
  if (!clean || !EMAIL_RE.test(clean)) return { ok: false, error: "Enter a valid email address." };
  const weak = passwordProblem(password);
  if (weak) return { ok: false, error: weak };
  const accounts = await prisma.account.findMany({ where: { email: clean } });
  if (accounts.length === 0) return { ok: false, error: "No tournament access found for this email." };
  await prisma.user.upsert({
    where: { email: clean },
    update: { password: hashPassword(password) },
    create: { email: clean, name: accounts[0].name, password: hashPassword(password) },
  });
  const signedIn = await startSessionFor(clean);
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

  const limit = rateLimit(`reset:${clean}`, RESET_LIMIT, RESET_WINDOW_MS);
  if (!limit.ok) {
    return { ok: false, error: `Too many reset requests. Try again in ${retryAfterText(limit.retryAfterSeconds)}.` };
  }

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
  const weak = passwordProblem(password);
  if (weak) return { ok: false, error: weak };

  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return { ok: false, error: "This reset link is invalid or has expired — request a new one." };
  }

  const user = await prisma.user.update({ where: { id: record.userId }, data: { password: hashPassword(password) } });
  await prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });

  const signedIn = await startSessionFor(user.email);
  if (!signedIn) return { ok: false, error: "Password updated, but sign-in failed. Try logging in." };
  redirect("/choose");
}

/**
 * Self-serve sign-up: create the person's login identity, and nothing else.
 *
 * Creating an account and creating a tournament are separate acts, so this
 * creates no Event, Account or Stage — the new user lands on /choose with an
 * empty list and an explicit "create your first tournament" step.
 */
export async function signUp(
  name: string,
  email: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanName) return { ok: false, error: "Enter your name." };
  if (!EMAIL_RE.test(cleanEmail)) return { ok: false, error: "Enter a valid email address." };
  const weak = passwordProblem(password);
  if (weak) return { ok: false, error: weak };

  // Don't let sign-up silently overwrite the password of an existing account.
  const existing = await prisma.user.findUnique({ where: { email: cleanEmail } });
  if (existing && existing.password) {
    return { ok: false, error: "An account already exists for this email — log in instead." };
  }

  const user = await prisma.user.upsert({
    where: { email: cleanEmail },
    update: { name: cleanName, password: hashPassword(password) },
    create: { email: cleanEmail, name: cleanName, password: hashPassword(password) },
  });
  await createSession(user.id);
  redirect("/choose");
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
