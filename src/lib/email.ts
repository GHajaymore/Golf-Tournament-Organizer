import "server-only";
import { Resend } from "resend";

// Lazily constructed so a missing key doesn't crash module load — dev
// environments without RESEND_API_KEY fall back to logging the link.
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.RESEND_FROM_EMAIL ?? "TourneyHQ <onboarding@resend.dev>";

export async function sendPasswordResetEmail(to: string, resetUrl: string): Promise<{ ok: boolean; error?: string }> {
  if (!resend) {
    console.warn(`[email] RESEND_API_KEY not set — password reset link for ${to}:\n${resetUrl}`);
    return { ok: false, error: "Email isn't configured yet on this server — ask an admin to check the server console for the reset link." };
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
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Failed to send email." };
  }
}
