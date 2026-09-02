"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomBytes, createHash } from "node:crypto";
import { createSession, destroySession, setPreviewRole, setActiveEvent, getSession, hashPassword, verifyPasswordHash } from "@/lib/auth";
import { sendPasswordResetEmail } from "@/lib/email";
import { checkRateLimit, clearRateLimit } from "@/lib/rate-limit";
import { passwordProblem } from "@/lib/domain/password";
import { prisma } from "@/lib/db";
import { effectiveAccess, hasAccess } from "@/lib/services/access";
import { createOrganizationWithOwner } from "@/lib/services/organization";
import { isOrgKind } from "@/lib/domain/org-profile";
import { homeFor } from "@/lib/roles";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

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
  // Club staff count as provisioned too; they used to be told their password
  // was wrong when the truth was that they had never set one.
  if ((!user || !user.password) && (await hasAccess(clean))) {
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

  // The address is the only thing known about them at this point, and it is
  // enough for the rule that matters here: an invited assistant claiming an
  // account should not set their password to their own email local part.
  const weak = passwordProblem(password, { email: clean });
  if (weak) return { ok: false, error: weak };

  // Club staff have no Account row until they are added to a specific event,
  // so checking only that table made claiming impossible for exactly the people
  // an organizer had just invited.
  if (!(await hasAccess(clean))) {
    return { ok: false, error: "No tournament access found for this email." };
  }

  const existing = await prisma.user.findUnique({ where: { email: clean } });
  if (existing?.password) {
    return {
      ok: false,
      error: "This email already has a password. Log in instead, or use Forgot password if you don't have it.",
    };
  }

  /**
   * A name to file them under, when there is no User row yet.
   *
   * Only the `create` branch needs it, and only an event-provisioned person can
   * reach it: club staff already have a User row from `addOrganizationMember`,
   * so they take `update`. Falling back to the empty string rather than
   * asserting a row exists — `hasAccess` may have been satisfied by an
   * organization membership, in which case there is no Account to read a name
   * from and the old `accounts[0].name` would have thrown.
   */
  const provisioned = await prisma.account.findFirst({
    where: { email: clean },
    select: { name: true },
  });

  await prisma.user.upsert({
    where: { email: clean },
    update: { password: hashPassword(password) },
    create: { email: clean, name: provisioned?.name ?? "", password: hashPassword(password) },
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

  /**
   * The link is checked BEFORE the password now, which is a deliberate
   * reordering: there is no point telling someone their password is too short
   * for a link that expired an hour ago, and they would fix the password, press
   * the button again, and only then be told to start over.
   *
   * It also buys the account, and with it the name and address that
   * `passwordProblem` needs to refuse a password that is simply who they are.
   * Reset used to be the one path that could not make that check, so
   * `annasmith` was refused at sign-up and accepted here — the same rule
   * disagreeing with itself depending on which form you reached it through.
   */
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!record || record.usedAt || record.expiresAt < new Date()) {
    return { ok: false, error: "This reset link is invalid or has expired — request a new one." };
  }

  const owner = await prisma.user.findUnique({
    where: { id: record.userId },
    select: { email: true, name: true },
  });
  const weak = passwordProblem(password, owner ?? undefined);
  if (weak) return { ok: false, error: weak };

  const user = await prisma.user.update({ where: { id: record.userId }, data: { password: hashPassword(password) } });
  await prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });

  const signedIn = await startSessionFor(user.email);
  if (!signedIn) return { ok: false, error: "Password updated, but sign-in failed. Try logging in." };
  redirect("/choose");
}

/**
 * Self-serve sign-up: the person's login identity, and the organization they
 * are signing up ON BEHALF OF.
 *
 * Still creates no Event, Account or Stage — creating an account and creating a
 * tournament are separate acts, and the new user lands on /choose with an empty
 * list and an explicit "create your first tournament" step.
 *
 * The organization is new. It used to be created lazily, on the first
 * tournament, which left a signed-up organizer with no tenant at all and so
 * nothing to hang a kind, a name, a plan or a setup checklist off. The kind is
 * asked here because it is the cheapest question in the product and it decides
 * the most: which setup steps exist, whether money defaults to a settle-up, and
 * whether the roster is shared. See lib/domain/org-profile.ts.
 *
 * `kind` is VALIDATED, not trusted. A "use server" export is a public HTTP
 * endpoint and TypeScript types are erased at runtime, so this is called with
 * whatever the caller likes — and an unrecognised kind stored here would be
 * resolved by `orgProfile`'s permissive fallback forever after, silently giving
 * a club the wrong product.
 */
export async function signUp(
  name: string,
  email: string,
  password: string,
  kind: string,
): Promise<{ ok: boolean; error?: string; needsClaim?: boolean }> {
  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanName) return { ok: false, error: "Enter your name." };
  if (!EMAIL_RE.test(cleanEmail)) return { ok: false, error: "Enter a valid email address." };
  // Both are on the form being submitted, so this is the one path that can
  // refuse a password made of the name typed two fields above it.
  const weak = passwordProblem(password, { email: cleanEmail, name: cleanName });
  if (weak) return { ok: false, error: weak };
  if (!isOrgKind(kind)) return { ok: false, error: "Choose what you're organizing golf for." };

  const existing = await prisma.user.findUnique({ where: { email: cleanEmail } });

  // Already has a password: this is a person who forgot they had signed up.
  if (existing?.password) {
    return { ok: false, error: "An account already exists for this email — log in instead." };
  }

  /**
   * Invited, but never set a password. Route to the claim screen instead of
   * quietly attaching one here.
   *
   * The upsert below would succeed and say nothing, so someone who had been
   * added to a club as staff would "sign up", land in an organization full of
   * other people's tournaments, and have no idea whether they had created an
   * account or joined one. That happened, and the reasonable conclusion from
   * the outside was that a SECOND account had been created — the opposite of
   * what actually occurred.
   *
   * The claim screen already exists, already says "<email> has been invited to
   * a tournament", and is where an unclaimed sign-in already goes. This makes
   * sign-up agree with sign-in rather than quietly doing something else.
   */
  if (existing && (await hasAccess(cleanEmail))) {
    return { ok: false, needsClaim: true };
  }

  const user = await prisma.user.upsert({
    where: { email: cleanEmail },
    update: { name: cleanName, password: hashPassword(password) },
    create: { email: cleanEmail, name: cleanName, password: hashPassword(password) },
  });

  /**
   * Only when they do not already run one.
   *
   * Someone invited as staff already has a User row and a membership but no
   * password, and claims the account by signing up. Creating a second
   * organization for them would leave a junk personal tenant beside their real
   * club, and the answer they just gave must not restate what their club is —
   * the same rule `newOrganizationName` follows in never renaming an existing
   * organization from a later form.
   */
  const owned = await prisma.organizationMember.findFirst({
    where: { userId: user.id, role: { in: ["owner", "admin"] } },
    select: { id: true },
  });
  if (!owned) {
    await createOrganizationWithOwner({ email: cleanEmail, displayName: cleanName, kind });
  }

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

export async function signOutAction() {
  await destroySession();
  redirect("/");
}

export async function setPreviewAction(previewRole: string) {
  await setPreviewRole(previewRole);
  revalidatePath("/", "layout");
}
