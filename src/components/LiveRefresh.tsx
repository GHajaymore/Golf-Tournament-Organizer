"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { freshness, POLL_MS } from "@/lib/domain/freshness";

/**
 * Keeps the public leaderboard up to date, and says how old it is.
 *
 * The board said "pull down to refresh" and meant it: nothing on the page ever
 * updated itself, so a spectator watching a group come up the 18th was reading
 * whatever had loaded when they opened the link.
 *
 * POLLING, deliberately, rather than a socket. These phones are on a golf
 * course — patchy signal, dead spots between holes, a browser that suspends
 * the tab in a pocket. Every poll here is an independent request that either
 * arrives or does not; there is no connection to drop, no reconnect storm when
 * a hundred spectators come back into coverage at once, and nothing to hold
 * open on the server. And the data barely moves: a fourball finishes a hole
 * about every twelve minutes, so sub-second delivery would buy a spectator
 * nothing they could perceive.
 *
 * `renderedAt` is stamped by the SERVER on each render, which is what makes
 * the age honest. A client-side "last tried" clock keeps ticking while the
 * phone is behind the 12th with no signal, so it would report the board as
 * fresh exactly when it is not. This timestamp cannot advance unless a
 * response actually came back, so the label ageing IS the failure showing
 * through.
 *
 * It renders the standings' own freshness. It never renders scores, so it
 * cannot disagree with the table above it.
 */
export function LiveRefresh({ renderedAt }: { renderedAt: string }) {
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null);

  // Mounted-only, so the server and the first client render agree. Relative
  // time is the classic hydration mismatch: the server renders "just now" and
  // the client, a moment later, renders something else.
  useEffect(() => {
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    /**
     * Only while somebody is looking.
     *
     * A leaderboard left open in a background tab for a five-hour round would
     * otherwise poll six hundred times on a phone in somebody's pocket. This
     * is battery and mobile data belonging to a spectator who is not even
     * looking at it, spent on scores nobody is reading.
     */
    const awake = () =>
      typeof document !== "undefined" &&
      document.visibilityState === "visible" &&
      (typeof navigator === "undefined" || navigator.onLine !== false);

    const poll = setInterval(() => {
      if (awake()) router.refresh();
    }, POLL_MS);

    // Coming back to the tab, or back into signal, should not mean waiting out
    // the rest of an interval to find out what happened on the last two holes.
    const wake = () => {
      if (awake()) router.refresh();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);

    return () => {
      clearInterval(poll);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [router]);

  const age = now === null ? 0 : now - new Date(renderedAt).getTime();
  const { label, stale } = freshness(age);
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  return (
    <p
      style={{
        fontSize: 12,
        marginTop: 24,
        textAlign: "center",
        color: stale || offline ? "var(--color-warning, var(--color-neutral-300))" : "var(--color-neutral-400)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 7,
        minWidth: 0,
      }}
      // Announced when it changes to stale, and not on every tick — a screen
      // reader repeating "2 min ago, 3 min ago" for five hours is unusable.
      aria-live={stale ? "polite" : "off"}
    >
      <span
        aria-hidden
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          flex: "none",
          background: stale || offline ? "var(--color-neutral-400)" : "var(--color-accent-2-300)",
        }}
      />
      {now === null ? (
        // Before the clock is read, say the durable thing rather than a time
        // that would immediately change.
        <span>Read-only · updates on its own</span>
      ) : offline ? (
        <span>No signal — showing scores from {label}</span>
      ) : stale ? (
        <span>Last reached {label} — scores may have moved since</span>
      ) : (
        <span>Live · updated {label}</span>
      )}
    </p>
  );
}
