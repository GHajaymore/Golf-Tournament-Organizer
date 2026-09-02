import "server-only";
import { Resend } from "resend";
import { prisma } from "@/lib/db";
import { classifySendFailure, type EmailKind, type EmailFailureReason } from "@/lib/domain/email-trouble";

// Lazily constructed so a missing key doesn't crash module load — dev
// environments without RESEND_API_KEY fall back to logging the link.
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

/**
 * Resend's shared sandbox sender.
 *
 * It only delivers to the address that owns the Resend account, so leaving it
 * in place in production means reset emails work for the operator testing it
 * and silently fail for every real user — the same shape of bug as a logo that
 * only loads for the person who set it.
 */
const SANDBOX_FROM = "onboarding@resend.dev";
const FROM = process.env.RESEND_FROM_EMAIL ?? `TourneyHQ <${SANDBOX_FROM}>`;

/**
 * An address, logged without being an address.
 *
 * P2 of the 2026-08-12 audit: five lines printed a member's email into the
 * platform log on every send failure. Logs are read by more people than the
 * database is, kept longer, and shipped to whoever aggregates them — so a
 * club's membership list leaked a name at a time through its own error
 * handling, for no benefit an operator could point at.
 *
 * The domain survives, because it is the part that debugs anything: one
 * corporate mail server bouncing everything looks nothing like one member's
 * typo, and telling those apart is the only reason to log this at all. The
 * local part does not, beyond its first character — enough to match a support
 * email against a line, not enough to identify anybody from the line alone.
 */
export function maskEmail(address: string): string {
  const at = (address ?? "").lastIndexOf("@");
  if (at <= 0) return "an address";
  return `${address[0]}***@${address.slice(at + 1)}`;
}

export interface EmailConfig {
  /** Whether an API key is present at all. */
  configured: boolean;
  /** Still on the sandbox sender, which only reaches the account owner. */
  sandboxSender: boolean;
  /** Set when something is wrong — safe to show an organizer. */
  problem?: string;
}

/**
 * Whether outbound email will actually reach a stranger.
 *
 * Surfaced on an authenticated staff screen rather than on the public reset
 * form: the person who needs to know is the organizer, and telling an
 * anonymous visitor about the mail configuration helps nobody but an attacker.
 */
export function emailConfig(): EmailConfig {
  if (!resend) {
    return {
      configured: false,
      sandboxSender: false,
      problem:
        "Password reset emails aren't set up. Anyone who forgets their password won't be able to get back in — set RESEND_API_KEY on the server.",
    };
  }
  if (FROM.includes(SANDBOX_FROM)) {
    return {
      configured: true,
      sandboxSender: true,
      problem:
        "Reset emails are sending from Resend's test address, which only delivers to your own inbox. Verify your domain and set RESEND_FROM_EMAIL so players actually receive them.",
    };
  }
  return { configured: true, sandboxSender: false };
}

/**
 * Record a failed send so it can surface on the Access screen.
 *
 * Never throws, for the same reason the sends themselves never throw: this is
 * bookkeeping about a nicety, and it must not be able to break the registration
 * or password-reset path it is attached to. A failure to record a failure is
 * logged and dropped.
 *
 * "unconfigured" is deliberately not recorded. A missing API key is already
 * reported by `emailConfig()` in far plainer words, and writing a row per send
 * would fill the table with rows that say what the banner above them already
 * says — including on every developer machine.
 */
async function recordFailure(input: {
  kind: EmailKind;
  reason: EmailFailureReason;
  detail: string;
  organizationIds: string[];
  eventId?: string | null;
  toEmail?: string;
  toName?: string;
}): Promise<void> {
  if (input.reason === "unconfigured" || input.organizationIds.length === 0) return;
  try {
    await prisma.emailFailure.createMany({
      data: input.organizationIds.map((organizationId) => ({
        organizationId,
        eventId: input.eventId ?? null,
        kind: input.kind,
        reason: input.reason,
        detail: input.detail.slice(0, 500),
        toEmail: input.toEmail ?? "",
        toName: input.toName ?? "",
      })),
    });
  } catch (e) {
    console.error(`[email] Could not record a send failure: ${e instanceof Error ? e.message : "unknown"}`);
  }
}

