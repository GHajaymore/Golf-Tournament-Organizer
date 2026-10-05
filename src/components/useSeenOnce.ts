"use client";
import { useCallback, useEffect, useState } from "react";

/**
 * HAS THIS PHONE SEEN IT BEFORE?
 *
 * Ajay, 2026-10-05: the player screens were "crowded" with sentences "required
 * only once and not a static sentence sitting there". A how-to line read on
 * the first tee is noise on the fourteenth, and on a 393px phone in the sun
 * every line of it pushes the score pad down.
 *
 * So a sentence like that is shown the first time, and remembered — on this
 * phone, in `localStorage`. Per PHONE rather than per account, deliberately:
 * nothing here is a record anybody needs back, a scorer may be holding a
 * partner's phone, and a fresh phone showing a tip once more costs nothing.
 *
 * `seen` is `null` until the browser has been asked. The server cannot know,
 * so the first render must not depend on the answer or the page hydrates
 * against a different tree; callers pick which side of `null` is safe for
 * them. Storage can be missing or throw (private mode, blocked site data) —
 * then everything reads as unseen and is simply shown, which is the old
 * behaviour, never a lost control.
 */
const PREFIX = "thq.seen.";

export function hasSeen(key: string): boolean {
  try {
    return window.localStorage.getItem(PREFIX + key) === "1";
  } catch {
    return false;
  }
}

export function markSeen(key: string): void {
  try {
    window.localStorage.setItem(PREFIX + key, "1");
  } catch {
    /* storage unavailable: the tip shows again next time, which is harmless */
  }
}

export function useSeenOnce(key: string): { seen: boolean | null; markSeen: () => void } {
  const [seen, setSeen] = useState<boolean | null>(null);
  useEffect(() => {
    setSeen(hasSeen(key));
  }, [key]);
  const mark = useCallback(() => {
    markSeen(key);
    setSeen(true);
  }, [key]);
  return { seen, markSeen: mark };
}
