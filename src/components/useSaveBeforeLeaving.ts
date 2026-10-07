"use client";
import { useEffect, useRef } from "react";

/**
 * WHAT THIS PHONE HAS NOT SENT GOES IF THE SCORER LEAVES (2026-10-07).
 *
 * A casual card saves itself a moment after the last tap — 600ms, so a run
 * of taps across a foursome is one write, not twelve. But the wait was a
 * window in which leaving dropped the save on the floor: the timer was
 * cleared with the screen, and the hole just entered never went. Enter the
 * 18th, tap Export, and the last hole of the round was lost. A tap made
 * while an earlier save was still going was lost the same way, because the
 * autosave waits for that save before arming again.
 *
 * So `flush` runs when the screen goes away, when the page is hidden (the
 * phone locked, another app opened) and when it is left. It must read the
 * LATEST cards (from a ref) and send only what differs from what was last
 * sent, queued behind any save already going — so leaving twice, or leaving
 * just after a save, sends nothing twice and nothing older over newer.
 */
export function useSaveBeforeLeaving(flush: () => void) {
  const latest = useRef(flush);
  useEffect(() => {
    latest.current = flush;
  });
  useEffect(() => {
    const now = () => latest.current();
    const hidden = () => {
      if (document.visibilityState === "hidden") now();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", now);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", now);
      now();
    };
  }, []);
}
