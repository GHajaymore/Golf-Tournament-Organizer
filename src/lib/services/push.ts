import "server-only";
import webpush from "web-push";
import { prisma } from "@/lib/db";
import { ADMIN_EMAIL } from "@/lib/contact";
import { demoRefusesMessage } from "@/lib/services/demo-guard";
import { livePass } from "@/lib/services/player-link";
import { guestWhoKey, isGuestKey, playerOfGuestKey, whoKeysForEntry } from "@/lib/domain/messaging";
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
 * WHOSE DEVICES ARE ON, FOR THE PERSON THE PLAYER SCREEN IS FOR (G-4 with
 * J39/J40 PR 2). The toggle sits on Today, which is drawn for the PLAYER VIEWER
 * — an account or a guest's link — and Turn on files the row for that same
 * viewer (`savePushSubscription`), so "on" is asked of the same one:
 *
 *   an account   its own `PushSubscription` rows (`pushFingerprintsFor`)
 *   a guest      its pass's `PlayerPassPush` rows at the pass's CURRENT version
 *                only, so a row from before New link reads "off" (the sender
 *                skips it too, `routesFor`), and an account's row on the same
 *                browser is never the guest's
 *
 * Fingerprints, never endpoints, as `pushFingerprintsFor` gives them.
 */
export async function pushFingerprintsForViewer(
  viewer: { email: string; guest: { passId: string; version: number } | null } | null | undefined,
): Promise<string[]> {
  if (!viewer) return [];
  if (!viewer.guest) return pushFingerprintsFor(viewer.email);
  try {
    const rows = await prisma.playerPassPush.findMany({
      where: { passId: viewer.guest.passId, passVersion: viewer.guest.version },
      select: { endpoint: true },
    });
    return Promise.all(rows.map((r) => endpointFingerprint(r.endpoint)));
  } catch {
    return [];
  }
}

/**
 * An endpoint as a push service issues it: https, and bounded. Anything else is
 * not one, and is read as "" (the boundary check every door that takes one asks).
 */
export function pushEndpoint(value: unknown): string {
  const v = typeof value === "string" ? value.trim() : "";
  return v.length > 0 && v.length <= 1024 && v.startsWith("https://") ? v : "";
}

/**
 * THIS PHONE STOPS (review of #1133, SEC-2): every row that sends to this
 * endpoint, whoever's it is — an account's `PushSubscription`, any pass's
 * `PlayerPassPush`. "Turn off" is a press on a phone, and a phone handed on
 * holds a previous person's row nobody on it can see; before J39/J40 PR 2 the
 * browser's unsubscribe ended those, and this is that, said to the server.
 * An endpoint is the push service's unguessable URL for one browser and the
 * server never hands one out, so knowing it is holding that browser.
 */
export async function silenceEndpoint(endpoint: string): Promise<void> {
  const at = pushEndpoint(endpoint);
  if (!at) return;
  await prisma.$transaction([
    prisma.pushSubscription.deleteMany({ where: { endpoint: at } }),
    prisma.playerPassPush.deleteMany({ where: { endpoint: at } }),
  ]);
}

/**
 * A GUEST'S LINK FORGOTTEN ON THIS PHONE (review of #1133, SEC-1): the held
 * pass's row for this endpoint, and only it. Forget changes no version, so
 * without this the sender's `livePass` check would go on passing and a
 * borrowed phone would keep getting the guest's tee times. Another identity's
 * row on the same browser (a signed-in account) is theirs and is left.
 */
export async function forgetPassHere(passId: string, endpoint: unknown): Promise<void> {
  const at = pushEndpoint(endpoint);
  if (!passId || !at) return;
  await prisma.playerPassPush.deleteMany({ where: { passId, endpoint: at } });
}

/**
 * WHERE A NOTICE CAN GO, FOR THESE WHO-KEYS — the one routing the sender and
 * the notices-off count share (J39/J40 PR 2, design §3), so the organizer's
 * "N players have notices off" can never claim somebody is reachable whom the
 * sender would skip.
 *
 *   an account's email   its `PushSubscription` rows, as always
 *   `guest:<playerId>`   its pass's `PlayerPassPush` rows, ONLY while the pass
 *                        is live at that row's version (`livePass`, the same
 *                        function the guest's cookie is checked by): New link,
 *                        Turn off, a withdrawal and expiry all stop it at once,
 *                        and the dead rows are returned to be deleted
 */
