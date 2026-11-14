"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** How often an open console asks the server again: the player side's siren cadence (`SuspensionAlarm`). */
export const PLAY_STATUS_REFRESH_MS = 20_000;

/**
 * THE FRAME SUSPEND PLAY SITS IN, on every console screen (Rule 5.7; review of
 * #1149, C2 and the persona walk).
 *
 * KEPT TRUE. The shell is a layout, and a layout is NOT drawn again when the
 * organizer moves between its screens: without this, a second staff member
 * whose console was open when the first suspended play went on seeing
 * "Suspend play" on every screen they clicked to, and — worse — after a
 * resume and a fresh suspension, a stale banner whose Resume would send the
 * field back out. So while it is drawn (staff, on a day of play or while
 * suspended — bounded), it asks the server again every 20 seconds and the
 * moment the screen comes back into view. `router.refresh()` keeps what is
 * typed and open on the screen; it only brings the server's state.
 *
 * KEPT IN VIEW. Sticky under the phone's top bar (measured, not guessed: the
 * bar's height moves with the notch), on its own ground, so on a long tee
 * sheet scrolled to the 14th group the button is still under the thumb — and
 * it covers only its own row, which is the button or the banner.
 *
 * NEVER ON PAPER (`no-print`): a printed tee sheet or set of cards carries no
 * committee control and no banner about this minute.
 */
export function PlayStatusFrame({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const frame = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let last = 0;
    const ask = () => {
      if (document.visibilityState !== "visible") return;
      // Back in view and focused in the same moment: one request, not two.
      const now = Date.now();
      if (now - last < 2_000) return;
      last = now;
      router.refresh();
    };
    const timer = window.setInterval(ask, PLAY_STATUS_REFRESH_MS);
    document.addEventListener("visibilitychange", ask);
    window.addEventListener("focus", ask);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", ask);
      window.removeEventListener("focus", ask);
    };
  }, [router]);

  useEffect(() => {
    const el = frame.current;
    const bar = document.querySelector<HTMLElement>(".m-topbar");
    if (!el || !bar) return;
    // Hidden on a desktop (`display: none`), the bar measures 0 and the frame sticks to the top.
    const place = () => el.style.setProperty("--play-status-top", `${bar.getBoundingClientRect().height}px`);
    place();
    const watch = new ResizeObserver(place);
    watch.observe(bar);
    return () => watch.disconnect();
  }, []);

  return (
    <div ref={frame} className="no-print console-play-status">
      {children}
    </div>
  );
}
