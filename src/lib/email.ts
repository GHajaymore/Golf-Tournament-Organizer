import "server-only";
import { Resend } from "resend";

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
      console.error(`[email] Resend rejected the reset email for ${to}: ${error.message}`);
      return { ok: false, error: error.message };
    }
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to send email.";
    console.error(`[email] Failed sending reset email to ${to}: ${message}`);
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
  opts: { eventName: string; status: "confirmed" | "waitlisted" | "pending" },
): Promise<void> {
  if (!resend) {
    console.warn(`[email] RESEND_API_KEY not set — skipping registration email to ${to} (${opts.status}).`);
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
    if (error) console.error(`[email] Resend rejected the registration email for ${to}: ${error.message}`);
  } catch (e) {
    const message = e instanceof Error ? e.message : "unknown error";
    console.error(`[email] Failed sending registration email to ${to}: ${message}`);
  }
}
