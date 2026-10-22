"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { randomBytes, createHash } from "node:crypto";
import { createSession, destroySession, setPreviewRole, setActiveEvent, getSession, hashPassword, verifyPasswordHash } from "@/lib/auth";
import { emailConfig, sendPasswordResetEmail } from "@/lib/email";
import { checkRateLimit, clearRateLimit } from "@/lib/rate-limit";
import { signUpLooksAutomated, AUTOMATED_SIGNUP } from "@/lib/services/bot-check";
import { passwordRefusal } from "@/lib/services/password-breach";
import { safeNextPath } from "@/lib/domain/safe-next";
import { appUrl } from "@/lib/domain/app-url";
import { prisma } from "@/lib/db";
import { effectiveAccess, hasAccess } from "@/lib/services/access";
import { createOrganizationWithOwner } from "@/lib/services/organization";
import { isOrgKind } from "@/lib/domain/org-profile";
import { homeFor } from "@/lib/roles";
import { markStaffSeen } from "@/lib/services/staff-seen";
import { normalizeDiscountCode } from "@/lib/plans";
import { discountRefusal } from "@/lib/domain/discount";
import { SIGNINS_CLOSED_MESSAGE } from "@/lib/sign-in-gate";
import { maySignInNow } from "@/lib/services/signins-switch";
import {
  checkEmailCode,
  latestCodeHere,
  latestSignupPending,
  proveAddress,
  sendEmailCode,
  type PendingProof,
} from "@/lib/services/email-code";
// The app's one shape of an address — see `typed-limits.ts`.
import { EMAIL_RE } from "@/lib/domain/typed-limits";

const RESET_TOKEN_TTL_MS = 15 * 60 * 1000;

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Where to send somebody once they are signed in.
 *
 * Always by way of `/choose`, never straight to the remembered path. `/choose`
 * is what resolves WHICH tournament somebody means — it skips itself when there
 * is only one, and shows the picker when there are several — and a deep link
 * says nothing about that. Jumping directly to `/prizes` for somebody in two
 * events would land them on whichever the cookie last happened to hold.
 *
 * The path is re-validated HERE rather than trusted from the form. This is a
 * `"use server"` export, so it is a public HTTP endpoint that will be called
 * with whatever the caller likes — the same reason `score-payload.ts` exists.
 * A client that has been tampered with cannot turn this into an open redirect.
 */
function afterSignIn(next?: string | null): string {
  const target = safeNextPath(next);
  return target ? `/choose?next=${encodeURIComponent(target)}` : "/choose";
}

/**
 * Start a session for this person. Sessions are anchored to the User, not to
 * any one tournament, so this succeeds even before they have any — /choose
 * then lets them create or pick one.
 */
async function startSessionFor(email: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return false;
  // `createSession` refuses an address nobody has proved, and a sign-in hold.
  if (!(await createSession(user.id))) return false;
  // Whoever added this person as staff while they were away may now be shown
  // who they added (`markStaffSeen`).
  await markStaffSeen(user.id);
  return true;
}

/**
 * A password somebody PROVED is theirs: set, and on an address they showed
 * they read. A password on an unproved address is a sign-up nobody finished —
 * it stops nobody claiming or signing up again, and lets nobody in.
 */
function hasProvedPassword(user: { password: string; emailVerifiedAt: Date | null } | null): boolean {
  return !!user?.password && !!user.emailVerifiedAt;
}

/**
 * Send a code to prove this address, counted against the address first.
 * `needsCode` turns the panel into "Enter your code".
 */
async function askForCode(input: {
  userId: string;
  email: string;
  purpose: "signup" | "claim";
  pending: PendingProof | null;
}): Promise<{ ok: false; error?: string; needsCode?: boolean }> {
  const limit = await checkRateLimit("email-code-send", input.email);
  if (!limit.allowed) return { ok: false, error: limit.message };
  const sent = await sendEmailCode(input);
  if (!sent.ok) return { ok: false, error: sent.error };
  return { ok: false, needsCode: true };
}

/**
 * Sign in with email + password.
 *
 * `needsClaim` is returned when the email was pre-provisioned by an organizer
 * (via registration, CSV import, or Staff & helpers) but has never had a
 * password set. The UI sends those people to the "set your password" step
 * rather than showing a misleading "wrong password" error.
 */
