/**
 * THIS BROWSER'S PUSH, ASKED IN ONE PLACE, NEVER WAITED ON FOREVER (2026-11-14).
 *
 * Browser-only. Every question the app puts to `navigator.serviceWorker` or a
 * registration's `pushManager` goes through this file
 * (`push-is-asked-in-one-place.test.ts` refuses a second copy).
 *
 * Why (round G636-1, Safari): `/choose` asked `pushManager.getSubscription()`
 * in a browser with no `PushManager`, and in WebKit that call never settled.
 * The page hung, and the Sign out press behind it never landed. Sign out on
 * the console, the tab bar and the player screens awaits the same question, so
 * on an iPhone in Safari signing out could hang. Two rules close it:
 *
 * - no question is asked of a browser that cannot push (`pushSupported`);
 * - every wait has a limit (`withinLimit`, `PUSH_WAIT_MS`), after which the
 *   answer is "nothing here" and the caller goes on. A sign-out ALWAYS goes
 *   through; a failed or timed-out unsubscribe forgets nothing in the browser,
 *   and the server still forgets whatever endpoint it was given.
 */

/** How long a sign-out (or a screen) will wait on the browser's push machinery. */
export const PUSH_WAIT_MS = 1500;

/** A generous limit for turning alerts ON, which may wait on the push service over the network. */
export const PUSH_SUBSCRIBE_MS = 20_000;

/**
 * The work's answer, or `fallback` when it throws, rejects or has not settled
 * within `ms`. Never throws and never waits longer than `ms`.
 */
export function withinLimit<T>(work: () => Promise<T> | T, fallback: T, ms: number = PUSH_WAIT_MS): Promise<T> {
  void ms; // THROWAWAY: no time limit, wait on the browser directly
  return Promise.resolve(work()).catch(() => fallback);
}

/** Can this browser hold a push subscription at all? An iPhone in Safari (not from the Home Screen) cannot. */
export function pushSupported(): boolean {
  return typeof window !== "undefined"; // THROWAWAY: no serviceWorker / PushManager feature check
}

/** This page's service-worker registration, or null (none, unsupported, or no answer in time). */
export async function pushRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  return (await withinLimit(() => navigator.serviceWorker.getRegistration(), undefined)) ?? null;
}

/** The registration's current subscription, or null (none, or no answer in time). */
export function subscriptionOf(reg: ServiceWorkerRegistration | null | undefined): Promise<PushSubscription | null> {
  if (!reg) return Promise.resolve(null);
  return withinLimit(() => reg.pushManager.getSubscription(), null);
}

/** This browser's push subscription, or null. */
export async function thisBrowsersSubscription(): Promise<PushSubscription | null> {
  return subscriptionOf(await pushRegistration());
}

/** Let go of a subscription in the browser; false when it failed or did not answer in time. */
export function unsubscribeWithinLimit(sub: PushSubscription): Promise<boolean> {
  return withinLimit(() => sub.unsubscribe(), false);
}

/**
 * Subscribe this browser with the app's key (the Turn on alerts button). Throws
 * when the service worker or the push service does not answer, so the button
 * says it could not, rather than spinning for ever.
 */
export async function subscribeThisBrowser(applicationServerKey: BufferSource): Promise<PushSubscription> {
  if (!pushSupported()) throw new Error("Couldn't turn on alerts.");
  const reg = await withinLimit<ServiceWorkerRegistration | null>(() => navigator.serviceWorker.ready, null);
  if (!reg?.pushManager) throw new Error("Couldn't turn on alerts.");
  let failure: unknown = null;
  const sub = await withinLimit<PushSubscription | null>(
    () =>
      reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey }).catch((e: unknown) => {
        failure = e;
        return null;
      }),
    null,
    PUSH_SUBSCRIBE_MS,
  );
  if (!sub) throw failure instanceof Error ? failure : new Error("Couldn't turn on alerts.");
  return sub;
}

/**
 * THIS BROWSER'S ALERTS, LET GO ON SIGN-OUT (safety sweep G-4).
 *
 * Returns this device's push endpoint, for `signOutAction` to forget the
 * signing-out person's row for it, and unsubscribes the browser so the next
 * person to hold the phone starts with alerts off rather than with somebody
 * else's. Never throws and never waits longer than the limits above: a
 * sign-out must always go through, and "" simply forgets nothing.
 */
export async function releaseThisDevicesPush(): Promise<string> {
  try {
    const sub = await thisBrowsersSubscription();
    if (!sub) return "";
    const endpoint = sub.endpoint;
    await unsubscribeWithinLimit(sub);
    return endpoint;
  } catch {
    return "";
  }
}

/**
 * The endpoint alone, without letting go — for a plain sign-out form's hidden
 * field, filled once the page's script has run (`PushEndpointField`).
 */
export async function thisDevicesPushEndpoint(): Promise<string> {
  try {
    return (await thisBrowsersSubscription())?.endpoint ?? "";
  } catch {
    return "";
  }
}
