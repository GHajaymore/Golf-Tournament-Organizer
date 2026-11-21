/**
 * A PRESS THAT STARTED A NAVIGATION IS JUDGED WHEN THE NAVIGATION ANSWERS (18 Nov 2026, nightly G60-1;
 * first seen G654-1, 17 Nov, backlog B83).
 *
 * A control that sends the person to another address (`router.push`) sends a client-side RSC request
 * (`?_rsc=`, header `rsc: 1`, not a prefetch). The server answers when it answers: 848 ms on a slow
 * runner, and the console crawl, which judged a press after a fixed 700 ms, called a working control
 * "silent". `waitForLoadState("networkidle")` does not help: it belongs to the document load and does
 * not re-arm for a client-side navigation.
 *
 * This watches the page for those requests. `settled(ms)` resolves when none is still in flight, or
 * says which one never answered in `ms`, so a slow server can never read as "nothing happened" and an
 * unanswered request is its own finding. A press that sends no such request has nothing to wait for,
 * so a genuinely silent control is still silent.
 */

type Req = { url(): string; headers(): Record<string, string> };
type Pageish = {
  on(event: string, fn: (r: Req) => void): unknown;
  off(event: string, fn: (r: Req) => void): unknown;
};

/** Is this request a navigation's RSC fetch (not a prefetch, not a server action)? */
export function isNavigationRequest(r: Req): boolean {
  const h = r.headers();
  if (h["next-action"]) return false;
  if (h["next-router-prefetch"]) return false;
  return h["rsc"] !== undefined || /[?&]_rsc=/.test(r.url());
}

/** `/print?signs=group` from a full RSC address: no host, no `_rsc`, no trailing `?` or `&`. */
export function targetOf(url: string): string {
  return url
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/([?&])_rsc=[^&]*&?/, "$1")
    .replace(/[?&]$/, "");
}

/**
 * ONE ADDRESS, HOWEVER IT IS SPELT (backlog B85, from the reviews of #1185).
 *
 * The crawl matched a press's navigation to its target by exact string, so a trailing slash, a
 * reordered query string or a host on the front of it raised a STUCK for a screen that had arrived.
 * Same address means: same pathname (a trailing slash ignored), the same query parameters as a set
 * (order ignored, repeated keys counted, Next's `_rsc` ignored), host and fragment disregarded.
 * A different path, a different value or a missing parameter is a different address, so a press that
 * went somewhere else is still judged so.
 */
export function addressKey(url: string): string {
  const u = new URL(url, "http://crawl.invalid");
  const path = u.pathname.replace(/\/+$/, "") || "/";
  const pairs = [...u.searchParams.entries()]
    .filter(([k]) => k !== "_rsc")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  return `${path}?${pairs.sort().join("&")}`;
}

export function sameAddress(a: string, b: string): boolean {
  return addressKey(a) === addressKey(b);
}

/**
 * Has the page arrived at one of the addresses its press navigated to? A redirect counts: the redirected
 * request is itself a navigation the page sends, so its final address is among `targets`.
 */
export function arrivedAt(current: string, targets: string[]): boolean {
  return targets.some((t) => sameAddress(current, t));
}

/** The navigation targets that are somewhere other than where the press began. */
export function elsewhere(startUrl: string, targets: string[]): string[] {
  return targets.filter((t) => !sameAddress(t, startUrl));
}

export function watchNavigations(page: Pageish) {
  const inFlight = new Set<Req>();
  const seenTargets: string[] = [];
  const waiters: Array<() => void> = [];
  const drained = () => {
    if (inFlight.size === 0) for (const w of waiters.splice(0)) w();
  };
  const onRequest = (r: Req) => {
    if (isNavigationRequest(r)) {
      inFlight.add(r);
      seenTargets.push(targetOf(r.url()));
    }
  };
  const onDone = (r: Req) => {
    if (inFlight.delete(r)) drained();
  };
  page.on("request", onRequest);
  page.on("requestfinished", onDone);
  page.on("requestfailed", onDone);
  return {
    /** Every navigation target (path and query, `_rsc` stripped) sent since watching began, answered or not. */
    seen: () => [...seenTargets],
    /** How many navigation requests have been sent and not answered. */
    pending: () => inFlight.size,
    /** Resolves `{ ok: true }` once nothing is in flight; `{ ok: false, waiting }` if one is still unanswered after `ms`. */
    async settled(ms = 10_000): Promise<{ ok: true } | { ok: false; waiting: string }> {
      if (inFlight.size === 0) return { ok: true };
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), ms);
      });
      const empty = new Promise<true>((resolve) => waiters.push(() => resolve(true)));
      const ok = await Promise.race([empty, timedOut]);
      clearTimeout(timer);
      if (ok) return { ok: true };
      const first = [...inFlight][0];
      const u = first ? first.url() : "";
      return { ok: false, waiting: targetOf(u).slice(0, 120) };
    },
    stop() {
      page.off("request", onRequest);
      page.off("requestfinished", onDone);
      page.off("requestfailed", onDone);
    },
  };
}
