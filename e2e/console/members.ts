import type { Locator, Page } from "@playwright/test";
import { consoleUrl } from "../../src/lib/console-url";
import { SCREENS_BUILT, openFold } from "./index";

/**
 * THE CLUB'S MEMBERS (R7), as a person uses it: `/roster`, reached while the redesign is only previewed. A
 * member's history is a section of the same screen (`?member=`), a kit `SectionFold` that a phone folds until a
 * member is chosen.
 */
export const MEMBERS_PATH = SCREENS_BUILT.members ?? "/roster";

/** Opens Members as a building screen, optionally on one member's history. */
export async function openMembers(page: Page, memberId?: string): Promise<void> {
  const path = memberId ? `${MEMBERS_PATH}?member=${encodeURIComponent(memberId)}` : MEMBERS_PATH;
  await page.goto(consoleUrl(path, "build"));
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByRole("heading", { level: 1, name: "Members" }).waitFor({ state: "visible" });
}

/** The history section, opened if a phone folded it; find controls INSIDE the section it returns. */
export async function openHistory(page: Page): Promise<Locator> {
  const section = page.locator('section[data-section="history"]');
  await openFold(section.locator("button[aria-expanded]").first());
  return section;
}