export async function signInWithPassword(
  email: string,
  password: string,
  next?: string,
): Promise<{ ok: boolean; error?: string; needsClaim?: boolean; needsCode?: boolean }> {
  const clean = email.trim().toLowerCase();
  if (!clean || !EMAIL_RE.test(clean)) return { ok: false, error: "Enter a valid email address." };
  if (!(await maySignInNow(clean))) return { ok: false, error: SIGNINS_CLOSED_MESSAGE };
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

  /**
   * Signed up, and gone before the code came. Their password is still waiting
   * on that code's row, not on the account; the right one earns a NEW code to
   * the inbox — the password is still only applied when that is typed back.
   */
  if (user && !user.password) {
    const waiting = await latestSignupPending(user.id);
    if (waiting?.passwordHash && verifyPasswordHash(password, waiting.passwordHash)) {
      return askForCode({ userId: user.id, email: clean, purpose: "signup", pending: waiting });
    }
  }

  if (!user || !user.password || !verifyPasswordHash(password, user.password)) {
    return { ok: false, error: "Wrong email or password." };
  }

  // The right password on an address nobody has proved: prove it first.
  if (!user.emailVerifiedAt) {
    return askForCode({ userId: user.id, email: clean, purpose: "signup", pending: null });
  }

  const signedIn = await startSessionFor(clean);
  if (!signedIn) return { ok: false, error: "Something went wrong." };
  await clearRateLimit("signin", clean);
  redirect(afterSignIn(next));
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
 *
 * AND IT SETS NOTHING UNTIL THE ADDRESS IS PROVED (2026-10-21). "A password
 * that isn't there yet" was the whole check, so whoever typed an invited
 * address FIRST became that person — an Admin seat, a member's card. Now the
 * password, hashed, waits on a code emailed to the address
 * (`services/email-code.ts`), and is set by `verifyEmailCode` when the code is
 * typed back in the same browser. `next` is carried by the panel to that step.
 */
export async function claimPassword(
  email: string,
  password: string,
  next?: string,
): Promise<{ ok: boolean; error?: string; needsCode?: boolean }> {
  void next;
  const clean = email.trim().toLowerCase();
  if (!clean || !EMAIL_RE.test(clean)) return { ok: false, error: "Enter a valid email address." };
  if (!(await maySignInNow(clean))) return { ok: false, error: SIGNINS_CLOSED_MESSAGE };

  const limit = await checkRateLimit("claim-password", clean);
  if (!limit.allowed) return { ok: false, error: limit.message };

  // The address is the only thing known about them at this point, and it is
  // enough for the rule that matters here: an invited assistant claiming an
  // account should not set their password to their own email local part.
  const weak = await passwordRefusal(password, { email: clean });
  if (weak) return { ok: false, error: weak };

  // Club staff have no Account row until they are added to a specific event,
  // so checking only that table made claiming impossible for exactly the people
  // an organizer had just invited.
  if (!(await hasAccess(clean))) {
    return { ok: false, error: "No tournament access found for this email." };
  }

  const existing = await prisma.user.findUnique({ where: { email: clean } });
  if (hasProvedPassword(existing)) {
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

  // A row to hang the code on, and NO password on it: the one chosen here is
  // held, hashed, on the code's row until the code comes back.
  const user = await prisma.user.upsert({
    where: { email: clean },
    update: {},
    create: { email: clean, name: provisioned?.name ?? "" },
    select: { id: true },
  });
  return askForCode({ userId: user.id, email: clean, purpose: "claim", pending: { passwordHash: hashPassword(password) } });
}

/**
 * The code typed back: the address is proved, what waited on it takes effect,
 * and the person is signed in and sent on as a sign-in would send them.
 *
 * The code is checked against THIS browser's newest one for the address
 * (`checkEmailCode`), so a code a stranger caused to be sent cannot be used
 * here to apply the stranger's password, and five wrong tries spend it.
 */
export async function verifyEmailCode(
  email: string,
  code: string,
  next?: string,
): Promise<{ ok: boolean; error?: string }> {
  const clean = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!clean || !EMAIL_RE.test(clean)) return { ok: false, error: "Enter a valid email address." };
  if (!(await maySignInNow(clean))) return { ok: false, error: SIGNINS_CLOSED_MESSAGE };

  const checked = await checkEmailCode(clean, code);
  if (!checked.ok) return { ok: false, error: checked.error };
  await proveAddress(checked);

  /**
   * A sign-up's club is made NOW, not when the form was sent: an address that
   * was never proved is nobody, and a club made for nobody would be a club a
   * stranger could make in your name. Only when they do not already run one —
   * see the note in `signUp`.
   */
  const { pending } = checked;
  if (checked.purpose === "signup" && pending.kind && isOrgKind(pending.kind)) {
    const owned = await prisma.organizationMember.findFirst({
      where: { userId: checked.userId, role: { in: ["owner", "admin"] } },
      select: { id: true },
    });
    if (!owned) {
      const person = await prisma.user.findUniqueOrThrow({ where: { id: checked.userId }, select: { name: true } });
      const organizationId = await createOrganizationWithOwner({ email: clean, displayName: person.name, kind: pending.kind });
      // Kept for the club's plan checkout, which asks again whether it is still usable.
      if (pending.discountCode) {
        await prisma.organization.update({ where: { id: organizationId }, data: { discountCode: pending.discountCode } });
      }
    }
  }
  if (checked.purpose === "claim") await clearRateLimit("claim-password", clean);

  const signedIn = await startSessionFor(clean);
  if (!signedIn) return { ok: false, error: "Something went wrong." };
  redirect(afterSignIn(next));
}

/**
 * "Send a new code": another code of the same kind to the same address, from
 * this browser's last one. Counted against the address BEFORE anything is
 * looked up, and the same answer whether or not there was anything to resend.
 */
export async function resendEmailCode(email: string): Promise<{ ok: boolean; error?: string }> {
  const clean = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!clean || !EMAIL_RE.test(clean)) return { ok: false, error: "Enter a valid email address." };
  if (!(await maySignInNow(clean))) return { ok: false, error: SIGNINS_CLOSED_MESSAGE };

  const limit = await checkRateLimit("email-code-send", clean);
  if (!limit.allowed) return { ok: false, error: limit.message };

  const user = await prisma.user.findUnique({ where: { email: clean }, select: { id: true, emailVerifiedAt: true } });
  const last = user && !user.emailVerifiedAt ? await latestCodeHere(user.id) : null;
  if (!user || !last) return { ok: true };
  const sent = await sendEmailCode({ userId: user.id, email: clean, purpose: last.purpose, pending: last.pending });
  return sent.ok ? { ok: true } : { ok: false, error: sent.error };
}