async function routesFor(whoKeys: string[]): Promise<{
  accounts: { endpoint: string; p256dh: string; auth: string; key: string }[];
  guests: { id: string; endpoint: string; p256dh: string; auth: string; key: string }[];
  deadGuestRows: string[];
}> {
  const emails = whoKeys.filter((k) => !isGuestKey(k));
  const guestIds = whoKeys.map(playerOfGuestKey).filter((id): id is string => !!id);
  const [subs, rows] = await Promise.all([
    emails.length ? prisma.pushSubscription.findMany({ where: { email: { in: emails } } }) : [],
    guestIds.length
      ? prisma.playerPassPush.findMany({
          where: { pass: { playerId: { in: guestIds } } },
          select: { id: true, endpoint: true, p256dh: true, auth: true, passVersion: true, passId: true, pass: { select: { playerId: true } } },
        })
      : [],
  ]);
  const guests: { id: string; endpoint: string; p256dh: string; auth: string; key: string }[] = [];
  const deadGuestRows: string[] = [];
  const liveAt = new Map<string, boolean>();
  for (const r of rows) {
    const at = `${r.passId}:${r.passVersion}`;
    if (!liveAt.has(at)) liveAt.set(at, !!(await livePass(r.passId, r.passVersion)));
    if (liveAt.get(at)) guests.push({ id: r.id, endpoint: r.endpoint, p256dh: r.p256dh, auth: r.auth, key: guestWhoKey(r.pass.playerId) });
    else deadGuestRows.push(r.id);
  }
  return {
    accounts: subs.map((s) => ({ endpoint: s.endpoint, p256dh: s.p256dh, auth: s.auth, key: s.email })),
    guests,
    deadGuestRows,
  };
}

/**
 * Push one payload to every device of every listed person, by WHO-KEY
 * (J39/J40 PR 2; was `sendPushToEmails`). An account's email reaches its
 * browsers as before; a guest's key reaches the browsers that guest turned
 * notices on in, while their link is live (`routesFor`). Keys are
 * lower-cased and de-duplicated. A person with no subscription is simply
 * skipped — opting in is theirs to do, and the absence is not an error. Never
 * an email, a text or a phone for a guest (ruled 7 Nov). The payload never
 * carries a code, and a tap opens Today (`public/sw.js`).
 */
export async function sendPushTo(
  whoKeys: string[],
  payload: PushPayload,
  /**
   * The tournament the push is about, or null for none — REQUIRED, so every
   * caller says, and the demo club's tournaments push nothing to anybody
   * (2026-10-24; docs/claude/demo-club.md). `delivery` defaults to "ordinary"
   * (`sendOptionsFor`).
   */
  scope: { eventId: string | null; delivery?: PushDelivery },
): Promise<void> {
  const targets = [...new Set(whoKeys.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (targets.length === 0) return;
  if (await demoRefusesMessage({ to: targets.filter((k) => !isGuestKey(k)), eventId: scope.eventId })) return;
  if (!ensureConfigured()) {
    console.warn("[push] VAPID keys not set — skipping push notification.");
    return;
  }

  try {
    const { accounts, guests, deadGuestRows } = await routesFor(targets);
    if (deadGuestRows.length) await prisma.playerPassPush.deleteMany({ where: { id: { in: deadGuestRows } } });
    if (accounts.length === 0 && guests.length === 0) return;

    const body = JSON.stringify(payload);
    // A guest's phone is carried exactly as an account's: play suspended wakes it too (G-5).
    const options = sendOptionsFor(scope.delivery ?? "ordinary");
    const deadAccounts: string[] = [];
    const deadGuests: string[] = [];

    const send = async (s: { endpoint: string; p256dh: string; auth: string }, onGone: () => void) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, options);
      } catch (e) {
        const code = (e as { statusCode?: number })?.statusCode;
        // 404/410: the browser unsubscribed or the push service retired it.
        if (code === 404 || code === 410) onGone();
        else console.error(`[push] send failed (${code ?? "?"}): ${e instanceof Error ? e.message : "unknown"}`);
      }
    };
    await Promise.all([
      ...accounts.map((s) => send(s, () => deadAccounts.push(s.endpoint))),
      ...guests.map((s) => send(s, () => deadGuests.push(s.id))),
    ]);

    if (deadAccounts.length) await prisma.pushSubscription.deleteMany({ where: { endpoint: { in: deadAccounts } } });
    if (deadGuests.length) await prisma.playerPassPush.deleteMany({ where: { id: { in: deadGuests } } });
  } catch (e) {
    console.error(`[push] Could not send notifications: ${e instanceof Error ? e.message : "unknown"}`);
  }
}

/**
 * HOW MANY OF THESE ENTRIES A PUSH CANNOT REACH: no key with a live
 * subscription behind it (J39/J40 PR 2). The organizer's "N players have
 * notices off. Tell them in person." beside Publish and beside a moved day. A
 * count only, for a staff screen; the same routing as `sendPushTo`
 * (`routesFor`), so the two agree on every row. Bounded to the event's own
 * entries, whatever ids are passed.
 */
export async function noticesOffAmong(eventId: string, playerIds: string[]): Promise<number> {
  if (playerIds.length === 0) return 0;
  const players = await prisma.player.findMany({
    where: { eventId, id: { in: playerIds } },
    select: { id: true, email: true, standing: true },
  });
  const keysOf = players.map((p) => whoKeysForEntry(p));
  const { accounts, guests } = await routesFor(keysOf.flat());
  const reached = new Set([...accounts.map((a) => a.key.trim().toLowerCase()), ...guests.map((g) => g.key)]);
  return keysOf.filter((keys) => !keys.some((k) => reached.has(k))).length;
}
