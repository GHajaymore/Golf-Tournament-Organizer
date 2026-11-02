import type { Page } from "@playwright/test";

/**
 * THE FRONT DOOR IS NOT ITS FULL HEIGHT WHEN IT HAS LOADED.
 *
 * The page is whole without its script: the story of a round is a plain
 * section. When the script starts, the story is told by scrolling instead, and
 * becomes a track about two and a half thousand pixels taller. Measured on a
 * phone, on Safari's engine and on Chrome's (2026-10-13):
 *
 *     half a second after it loads    14,021 px tall, the sign-up form at 11,903
 *     one second after                16,559 px tall, the sign-up form at 14,441
 *
 * Nobody at the top of the page sees that — it happens a long way below the
 * fold — but a test that reads a position the moment the page has loaded and
 * scrolls to it later is scrolling to where something USED to be. The bottom-
 * bar test did exactly that: it read where the sign-up form was, scrolled
 * there, landed in the pricing section and reported the bar up "at the sign-up
 * form". It passed for as long as the page happened to take longer to load
 * than its script took to start, and failed on Safari's engine at two sizes
 * the first round after a change made the page load sooner.
 *
 * The same reading, taken early by a walk DOWN the page, does not fail. It
 * stops two and a half thousand pixels short of the bottom and reports
 * everything above that as clean — which is the worse of the two.
 *
 * So: nothing on this page is measured until its script has run and its height
 * has stopped changing, and a test that scrolls to a thing asks where the
 * thing is at the moment it scrolls.
 *
 * SINCE 2026-11-01 THE PAGE NO LONGER GROWS: the week is a stepper in the
 * page's own flow, the same markup with or without script ("Landing story
 * section - redesign spec"), and `landing-screens.spec.ts` holds the growth to
 * a few pixels. The wait is kept because it is cheap, and a late typeface or
 * the hero could still nudge a pixel.
 */
export async function landingSettled(page: Page): Promise<number> {
  // The script's own marks: the live strip is doubled first, and the week's stepper is wired in the same pass.
  // A page with neither (the FAQ, the terms) has no script to wait for.
  await page
    .waitForFunction(() => !document.querySelector("main.m-home") || !!document.querySelector("#ticker-track[data-doubled], #story[data-ready]"), null, { timeout: 15_000 })
    .catch(() => {});
  let last = -1;
  let same = 0;
  for (let i = 0; i < 80 && same < 3; i += 1) {
    const now = await page.evaluate(() => document.documentElement.scrollHeight);
    same = now === last ? same + 1 : 0;
    last = now;
    if (same < 3) await page.waitForTimeout(150);
  }
  return last;
}
