"use server";
import { prisma } from "@/lib/db";
import { getPlayerViewer, type PlayerViewer } from "@/lib/player-viewer";
import { checkRateLimit } from "@/lib/rate-limit";
import { fileGuestPush, pushDeviceBudgetKey, pushEndpoint, turnOffHere } from "@/lib/services/push";

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
 * phone; turning off removes the caller's own row only (the #1133 security
 * review F-3). Both presses are budgeted per identity (`push-device`, F-1), and
 * a guest's link holds at most `GUEST_PUSH_ROWS` phones.
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
  const budget = await checkRateLimit("push-device", pushDeviceBudgetKey(owner));
  if (!budget.allowed) return { ok: false, error: budget.message };

  const endpoint = pushEndpoint(sub?.endpoint);
  const p256dh = cleanKey(sub?.keys?.p256dh);
  const auth = cleanKey(sub?.keys?.auth);
  if (!endpoint || !p256dh || !auth) return { ok: false, error: "That isn't a push subscription." };

  if (owner.guest) {
    await fileGuestPush(owner.guest, { endpoint, p256dh, auth });
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
 * "Turn off": the caller's own row on this browser's endpoint goes, and only
 * it (the #1133 security review F-3; `turnOffHere`). Before, every identity's
 * row on the endpoint went, so any player viewer could delete somebody else's
 * by naming its endpoint.
 *
 * The phone still stops for everybody on it: the client then unsubscribes the
 * browser, as before J39/J40 PR 2, the push service answers 410 for that
 * endpoint, and the sender deletes any other row on it at the next notice (a
 * previous holder's on a handed-on phone included). A browser holding an
 * account AND a guest link is one phone: Turn off on either stops both, and
 * either can Turn on again for itself. Budgeted like a save (`push-device`).
 */
export async function removePushSubscription(endpoint: string): Promise<PushActionResult> {
  const owner = await pushOwnerNow();
  if (!owner) return { ok: false, error: "Not signed in." };
  const budget = await checkRateLimit("push-device", pushDeviceBudgetKey(owner));
  if (!budget.allowed) return { ok: false, error: budget.message };
  await turnOffHere(owner, pushEndpoint(endpoint));
  return { ok: true };
}

/*
 * WHETHER THIS BROWSER'S NOTICES ARE ON for the person this screen is for is
 * not an action: the toggle is drawn on the server for the player viewer, with
 * that viewer's own devices as fingerprints (`PushToggle`,
 * `pushFingerprintsForViewer`), and the browser compares its own subscription
 * with them (`pushToggleState`). One rule for an account and a guest's link.
 */
