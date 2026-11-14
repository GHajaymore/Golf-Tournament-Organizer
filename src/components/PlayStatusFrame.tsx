"use client";
import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

/** How often an open console asks: the player side's siren cadence (`SuspensionAlarm`). */
export const PLAY_STATUS_REFRESH_MS = 20_000;

/** The one question the frame asks: one timestamp of the session's own tournament, staff only. */
export const PLAY_STATUS_PROBE = "/api/console-play-status";

/**
 * THE FRAME SUSPEND PLAY SITS IN, on every console screen (Rule 5.7; review and
 * re-review of #1149, and the persona walk).
 *
 * KEPT TRUE, CHEAPLY. The shell is a layout, and a layout is NOT drawn again
 * when the organizer moves between its screens: without this, a second staff
 * member whose console was open when the first suspended play went on seeing
 * "Suspend play" on every screen they clicked to, and — worse — after a
 * resume and a fresh suspension, a stale banner whose Resume would send the
 * field back out. So the frame asks the PROBE (one primary-key select) every
 * 20 seconds, the moment the screen comes back into view, and on every move
 * between screens; only when its answer differs from the suspension this frame
 * was drawn with (`since`) does it re-render the route (`router.refresh()`,
 * which keeps what is typed and open). A blind refresh every 20 s re-rendered
 * the whole shell — 15–20 queries — all day, for a season-long league.
 *
 * KEPT IN VIEW, AND STACKED, NEVER OVER ANYTHING. Sticky under the phone's top
 * bar (its measured height, `--play-status-top`; 0 on a desktop). It publishes
 * where the console's sticky band now ends, `--console-sticky-top` on the
 * document (bar + this frame), and the screens with a sticky header of their
 * own (`SettingsNav`, `SettingsTabs`) stick THERE instead of at 0; the document's
 * `scroll-padding-top` takes the same value, so an anchor, a scrolled-to round
 * or a focused input lands below the band, not under it. Its height is capped
 * to the room between the top bar and the phone's tab bar (`--play-status-bottom`),
 * so a long confirm scrolls inside the frame and its button can always be
 * brought into view (`PlayStatusControl` does that when a confirm opens).
 *
 * NEVER ON PAPER (`no-print`): a printed tee sheet or set of cards carries no
 * committee control and no banner about this minute.
 */
export function PlayStatusFrame({ since, children }: { since: string; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const frame = useRef<HTMLDivElement>(null);

  // Ask the probe; re-render only on a change.
  useEffect(() => {
    let stopped = false;
    const ask = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch(PLAY_STATUS_PROBE, { cache: "no-store" });
        if (!res.ok || stopped) return;
        const now = (await res.json()) as { since?: unknown };
        if (typeof now.since === "string" && now.since !== since) router.refresh();
      } catch {
        // Offline for a moment: the next tick asks again.
      }
    };
    void ask();
    const timer = window.setInterval(ask, PLAY_STATUS_REFRESH_MS);
    document.addEventListener("visibilitychange", ask);
    window.addEventListener("focus", ask);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", ask);
      window.removeEventListener("focus", ask);
    };
    // A move between screens asks again at once (`pathname`).
  }, [router, since, pathname]);

  // Measure the bars, and publish where the sticky band ends.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const root = document.documentElement;
    const topBar = document.querySelector<HTMLElement>(".m-topbar");
    const tabBar = document.querySelector<HTMLElement>(".m-tabbar");
    // A bar hidden on a desktop (`display: none`) measures 0.
    const place = () => {
      const top = topBar?.getBoundingClientRect().height ?? 0;
      el.style.setProperty("--play-status-top", `${top}px`);
      el.style.setProperty("--play-status-bottom", `${tabBar?.getBoundingClientRect().height ?? 0}px`);
      root.style.setProperty("--console-sticky-top", `${top + el.getBoundingClientRect().height}px`);
    };
    place();
    const watch = new ResizeObserver(place);
    for (const it of [el, topBar, tabBar]) if (it) watch.observe(it);
    return () => {
      watch.disconnect();
      root.style.removeProperty("--console-sticky-top");
    };
  }, []);

  return (
    <div ref={frame} className="no-print console-play-status">
      {children}
    </div>
  );
}
