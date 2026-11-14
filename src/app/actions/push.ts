"use server";
import { prisma } from "@/lib/db";
import { getPlayerViewer, type PlayerViewer } from "@/lib/player-viewer";

/**
 * Opting a device in and out of web-push.
 *
 * A subscription belongs to WHOEVER THE PLAYER SCREEN IS FOR (J39/J40 PR 2):
 * the toggle lives on Today, so it asks the same viewer that screen was drawn
 * for (`getPlayerViewer`).
 *
 *   an account   its `PushSubscription`, by email — the identity the player
 *                app already resolves by — so a notice reaches every browser
 *                they turned alerts on in. The push service's `endpoint` is the
 *                device's own unguessable URL and the natural key.
 *   a guest      its pass's `PlayerPassPush`, bound to the pass's VERSION, so
 *                New link, Turn off and the entry ending stop it at once. Kept
 *                apart, so a guest's subscribe on a browser that also holds an
 *                account never overwrites the account's row.
 *
 * Every export here is a public HTTP endpoint. The rule is the same one the
 * whole app runs on: a caller may only act on their OWN record. Saving stamps
 * the row with the caller's own identity, taken from the viewer and never from
 * an argument; removing and asking are scoped to it, so nobody can unsubscribe
 * or probe somebody else's phone.
 */

/* The boundary checks and the owner, above every action so no action's text carries them. */
/** An endpoint as a push service issues it: https, and bounded. Anything else is not one. */
function cleanEndpoint(value: unknown): string {
  const v = typeof value === "string" ? value.trim() : "";
  return v.length > 0 && v.length <= 1024 && v.startsWith("https://") ? v : "";
}
const cleanKey = (value: unknown): string => {
  const v = typeof value === "string" ? value.trim() : "";
  return v.length > 0 && v.length <= 256 ? v : "";
};

/** Whose notices these are: the viewer's own, or null when nobody is looking. */
async function pushOwnerNow(): Promise<PlayerViewer | null> {
  const viewer = await getPlayerViewer();
  if (!viewer) return null;
  if (!viewer.guest && !viewer.email.trim()) return null;
  return viewer;
}

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

/** Store (or refresh) this device's subscription for the person this screen is for. */
export async function savePushSubscription(sub: {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}): Promise<PushActionResult> {
  const owner = await pushOwnerNow();
  if (!owner) return { ok: false, error: "Not signed in." };

  const endpoint = cleanEndpoint(sub?.endpoint);
  const p256dh = cleanKey(sub?.keys?.p256dh);
  const auth = cleanKey(sub?.keys?.auth);
  if (!endpoint || !p256dh || !auth) return { ok: false, error: "That isn't a push subscription." };

  if (owner.guest) {
    const { passId, version } = owner.guest;
    await prisma.playerPassPush.upsert({
      where: { passId_endpoint: { passId, endpoint } },
      update: { p256dh, auth, passVersion: version },
      create: { passId, passVersion: version, endpoint, p256dh, auth },
    });
    return { ok: true };
  }

  const email = owner.email.trim().toLowerCase();
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
 * Scoped to the caller's own identity as well as the endpoint, so a leaked
 * endpoint cannot be used to silence another person's phone — a foreign
 * endpoint simply matches no row of theirs. A guest removes only their own
 * pass's row; an account only its own.
 */
export async function removePushSubscription(endpoint: string): Promise<PushActionResult> {
  const owner = await pushOwnerNow();
  if (!owner) return { ok: false, error: "Not signed in." };
  const at = cleanEndpoint(endpoint);
  if (!at) return { ok: true };
  if (owner.guest) {
    await prisma.playerPassPush.deleteMany({ where: { passId: owner.guest.passId, endpoint: at } });
    return { ok: true };
  }
  await prisma.pushSubscription.deleteMany({ where: { endpoint: at, email: owner.email.trim().toLowerCase() } });
  return { ok: true };
}

/**
 * WHETHER THIS BROWSER'S NOTICES ARE ON FOR THE PERSON THIS SCREEN IS FOR
 * (J39/J40 PR 2). The toggle asks the SERVER, not only
 * `pushManager.getSubscription()`: one browser can be on for an account and
 * off for the guest link it also holds, and a guest's row from before a New
 * link is not on. Only ever about the caller's own rows.
 */
export async function pushIsOnHere(endpoint: string): Promise<boolean> {
  const owner = await pushOwnerNow();
  const at = cleanEndpoint(endpoint);
  if (!owner || !at) return false;
  if (owner.guest) {
    const row = await prisma.playerPassPush.findFirst({
      where: { passId: owner.guest.passId, endpoint: at, passVersion: owner.guest.version },
      select: { id: true },
    });
    return !!row;
  }
  const row = await prisma.pushSubscription.findFirst({ where: { endpoint: at, email: owner.email.trim().toLowerCase() }, select: { id: true } });
  return !!row;
}
