/**
 * THE BANNER'S PURE RULES, IN A MODULE WITH NO "use client".
 *
 * A function exported from a "use client" file is a client reference on the server: calling it from
 * a server component throws "Attempted to call scopeLockBannerDrawn() from the server" and the page
 * returns 500. `LockedOnce` (a server-renderable wrapper) asks `scopeLockBannerDrawn`, so the rule
 * lives here, importable by server and client alike. `ScopeLockBanner.tsx` imports it; nothing
 * copies it.
 */

/**
 * THE BANNER'S WORDS, FOR A CONTROL IT SHUTS (console sweep, J51). A control greyed by one of this
 * screen's locks points at the banner's reason with `aria-describedby={SCOPE_LOCK_REASON_ID}`.
 * Point at it only where the banner is drawn (`scopeLockBannerDrawn`): an id that names nothing
 * describes nothing.
 */
export const SCOPE_LOCK_REASON_ID = "scope-lock-banner-reason";

/** Whether `ScopeLockBanner` draws anything for these props: the one answer, asked by the banner itself. */
export function scopeLockBannerDrawn(locks: readonly unknown[], correction: unknown, open: readonly string[] | null | undefined): boolean {
  return locks.length > 0 || !!correction || !!open;
}

/**
 * THE BANNER IS NAMED FOR WHAT IT SAYS. A screen reader announces the region's name before its
 * words, so a banner whose only line is "Open for a correction" must not be announced as "Locked"
 * (round G567-2). Any lock line on the screen makes it "Locked".
 */
export function bannerName(lockLines: number, correctionOpen: boolean): "Locked" | "Open for a correction" | "Under way" {
  if (lockLines > 0) return "Locked";
  return correctionOpen ? "Open for a correction" : "Under way";
}