/**
 * The organizations that would want to know an address could not be reached.
 *
 * There are TWO ways an address belongs to a club, and this used to look at one.
 *
 * `Member` is the club roster — the players an organizer entered, who mostly
 * never signed up for anything. `OrganizationMember` is the staff link between a
 * `User` and an organization, and it carries no email of its own; the address
 * lives on the `User` it points at. An organizer who never put themselves on
 * their own roster exists only in the second table.
 *
 * So a failed PASSWORD RESET for an organizer returned no organizations, and
 * `recordFailure` drops anything with an empty list — no row, no Access-screen
 * card, nothing. That is the worst possible person to lose the signal for: they
 * are the one who can fix the mail configuration, and the reset form cannot tell
 * them anything either (saying a send failed would leak which addresses are
 * registered). The failure was invisible from every direction at once, and the
 * one screen that would have shown it is behind the sign-in they cannot
 * complete.
 *
 * Both tables now, de-duplicated: an organizer who IS also on their own roster
 * is one organization, not two rows saying the same thing.
 */
export async function organizationsFor(email: string): Promise<string[]> {
  try {
    const [roster, staff] = await Promise.all([
      prisma.member.findMany({
        where: { email },
        select: { organizationId: true },
        distinct: ["organizationId"],
      }),
      prisma.organizationMember.findMany({
        where: { user: { email } },
        select: { organizationId: true },
        distinct: ["organizationId"],
      }),
    ]);
    return [...new Set([...roster, ...staff].map((r) => r.organizationId))];
  } catch {
    return [];
  }
}

/**
 * Send a password reset link.
 *
 * The caller must not vary its response based on the outcome — see
 * requestPasswordReset. Failures are logged here instead, because that's the
 * only place they can be recorded without telling the requester whether the
 * address was registered.
 */