/**
 * Request a password-reset email. Always reports success regardless of
 * whether the email has an account, so this can't be used to enumerate
 * registered users. A User that exists but has never claimed a password
 * (organizer-provisioned only) is directed to sign-in instead — sending a
 * reset link would let someone hijack an identity nobody has claimed yet.
 */
export async function requestPasswordReset(email: string): Promise<{ ok: boolean; error?: string; sent?: boolean }> {
  const clean = email.trim().toLowerCase();
  if (!clean || !EMAIL_RE.test(clean)) return { ok: false, error: "Enter a valid email address." };
  if (!(await maySignInNow(clean))) return { ok: false, error: SIGNINS_CLOSED_MESSAGE };

  const limit = await checkRateLimit("password-reset", clean);
  if (!limit.allowed) return { ok: false, error: limit.message };

  /**
   * NO WAY TO SEND MAIL, SO NO CLAIM THAT ANY WAS SENT (Ajay, 2026-10-11:
   * "yes for now").
   *
   * With no mail provider this used to make a token, fail to send it, and
   * answer `{ ok: true }` — and the screen then said "a reset link is on its
   * way" to somebody who would wait for a message that could not come.
   *
   * Decided HERE, before the address is looked up, on a fact about the
   * installation and nothing about the person: the answer is the same for a
   * registered address and a made-up one, so it is not the oracle the comment
   * below is about. And no token is made — a working credential nobody can
   * ever receive is a thing to not have lying about.
   */
  if (!emailConfig().configured) return { ok: true, sent: false };

  const user = await prisma.user.findUnique({ where: { email: clean } });
  if (user && user.password) {
    const token = randomBytes(32).toString("hex");
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
    });
    const base = appUrl().base;
    // Result deliberately ignored. Returning a send failure here would make
    // this an oracle: a registered address would error while an unregistered
    // one succeeded, which is exactly the enumeration this function is
    // supposed to prevent. Failures are logged inside sendPasswordResetEmail,
    // and organizers see mail-configuration problems on Staff & helpers.
    await sendPasswordResetEmail(clean, `${base}/reset-password?token=${token}`);
  }
  // Always the same answer, whether or not the address is registered.
  return { ok: true, sent: true };
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
    select: { email: true, name: true, emailVerifiedAt: true },
  });
  if (!(await maySignInNow(owner?.email))) return { ok: false, error: SIGNINS_CLOSED_MESSAGE };
  const weak = await passwordRefusal(password, owner ? { email: owner.email, name: owner.name } : undefined);
  if (weak) return { ok: false, error: weak };

  /**
   * A RESET ENDS EVERY EARLIER SIGN-IN (2026-10-11).
   *
   * Resetting a password is the one moment somebody is saying "another person
   * may be in my account". It used to change the password and leave every
   * session that already existed exactly as it was — whoever was in, stayed
   * in. Moving `sessionsValidFrom` to now makes every cookie issued before
   * this moment stop working, on every device (`sessionRefusal`), and the
   * sign-in a few lines below is issued after it.
   *
   * And every OTHER reset link still out for this account goes with it. Two
   * requests made a minute apart are two working links for fifteen minutes;
   * using one must not leave the other good.
   */
  const now = new Date();
  // A reset link only ever reaches the inbox, so finishing one PROVES the
  // address as a typed-back code does (2026-10-21) — kept from the first proof.
  const user = await prisma.user.update({
    where: { id: record.userId },
    data: { password: hashPassword(password), sessionsValidFrom: now, emailVerifiedAt: owner?.emailVerifiedAt ?? now },
  });
  await prisma.passwordResetToken.updateMany({ where: { userId: record.userId, usedAt: null }, data: { usedAt: now } });

  const signedIn = await startSessionFor(user.email);
  if (!signedIn) return { ok: false, error: "Password updated, but sign-in failed. Try logging in." };
  /**
   * No `next` here, deliberately. A reset arrives by following a link out of an
   * email, so there is no interrupted journey to resume — the destination they
   * were heading for was the reset itself. Threading one through would mean
   * carrying it in the emailed URL, which is a live credential and not a place
   * to put more parameters than it needs.
   */
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
  next?: string,
  discountInput?: string,
): Promise<{ ok: boolean; error?: string; needsClaim?: boolean; needsCode?: boolean }> {
  const cleanName = name.trim();
  const cleanEmail = email.trim().toLowerCase();
  if (!cleanName) return { ok: false, error: "Enter your name." };
  if (!EMAIL_RE.test(cleanEmail)) return { ok: false, error: "Enter a valid email address." };
  if (!(await maySignInNow(cleanEmail))) return { ok: false, error: SIGNINS_CLOSED_MESSAGE };
  // Both are on the form being submitted, so this is the one path that can
  // refuse a password made of the name typed two fields above it.
  const weak = await passwordRefusal(password, { email: cleanEmail, name: cleanName });
  if (weak) return { ok: false, error: weak };
  if (!isOrgKind(kind)) return { ok: false, error: "Choose what you're organizing golf for." };
  // A discount code is optional; one that is given must be usable, said here
  // rather than at a checkout weeks later. Counted per address, like a sign-in.
  const discountCode = normalizeDiscountCode(typeof discountInput === "string" ? discountInput : "");
  if (discountCode) {
    const limit = await checkRateLimit("discount-check", cleanEmail);
    if (!limit.allowed) return { ok: false, error: limit.message };
    const refusal = discountRefusal(await prisma.discountCode.findUnique({ where: { code: discountCode } }), new Date());
    if (refusal) return { ok: false, error: refusal };
  }

  // A script is refused before it costs a lookup or a password hash. See
  // bot-check.ts for why this lets a person in when the check itself fails.
  if (await signUpLooksAutomated()) return { ok: false, error: AUTOMATED_SIGNUP };

  const existing = await prisma.user.findUnique({ where: { email: cleanEmail } });

  // Already has a password: this is a person who forgot they had signed up.
  // (A sign-up nobody finished proving is not one — it may be a stranger's.)
  if (hasProvedPassword(existing)) {
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

  /**
   * THE ADDRESS IS PROVED BEFORE ANYTHING IS ITS (2026-10-21). The account row
   * is made (or kept) with NO password and no name; what was typed — the
   * password hashed, the name, the club's kind, a discount code — waits on a
   * code emailed to the address, and `verifyEmailCode` applies it, makes the
   * club and signs them in. Until then this address is nobody: access follows
   * the address, so a session here would have been every tournament it was
   * ever entered in, for whoever typed it first.
   *
   * The club is made at verification and only when they do not already run
   * one. Someone invited as staff already has a User row and a membership but
   * no password; creating a second organization for them would leave a junk
   * personal tenant beside their real club, and the answer they just gave must
   * not restate what their club is — the same rule `newOrganizationName`
   * follows in never renaming an existing organization from a later form.
   */
  const user = await prisma.user.upsert({
    where: { email: cleanEmail },
    update: {},
    create: { email: cleanEmail, name: "" },
    select: { id: true },
  });
  // `next` rides with the panel to the code step, as the email does.
  void next;
  return askForCode({
    userId: user.id,
    email: cleanEmail,
    purpose: "signup",
    pending: { passwordHash: hashPassword(password), name: cleanName, kind, discountCode },
  });
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
 * and the thing they came for — EXCEPT from the play shell's own tournament
 * switcher, which passes `"player"`. Somebody switching tournaments there is
 * using the player app, and throwing them into the console because they also
 * happen to run the club is the same mistake as above in the other direction.
 *
 * `stay` arrives from the client like every argument here, so it is compared
 * with `===` and can only ever choose between the two homes; access is still
 * decided by `effectiveAccess` alone.
 */
export async function enterTournament(eventId: string, stay?: unknown): Promise<void> {
  const session = await getSession();
  if (!session) redirect("/");
  const access = await effectiveAccess(session.email, eventId);
  if (!access) throw new Error("You don't have access to that tournament");
  await setActiveEvent(eventId);
  // Somebody already signed in when a club added them: opening one of that
  // club's tournaments is them having been back.
  const opened = await prisma.event.findUnique({ where: { id: eventId }, select: { organizationId: true } });
  if (opened?.organizationId) await markStaffSeen(session.userId, opened.organizationId);
  // "board" is the events list's Leaderboard / Results button, which should
  // land on the board it names rather than on Today.
  redirect(stay === "board" ? "/me/board" : stay === "player" ? "/me" : homeFor(access.role));
}

export async function signOutAction() {
  await destroySession();
  redirect("/");
}

/**
 * SIGN OUT EVERYWHERE (Ajay, 2026-10-11: "yes do it").
 *
 * The ordinary Sign out takes the cookie off THIS browser and nothing else —
 * right for a shared laptop, and no help at all to somebody who has just
 * realised they are still signed in on the pro shop's computer, or on a phone
 * they no longer hold. Until now the only way to end those was to reset the
 * password, which nobody thinks of when the password is not the worry.
 *
 * It uses the line a reset already moves: `sessionsValidFrom` becomes now, and
 * every cookie issued before this moment is nobody's session on any device
 * (`sessionRefusal`). The password is untouched, so the person signs straight
 * back in wherever they actually are.
 *
 * WHOSE sessions is the session's own, never an argument — a "use server"
 * export is a public endpoint. Called by nobody signed in, it writes nothing.
 */
export async function signOutEverywhereAction() {
  const session = await getSession();
  if (session) {
    await prisma.user.update({ where: { id: session.userId }, data: { sessionsValidFrom: new Date() } });
  }
  await destroySession();
  redirect("/");
}

export async function setPreviewAction(previewRole: string) {
  await setPreviewRole(previewRole);
  revalidatePath("/", "layout");
}
