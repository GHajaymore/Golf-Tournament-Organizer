import "server-only";

/**
 * Sending a text.
 *
 * Same shape as email.ts: lazily configured, and a missing key logs instead of
 * crashing so a dev environment works without an account. The difference is
 * what "not configured" has to mean. A password-reset email that silently
 * fails is a bug; a broadcast text that silently fails is an organizer
 * believing 90 people have been told about a frost delay when nobody has. So
 * `smsConfig()` is surfaced on the compose screen BEFORE the send, and the
 * send itself reports per-recipient rather than returning a single boolean.
 *
 * Twilio over its REST API rather than the SDK: it is one authenticated form
 * POST, and the SDK is a large dependency for that.
 */

const SID = process.env.TWILIO_ACCOUNT_SID ?? "";
const TOKEN = process.env.TWILIO_AUTH_TOKEN ?? "";
/** A number, or a Messaging Service SID (starts MG) which is what a club with
 *  more than a handful of recipients should actually use. */
const FROM = process.env.TWILIO_FROM ?? "";

export interface SmsConfig {
  configured: boolean;
  /** Set when something is wrong — safe to show an organizer. */
  problem?: string;
}

/**
 * Whether a text will actually leave the building.
 *
 * Shown to staff before they compose, never to a player: what an anonymous
 * visitor learns from "SMS is misconfigured" helps nobody but an attacker.
 */
export function smsConfig(): SmsConfig {
  if (!SID || !TOKEN) {
    return {
      configured: false,
      problem:
        "Text messages aren't set up. Messages will still appear in the app for everyone — nothing is lost — but nobody will get a text. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN on the server.",
    };
  }
  if (!FROM) {
    return {
      configured: false,
      problem:
        "Text messages have credentials but no sending number. Set TWILIO_FROM to your Twilio number or Messaging Service SID.",
    };
  }
  return { configured: true };
}

export interface SendResult {
  ok: boolean;
  /** The provider's id, for reconciling against an invoice. */
  providerId?: string;
  error?: string;
}

/**
 * Send one text.
 *
 * Never throws. A carrier rejecting one number must not abort a fan-out to the
 * other eighty-nine, so every failure comes back as a value the caller records
 * against that recipient.
 */
export async function sendSms(to: string, body: string): Promise<SendResult> {
  const config = smsConfig();
  if (!config.configured) {
    // Visible in dev, and honest: this did not go anywhere.
    console.info(`[sms] not configured — would have sent to ${to}: ${body}`);
    return { ok: false, error: "SMS is not configured on this server." };
  }

  const form = new URLSearchParams({ To: to, Body: body });
  // A Messaging Service SID and a plain number go in different fields, and
  // sending one in the other's field fails with an error that does not say so.
  if (FROM.startsWith("MG")) form.set("MessagingServiceSid", FROM);
  else form.set("From", FROM);

  try {
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${SID}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${SID}:${TOKEN}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form,
      // A hung carrier request must not hold a server action open. The
      // delivery row is already written, so a timeout is recoverable.
      signal: AbortSignal.timeout(15_000),
    });

    const json = (await res.json().catch(() => ({}))) as { sid?: string; message?: string };
    if (!res.ok) return { ok: false, error: json.message ?? `Carrier rejected it (${res.status}).` };
    return { ok: true, providerId: json.sid ?? "" };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Couldn't reach the carrier." };
  }
}