export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<{ ok: boolean; error?: string }> {
  if (!resend) {
    /**
     * The link is a live credential. Never print it outside development.
     *
     * This logged the address AND the reset URL unconditionally, and
     * RESEND_API_KEY being unset is a state the app fully supports — it shows
     * a "not set up" banner rather than failing. So on any deployment without
     * a key, every password reset token in the club was written to the
     * platform log in plaintext next to the account it belonged to, for the
     * fifteen minutes it stayed valid. Anyone who could read the logs could
     * take over any account, organizers included.
     *
     * Development still prints it, because there is no other way to complete a
     * reset locally. Production gets the fact and nothing identifying.
     */
    if (process.env.NODE_ENV === "development") {
      console.warn(`[email] RESEND_API_KEY not set — password reset link for ${to}:\n${resetUrl}`);
    } else {
      console.warn("[email] RESEND_API_KEY not set — password reset email not sent.");
    }
    return { ok: false, error: "Email isn't configured on this server." };
  }
  try {
    const { error } = await resend.emails.send({
      from: FROM,
      to,
      subject: "Reset your TourneyHQ password",
      html: `
        <p>Someone requested a password reset for your TourneyHQ account.</p>
        <p><a href="${resetUrl}">Reset your password</a> — this link expires in 15 minutes.</p>
        <p>If you didn't request this, you can safely ignore this email.</p>
      `,
    });
    if (error) {
      console.error(`[email] Resend rejected the reset email for ${maskEmail(to)}: ${error.message}`);
      await recordFailure({
        kind: "reset",
        reason: classifySendFailure(error.message, (error as { statusCode?: number }).statusCode),
        detail: error.message,
        organizationIds: await organizationsFor(to),
        // Address deliberately omitted — see the model. The organizer's job
        // here is to fix the mail setup, and a durable list of who forgot
        // their password is a record worth not keeping.
      });
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to send email.";
    console.error(`[email] Failed sending reset email to ${maskEmail(to)}: ${message}`);
    await recordFailure({
      kind: "reset",
      reason: classifySendFailure(message),
      detail: message,
      organizationIds: await organizationsFor(to),
    });
    return { ok: false, error: message };
  }
}

/**
 * Best-effort "you're registered" confirmation for open registration.
 *
 * Deliberately fire-and-forget: registration is confirmed on-screen the moment
 * it succeeds, so email is a nicety, not the receipt. Without RESEND_API_KEY it
 * no-ops (dev, and any deploy that hasn't wired mail yet — decision #83), and a
 * send that fails is logged and swallowed. Nothing here may ever throw into the
 * registration path — a bounced confirmation must not undo a real entry.
 */
export async function sendRegistrationEmail(
  to: string,
  opts: {
    eventName: string;
    status: "confirmed" | "waitlisted" | "pending";
    /** So a failure can be shown to the club it happened in. */
    organizationId: string;
    eventId: string;
    /** For the follow-up: an organizer needs to know who to call. */
    toName?: string;
  },
): Promise<void> {
  if (!resend) {
    console.warn(`[email] RESEND_API_KEY not set — skipping registration email to ${maskEmail(to)} (${opts.status}).`);
    return;
  }
  const line =
    opts.status === "confirmed"
      ? "You're confirmed in the field."
      : opts.status === "waitlisted"
        ? "The field is full, so you're on the waitlist — we'll be in touch if a place opens."
        : "Your entry has been received and is waiting for the organizer to confirm it.";
  try {
    const { error } = await resend.emails.send({
      from: FROM,
      to,
      subject: `You're registered — ${opts.eventName}`,
      html: `<p>Thanks for registering for <strong>${opts.eventName}</strong>.</p><p>${line}</p>`,
    });
    if (error) {
      console.error(`[email] Resend rejected the registration email for ${maskEmail(to)}: ${error.message}`);
      await recordFailure({
        kind: "registration",
        reason: classifySendFailure(error.message, (error as { statusCode?: number }).statusCode),
        detail: error.message,
        organizationIds: [opts.organizationId],
        eventId: opts.eventId,
        toEmail: to,
        toName: opts.toName ?? "",
      });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    console.error(`[email] Failed sending registration email to ${maskEmail(to)}: ${message}`);
    await recordFailure({
      kind: "registration",
      reason: classifySendFailure(message),
      detail: message,
      organizationIds: [opts.organizationId],
      eventId: opts.eventId,
      toEmail: to,
      toName: opts.toName ?? "",
    });
  }
}

/**
 * Tell somebody an organizer just gave them access.
 *
 * Adding staff created a `User` and an `OrganizationMember` and then said
 * nothing at all, so the person had no idea an account existed for them. The
 * organizer had to message them out of band, and the app's own instruction —
 * "claim the account by signing up" — was one nobody had been given.
 *
 * Fire-and-forget, exactly like the registration confirmation and for the same
 * reason: the membership is already written and correct, and a bounced
 * invitation must never undo it. Without `RESEND_API_KEY` this no-ops, which is
 * every developer machine.
 *
 * The wording splits on whether they can already sign in, because the two
 * situations need different instructions and guessing wrong wastes the one
 * email they will read. Someone with a password just signs in; someone without
 * has to set one first, and the sign-in screen routes them there once it
 * recognises club staff as provisioned — which it did not until the change
 * this ships alongside.
 */
export async function sendStaffInviteEmail(
  to: string,
  opts: {
    organizationName: string;
    /** So a failure can be shown to the club it happened in. */
    organizationId: string;
    /** "owner" | "admin" | "assistant" | "member" — shown as-is. */
    role: string;
    /** Whether they already have a password, which changes the instruction. */
    hasPassword: boolean;
    /** For the follow-up: an organizer needs to know who to chase. */
    toName?: string;
  },
): Promise<void> {
  if (!resend) {
    console.warn(`[email] RESEND_API_KEY not set — skipping staff invite to ${maskEmail(to)}.`);
    return;
  }

  const club = opts.organizationName || "a club";
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const line = opts.hasPassword
    ? `<p>Sign in with this email address and you will see it: <a href="${base}">${base}</a></p>`
    : `<p>You do not have a password yet. Go to <a href="${base}">${base}</a>, enter this email address, and it will walk you through setting one.</p>`;

  try {
    const { error } = await resend.emails.send({
      from: FROM,
      to,
      subject: `You have been added to ${club} on TourneyHQ`,
      html:
        `<p>An organizer at <strong>${club}</strong> has given you ${opts.role} access on TourneyHQ.</p>` +
        line +
        `<p>If you were not expecting this, you can ignore it — nothing happens until you sign in.</p>`,
    });
    if (error) {
      console.error(`[email] Resend rejected the staff invite for ${maskEmail(to)}: ${error.message}`);
      await recordFailure({
        kind: "invite",
        reason: classifySendFailure(error.message, (error as { statusCode?: number }).statusCode),
        detail: error.message,
        organizationIds: [opts.organizationId],
        // The address IS kept here, unlike a reset. An organizer who invited
        // someone already knows they invited them, so this leaks nothing they
        // did not type themselves — and without it they cannot tell WHICH
        // invitation failed, which is the only thing they can act on.
        toEmail: to,
        toName: opts.toName ?? "",
      });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    console.error(`[email] Failed sending staff invite to ${maskEmail(to)}: ${message}`);
    await recordFailure({
      kind: "invite",
      reason: classifySendFailure(message),
      detail: message,
      organizationIds: [opts.organizationId],
      toEmail: to,
      toName: opts.toName ?? "",
    });
  }
}

/**
 * Which way a player moved between the field and the waitlist.
 *
 * Two directions, and they are not symmetrical. Being promoted is good news
 * somebody will act on when they get round to it. Being demoted is information
 * they need BEFORE they set off for the course.
 */
export type FieldChange = "promoted" | "waitlisted";

/**
 * Tell a player their place in the field changed.
 *
 * The registration email makes a promise in writing — "The field is full, so
 * you're on the waitlist — we'll be in touch if a place opens" — and nothing
 * kept it. Three paths moved players between `confirmed` and `waitlisted` and
 * none of them told anybody:
 *
 *   - a confirmed player withdraws, and the earliest waitlisted is promoted
 *   - the field is enlarged, and the waitlist is promoted in bulk
 *   - the field is SHRUNK, and confirmed players are moved to the waitlist
 *
 * The third matters most, and it is not the one the promise is about. Every
 * other silent transition leaves somebody pleasantly surprised; that one leaves
 * a player who was told "You're confirmed in the field" standing at a golf
 * course with no tee time. So the demotion wording states the consequence
 * plainly rather than softening it, and says it in the first line — this is the
 * message nobody may skim.
 *
 * Fire-and-forget, like every other send here: the field is already correct in
 * the database, and a bounced notification must never undo a place in it.
 */
export async function sendFieldStatusEmail(
  to: string,
  opts: {
    change: FieldChange;
    eventName: string;
    /** Free text, as the organizer typed it — "12-14 June", "Saturday". */
    eventDates: string;
    eventCourse: string;
    /** So a failure can be shown to the club it happened in. */
    organizationId: string;
    eventId: string;
    /** For the follow-up: an organizer needs to know who to call. */
    toName?: string;
  },
): Promise<void> {
  if (!resend) {
    console.warn(`[email] RESEND_API_KEY not set — skipping field-status email to ${maskEmail(to)}.`);
    return;
  }

  const where = [opts.eventDates, opts.eventCourse].filter((s) => s.trim()).join(" &middot; ");
  const heading = where ? `<p>${where}</p>` : "";

  const subject =
    opts.change === "promoted"
      ? `A place has opened - you're in the field for ${opts.eventName}`
      : `Your place in ${opts.eventName} has changed`;

  const body =
    opts.change === "promoted"
      ? `<p>A place has opened in <strong>${opts.eventName}</strong> and you have moved off the waitlist.</p>` +
        heading +
        `<p><strong>You are now confirmed in the field.</strong> Your place is held - there is nothing you need to do to accept it.</p>` +
        // Asks for a reply within the same window the organizer's screen uses
        // to decide who to chase, so the message and the badge agree. It is a
        // request, not a deadline: the place is theirs either way, and saying
        // otherwise would be a threat the software does not carry out.
        `<p>If you can no longer play, please tell the organizer <strong>within 48 hours</strong> so the place can go to the next person on the list.</p>`
      : `<p>The field for <strong>${opts.eventName}</strong> has been resized, and you have been moved to the waitlist.</p>` +
        heading +
        `<p><strong>You are not currently in the field, so please do not travel to the course expecting to play.</strong></p>` +
        `<p>You keep your place in the queue, and we will be in touch if a place opens again. If you think this is a mistake, contact the organizer.</p>`;

  try {
    const { error } = await resend.emails.send({ from: FROM, to, subject, html: body });
    if (error) {
      console.error(`[email] Resend rejected the field-status email for ${maskEmail(to)}: ${error.message}`);
      await recordFailure({
        kind: "field",
        reason: classifySendFailure(error.message, (error as { statusCode?: number }).statusCode),
        detail: error.message,
        organizationIds: [opts.organizationId],
        eventId: opts.eventId,
        // The address is kept, as for registration and unlike a reset. The
        // organizer entered this player themselves, so it leaks nothing they
        // did not already have, and "who do I need to phone" is the only useful
        // thing to do about a notification that did not arrive.
        toEmail: to,
        toName: opts.toName ?? "",
      });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    console.error(`[email] Failed sending field-status email to ${maskEmail(to)}: ${message}`);
    await recordFailure({
      kind: "field",
      reason: classifySendFailure(message),
      detail: message,
      organizationIds: [opts.organizationId],
      eventId: opts.eventId,
      toEmail: to,
      toName: opts.toName ?? "",
    });
  }
}
