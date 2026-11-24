"use client";
import { useEffect, useRef, useState } from "react";

/**
 * HOW LONG, FROM THE TAP THAT SET A SCORE, A NEW HOLE IGNORES THE SCORE PAD
 * (B117, 2026-11-23; origin moved from the advance to the tap by the PE's
 * ruling the same day, which also resolves B119). The card moves on 160ms
 * after the tap, so only a tap in the new hole's first ~240ms is dropped:
 * faster than anyone sees a new hole and aims at it (about 250ms at best),
 * and still the second touch of a double-tap, which runs 100-300ms, gloved
 * ones slower. A tap before the card has moved lands on the same hole and is
 * taken (a correction, or the same score again).
 */
export const ADVANCE_SETTLE_MS = 400;

/** How long the "that tap was not counted" note stays on the new hole. */
export const TAP_NOTE_MS = 700;

/**
 * ONE RULE FOR "THE CARD JUST MOVED ON, SO A PAD TAP IS STILL THE LAST ONE"
 * (shared by `HoleByHoleCard` and `HoleResultCard`).
 *
 * `stamp()` when a tap sets a score and starts the advance; `markAdvanced()`
 * when the card moves (it ARMS the window); `refused()` before a pad tap is
 * written; `clear()` from `go()`, because a deliberate move (strip, Next,
 * swipe) is a decision and nobody going back to correct a hole is held up.
 * A tap dropped inside the window never reaches the writer, so nothing is
 * queued or sent for it, and `flash` shows the note briefly. Every other tap
 * goes as before, online or off.
 *
 * `holding` is true for exactly the armed window: the pad's buttons carry
 * `aria-disabled` (never `disabled`, so the click still runs and can be
 * dropped with its note) so that a browser test's click waits for the pad to
 * take taps again instead of racing a timer.
 *
 * The clock is a device-side tap debounce, not a club's day, so it is
 * `Date.now` (a test passes its own).
 */
export function useAdvanceSettle(now: () => number = Date.now) {
  const tapAt = useRef<number | null>(null);
  const armed = useRef(false);
  const [flash, setFlash] = useState(false);
  const [holding, setHolding] = useState(false);
  const off = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (off.current) clearTimeout(off.current);
      if (hold.current) clearTimeout(hold.current);
    },
    [],
  );
  const settling = () => armed.current && tapAt.current != null && now() - tapAt.current < ADVANCE_SETTLE_MS;
  const stopHolding = () => {
    if (hold.current) clearTimeout(hold.current);
    hold.current = null;
    setHolding(false);
  };
  return {
    /** A tap set a score and the advance is starting: the window runs from now, unarmed. */
    stamp: () => {
      tapAt.current = now();
      armed.current = false;
    },
    /** The card moved on by itself: the window is armed until 400ms after the tap. */
    markAdvanced: () => {
      if (tapAt.current == null) return;
      armed.current = true;
      const left = Math.max(0, ADVANCE_SETTLE_MS - (now() - tapAt.current));
      if (hold.current) clearTimeout(hold.current);
      setHolding(left > 0);
      hold.current = left > 0 ? setTimeout(stopHolding, left) : null;
    },
    clear: () => {
      armed.current = false;
      tapAt.current = null;
      stopHolding();
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
    holding,
  };
}
