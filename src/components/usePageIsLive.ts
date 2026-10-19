"use client";
import { useSyncExternalStore } from "react";

/**
 * Is this page's script running yet? False in the server's drawing and while
 * React takes the page over; true from then on.
 *
 * A SCORE TAPPED BEFORE THE PAGE IS LIVE IS LOST (2026-10-18). Picking your
 * name on a round code reloads the page, so the scorecard arrives drawn by the
 * server, buttons and all, before its script. On one bar of signal that gap is
 * seconds, and a tap in it goes nowhere: the button looked pressed, the hole
 * stayed "not played". Found by a round on a small phone, where the spec tapped
 * "Hole 1 halved" in that gap. A button that cannot act yet says so by being
 * disabled, and a scorer, like Playwright, waits for it.
 *
 * Text boxes are not this hook's business: `TypedBeforeLoad` keeps what was
 * typed early and hands it over.
 */
const noSubscription = () => () => {};

export function usePageIsLive(): boolean {
  return useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
}
