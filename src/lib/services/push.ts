import "server-only";
import webpush from "web-push";
import { prisma } from "@/lib/db";

/**
 * Sending a web-push notification to a member, on every device they opted in on.
 *
 * The non-email rail (Ajay, 2026-09-24): tee times and other in-app news are
 * too last-minute for an inbox, so this pushes to the phone instead. It reaches
 * a member by EMAIL — the same identity the player screens resolve by — so one
 * send lights up every browser they subscribed from.
 *
 * Never throws, like `field-notify`: the thing the notice is about (a published
 * tee sheet, a moved place) is already true in the database, and a push that
 * bounces must not undo it. A subscription the push service has retired (410
 * Gone / 404) is deleted on the spot, so the table cannot fill with dead
 * endpoints.
 */

let configured: boolean | null = null;

/**
 * Wire the VAPID keys once, and remember whether we could.
 *
 * Unset keys are the ordinary state of a machine nobody has configured push on
 * — a fresh clone, a preview with no secrets — so this is a quiet skip, exactly
 * as the email senders treat a missing `RESEND_API_KEY`. Production sets
 * `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` in its env.
 */
function ensureConfigured(): boolean {
  if (configured !== null) return configured;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:hello@tourneyhq.club";
  if (!publicKey || !privateKey) {
    configured = false;
    return false;
  }
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Where a tap lands. Defaults to the player home. */
  url?: string;
  /** Collapses repeats: a second push with the same tag replaces the first. */
  tag?: string;
}

/**
 * Push one payload to every device of every listed member.
 *
 * Emails are lowercased and de-duplicated to match how subscriptions are
 * stored. A member with no subscription is simply skipped — opting in is
 * theirs to do, and the absence is not an error.
 */
export async function sendPushToEmails(emails: string[], payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) {
    console.warn("[push] VAPID keys not set — skipping push notification.");
    return;
  }
  const targets = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (targets.length === 0) return;

  try {
    const subs = await prisma.pushSubscription.findMany({ where: { email: { in: targets } } });
    if (subs.length === 0) return;

    const body = JSON.stringify(payload);
    const dead: string[] = [];

    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
          );
        } catch (e) {
          const code = (e as { statusCode?: number })?.statusCode;
          // 404/410: the browser unsubscribed or the push service retired it.
          if (code === 404 || code === 410) {
            dead.push(s.endpoint);
          } else {
            console.error(`[push] send failed (${code ?? "?"}): ${e instanceof Error ? e.message : "unknown"}`);
          }
        }
      }),
    );

    if (dead.length) {
      await prisma.pushSubscription.deleteMany({ where: { endpoint: { in: dead } } });
    }
  } catch (e) {
    console.error(`[push] Could not send notifications: ${e instanceof Error ? e.message : "unknown"}`);
  }
}
