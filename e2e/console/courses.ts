import type { Locator, Page } from "@playwright/test";
import { consoleUrl } from "../../src/lib/console-url";
import { SCREENS_BUILT } from "./index";

/**
 * THE CLUB'S COURSES SCREEN (R2), as a person uses it: `/courses`, reached while it is only previewed.
 * Its card is the library's own (`CourseLibrary`, titled "Courses"), so the specs that walk Tournament
 * details' library walk this one through the same locator.
 */
export const COURSES_PATH = SCREENS_BUILT.courses ?? "/courses";

/** Opens the screen as a building screen, optionally sent from another screen (`?from=`), and returns its library card. */
export async function openCourses(page: Page, from?: string): Promise<Locator> {
  const path = from ? `${COURSES_PATH}?from=${encodeURIComponent(from)}` : COURSES_PATH;
  await page.goto(consoleUrl(path, "build"));
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.locator("h1").first().waitFor({ state: "visible" });
  return library(page);
}

/** The library's card on the page. */
export function library(page: Page): Locator {
  return page.locator(".card", { has: page.locator(".card-title", { hasText: /^Courses$/ }) }).first();
}

/** The "Back to …" link a screen offers when a person was sent here. */
export function backLink(page: Page, name: string | RegExp): Locator {
  return page.getByRole("link", { name: typeof name === "string" ? `Back to ${name}` : name });
}
