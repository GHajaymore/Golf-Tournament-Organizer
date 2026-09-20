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
export function LiveRefresh({
  renderedAt,
  compact = false,
  final = false,
}: {
  renderedAt: string;
  /**
   * Every card is in, so nothing can move — the same value that puts "Final"
   * on the badge above this line.
   *
   * It read "Live · updated just now" under a badge reading "Final", which is
   * the two-places-one-question fault this file's own header was written
   * about, arriving from the other direction: the label was honest about the
   * FETCH and silent about whether there was anything left to fetch. Seen on
   * the seeded festival 2026-09-20.
   *
   * It also stops the polling. A finished tournament's share link left open
   * refreshed itself every POLL_MS for ever, on a spectator's phone, for
   * scores that cannot change.
   */
  final?: boolean;
  /**
   * Sits inline in a page header rather than centred under a board.
   *
   * A prop rather than a second component, and the reason is the whole point of
   * this file: the console leaderboard previously rendered a STATIC badge
   * reading "Updating live" beside a board that never updated. Two places
   * claiming to report freshness, one of them lying, is exactly what happens
   * when the polling and the label are allowed to live apart. There is one of
   * these, it does both, and where it is placed is a layout detail.
   */
  compact?: boolean;
}) {
  const router = useRouter();
  const [now, setNow] = useState<number | null>(null);

  // Mounted-only, so the server and the first client render agree. Relative
  // time is the classic hydration mismatch: the server renders "just now" and
  // the client, a moment later, renders something else.
  useEffect(() => {
    // A final board's label carries no time, so there is nothing for a clock
    // to change — and a per-second re-render of a finished leaderboard is the
    // same waste as the polling below, one order of magnitude worse.
    if (final) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [final]);

  useEffect(() => {
    if (final) return;
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
  }, [router, final]);

  const age = now === null ? 0 : now - new Date(renderedAt).getTime();
  const { label, stale } = freshness(age);
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  return (
    <p
      style={{
        fontSize: 12,
        margin: compact ? 0 : "24px 0 0",
        textAlign: compact ? "left" : "center",
        // NOT `white-space: nowrap`, which is what the first version of the
        // compact variant did and what `layout.spec` caught: "Live · updated
        // just now" beside a 27px heading in a space-between row does not fit
        // a 393px phone, and refusing to wrap pushed the page to 402px in a
        // 393px viewport. The label is allowed to wrap; the header it sits in
        // is allowed to stack, and the `minWidth: 0` below is what lets this
        // shrink inside a flex parent at all.
        color: stale || offline ? "var(--color-warning)" : "var(--color-neutral-400)",
        display: "flex",
        alignItems: "center",
        justifyContent: compact ? "flex-start" : "center",
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
      {final ? (
        // No time at all. The age of a board that cannot change is not a fact
        // a reader needs, and printing one invites them to wonder whether
        // something newer exists.
        //
        // And it says nothing about CARDS. The first draft read "every card is
        // in", which is what `allIn` mostly means — but `declaredFinal` also
        // sets it from the committee closing the tournament, and a round
        // scored by hand has no cards to be in. What is true either way is
        // that the number on the screen is the last one there will be.
        <span>Final · these scores no longer change</span>
      ) : now === null ? (
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
