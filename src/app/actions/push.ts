"use server";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * Opting a device in and out of web-push.
 *
 * A subscription belongs to the SIGNED-IN member, by email — the identity the
 * player app already resolves by — so a notice meant for a player reaches every
 * browser they turned alerts on in. The push service's `endpoint` is the
 * device's own unguessable URL and the natural key: re-subscribing the same
 * device replaces its keys rather than piling up rows.
 *
 * Every export here is a public HTTP endpoint. The rule is the same one the
 * whole app runs on: a caller may only act on their OWN record. Saving stamps
 * the row with the caller's email; removing is scoped to it, so nobody can
 * unsubscribe somebody else's phone.
 */

export interface PushActionResult {
  ok: boolean;
  error?: string;
}

/**
 * The VAPID public key the browser needs to build a subscription.
 *
 * Public by design — it is the key a push service checks a subscription
 * against, and shipping it to the client is how web push is meant to work.
 * Empty when push is not configured, which the client reads as "not available"
 * and hides the toggle rather than offering an alert that can never arrive.
 */
export async function getVapidPublicKey(): Promise<string> {
  return process.env.VAPID_PUBLIC_KEY ?? "";
}

/** Store (or refresh) this device's subscription for the signed-in member. */
export async function savePushSubscription(sub: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}): Promise<PushActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };

  const endpoint = String(sub?.endpoint ?? "").trim();
  const p256dh = String(sub?.keys?.p256dh ?? "").trim();
  const auth = String(sub?.keys?.auth ?? "").trim();
  if (!endpoint || !p256dh || !auth) return { ok: false, error: "That isn't a push subscription." };

  const email = session.email.trim().toLowerCase();
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: { p256dh, auth, email },
    create: { endpoint, p256dh, auth, email },
  });
  return { ok: true };
}

/**
 * Forget this device's subscription.
 *
 * Scoped to the caller's own email as well as the endpoint, so a leaked
 * endpoint cannot be used to silence another member's phone — a foreign
 * endpoint simply matches no row of theirs.
 */
export async function removePushSubscription(endpoint: string): Promise<PushActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Not signed in." };
  const email = session.email.trim().toLowerCase();
  await prisma.pushSubscription.deleteMany({ where: { endpoint: endpoint.trim(), email } });
  return { ok: true };
}
