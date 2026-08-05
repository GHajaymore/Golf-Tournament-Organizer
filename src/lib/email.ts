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
    console.warn(`[email] RESEND_API_KEY not set — password reset link for ${to}:\n${resetUrl}`);
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
