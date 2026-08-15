"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomBytes, createHash } from "node:crypto";
import { createSession, destroySession, setPreviewRole, setActiveEvent, getSession, hashPassword, verifyPasswordHash } from "@/lib/auth";
import { sendPasswordResetEmail } from "@/lib/email";
import { checkRateLimit, clearRateLimit } from "@/lib/rate-limit";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth-constants";
import { prisma } from "@/lib/db";
import { effectiveAccess } from "@/lib/services/access";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  return null;
}

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

  // Counted before the lookup, and keyed on the email rather than the caller,
  // so the refusal reads the same for an address that has an account and one
  // that never did.
  const limit = await checkRateLimit("signin", clean);
  if (!limit.allowed) return { ok: false, error: limit.message };

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
  await clearRateLimit("signin", clean);
  redirect("/choose");
}

/**
 * First-time password for an email an organizer already provisioned.
 *
 * Only ever sets a password that isn't there yet. This is a server action, so
 * it is directly callable regardless of what the UI shows — without the
 * already-claimed check it would set a new password on *any* email holding an
 * Account row and sign the caller straight in, which is account takeover of
 * every player and organizer whose address someone knows. `signUp` has always
 * refused to overwrite an existing password; this is the same rule.
 */
export async function claimPassword(email: string, password: string): Promise<{ ok: boolean; error?: string }> {
  const clean = email.trim().toLowerCase();
  if (!clean || !EMAIL_RE.test(clean)) return { ok: false, error: "Enter a valid email address." };

  const limit = await checkRateLimit("claim-password", clean);
  if (!limit.allowed) return { ok: false, error: limit.message };

  const weak = passwordProblem(password);
  if (weak) return { ok: false, error: weak };

  const accounts = await prisma.account.findMany({ where: { email: clean } });
  if (accounts.length === 0) return { ok: false, error: "No tournament access found for this email." };

  const existing = await prisma.user.findUnique({ where: { email: clean } });
  if (existing?.password) {
    return {
      ok: false,
      error: "This email already has a password. Log in instead, or use Forgot password if you don't have it.",
    };
  }

  await prisma.user.upsert({
    where: { email: clean },
    update: { password: hashPassword(password) },
    create: { email: clean, name: accounts[0].name, password: hashPassword(password) },
  });
  await clearRateLimit("claim-password", clean);
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

  const limit = await checkRateLimit("password-reset", clean);
  if (!limit.allowed) return { ok: false, error: limit.message };

  const user = await prisma.user.findUnique({ where: { email: clean } });
  if (user && user.password) {
    const token = randomBytes(32).toString("hex");
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
    });
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    // Result deliberately ignored. Returning a send failure here would make
    // this an oracle: a registered address would error while an unregistered
    // one succeeded, which is exactly the enumeration this function is
    // supposed to prevent. Failures are logged inside sendPasswordResetEmail,
    // and organizers see mail-configuration problems on Access & staff.
    await sendPasswordResetEmail(clean, `${base}/reset-password?token=${token}`);
  }
  // Always the same answer, whether or not the address is registered.
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

/**
 * Switch into one of the tournaments this signed-in user has access to, and
 * land wherever that role actually belongs.
 *
 * A PLAYER goes to the player app, not the console. Every route in here sent
 * everybody to /dashboard, so a player who signed in got the organizer's
 * screen with most of it removed by the role guards — a stripped console
 * instead of the four-tab app built for exactly them. The player shell, the
 * card, the board and the availability calendar were all unreachable unless
 * somebody typed /me by hand.
 *
 * Staff still land on the dashboard: it is their tournament's command centre
 * and the thing they came for.
 */
export async function enterTournament(eventId: string): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/");
  const access = await effectiveAccess(session.email, eventId);
  if (!access) throw new Error("You don't have access to that tournament");
  await setActiveEvent(eventId);
  redirect(homeFor(access.role));
}

/** Where a role's app starts. One answer, so every entry point agrees. */
export function homeFor(role: string): string {
  return role === "admin" || role === "assistant" ? "/dashboard" : "/me";
}

export async function signOutAction() {
  await destroySession();
  redirect("/");
}

export async function setPreviewAction(previewRole: string) {
  await setPreviewRole(previewRole);
  revalidatePath("/", "layout");
}
