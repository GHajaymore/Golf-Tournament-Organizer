import { courseHandicapExact, playingHandicapFrom, wholeStrokes } from "@/lib/domain/handicap";

/**
 * The worked handicap example the front door and the FAQ both quote: a 12.4
 * index on a card rated 71.5 off 140 slope, playing four-ball at its 90%
 * allowance — the single calculation most golf software gets wrong.
 *
 * Computed by the engine the app scores with, so the number a visitor is shown
 * on the way in cannot drift from the number they get once inside. Moved here
 * from page.tsx when the FAQ got a page of its own, so the two answers are one.
 *
 * AND UNTIL 2026-10-13 THIS APP GOT IT WRONG TOO, in this very example. It read
 * course handicap 15, playing handicap 14: 90% of the ROUNDED figure, rounded
 * again. The Rules of Handicapping (6.2a) take the allowance of the unrounded
 * course handicap — 14.86 here — and round once, which is 13. `exact` is that
 * figure, shown beside the whole number so the last line can be checked by
 * anybody with a calculator.
 */
export const HANDICAP_EXAMPLE = (() => {
  const index = 12.4;
  const tee = { courseRating: 71.5, slopeRating: 140, par: 72 };
  const allowance = 90;
  const exact = courseHandicapExact(index, tee);
  return { index, tee, allowance, exact, course: wholeStrokes(exact), playing: playingHandicapFrom(exact, allowance) };
})();
