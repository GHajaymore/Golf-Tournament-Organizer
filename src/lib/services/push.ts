import "server-only";
import webpush from "web-push";
import { prisma } from "@/lib/db";
import { ADMIN_EMAIL } from "@/lib/contact";
import { demoRefusesMessage } from "@/lib/services/demo-guard";
import { endpointFingerprint } from "@/lib/domain/push-device";

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
  // Who a push service writes to about this sender: the operator's own address, which is read.
  const subject = process.env.VAPID_SUBJECT || `mailto:${ADMIN_EMAIL}`;
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
  /**
   * A safety notice (play suspended): the service worker asks for a long
   * vibration and keeps it on screen until dismissed. See `public/sw.js`.
   */
  urgent?: boolean;
}

/**
 * HOW THE PUSH SERVICE IS ASKED TO CARRY IT (2026-11-14, safety sweep G-5).
 *
 *   "ordinary"     tee times, a cup's lineup: the library's defaults, unchanged
 *                  (normal urgency; held for a phone that is off for weeks)
 *   "play-status"  play suspended, and play resumed (Rule 5.7): HIGH urgency, so
 *                  Android's push service wakes a dozing phone for it rather
 *                  than batching it, and a life of hours rather than weeks:
 *                  long enough for a dead spot through a lightning hold
 */
export type PushDelivery = "ordinary" | "play-status";

/**
 * Three hours (the Tournament Director's review of #1134). A lightning hold
 * commonly lasts 45–90 minutes, and a player on a no-signal hole when the
 * hooter goes must still be told when the phone finds signal — half an hour
 * dropped exactly that push. "Yesterday's stop now" cannot arrive: suspend and
 * resume share one tag (`play-<event>`) and the same life, and resume is sent
 * later, so a queued suspension is always followed and replaced by its resume.
 */
export const PLAY_STATUS_TTL_SECONDS = 3 * 60 * 60;

export function sendOptionsFor(delivery: PushDelivery): { urgency: "high"; TTL: number } | undefined {
  return delivery === "play-status" ? { urgency: "high", TTL: PLAY_STATUS_TTL_SECONDS } : undefined;
}

/**
 * A PHONE THAT CHANGES HANDS STOPS BEING THE FIRST PERSON'S (2026-11-14,
 * safety sweep G-4; a Security Lead hole as much as a safety one).
 *
 * A subscription is a device's, stamped with the address of whoever turned
 * alerts on. Signing out left it there, so the first person's "play is
 * suspended" and tee times went on landing on a phone they no longer held, and
 * the next person was told "alerts are on" and got nothing of their own.
 *
 *   Sign out             forgets THIS device for the person signing out: the
 *                        endpoint the browser sends, matched with the session's
 *                        own address, so a stranger's endpoint matches nothing
 *   Sign out everywhere  forgets every device of theirs: it is for the phone
 *                        they no longer hold, and that phone cannot be asked
 *
 * Never throws: signing out must always finish.
 */
export function pushEndpointFrom(raw: unknown): string {
  // A plain form posts FormData (the account and choose pages); a button passes the string.
  const value = typeof FormData !== "undefined" && raw instanceof FormData ? raw.get("pushEndpoint") : raw;
  return typeof value === "string" ? value.trim().slice(0, 2048) : "";
}

export async function forgetThisDevicePush(email: string, endpoint: string): Promise<void> {
  const who = email.trim().toLowerCase();
  if (!who || !endpoint) return;
  try {
    await prisma.pushSubscription.deleteMany({ where: { endpoint, email: who } });
  } catch (e) {
    console.error(`[push] could not forget a device on sign-out: ${e instanceof Error ? e.message : "unknown"}`);
  }
}

export async function forgetEveryDevicePush(email: string): Promise<void> {
  const who = email.trim().toLowerCase();
  if (!who) return;
  try {
    await prisma.pushSubscription.deleteMany({ where: { email: who } });
  } catch (e) {
    console.error(`[push] could not forget devices on sign-out everywhere: ${e instanceof Error ? e.message : "unknown"}`);
  }
}

/**
 * Which of this person's devices have alerts on, as fingerprints — so the
 * toggle on a shared phone can tell whether the subscription the BROWSER holds
 * is the signed-in person's, rather than taking the browser's word for it
 * (`pushToggleState`). A fingerprint, never the endpoint: the endpoint is the
 * device's secret address, and the page needs only to recognise its own.
 */
export async function pushFingerprintsFor(email: string | null | undefined): Promise<string[]> {
  const who = (email ?? "").trim().toLowerCase();
  if (!who) return [];
  try {
    const rows = await prisma.pushSubscription.findMany({ where: { email: who }, select: { endpoint: true } });
    return Promise.all(rows.map((r) => endpointFingerprint(r.endpoint)));
  } catch {
    return [];
  }
}

/**
 * Push one payload to every device of every listed member.
 *
 * Emails are lowercased and de-duplicated to match how subscriptions are
 * stored. A member with no subscription is simply skipped — opting in is
 * theirs to do, and the absence is not an error.
 */
export async function sendPushToEmails(
  emails: string[],
  payload: PushPayload,
  /**
   * The tournament the push is about, or null for none — REQUIRED, so every
   * caller says, and the demo club's tournaments push nothing to anybody
   * (2026-10-24; docs/claude/demo-club.md). `delivery` defaults to "ordinary"
   * (`sendOptionsFor`).
   */
  scope: { eventId: string | null; delivery?: PushDelivery },
): Promise<void> {
  const targets = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (targets.length === 0) return;
  if (await demoRefusesMessage({ to: targets, eventId: scope.eventId })) return;
  if (!ensureConfigured()) {
    console.warn("[push] VAPID keys not set — skipping push notification.");
    return;
  }

  try {
    const subs = await prisma.pushSubscription.findMany({ where: { email: { in: targets } } });
    if (subs.length === 0) return;

    const body = JSON.stringify(payload);
    const options = sendOptionsFor(scope.delivery ?? "ordinary");
    const dead: string[] = [];

    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body,
            options,
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
