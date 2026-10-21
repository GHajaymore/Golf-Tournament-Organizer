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
