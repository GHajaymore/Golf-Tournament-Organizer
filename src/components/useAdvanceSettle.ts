"use client";
import { useEffect, useRef, useState } from "react";

/**
 * HOW LONG A NEW HOLE IGNORES THE SCORE PAD AFTER THE CARD MOVES ON ITSELF
 * (B117, 2026-11-23): 400ms from the moment the new hole appears. Human
 * double-taps run 100-300ms, gloved or bumped ones slower, so this swallows
 * the second half of one; and a player who reads the new hole before scoring
 * it is not held up, because the advance itself already took 160ms.
 */
export const ADVANCE_SETTLE_MS = 400;

/** How long the "that tap was not counted" note stays on the new hole. */
export const TAP_NOTE_MS = 700;

/**
 * ONE RULE FOR "THE CARD JUST MOVED ON, SO A PAD TAP IS STILL THE LAST ONE"
 * (shared by `HoleByHoleCard` and `HoleResultCard`).
 *
 * The card moves to the next hole 160ms after a score is set. A second tap of
 * a double-tap landed on the NEXT hole's pad after that and scored a hole
 * nobody had played, silently. Call `markAdvanced()` in the step that moves
 * the card on, and ask `refused()` before a pad tap is written. Only the
 * card's own advance marks it; a deliberate move (strip, Next, swipe) calls
 * `clear()` so nobody going straight back to correct a hole is held up. A tap
 * inside the window is dropped before it reaches the writer, so nothing is
 * queued or sent for it, and `flash` turns on briefly so the player sees it
 * was not taken. Every tap outside the window goes as before, online or off.
 *
 * The clock is a device-side tap debounce, not a club's day, so it is
 * `Date.now` (a test passes its own).
 */
export function useAdvanceSettle(now: () => number = Date.now) {
  const at = useRef<number | null>(null);
  const [flash, setFlash] = useState(false);
  const off = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (off.current) clearTimeout(off.current);
    },
    [],
  );
  const settling = () => at.current != null && now() - at.current < ADVANCE_SETTLE_MS;
  return {
    markAdvanced: () => {
      at.current = now();
    },
    clear: () => {
      at.current = null;
    },
    settling,
    /** True means DROP the tap; the new hole flashes its note for a moment. */
    refused: () => {
      if (!settling()) return false;
      setFlash(true);
      if (off.current) clearTimeout(off.current);
      off.current = setTimeout(() => setFlash(false), TAP_NOTE_MS);
      return true;
    },
    flash,
  };
}
