"use server";
import { prisma } from "@/lib/db";
import { getPlayerViewer, type PlayerViewer } from "@/lib/player-viewer";
import { pushEndpoint, silenceEndpoint } from "@/lib/services/push";

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
 * an argument; asking is scoped to it, so nobody can probe somebody else's
 * phone. Turning off is about the PHONE, not the person (review of #1133,
 * SEC-2): it silences every row on the endpoint the caller's own browser holds.
 */

/* The boundary checks and the owner, above every action so no action's text carries them. */
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

  const endpoint = pushEndpoint(sub?.endpoint);
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
 * "Turn off": THIS PHONE stops getting notices (review of #1133, SEC-2).
 *
 * Every row on this browser's endpoint goes, whoever it belongs to: the
 * caller's own, and a previous person's left behind on a phone that was handed
 * on (sign-out never removed an account's row, and the toggle shows only the
 * caller's own, so that row was otherwise one nobody on the phone could reach).
 * The client then unsubscribes the browser, as before J39/J40 PR 2. A browser
 * holding an account AND a guest link is one phone: Turn off on either stops
 * both, and either can Turn on again for itself.
 *
 * Why this cannot be pointed at somebody else's phone: the endpoint is the push
 * service's unguessable URL for one browser, the server never hands one out,
 * and a caller must still be somebody the player screen is for.
 */
export async function removePushSubscription(endpoint: string): Promise<PushActionResult> {
  const owner = await pushOwnerNow();
  if (!owner) return { ok: false, error: "Not signed in." };
  await silenceEndpoint(pushEndpoint(endpoint));
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
  const at = pushEndpoint(endpoint);
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
