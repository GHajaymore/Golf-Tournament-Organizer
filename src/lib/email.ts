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

/** The organizations that would want to know an address could not be reached. */
async function organizationsFor(email: string): Promise<string[]> {
  try {
    const rows = await prisma.member.findMany({
      where: { email },
      select: { organizationId: true },
      distinct: ["organizationId"],
    });
    return rows.map((r) => r.organizationId);
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
