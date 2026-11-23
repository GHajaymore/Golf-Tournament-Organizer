import type { Locator, Page } from "@playwright/test";
import { consoleUrl } from "../../src/lib/console-url";
import { SCREENS_BUILT, openFold } from "./index";
import { openSettingsTab } from "../settings-tabs";

/**
 * CLUB SETTINGS' STAFF & ACCESS (R7), as a person uses it: `/organization#access`, reached while the redesign is
 * only previewed. Two sections sit in the tab, each a kit `SectionFold` (a phone folds the one that does not need
 * you): "On this event" is this tournament's helpers (what `/access` was), "Club staff" is the club's own list.
 */
export const CLUB_SETTINGS_PATH = SCREENS_BUILT.clubSettings ?? "/organization";

/** Opens Club settings as a building screen, on its Staff & access tab. Returns the tab's panel. */
export async function openStaffAndAccess(page: Page): Promise<Locator> {
  await page.goto(consoleUrl(`${CLUB_SETTINGS_PATH}#access`, "build"));
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.locator("h1").first().waitFor({ state: "visible" });
  return openSettingsTab(page, "Staff & access");
}

/** One section of Staff & access, opened if a phone folded it, and the section returned (find controls INSIDE it). */
export async function openAccessSection(page: Page, which: "event" | "club"): Promise<Locator> {
  const section = page.locator(`section[data-section="access-${which}"]`);
  await openFold(section.locator("button[aria-expanded]").first());
  return section;
}

/** Opens a named tab of Club settings, as a building screen, and returns its panel. */
export async function openClubTab(page: Page, label: string): Promise<Locator> {
  await page.goto(consoleUrl(CLUB_SETTINGS_PATH, "build"));
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.locator("h1").first().waitFor({ state: "visible" });
  return openSettingsTab(page, label);
}
