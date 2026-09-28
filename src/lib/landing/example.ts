import { courseHandicap, playingHandicapFrom } from "@/lib/domain/handicap";

/**
 * The worked handicap example the front door and the FAQ both quote: a 12.4
 * index on a card rated 71.5 off 140 slope, playing four-ball at its 90%
 * allowance — the single calculation most golf software gets wrong.
 *
 * Computed by the engine the app scores with, so the number a visitor is shown
 * on the way in cannot drift from the number they get once inside. Moved here
 * from page.tsx when the FAQ got a page of its own, so the two answers are one.
 */
export const HANDICAP_EXAMPLE = (() => {
  const index = 12.4;
  const tee = { courseRating: 71.5, slopeRating: 140, par: 72 };
  const allowance = 90;
  const course = courseHandicap(index, tee);
  return { index, tee, allowance, course, playing: playingHandicapFrom(course, allowance) };
})();
