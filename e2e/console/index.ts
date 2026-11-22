import type { Page } from "@playwright/test";
import { consoleUrl } from "../../src/lib/console-url";
import type { ScreenKey } from "../../src/lib/domain/console-merges";

/**
 * THE REDESIGNED SCREENS' PAGE OBJECTS LIVE IN THIS FOLDER (R1c): one file per screen,
 * `e2e/console/<screen>.ts`. A screen's PR adds its page object here, changes its own line of
 * `SCREENS_BUILT` to its path, and adds a `@redesign` describe to each spec it ports.
 */

/** Opens a building screen (`?stepper=1&build=1`) and waits for its heading. */
export async function openScreen(page: Page, path: string): Promise<void> {
  await page.goto(consoleUrl(path, "build"));
  await page.locator("h1").first().waitFor({ state: "visible" });
}

/**
 * The path of each redesigned screen once it is built, or null while it is not. The console sweep
 * (`console-sweep.spec.ts`) walks every non-null path at 320px, so a screen is swept the day its
 * line is set and no lane edits the sweep. One line per key, so three lanes never collide.
 */
export const SCREENS_BUILT: Readonly<Record<ScreenKey, string | null>> = {
  home: null,
  event: null,
  rounds: "/stages",
  players: null,
  prizes: null,
  teeTimes: null,
  scoreEntry: null,
  leaderboard: null,
  results: null,
  money: null,
  events: null,
  members: null,
  courses: null,
  clubSettings: null,
};

/** The built screens' paths, in key order. */
export function builtScreenPaths(): string[] {
  return Object.values(SCREENS_BUILT).filter((p): p is string => p !== null);
}
