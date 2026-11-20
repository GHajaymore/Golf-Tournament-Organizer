import { useEffect, useRef, type RefObject } from "react";

/**
 * A REFUSAL IS SAID WHERE THE PRESS WAS — and brought into view when it appears.
 *
 * Used as a ref: `<p role="alert" ref={bringIntoView}>`. It scrolls the least it can
 * (`block: "nearest"`), so a refusal already on the screen does not move anything.
 *
 * ONE FUNCTION, DECLARED ONCE, ON PURPOSE. Written inline — `ref={(el) =>
 * el?.scrollIntoView(...)}` — the ref is a new function on every render, and React
 * calls it again each time: while a refusal stayed up, every keystroke anywhere on
 * the screen scrolled the page back to it, so somebody who had scrolled away to fix
 * the field it named was pulled back down as they typed. A function with one
 * identity is called when the element appears and not again (2026-10-21).
 * `bring-into-view.test.ts` refuses the inline form anywhere in `src`.
 */
export function bringIntoView(el: HTMLElement | null): void {
  el?.scrollIntoView({ block: "nearest" });
}

/**
 * AND KEPT IN VIEW WHEN THE SCREEN CATCHES UP WITH A LOCK (J12, PR 7b; 2026-11-09).
 *
 * A press refused by a scoped lock draws the screen again (`useCaughtUp`): the
 * "Locked" banner arrives ABOVE the control a moment after the refusal was said
 * under it. Further down the page the browser holds the place (scroll anchoring);
 * at the very top of the page it does not, so the banner's height pushed a
 * refusal that had been said in view to below the fold — "Cut the field for
 * Round 2" on Rounds & formats, pressed without scrolling, answered with a
 * sentence nobody could see (`locked-setup-refuses-in-words.spec.ts`, CI run
 * 42718807588: the page's scroll was 0 from the press to the failure).
 * `bringIntoView` cannot see that: it is called once, when the refusal appears,
 * which is before the banner does.
 *
 * So: `const ref = useKeptInView(refused, locked)` and `<p role="alert" ref={ref}>`.
 * It scrolls the least it can when the sentence appears or changes, and once more
 * when `caughtUp` changes — the lock arriving. On no other render, so the
 * keystroke fault `bringIntoView` was written against cannot come back.
 */
export function useKeptInView<T extends HTMLElement = HTMLParagraphElement>(said: string, caughtUp: boolean): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (said) ref.current?.scrollIntoView({ block: "nearest" });
  }, [said, caughtUp]);
  return ref;
}
