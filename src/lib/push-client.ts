/**
 * THIS BROWSER'S ALERTS, LET GO ON SIGN-OUT (2026-11-14, safety sweep G-4).
 *
 * Browser-only. Returns this device's push endpoint, for `signOutAction` to
 * forget the signing-out person's row for it, and unsubscribes the browser so
 * the next person to hold the phone starts with alerts off rather than with
 * somebody else's. Never throws and never waits on a missing service worker:
 * a sign-out must always go through, and "" simply forgets nothing.
 */
export async function releaseThisDevicesPush(): Promise<string> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return "";
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager?.getSubscription();
    if (!sub) return "";
    const endpoint = sub.endpoint;
    await sub.unsubscribe().catch(() => false);
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
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return "";
    const reg = await navigator.serviceWorker.getRegistration();
    return (await reg?.pushManager?.getSubscription())?.endpoint ?? "";
  } catch {
    return "";
  }
}
