import type { KeyboardEvent } from "react";

/**
 * ENTER KEEPS WHAT YOU TYPED (2026-10-13).
 *
 * A dozen boxes in the console save when they are LEFT: a knockout's margin, a
 * prize's amount, a side's name, a cut's size, a player's handicap. Leaving is
 * a click somewhere else or a Tab. Enter — what most people press when they
 * have finished typing a figure — did nothing at all, in any browser: the box
 * kept the focus, nothing was sent, and nothing said so. The figure was saved
 * later if the next thing the organizer did happened to take the focus away,
 * and lost if it was closing the tab.
 *
 * Found by the first run of the suite on Firefox. The knockout spec typed the
 * final's margin and pressed Tab; the final's box is the last thing on the
 * page that can take the focus, and there Firefox had nowhere to send it, so
 * the box was never left and "1 UP" was never saved. The spec was standing in
 * for a person who presses Enter.
 *
 * So a box that saves when it is left is left when Enter is pressed. One
 * handler, on the box itself: the save stays where it was, in `onBlur`, and
 * cannot run twice. `saves-on-leave-saves-on-enter.test.ts` holds every such
 * box to it.
 *
 * NOT a listener on the whole page, deliberately. Score entry and the course
 * picker give Enter a meaning of their own; a page-wide rule would have to
 * guess which boxes to leave alone, and the ones it guessed wrong about are
 * the ones a card is typed into.
 */
export function leaveOnEnter(e: KeyboardEvent<HTMLInputElement>): void {
  if (e.key === "Enter") e.currentTarget.blur();
}
